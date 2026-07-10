-- =============================================================================
-- Cubes Greenfield Rebuild — Phase 5: Home / Notifications / File storage
-- =============================================================================
-- Completes the MVP. Builds on Phase 1 (identity/tenancy + is_team_member /
-- is_team_admin / is_org_member), Phase 2 (settings/onboarding incl.
-- notification_settings: per-(user,team) email/popup/digest prefs), Phase 3
-- (projects + project-granular RLS helpers + create_project) and Phase 4 (tasks,
-- tasks_assignees, task_comments, is_task_member, create_task).
--
-- Adds:
--   * user_notifications  — the in-app notification feed (user-scoped).
--   * personal_todo_list  — the home-page personal to-dos (user-scoped).
--   * task_attachments    — file-upload metadata (scoped via is_task_member).
--   * create_notification(...) RPC — SECURITY DEFINER insert into
--     user_notifications, honouring notification_settings.popup_notifications.
--   * notify_on_task_assignment() AFTER INSERT on tasks_assignees.
--   * notify_on_task_comment()    AFTER INSERT on task_comments.
--   * get_my_tasks() — the home page "my work" feed for auth.uid().
--   * Supabase Storage buckets (avatars public / attachments private) + RLS
--     policies on storage.objects (path-segment scoping).
--   * RLS enable + policies + grants for the three new public tables.
--
-- Ported faithfully from the legacy schema (cubes-backend/database/sql/
-- {1_tables,4_functions}.sql) with the SAME Supabase adaptations Phases 1-4 used:
--   * uuid_generate_v4()  ->  extensions.gen_random_uuid() via the column DEFAULT
--     (never cast explicitly in a function body).
--   * the legacy WL_HEX_COLOR domain -> plain text (no inline hex CHECK here:
--     personal_todo_list.color_code is now nullable/free-form per the brief).
--   * any FUNCTION BODY touching gen_random_uuid()/citext pins
--     `set search_path = public, extensions` (Phase 1-4 lesson). The trigger /
--     SECURITY DEFINER functions below pin search_path so they resolve public.*
--     deterministically regardless of the caller's search_path.
--   * RLS is enforced in the database; Phase 1's is_team_member and Phase 4's
--     is_task_member are REUSED (NOT recreated).
--
-- Faithfulness notes vs. legacy columns (per the Phase 5 brief):
--   * user_notifications: legacy team_id was NOT NULL (FK cascade) — here team_id
--     is NULLABLE (a notification may be team-agnostic). Added `type text default
--     'info'` and `url text` (legacy carried these in the socket payload, not the
--     row; the brief wants them persisted). task_id / project_id FK ON DELETE SET
--     NULL (legacy CASCADE-deleted the notification; the brief keeps the row so the
--     feed isn't silently pruned). Legacy updated_at DROPPED (notifications are
--     immutable except the `read` flag).
--   * personal_todo_list: legacy `index` -> `index integer default 0` (kept the
--     legacy name; it is not reserved as a column identifier). color_code is plain
--     text + NULLABLE (legacy WL_HEX_COLOR NOT NULL relaxed per the brief).
--   * task_attachments: legacy storage was S3 (file_id/url); here storage_path
--     (text NOT NULL) holds the Supabase Storage object path. name/size/type made
--     NULLABLE (the brief lists them without NOT NULL); task_id FK CASCADE.
--
-- Re-runnable where practical (IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING). No seed needed.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 user_notifications (legacy: user_notifications). The in-app feed. One row
--     per (recipient user, event). user_id CASCADE; team_id nullable CASCADE.
--     task_id / project_id ON DELETE SET NULL (keep the feed row if the task /
--     project is later deleted). `read` toggled by the recipient; `type`/`url`
--     drive the UI rendering + deep-link.
-- -----------------------------------------------------------------------------
create table if not exists public.user_notifications (
    id         uuid                     default gen_random_uuid() not null,
    user_id    uuid                                               not null,
    team_id    uuid,
    message    text                                               not null,
    type       text                     default 'info'            not null,
    url        text,
    task_id    uuid,
    project_id uuid,
    read       boolean                  default false             not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint user_notifications_pk primary key (id),
    constraint user_notifications_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint user_notifications_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint user_notifications_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete set null,
    constraint user_notifications_project_id_fk
        foreign key (project_id) references public.projects (id) on delete set null,
    constraint user_notifications_message_check check (char_length(message) <= 2000)
);

-- -----------------------------------------------------------------------------
-- 1.2 personal_todo_list (legacy: personal_todo_list). Home-page personal to-dos,
--     not tied to any project/task. user_id CASCADE. `index` orders the list;
--     `done` marks completion; color_code is free-form text (nullable).
-- -----------------------------------------------------------------------------
create table if not exists public.personal_todo_list (
    id          uuid                     default gen_random_uuid() not null,
    user_id     uuid                                               not null,
    name        text                                               not null,
    description text,
    done        boolean                  default false             not null,
    color_code  text,
    index       integer                  default 0                 not null,
    created_at  timestamp with time zone default current_timestamp not null,
    updated_at  timestamp with time zone default current_timestamp not null,
    constraint personal_todo_list_pk primary key (id),
    constraint personal_todo_list_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint personal_todo_list_name_check check (char_length(name) <= 100),
    constraint personal_todo_list_description_check check (char_length(description) <= 200)
);

-- -----------------------------------------------------------------------------
-- 1.3 task_attachments (legacy: task_attachments). Upload METADATA only; the
--     bytes live in the Supabase Storage `attachments` bucket at storage_path.
--     task_id CASCADE; project_id / team_id CASCADE (mirror the legacy FKs);
--     uploaded_by -> users. RLS is via is_task_member(task_id).
-- -----------------------------------------------------------------------------
create table if not exists public.task_attachments (
    id           uuid                     default gen_random_uuid() not null,
    task_id      uuid                                               not null,
    project_id   uuid                                               not null,
    team_id      uuid                                               not null,
    name         text,
    size         bigint                   default 0,
    type         text,
    storage_path text                                               not null,
    uploaded_by  uuid,
    created_at   timestamp with time zone default current_timestamp not null,
    constraint task_attachments_pk primary key (id),
    constraint task_attachments_task_id_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint task_attachments_project_id_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint task_attachments_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint task_attachments_uploaded_by_fk
        foreign key (uploaded_by) references public.users (id),
    constraint task_attachments_name_check check (char_length(name) <= 110)
);


-- =============================================================================
-- SECTION 2: Indexes
-- =============================================================================
-- (CONCURRENTLY is not allowed inside a migration transaction block.)

-- user_notifications: the feed is queried by recipient, newest-first, often
-- filtered on unread.
create index if not exists user_notifications_user_id_index
    on public.user_notifications (user_id);
create index if not exists user_notifications_user_unread_index
    on public.user_notifications (user_id, read);
create index if not exists user_notifications_created_at_index
    on public.user_notifications (created_at);
create index if not exists user_notifications_task_id_index
    on public.user_notifications (task_id);
create index if not exists user_notifications_project_id_index
    on public.user_notifications (project_id);

-- personal_todo_list: queried by owner, ordered by index.
create index if not exists personal_todo_list_user_id_index
    on public.personal_todo_list (user_id);

-- task_attachments: listed per task; also queried per project/team.
create index if not exists task_attachments_task_id_index
    on public.task_attachments (task_id);
create index if not exists task_attachments_project_id_index
    on public.task_attachments (project_id);
create index if not exists task_attachments_team_id_index
    on public.task_attachments (team_id);


-- =============================================================================
-- SECTION 3: Functions + triggers
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 3.1 create_notification(...) — SECURITY DEFINER insert into user_notifications.
--     Honours notification_settings: if the recipient has a row for p_team_id with
--     popup_notifications_enabled = false, the notification is SKIPPED (returns
--     null). With no settings row (or no team) the default is to notify. Returns
--     the new notification id (or null when skipped / inputs invalid).
--     SECURITY DEFINER so triggers/RPCs can insert a row for ANOTHER user
--     (the recipient) — RLS on user_notifications only lets a user touch their own.
--     Pinned search_path (public, extensions): the column DEFAULT gen_random_uuid()
--     lives in extensions, and we resolve public.* deterministically.
-- -----------------------------------------------------------------------------
create or replace function public.create_notification(
    p_user_id    uuid,
    p_message    text,
    p_type       text default 'info',
    p_url        text default null,
    p_team_id    uuid default null,
    p_task_id    uuid default null,
    p_project_id uuid default null
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _message text := trim(coalesce(p_message, ''));
    _popup   boolean;
    _id      uuid;
begin
    if p_user_id is null or _message = '' then
        return null;
    end if;

    -- Respect the recipient's per-team popup preference (Phase 2). Absence of a
    -- settings row => notify (the default for popup_notifications_enabled is true).
    if p_team_id is not null then
        select ns.popup_notifications_enabled
            into _popup
            from public.notification_settings ns
            where ns.user_id = p_user_id and ns.team_id = p_team_id;
        if _popup is false then
            return null;
        end if;
    end if;

    insert into public.user_notifications (user_id, team_id, message, type, url, task_id, project_id)
    values (p_user_id, p_team_id, _message, coalesce(nullif(trim(p_type), ''), 'info'),
            p_url, p_task_id, p_project_id)
    returning id into _id;

    return _id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3.2 notify_on_task_assignment() — AFTER INSERT on tasks_assignees. Resolves the
--     assigned team_member's user_id; if that user is neither the task reporter
--     nor the person who assigned them (assigned_by -> a user), sends them an
--     'assignment' notification. Task name / project / team come from the task.
--     SECURITY DEFINER + pinned search_path (reads tasks/team_members/projects;
--     calls create_notification which itself inserts for the recipient).
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_task_assignment()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _assignee_user uuid;
    _assigner_user uuid;
    _task_name     text;
    _project_id    uuid;
    _project_name  text;
    _team_id       uuid;
    _reporter_id   uuid;
begin
    -- The assigned user (team_members row may be team-only with a null user_id).
    select tm.user_id into _assignee_user
        from public.team_members tm where tm.id = new.team_member_id;
    if _assignee_user is null then
        return new;
    end if;

    -- Task context: name, project (+ name), team, reporter.
    select t.name, t.project_id, t.reporter_id, p.name, p.team_id
        into _task_name, _project_id, _reporter_id, _project_name, _team_id
        from public.tasks t
        join public.projects p on p.id = t.project_id
        where t.id = new.task_id;

    -- Who performed the assignment (assigned_by is a users.id directly).
    _assigner_user := new.assigned_by;

    -- Don't notify the assignee if they assigned themselves or are the reporter.
    if _assignee_user = coalesce(_assigner_user, '00000000-0000-0000-0000-000000000000')
       or _assignee_user = coalesce(_reporter_id, '00000000-0000-0000-0000-000000000000') then
        return new;
    end if;

    perform public.create_notification(
        p_user_id    => _assignee_user,
        p_message    => coalesce(_task_name, 'A task') || ' was assigned to you',
        p_type       => 'assignment',
        p_url        => null,
        p_team_id    => _team_id,
        p_task_id    => new.task_id,
        p_project_id => _project_id
    );

    return new;
end;
$$;

drop trigger if exists tasks_assignees_notify on public.tasks_assignees;
create trigger tasks_assignees_notify
    after insert on public.tasks_assignees
    for each row
    execute function public.notify_on_task_assignment();

-- -----------------------------------------------------------------------------
-- 3.3 notify_on_task_comment() — AFTER INSERT on task_comments. Notifies every
--     participant of the task (its assignees' users + the reporter) EXCEPT the
--     commenter (new.created_by). One notification per distinct recipient.
--     SECURITY DEFINER + pinned search_path.
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_task_comment()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _task_name    text;
    _project_id   uuid;
    _team_id      uuid;
    _reporter_id  uuid;
    _commenter    uuid := new.created_by;
    _recipient    uuid;
begin
    select t.name, t.project_id, t.reporter_id, p.team_id
        into _task_name, _project_id, _reporter_id, _team_id
        from public.tasks t
        join public.projects p on p.id = t.project_id
        where t.id = new.task_id;

    -- Distinct set of participant users: assignees' users + the reporter, minus
    -- the commenter and minus nulls.
    for _recipient in
        select distinct u
        from (
            select tm.user_id as u
                from public.tasks_assignees ta
                join public.team_members tm on tm.id = ta.team_member_id
                where ta.task_id = new.task_id
            union
            select _reporter_id as u
        ) parts
        where u is not null
          and u is distinct from _commenter
    loop
        perform public.create_notification(
            p_user_id    => _recipient,
            p_message    => 'New comment on ' || coalesce(_task_name, 'a task'),
            p_type       => 'comment',
            p_url        => null,
            p_team_id    => _team_id,
            p_task_id    => new.task_id,
            p_project_id => _project_id
        );
    end loop;

    return new;
end;
$$;

drop trigger if exists task_comments_notify on public.task_comments;
create trigger task_comments_notify
    after insert on public.task_comments
    for each row
    execute function public.notify_on_task_comment();

-- -----------------------------------------------------------------------------
-- 3.4 get_my_tasks() — the home-page "my work" feed. Returns the current user's
--     ASSIGNED, NOT-done tasks across ALL their teams (tasks -> tasks_assignees ->
--     team_members where team_members.user_id = auth.uid()). One row per task
--     (a task assigned to the user via several memberships still appears once).
--     SECURITY DEFINER + pinned search_path (public, extensions): a clean,
--     RLS-independent read for the dashboard. STABLE.
-- -----------------------------------------------------------------------------
create or replace function public.get_my_tasks()
    returns table (
        task_id      uuid,
        name         text,
        project_id   uuid,
        project_name text,
        status_name  text,
        priority     text,
        end_date     timestamp with time zone
    )
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select distinct on (t.id)
           t.id            as task_id,
           t.name          as name,
           t.project_id    as project_id,
           p.name          as project_name,
           ts.name         as status_name,
           pr.name         as priority,
           t.end_date      as end_date
    from public.tasks t
    join public.tasks_assignees ta on ta.task_id = t.id
    join public.team_members   tm on tm.id = ta.team_member_id
    join public.projects        p on p.id = t.project_id
    left join public.task_statuses   ts on ts.id = t.status_id
    left join public.task_priorities pr on pr.id = t.priority_id
    where tm.user_id = auth.uid()
      and t.done is false
      and t.archived is false
    order by t.id, t.end_date nulls last;
$$;


-- =============================================================================
-- SECTION 4: Supabase Storage — buckets + storage.objects policies
-- =============================================================================
-- Buckets (idempotent). `avatars` is public (profile pictures served directly);
-- `attachments` is private (served via signed URLs / RLS-checked downloads).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true),
       ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- These policies run as postgres in the migration. storage.objects already has
-- RLS enabled by Supabase; we add scoped policies (drop-if-exists first so the
-- migration is re-runnable). Path-segment scoping uses storage.foldername(name),
-- whose [1] element is the first path segment.

-- -------------------------------------------------------------------
-- 4.1 avatars (public bucket). Path convention: `<uid>/<file>`. A user may write
--     only under their own uid folder; SELECT is public (the bucket is public),
--     plus an explicit permissive SELECT for authenticated.
-- -------------------------------------------------------------------
drop policy if exists "avatars_select_authenticated" on storage.objects;
create policy "avatars_select_authenticated" on storage.objects
    for select to authenticated
    using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- -------------------------------------------------------------------
-- 4.2 attachments (private bucket). Path convention:
--     `<team_id>/<project_id>/<task_id>/<file>`. A member of the team in the
--     first path segment may INSERT / SELECT / DELETE. Reuses Phase 1
--     is_team_member.
-- -------------------------------------------------------------------
drop policy if exists "attachments_select_team_member" on storage.objects;
create policy "attachments_select_team_member" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'attachments'
        and public.is_team_member(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "attachments_insert_team_member" on storage.objects;
create policy "attachments_insert_team_member" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'attachments'
        and public.is_team_member(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "attachments_delete_team_member" on storage.objects;
create policy "attachments_delete_team_member" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'attachments'
        and public.is_team_member(((storage.foldername(name))[1])::uuid)
    );


-- =============================================================================
-- SECTION 5: Enable Row Level Security + policies (public tables)
-- =============================================================================
alter table public.user_notifications enable row level security;
alter table public.personal_todo_list enable row level security;
alter table public.task_attachments   enable row level security;

-- Convention (matches Phases 1-4): drop-then-create so re-runnable; policies
-- target `authenticated`; service_role bypasses RLS.

-- -------------------------------------------------------------------
-- 5.1 user_notifications — strictly user-private (all ops). Inserts normally
--     happen via create_notification (SECURITY DEFINER, on behalf of the
--     recipient); the recipient may still SELECT, toggle `read` (UPDATE) and
--     DELETE their own rows directly.
-- -------------------------------------------------------------------
drop policy if exists user_notifications_select on public.user_notifications;
create policy user_notifications_select on public.user_notifications
    for select to authenticated
    using (user_id = auth.uid());

drop policy if exists user_notifications_insert on public.user_notifications;
create policy user_notifications_insert on public.user_notifications
    for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists user_notifications_update on public.user_notifications;
create policy user_notifications_update on public.user_notifications
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists user_notifications_delete on public.user_notifications;
create policy user_notifications_delete on public.user_notifications
    for delete to authenticated
    using (user_id = auth.uid());

-- -------------------------------------------------------------------
-- 5.2 personal_todo_list — strictly user-private (all ops).
-- -------------------------------------------------------------------
drop policy if exists personal_todo_list_select on public.personal_todo_list;
create policy personal_todo_list_select on public.personal_todo_list
    for select to authenticated
    using (user_id = auth.uid());

drop policy if exists personal_todo_list_insert on public.personal_todo_list;
create policy personal_todo_list_insert on public.personal_todo_list
    for insert to authenticated
    with check (user_id = auth.uid());

drop policy if exists personal_todo_list_update on public.personal_todo_list;
create policy personal_todo_list_update on public.personal_todo_list
    for update to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists personal_todo_list_delete on public.personal_todo_list;
create policy personal_todo_list_delete on public.personal_todo_list
    for delete to authenticated
    using (user_id = auth.uid());

-- -------------------------------------------------------------------
-- 5.3 task_attachments — SELECT/INSERT/DELETE gated by is_task_member(task_id).
--     (No UPDATE policy: attachment metadata is immutable; replace = delete+insert.)
-- -------------------------------------------------------------------
drop policy if exists task_attachments_select on public.task_attachments;
create policy task_attachments_select on public.task_attachments
    for select to authenticated
    using (public.is_task_member(task_id));

drop policy if exists task_attachments_insert on public.task_attachments;
create policy task_attachments_insert on public.task_attachments
    for insert to authenticated
    with check (public.is_task_member(task_id));

drop policy if exists task_attachments_delete on public.task_attachments;
create policy task_attachments_delete on public.task_attachments
    for delete to authenticated
    using (public.is_task_member(task_id));


-- =============================================================================
-- SECTION 6: Function execute grants
-- =============================================================================
grant execute on function public.create_notification(uuid, text, text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.get_my_tasks() to authenticated;
-- The trigger functions run as their owner (SECURITY DEFINER) on the table
-- triggers; no execute grant to authenticated is needed for them.


-- =============================================================================
-- SECTION 7: Table privileges for the API roles
-- =============================================================================
-- RLS (above) governs which ROWS are visible/mutable; these grants govern
-- TABLE-level access. Without them every query fails with "permission denied"
-- before RLS is evaluated.
grant select, insert, update, delete on public.user_notifications to authenticated;
grant select, insert, update, delete on public.personal_todo_list to authenticated;
grant select, insert, update, delete on public.task_attachments   to authenticated;

grant all on public.user_notifications to service_role;
grant all on public.personal_todo_list to service_role;
grant all on public.task_attachments   to service_role;

-- =============================================================================
-- END Phase 5
-- =============================================================================
