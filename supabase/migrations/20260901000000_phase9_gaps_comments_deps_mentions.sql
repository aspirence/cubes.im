-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 9: Gaps (project updates / comments,
-- task dependencies, @mentions, account-deletion FK fix)
-- =============================================================================
-- Builds on Phase 1 (identity/tenancy: users / organizations / teams /
-- team_members + is_team_member / is_team_admin; the teams_user_id_fk and
-- users_active_team_fk constraints), Phase 3 (projects + team_id_of_project /
-- is_project_team_member / is_project_team_admin), Phase 4 (tasks / task_comments
-- + is_task_member) and Phase 5 (create_notification + user_notifications).
--
-- Adds:
--   * project_comments      — the project "Updates" feed. One row per update on a
--     project; `mentions uuid[]` carries the mentioned users' ids (the resolved
--     output of client-side @mention parsing). project_id CASCADE; created_by ->
--     users.
--   * task_dependencies     — directed relations between two tasks in the SAME
--     project-team scope (blocked_by / blocks). Both task_id and depends_on_task_id
--     CASCADE; UNIQUE(task_id, depends_on_task_id); a task cannot depend on itself.
--   * task_comments.mentions uuid[] — a new column on the existing Phase 4 table
--     carrying the mentioned users' ids for a task comment (same mechanism as
--     project_comments.mentions).
--   * notify_project_comment_mentions() / notify_task_comment_mentions() — AFTER
--     INSERT trigger fns (SECURITY DEFINER, pinned search_path) that fan a
--     'mention' notification out to every mentioned user (skipping the author),
--     reusing the Phase 5 create_notification(...) function.
--   * RLS enable + policies + table grants for the two new public tables.
--
-- Account-deletion FK fix (so a user can actually be deleted, cascading cleanly):
--   * teams_user_id_fk  — Phase 1 created it WITHOUT an on-delete action, which
--     BLOCKS deleting a user who created a team. We recreate it as
--     ON DELETE CASCADE. The full chain then is:
--       auth.users  --(users_auth_fk CASCADE)-->  public.users
--         public.users --(organizations_user_id_fk CASCADE)--> organizations
--                                                              --> children (CASCADE)
--         public.users --(teams_user_id_fk now CASCADE)--> teams
--                                                              --> children (CASCADE)
--     so deleting the auth.users row tears down the whole tenant.
--   * users_active_team_fk — Phase 1 created it WITHOUT an on-delete action, which
--     would BLOCK deleting a team that is some user's active_team. We recreate it
--     as ON DELETE SET NULL so deleting a team simply clears any pointer to it.
--   Both are done defensively (drop constraint if exists, then add) and are
--   re-runnable.
--
-- Supabase adaptations carried over from Phases 1-8:
--   * uuid_generate_v4()  ->  extensions.gen_random_uuid() via the column DEFAULT
--     (never cast explicitly in a function body).
--   * any FUNCTION BODY touching gen_random_uuid()/citext pins
--     `set search_path = public, extensions`. The two notify triggers INSERT (via
--     create_notification) a gen_random_uuid()-defaulted user_notifications row and
--     resolve public.* deterministically, so they MUST pin that path.
--
-- Faithfulness notes vs. the legacy schema (cubes-backend/.../1_tables.sql):
--   * legacy modelled mentions as a separate project_comment_mentions table
--     (comment_id, mentioned_index, mentioned_by, informed_by). Phase 9 collapses
--     that to a single `mentions uuid[]` column on project_comments (and the same
--     on task_comments) — the resolved set of mentioned user ids. Rich mention
--     PARSING (turning "@Name" tokens in the text into user ids) is client-side;
--     this layer only stores the ids and fans out notifications.
--   * legacy task_dependencies used (task_id, related_task_id, dependency_type
--     DEPENDENCY_TYPE, UNIQUE(task_id, related_task_id, dependency_type)). Per the
--     Phase 9 brief the column is named depends_on_task_id, the type column is
--     relation_type text CHECK in ('blocked_by','blocks') default 'blocked_by',
--     the UNIQUE is (task_id, depends_on_task_id), and a CHECK forbids a
--     self-dependency (task_id <> depends_on_task_id).
--
-- Re-runnable where practical (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- CREATE OR REPLACE / DROP TRIGGER IF EXISTS / DROP POLICY IF EXISTS / drop+add
-- constraint guarded by pg_constraint). No lookup seed needed.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 project_comments (legacy: project_comments + project_comment_mentions,
--     collapsed). The project "Updates" feed. content is the update body;
--     created_by -> users (who posted it); mentions is the resolved set of
--     mentioned user ids (default empty). project_id CASCADE so an update never
--     outlives its project. created_by SET NULL on user delete so the feed
--     survives an account deletion (the entry just loses its author pointer).
-- -----------------------------------------------------------------------------
create table if not exists public.project_comments (
    id         uuid                     default gen_random_uuid() not null,
    project_id uuid                                               not null,
    content    text                                               not null,
    created_by uuid,
    mentions   uuid[]                   default '{}'::uuid[]      not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint project_comments_pk primary key (id),
    constraint project_comments_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint project_comments_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint project_comments_content_check check (char_length(content) <= 2000)
);

-- -----------------------------------------------------------------------------
-- 1.2 task_dependencies (legacy: task_dependencies, renamed columns per brief).
--     A directed relation between two tasks: relation_type 'blocked_by' (task_id
--     is blocked by depends_on_task_id) or 'blocks' (task_id blocks
--     depends_on_task_id). Both FKs CASCADE so a relation never outlives either
--     endpoint task. UNIQUE(task_id, depends_on_task_id) prevents duplicate edges;
--     the self-dependency CHECK forbids task_id = depends_on_task_id.
--     NOTE: RLS is gated on is_task_member(task_id). Because both tasks must be
--     in the same project (the UI only offers same-project tasks) the task_id
--     side is sufficient to scope the row to its team.
-- -----------------------------------------------------------------------------
create table if not exists public.task_dependencies (
    id                 uuid                     default gen_random_uuid() not null,
    task_id            uuid                                               not null,
    depends_on_task_id uuid                                               not null,
    relation_type      text                     default 'blocked_by'      not null,
    created_at         timestamp with time zone default current_timestamp not null,
    constraint task_dependencies_pk primary key (id),
    constraint task_dependencies_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_dependencies_depends_on_task_id_fk
        foreign key (depends_on_task_id) references public.tasks (id) on delete cascade,
    constraint task_dependencies_unique unique (task_id, depends_on_task_id),
    constraint task_dependencies_not_self check (task_id <> depends_on_task_id),
    constraint task_dependencies_relation_type_check
        check (relation_type in ('blocked_by', 'blocks'))
);

-- -----------------------------------------------------------------------------
-- 1.3 task_comments.mentions — add the resolved-mentioned-ids array to the
--     existing Phase 4 task_comments table. Idempotent (ADD COLUMN IF NOT EXISTS).
--     default empty so existing rows backfill cleanly.
-- -----------------------------------------------------------------------------
alter table public.task_comments
    add column if not exists mentions uuid[] default '{}'::uuid[] not null;


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
create index if not exists project_comments_project_id_index
    on public.project_comments (project_id);
create index if not exists project_comments_created_by_index
    on public.project_comments (created_by);
create index if not exists project_comments_created_at_index
    on public.project_comments (created_at);

create index if not exists task_dependencies_task_id_index
    on public.task_dependencies (task_id);
create index if not exists task_dependencies_depends_on_task_id_index
    on public.task_dependencies (depends_on_task_id);


-- =============================================================================
-- SECTION 3: Mention-notification trigger functions
-- =============================================================================
-- Both are SECURITY DEFINER (they call create_notification, which inserts a
-- user_notifications row for ANOTHER user — the mentioned recipient — and RLS on
-- user_notifications only lets a user touch their own). Both pin
-- search_path = public, extensions because create_notification's insert relies on
-- the gen_random_uuid() column default and we resolve public.* deterministically.
-- They skip the author (no self-notification) and skip null entries defensively.

-- -----------------------------------------------------------------------------
-- 3.1 notify_project_comment_mentions() — AFTER INSERT on project_comments. For
--     each user id in NEW.mentions (excluding NEW.created_by) send a 'mention'
--     notification "<author> mentioned you in a project update", scoped to the
--     project's team_id and carrying the project_id (no task / url).
-- -----------------------------------------------------------------------------
create or replace function public.notify_project_comment_mentions()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _team_id      uuid;
    _author_name  text;
    _message      text;
    _uid          uuid;
begin
    -- Nothing to do if no one was mentioned.
    if new.mentions is null or array_length(new.mentions, 1) is null then
        return new;
    end if;

    -- Resolve the project's team (for the per-team popup preference in
    -- create_notification) and the author's display name for the message.
    select public.team_id_of_project(new.project_id) into _team_id;
    select u.name into _author_name from public.users u where u.id = new.created_by;
    _message := coalesce(_author_name, 'Someone') || ' mentioned you in a project update';

    foreach _uid in array new.mentions
    loop
        -- Skip nulls and the author (no self-mention notification).
        if _uid is not null and _uid is distinct from new.created_by then
            perform public.create_notification(
                _uid,              -- recipient
                _message,          -- message
                'mention',         -- type
                null,              -- url
                _team_id,          -- team_id
                null,              -- task_id
                new.project_id     -- project_id
            );
        end if;
    end loop;

    return new;
end;
$$;

drop trigger if exists project_comments_notify_mentions on public.project_comments;
create trigger project_comments_notify_mentions
    after insert on public.project_comments
    for each row
    execute function public.notify_project_comment_mentions();

-- -----------------------------------------------------------------------------
-- 3.2 notify_task_comment_mentions() — AFTER INSERT on task_comments. For each
--     user id in NEW.mentions (excluding NEW.created_by) send a 'mention'
--     notification "You were mentioned in a comment", scoped to the task's team
--     (resolved via the task's project) and carrying the task_id + project_id.
-- -----------------------------------------------------------------------------
create or replace function public.notify_task_comment_mentions()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _project_id uuid;
    _team_id    uuid;
    _uid        uuid;
begin
    if new.mentions is null or array_length(new.mentions, 1) is null then
        return new;
    end if;

    -- Resolve the task's project, then the project's team.
    select t.project_id into _project_id from public.tasks t where t.id = new.task_id;
    if _project_id is not null then
        select public.team_id_of_project(_project_id) into _team_id;
    end if;

    foreach _uid in array new.mentions
    loop
        if _uid is not null and _uid is distinct from new.created_by then
            perform public.create_notification(
                _uid,                       -- recipient
                'You were mentioned in a comment',  -- message
                'mention',                  -- type
                null,                       -- url
                _team_id,                   -- team_id
                new.task_id,                -- task_id
                _project_id                 -- project_id
            );
        end if;
    end loop;

    return new;
end;
$$;

drop trigger if exists task_comments_notify_mentions on public.task_comments;
create trigger task_comments_notify_mentions
    after insert on public.task_comments
    for each row
    execute function public.notify_task_comment_mentions();


-- =============================================================================
-- SECTION 4: Account-deletion FK fixes
-- =============================================================================
-- teams_user_id_fk: Phase 1 created it with NO on-delete action, blocking the
-- deletion of a user who created a team. Recreate it ON DELETE CASCADE so the
-- auth.users -> public.users delete cascades into the team(s) the user created
-- (and from there into all the team's CASCADE children).
do $$
begin
    if exists (select 1 from pg_constraint where conname = 'teams_user_id_fk') then
        alter table public.teams drop constraint teams_user_id_fk;
    end if;
    alter table public.teams
        add constraint teams_user_id_fk
            foreign key (user_id) references public.users (id) on delete cascade;
end
$$;

-- users_active_team_fk: Phase 1 created it with NO on-delete action, which would
-- block deleting a team that some user has set as their active_team. Recreate it
-- ON DELETE SET NULL so deleting a team simply clears the active_team pointer
-- (and so the teams_user_id_fk CASCADE above is not itself blocked by this FK).
do $$
begin
    if exists (select 1 from pg_constraint where conname = 'users_active_team_fk') then
        alter table public.users drop constraint users_active_team_fk;
    end if;
    alter table public.users
        add constraint users_active_team_fk
            foreign key (active_team) references public.teams (id) on delete set null;
end
$$;


-- =============================================================================
-- SECTION 5: Enable Row Level Security + policies
-- =============================================================================
alter table public.project_comments  enable row level security;
alter table public.task_dependencies enable row level security;

-- Convention (matches Phases 1-8): drop-then-create so re-runnable; policies
-- target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 5.1 project_comments — SELECT/INSERT gated by project-team membership.
--     UPDATE/DELETE allowed for the author OR a project-team admin. The INSERT
--     WITH CHECK additionally pins created_by = auth.uid() so a member cannot
--     post an update attributed to someone else.
-- -------------------------------------------------------------------
drop policy if exists project_comments_select on public.project_comments;
create policy project_comments_select on public.project_comments
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists project_comments_insert on public.project_comments;
create policy project_comments_insert on public.project_comments
    for insert to authenticated
    with check (
        public.is_project_team_member(project_id)
        and created_by = (select auth.uid())
    );

drop policy if exists project_comments_update on public.project_comments;
create policy project_comments_update on public.project_comments
    for update to authenticated
    using (
        created_by = (select auth.uid())
        or public.is_project_team_admin(project_id)
    )
    with check (
        created_by = (select auth.uid())
        or public.is_project_team_admin(project_id)
    );

drop policy if exists project_comments_delete on public.project_comments;
create policy project_comments_delete on public.project_comments
    for delete to authenticated
    using (
        created_by = (select auth.uid())
        or public.is_project_team_admin(project_id)
    );

-- -------------------------------------------------------------------
-- 5.2 task_dependencies — every op gated by is_task_member(task_id) (a member of
--     the task's project's team). INSERT/UPDATE mirror the predicate in
--     WITH CHECK so a member cannot move a row out of their scope.
-- -------------------------------------------------------------------
drop policy if exists task_dependencies_select on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies
    for select to authenticated
    using (public.is_task_member(task_id));

drop policy if exists task_dependencies_insert on public.task_dependencies;
create policy task_dependencies_insert on public.task_dependencies
    for insert to authenticated
    with check (public.is_task_member(task_id));

drop policy if exists task_dependencies_update on public.task_dependencies;
create policy task_dependencies_update on public.task_dependencies
    for update to authenticated
    using (public.is_task_member(task_id))
    with check (public.is_task_member(task_id));

drop policy if exists task_dependencies_delete on public.task_dependencies;
create policy task_dependencies_delete on public.task_dependencies
    for delete to authenticated
    using (public.is_task_member(task_id));


-- =============================================================================
-- SECTION 6: Function execute grants
-- =============================================================================
-- The two notify trigger functions are invoked by their triggers (which run as
-- the table owner), not called directly by clients — no execute grant is needed.
-- (The helpers they call — team_id_of_project / create_notification — were
-- already granted in their respective phases.)


-- =============================================================================
-- SECTION 7: Table privileges for the API roles
-- =============================================================================
-- RLS (above) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated.
grant select, insert, update, delete on public.project_comments  to authenticated;
grant select, insert, update, delete on public.task_dependencies to authenticated;

grant all on public.project_comments  to service_role;
grant all on public.task_dependencies to service_role;

-- =============================================================================
-- END Phase 9
-- =============================================================================
