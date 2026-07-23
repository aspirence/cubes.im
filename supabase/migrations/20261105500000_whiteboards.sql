-- =============================================================================
-- Whiteboards — team-scoped infinite canvases (Excalidraw)
-- =============================================================================
-- Replaces the localStorage-only v1 store with a Supabase-backed, team-shared,
-- realtime board list. Split into two tables on purpose:
--
--   * whiteboards        — one row per board (metadata: name, owner, timestamps).
--                          Small; streamed over Realtime so the board list stays
--                          live across a user's tabs and across teammates.
--   * whiteboard_scenes  — the heavy Excalidraw payload (elements + embedded
--                          image files), 1:1 with a board. NOT in the Realtime
--                          publication: a scene can be megabytes, and we never
--                          hot-reload an open board from a remote change (that
--                          would clobber the local editor), so broadcasting it
--                          on every debounced save would be pure waste.
--
-- A scene save bumps its parent board's updated_at (trigger below), so the small
-- metadata UPDATE — not the scene — is what fans out to the team, re-sorting the
-- list and refreshing "edited …" for everyone. Scene sync is last-write-wins;
-- live multiplayer co-editing is intentionally out of scope for this version.
--
-- Per-user viewport (pan/zoom) is kept in the browser, never here — one person
-- panning must not move everyone else's camera.
--
-- RLS: any active member of the owning team has full read/write (shared canvas
-- model). is_team_member / is_team_admin already exist (phase1 identity).
-- =============================================================================

-- --- boards (metadata) -------------------------------------------------------
create table if not exists public.whiteboards (
    id          uuid                     default gen_random_uuid() not null,
    team_id     uuid                                               not null,
    name        text                     default 'Untitled board'  not null,
    created_by  uuid,
    created_at  timestamp with time zone default current_timestamp not null,
    updated_at  timestamp with time zone default current_timestamp not null,
    constraint whiteboards_pk primary key (id),
    constraint whiteboards_team_id_fk foreign key (team_id)
        references public.teams (id) on delete cascade,
    constraint whiteboards_created_by_fk foreign key (created_by)
        references public.users (id) on delete set null,
    constraint whiteboards_name_check check (char_length(name) <= 200)
);

create index if not exists whiteboards_team_id_updated_at_index
    on public.whiteboards (team_id, updated_at desc);

-- --- scenes (heavy payload, 1:1 with a board) --------------------------------
create table if not exists public.whiteboard_scenes (
    whiteboard_id uuid                                               not null,
    scene         jsonb                    default '{}'::jsonb       not null,
    updated_at    timestamp with time zone default current_timestamp not null,
    constraint whiteboard_scenes_pk primary key (whiteboard_id),
    constraint whiteboard_scenes_whiteboard_id_fk foreign key (whiteboard_id)
        references public.whiteboards (id) on delete cascade,
    constraint whiteboard_scenes_scene_check check (jsonb_typeof(scene) = 'object')
);

-- --- RLS ---------------------------------------------------------------------
alter table public.whiteboards       enable row level security;
alter table public.whiteboard_scenes enable row level security;

-- boards: any active team member has full CRUD
drop policy if exists whiteboards_select on public.whiteboards;
create policy whiteboards_select on public.whiteboards
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists whiteboards_insert on public.whiteboards;
create policy whiteboards_insert on public.whiteboards
    for insert to authenticated
    with check (public.is_team_member(team_id));

drop policy if exists whiteboards_update on public.whiteboards;
create policy whiteboards_update on public.whiteboards
    for update to authenticated
    using (public.is_team_member(team_id))
    with check (public.is_team_member(team_id));

drop policy if exists whiteboards_delete on public.whiteboards;
create policy whiteboards_delete on public.whiteboards
    for delete to authenticated
    using (public.is_team_member(team_id));

-- scenes: gated through the parent board's team membership
drop policy if exists whiteboard_scenes_select on public.whiteboard_scenes;
create policy whiteboard_scenes_select on public.whiteboard_scenes
    for select to authenticated
    using (exists (
        select 1 from public.whiteboards w
        where w.id = whiteboard_id and public.is_team_member(w.team_id)
    ));

drop policy if exists whiteboard_scenes_insert on public.whiteboard_scenes;
create policy whiteboard_scenes_insert on public.whiteboard_scenes
    for insert to authenticated
    with check (exists (
        select 1 from public.whiteboards w
        where w.id = whiteboard_id and public.is_team_member(w.team_id)
    ));

drop policy if exists whiteboard_scenes_update on public.whiteboard_scenes;
create policy whiteboard_scenes_update on public.whiteboard_scenes
    for update to authenticated
    using (exists (
        select 1 from public.whiteboards w
        where w.id = whiteboard_id and public.is_team_member(w.team_id)
    ))
    with check (exists (
        select 1 from public.whiteboards w
        where w.id = whiteboard_id and public.is_team_member(w.team_id)
    ));

drop policy if exists whiteboard_scenes_delete on public.whiteboard_scenes;
create policy whiteboard_scenes_delete on public.whiteboard_scenes
    for delete to authenticated
    using (exists (
        select 1 from public.whiteboards w
        where w.id = whiteboard_id and public.is_team_member(w.team_id)
    ));

-- --- grants -------------------------------------------------------------------
revoke all on public.whiteboards       from anon;
revoke all on public.whiteboard_scenes from anon;
grant select, insert, update, delete on public.whiteboards       to authenticated;
grant select, insert, update, delete on public.whiteboard_scenes to authenticated;
grant all on public.whiteboards       to service_role;
grant all on public.whiteboard_scenes to service_role;

-- --- triggers ----------------------------------------------------------------
-- Keep a board's updated_at fresh on any metadata change (e.g. rename).
create or replace function public.set_whiteboard_updated_at()
    returns trigger
    language plpgsql
as
$$
begin
    new.updated_at := current_timestamp;
    return new;
end;
$$;

drop trigger if exists whiteboards_set_updated_at on public.whiteboards;
create trigger whiteboards_set_updated_at
    before update on public.whiteboards
    for each row
    execute function public.set_whiteboard_updated_at();

-- A scene save touches the parent board so the (Realtime) metadata row moves to
-- the top of everyone's list and "edited …" refreshes — without shipping the
-- scene itself over the wire.
create or replace function public.touch_whiteboard_from_scene()
    returns trigger
    language plpgsql
as
$$
begin
    update public.whiteboards
       set updated_at = current_timestamp
     where id = new.whiteboard_id;
    return new;
end;
$$;

drop trigger if exists whiteboard_scenes_touch_parent on public.whiteboard_scenes;
create trigger whiteboard_scenes_touch_parent
    after insert or update on public.whiteboard_scenes
    for each row
    execute function public.touch_whiteboard_from_scene();

-- --- realtime -----------------------------------------------------------------
-- Only the lightweight metadata table streams. Postgres only broadcasts tables
-- in the supabase_realtime publication; RLS still scopes delivery per team.
do $$
begin
    alter publication supabase_realtime add table public.whiteboards;
exception
    when duplicate_object then null; -- already in the publication
end;
$$;

-- =============================================================================
-- END whiteboards
-- =============================================================================
