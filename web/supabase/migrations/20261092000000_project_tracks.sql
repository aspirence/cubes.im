-- =============================================================================
-- Tracks — a workstream level INSIDE a project
-- =============================================================================
-- Hierarchy becomes: Space -> Project -> Track -> Tasks.
--
-- A track groups a project's work by AREA ("Social Media", "Paid Ads",
-- "Website"). The project keeps showing every task; picking a track narrows the
-- views to just that track's tasks — the point is focus, not separation.
--
-- Distinct from project_phases, which model WHEN work happens (Discovery ->
-- Build -> Launch, with dates). A task can sit in a phase AND a track.
--
-- A task belongs to at most ONE track (tasks.track_id, nullable = "No track"),
-- so per-track counts always add up to the project total.
-- =============================================================================

create table if not exists public.project_tracks (
    id          uuid                     default gen_random_uuid() not null,
    project_id  uuid                                               not null,
    name        text                                               not null,
    color_code  text                     default '#7c3aed'         not null,
    sort_order  integer                  default 0                 not null,
    created_by  uuid,
    created_at  timestamp with time zone default current_timestamp not null,
    updated_at  timestamp with time zone default current_timestamp not null,
    constraint project_tracks_pk primary key (id),
    constraint project_tracks_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint project_tracks_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint project_tracks_name_check
        check (char_length(btrim(name)) between 1 and 60),
    constraint project_tracks_color_check
        check (color_code ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$')
);

-- One track name per project (case-insensitive) — two "Social Media" tracks in
-- the same project would make the picker ambiguous.
create unique index if not exists project_tracks_project_name_uindex
    on public.project_tracks (project_id, lower(name));

create index if not exists project_tracks_project_index
    on public.project_tracks (project_id, sort_order);

-- ----- tasks.track_id --------------------------------------------------------
-- SET NULL on delete: removing a track must never delete the work inside it;
-- those tasks fall back to "No track" and stay visible at the project level.
alter table public.tasks
    add column if not exists track_id uuid;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'tasks_track_id_fk'
    ) then
        alter table public.tasks
            add constraint tasks_track_id_fk
            foreign key (track_id) references public.project_tracks (id)
            on delete set null;
    end if;
end
$$;

create index if not exists tasks_track_id_index on public.tasks (track_id);

-- A task's track must belong to the SAME project as the task, otherwise a
-- client could file work under another project's track.
create or replace function public.tasks_validate_track()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
begin
    if new.track_id is not null then
        if not exists (
            select 1 from public.project_tracks t
            where t.id = new.track_id and t.project_id = new.project_id
        ) then
            raise exception 'tasks: track % does not belong to project %',
                new.track_id, new.project_id;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists tasks_validate_track on public.tasks;
create trigger tasks_validate_track
    before insert or update of track_id, project_id on public.tasks
    for each row
    execute function public.tasks_validate_track();

-- ----- RLS (mirrors project_phases: members read, project admins write) ------
alter table public.project_tracks enable row level security;

drop policy if exists project_tracks_select on public.project_tracks;
create policy project_tracks_select on public.project_tracks
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists project_tracks_insert on public.project_tracks;
create policy project_tracks_insert on public.project_tracks
    for insert to authenticated
    with check (public.is_project_team_admin(project_id));

drop policy if exists project_tracks_update on public.project_tracks;
create policy project_tracks_update on public.project_tracks
    for update to authenticated
    using (public.is_project_team_admin(project_id))
    with check (public.is_project_team_admin(project_id));

drop policy if exists project_tracks_delete on public.project_tracks;
create policy project_tracks_delete on public.project_tracks
    for delete to authenticated
    using (public.is_project_team_admin(project_id));

revoke all on public.project_tracks from public, anon;
grant select, insert, update, delete on public.project_tracks to authenticated;
grant all on public.project_tracks to service_role;

-- Keep updated_at honest.
create or replace function public.set_project_track_updated_at()
    returns trigger
    language plpgsql
as
$$
begin
    new.updated_at := current_timestamp;
    return new;
end;
$$;

drop trigger if exists project_tracks_set_updated_at on public.project_tracks;
create trigger project_tracks_set_updated_at
    before update on public.project_tracks
    for each row
    execute function public.set_project_track_updated_at();
