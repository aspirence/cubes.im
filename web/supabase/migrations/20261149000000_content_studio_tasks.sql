-- =============================================================================
-- Content Studio — tasks created (or later adopted) by hand
-- =============================================================================
-- A task is "social" when this app put it there (use-content-calendar.ts):
-- a routine made it, or a post points at it. A task typed into Content
-- Studio's own "New task" had neither receipt and vanished into "All tasks".
-- This is the third receipt. It is NOT app_content_studio_routine_tasks
-- (routine_id is NOT NULL and its RLS is SELECT-only so clients cannot forge
-- idempotency rows) and NOT a hidden item (items are deliverables and show up
-- in the Queue). source='adopted' is reserved for pulling an existing task in
-- from the calendar; nothing writes it yet.
-- Re-runnable: create table if not exists / drop policy if exists.
-- =============================================================================

create table if not exists public.app_content_studio_tasks (
    task_id    uuid                                               not null,
    team_id    uuid                                               not null,
    -- 'created' = made from Content Studio's New task;
    -- 'adopted' = an existing task pulled onto the content calendar (later).
    source     text                     default 'created'         not null,
    created_by uuid                     default auth.uid(),
    created_at timestamp with time zone default current_timestamp not null,
    -- One receipt per task: adopting twice is a no-op, not a second row.
    constraint app_content_studio_tasks_pk primary key (task_id),
    -- The task is the thing; when it goes, so does the fact it was social.
    constraint app_content_studio_tasks_task_fk
        foreign key (task_id) references public.tasks (id) on delete cascade,
    constraint app_content_studio_tasks_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_content_studio_tasks_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_content_studio_tasks_source_check
        check (source in ('created', 'adopted'))
);

-- useSocialOwnedTaskIds reads the whole team's set in one query.
create index if not exists app_content_studio_tasks_team_idx
    on public.app_content_studio_tasks (team_id);

-- ----------------------------------------------------------------- RLS ------
alter table public.app_content_studio_tasks enable row level security;

-- Read: a team member who can open the task (is_task_member respects limited
-- members and private projects — the same helper task comments, dependencies
-- and work logs use).
drop policy if exists app_content_studio_tasks_select on public.app_content_studio_tasks;
create policy app_content_studio_tasks_select on public.app_content_studio_tasks
    for select to authenticated
    using (public.is_team_member(team_id) and public.is_task_member(task_id));

-- Insert: additionally the row may not lie about the task's team — a user in
-- two teams cannot file a receipt under the wrong team_id. The subquery runs
-- under tasks RLS, which is_task_member has already satisfied.
drop policy if exists app_content_studio_tasks_insert on public.app_content_studio_tasks;
create policy app_content_studio_tasks_insert on public.app_content_studio_tasks
    for insert to authenticated
    with check (
        public.is_team_member(team_id)
        and public.is_task_member(task_id)
        and exists (
            select 1
              from public.tasks t
             where t.id = app_content_studio_tasks.task_id
               and public.team_id_of_project(t.project_id) = app_content_studio_tasks.team_id
        )
    );

-- Delete (un-adopt, follow-up UI): same gate as read.
drop policy if exists app_content_studio_tasks_delete on public.app_content_studio_tasks;
create policy app_content_studio_tasks_delete on public.app_content_studio_tasks
    for delete to authenticated
    using (public.is_team_member(team_id) and public.is_task_member(task_id));

-- No UPDATE policy on purpose: a receipt is created or deleted, never edited.
-- The client's upsert uses ignoreDuplicates (ON CONFLICT DO NOTHING), which
-- needs no UPDATE privilege.

-- -------------------------------------------------------------- grants ------
-- Supabase's default privileges hand `authenticated` ALL on every new table.
-- Revoke first, then grant exactly the three verbs the policies cover.
revoke all on public.app_content_studio_tasks from authenticated, anon;
grant select, insert, delete on public.app_content_studio_tasks to authenticated;
grant all on public.app_content_studio_tasks to service_role;

-- No triggers. Task creation still goes through create_task /
-- create_task_with_template, so every tasks trigger fires as usual.
