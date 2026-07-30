-- =============================================================================
-- Status templates: named, reusable status sets managed by team admins.
-- =============================================================================
-- A status template is a JSONB list of {name, category} entries (category is
-- one of todo/doing/done, matching sys_task_status_categories). Admins manage
-- any number of them (e.g. "Software Dev", "Sales Pipeline"); pickers such as
-- the project-template builder prefill their Statuses section from one. The
-- template document is copied at use time — later edits to a status template do
-- not retroactively change project templates or projects built from it.

create table if not exists public.status_templates (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    name       text                                               not null,
    created_by uuid,
    statuses   jsonb                    default '[]'::jsonb       not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint status_templates_pk primary key (id),
    constraint status_templates_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint status_templates_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint status_templates_name_check check (char_length(name) <= 100),
    constraint status_templates_is_array check (jsonb_typeof(statuses) = 'array')
);

create index if not exists status_templates_team_id_index
    on public.status_templates (team_id);

alter table public.status_templates enable row level security;

-- Members read; ONLY admins write (the ask: "admin manages status templates").
drop policy if exists status_templates_select on public.status_templates;
create policy status_templates_select on public.status_templates
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists status_templates_insert on public.status_templates;
create policy status_templates_insert on public.status_templates
    for insert to authenticated
    with check (public.is_team_admin(team_id));

drop policy if exists status_templates_update on public.status_templates;
create policy status_templates_update on public.status_templates
    for update to authenticated
    using (public.is_team_admin(team_id))
    with check (public.is_team_admin(team_id));

drop policy if exists status_templates_delete on public.status_templates;
create policy status_templates_delete on public.status_templates
    for delete to authenticated
    using (public.is_team_admin(team_id));

-- Default privileges may auto-grant ALL to anon as well — revoke explicitly and
-- grant only what RLS is meant to mediate.
revoke all on public.status_templates from public, anon;
grant select, insert, update, delete on public.status_templates to authenticated;
grant all on public.status_templates to service_role;
