-- =============================================================================
-- Customizable per-project views (tab strip).
-- =============================================================================
-- A project's task views (List / Board / Calendar / Timeline / Table …) become
-- data rows instead of hardcoded tabs, so each project can add/remove/reorder
-- which views it shows. The set of view TYPES is a code registry
-- (src/lib/projects/views.ts); this table records the instances per project.
-- Utility tabs (Overview / Members / Automations / Activity) stay fixed in the
-- app and are NOT stored here.
--
-- v1: one instance per view type per project (unique). New projects are seeded
-- with List + Board via an AFTER-INSERT trigger; existing projects are
-- backfilled below.

create table if not exists public.project_views (
    id         uuid                     default gen_random_uuid() not null,
    project_id uuid                                               not null,
    view_key   text                                               not null,
    name       text,
    position   integer                  default 0                 not null,
    config     jsonb                    default '{}'::jsonb       not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint project_views_pk primary key (id),
    constraint project_views_project_id_fk foreign key (project_id)
        references public.projects (id) on delete cascade,
    constraint project_views_view_key_check check (char_length(view_key) <= 50),
    constraint project_views_config_check check (jsonb_typeof(config) = 'object'),
    constraint project_views_unique unique (project_id, view_key)
);
create index if not exists project_views_project_id_index
    on public.project_views (project_id, position);

-- Seed a new project with the default views (List + Board).
create or replace function public.seed_default_project_views()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
begin
    insert into public.project_views (project_id, view_key, position)
    values (new.id, 'list', 0), (new.id, 'board', 1)
    on conflict (project_id, view_key) do nothing;
    return new;
end;
$$;

drop trigger if exists projects_seed_views on public.projects;
create trigger projects_seed_views
    after insert on public.projects
    for each row
    execute function public.seed_default_project_views();

-- Backfill existing projects that predate this feature.
insert into public.project_views (project_id, view_key, position)
select p.id, 'list', 0 from public.projects p
on conflict (project_id, view_key) do nothing;
insert into public.project_views (project_id, view_key, position)
select p.id, 'board', 1 from public.projects p
on conflict (project_id, view_key) do nothing;

-- ---------------------------------------------------------------------- RLS --
alter table public.project_views enable row level security;

drop policy if exists project_views_select on public.project_views;
create policy project_views_select on public.project_views
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists project_views_write on public.project_views;
create policy project_views_write on public.project_views
    for all to authenticated
    using (public.is_project_team_admin(project_id))
    with check (public.is_project_team_admin(project_id));

grant select, insert, update, delete on public.project_views to authenticated;
grant all on public.project_views to service_role;
revoke all on public.project_views from anon;
