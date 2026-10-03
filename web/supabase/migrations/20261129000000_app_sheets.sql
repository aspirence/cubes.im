-- =============================================================================
-- Sheets app — sheets, their rows, team templates, and Google Sheets links
-- =============================================================================
-- See docs/SHEETS_WORKFLOWS.md. A sheet is a grid of typed columns
-- (app_sheets.columns, the SheetColumn[] contract in src/lib/sheets/types.ts)
-- over one of several sources: its own rows ('custom'), a project's tasks,
-- or Content Studio items. Whatever the
-- source, the values of the user's OWN columns (notes, owners, targets) live in
-- app_sheet_rows.data keyed by column id — which is how a custom column can sit
-- next to app data without the app's table knowing about it.
--
-- A sheet can be linked to one Google Sheet tab and synced both ways. The sync
-- engine (src/lib/sheets/google-sync.ts) runs as service_role from routes and
-- from the workflows runner tick, so every sync table is written only there;
-- members read link status and run history through RLS.
--
-- Re-runnable: create … if not exists / drop policy if exists / create or
-- replace. Purely additive: no existing row is touched.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. app_sheets
-- -----------------------------------------------------------------------------
create table if not exists public.app_sheets (
    id            uuid default gen_random_uuid() not null,
    team_id       uuid not null,
    -- Null = a workspace sheet, visible to every member of the team. Set = a
    -- project sheet, visible to that project's members only.
    project_id    uuid,
    name          text not null,
    description   text,
    source        text not null,
    source_config jsonb not null default '{}'::jsonb,
    -- SheetColumn[]; validated in code (the grid and the wizard own its shape).
    columns       jsonb not null default '[]'::jsonb,
    -- The built-in template key or a team template id the sheet started from —
    -- informational only, a sheet never follows later edits to its template.
    template_key  text,
    archived      boolean not null default false,
    created_by    uuid default auth.uid(),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint app_sheets_pk primary key (id),
    constraint app_sheets_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_sheets_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_sheets_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_sheets_name_check
        check (char_length(name) between 1 and 120),
    constraint app_sheets_description_check
        check (description is null or char_length(description) <= 2000),
    constraint app_sheets_source_check
        check (source in ('custom', 'tasks', 'content_studio_items',

    constraint app_sheets_source_config_check
        check (jsonb_typeof(source_config) = 'object'),
    constraint app_sheets_columns_check
        check (jsonb_typeof(columns) = 'array'),
    -- A tasks sheet IS a project's task list; without a project it has no rows.
    constraint app_sheets_tasks_project_check
        check (source <> 'tasks' or project_id is not null)
);

create index if not exists app_sheets_team_project_index
    on public.app_sheets (team_id, project_id);
create index if not exists app_sheets_project_index
    on public.app_sheets (project_id) where project_id is not null;

drop trigger if exists app_sheets_set_updated_at on public.app_sheets;
create trigger app_sheets_set_updated_at
    before update on public.app_sheets
    for each row execute function public.set_row_updated_at();


-- -----------------------------------------------------------------------------
-- 2. app_sheets_can_access — the one access rule every child table uses
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so the child tables' policies don't have to re-join
-- app_sheets under RLS (and so the routes can ask it as the caller). Returns
-- false, not an error, for an id that does not exist, so it cannot be used to
-- probe for sheets in other workspaces.
create or replace function public.app_sheets_can_access(p_sheet_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select exists (
        select 1
        from public.app_sheets s
        where s.id = p_sheet_id
          and public.is_team_member(s.team_id)
          and (s.project_id is null or public.is_project_team_member(s.project_id))
    );
$$;

revoke all on function public.app_sheets_can_access(uuid) from public, anon;
grant execute on function public.app_sheets_can_access(uuid) to authenticated, service_role;


alter table public.app_sheets enable row level security;

drop policy if exists app_sheets_select on public.app_sheets;
create policy app_sheets_select on public.app_sheets
    for select to authenticated
    using (public.is_team_member(team_id)
           and (project_id is null or public.is_project_team_member(project_id)));

drop policy if exists app_sheets_insert on public.app_sheets;
create policy app_sheets_insert on public.app_sheets
    for insert to authenticated
    with check (public.is_team_member(team_id)
                and (project_id is null or public.is_project_team_member(project_id))
                -- Nobody can create a sheet "by" someone else.
                and (created_by is null or created_by = auth.uid()));

drop policy if exists app_sheets_update on public.app_sheets;
create policy app_sheets_update on public.app_sheets
    for update to authenticated
    using (public.is_team_member(team_id)
           and (project_id is null or public.is_project_team_member(project_id)))
    with check (public.is_team_member(team_id)
                and (project_id is null or public.is_project_team_member(project_id)));

-- Deleting takes a sheet's custom data and its Google link with it, so it is
-- the creator's call or an admin's — everyone else archives.
drop policy if exists app_sheets_delete on public.app_sheets;
create policy app_sheets_delete on public.app_sheets
    for delete to authenticated
    using (public.is_team_member(team_id)
           and (project_id is null or public.is_project_team_member(project_id))
           and (created_by = auth.uid() or public.is_team_admin(team_id)));


-- -----------------------------------------------------------------------------
-- 3. app_sheet_rows — custom rows, and custom-column values of bound rows
-- -----------------------------------------------------------------------------
create table if not exists public.app_sheet_rows (
    id          uuid default gen_random_uuid() not null,
    sheet_id    uuid not null,
    -- Filled from the sheet by the trigger below, so a row can never claim a
    -- different workspace than its sheet.
    team_id     uuid not null,
    -- custom sheets: the row's own id (text). Bound sheets: the source record's
    -- key (task id, item id, "campaign:<id>:<date>" …).
    record_key  text not null,
    position    double precision not null default 0,
    -- Custom column values keyed by column id. Nulls are stripped on write.
    data        jsonb not null default '{}'::jsonb,
    created_by  uuid default auth.uid(),
    updated_by  uuid default auth.uid(),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint app_sheet_rows_pk primary key (id),
    constraint app_sheet_rows_key_uniq unique (sheet_id, record_key),
    constraint app_sheet_rows_sheet_fk
        foreign key (sheet_id) references public.app_sheets (id) on delete cascade,
    constraint app_sheet_rows_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_sheet_rows_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_sheet_rows_updated_by_fk
        foreign key (updated_by) references public.users (id) on delete set null,
    constraint app_sheet_rows_key_check
        check (char_length(record_key) between 1 and 200),
    constraint app_sheet_rows_data_check
        check (jsonb_typeof(data) = 'object')
);

create index if not exists app_sheet_rows_sheet_position_index
    on public.app_sheet_rows (sheet_id, position);

drop trigger if exists app_sheet_rows_set_updated_at on public.app_sheet_rows;
create trigger app_sheet_rows_set_updated_at
    before update on public.app_sheet_rows
    for each row execute function public.set_row_updated_at();

-- team_id always follows the sheet: the RLS rule is about the SHEET, and a
-- denormalized team_id that could disagree with it would be a quiet leak for
-- any later query that trusts the column.
create or replace function public.app_sheets_child_team()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _team uuid;
begin
    select s.team_id into _team from public.app_sheets s where s.id = new.sheet_id;
    if _team is null then
        raise exception 'Sheet not found.' using errcode = 'P0002';
    end if;
    new.team_id := _team;
    return new;
end;
$$;

revoke all on function public.app_sheets_child_team() from public, anon, authenticated;

drop trigger if exists app_sheet_rows_team on public.app_sheet_rows;
create trigger app_sheet_rows_team
    before insert or update of sheet_id, team_id on public.app_sheet_rows
    for each row execute function public.app_sheets_child_team();

alter table public.app_sheet_rows enable row level security;

drop policy if exists app_sheet_rows_all on public.app_sheet_rows;
create policy app_sheet_rows_all on public.app_sheet_rows
    for all to authenticated
    using (public.app_sheets_can_access(sheet_id))
    with check (public.app_sheets_can_access(sheet_id));


-- -----------------------------------------------------------------------------
-- 4. app_sheet_templates — a team's own templates (built-ins are code)
-- -----------------------------------------------------------------------------
create table if not exists public.app_sheet_templates (
    id            uuid default gen_random_uuid() not null,
    team_id       uuid not null,
    name          text not null,
    description   text,
    icon          text,
    source        text not null,
    source_config jsonb not null default '{}'::jsonb,
    columns       jsonb not null default '[]'::jsonb,
    created_by    uuid default auth.uid(),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint app_sheet_templates_pk primary key (id),
    constraint app_sheet_templates_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_sheet_templates_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_sheet_templates_name_check
        check (char_length(name) between 1 and 120),
    constraint app_sheet_templates_description_check
        check (description is null or char_length(description) <= 2000),
    constraint app_sheet_templates_icon_check
        check (icon is null or char_length(icon) <= 60),
    constraint app_sheet_templates_source_check
        check (source in ('custom', 'tasks', 'content_studio_items',

    constraint app_sheet_templates_source_config_check
        check (jsonb_typeof(source_config) = 'object'),
    constraint app_sheet_templates_columns_check
        check (jsonb_typeof(columns) = 'array')
);

create index if not exists app_sheet_templates_team_index
    on public.app_sheet_templates (team_id);

drop trigger if exists app_sheet_templates_set_updated_at on public.app_sheet_templates;
create trigger app_sheet_templates_set_updated_at
    before update on public.app_sheet_templates
    for each row execute function public.set_row_updated_at();

alter table public.app_sheet_templates enable row level security;

drop policy if exists app_sheet_templates_select on public.app_sheet_templates;
create policy app_sheet_templates_select on public.app_sheet_templates
    for select to authenticated
    using (public.is_team_member(team_id));

drop policy if exists app_sheet_templates_insert on public.app_sheet_templates;
create policy app_sheet_templates_insert on public.app_sheet_templates
    for insert to authenticated
    with check (public.is_team_member(team_id) and created_by = auth.uid());

-- A member edits and removes their own templates; an admin tidies anyone's.
drop policy if exists app_sheet_templates_update on public.app_sheet_templates;
create policy app_sheet_templates_update on public.app_sheet_templates
    for update to authenticated
    using (public.is_team_member(team_id)
           and (created_by = auth.uid() or public.is_team_admin(team_id)))
    with check (public.is_team_member(team_id));

drop policy if exists app_sheet_templates_delete on public.app_sheet_templates;
create policy app_sheet_templates_delete on public.app_sheet_templates
    for delete to authenticated
    using (public.is_team_member(team_id)
           and (created_by = auth.uid() or public.is_team_admin(team_id)));


-- -----------------------------------------------------------------------------
-- 5. app_sheet_google_links — one Google Sheet tab per sheet
-- -----------------------------------------------------------------------------
create table if not exists public.app_sheet_google_links (
    id               uuid default gen_random_uuid() not null,
    sheet_id         uuid not null,
    team_id          uuid not null,
    -- The Google account whose drive.file grant can open the file. Disconnecting
    -- that account removes its links (cascade) — there is nothing left that
    -- could read the file.
    connection_id    uuid not null,
    spreadsheet_id   text not null,
    spreadsheet_url  text,
    sheet_gid        integer,
    sheet_title      text,
    direction        text not null default 'both',
    conflict_policy  text not null default 'newest',
    delete_policy    text not null default 'keep',
    auto_sync        boolean not null default true,
    interval_minutes integer not null default 15,
    next_run_at      timestamptz,
    -- A sync in progress holds the lease; manual, auto and workflow runs all
    -- claim it first, so two of them never interleave writes on one sheet.
    lease_until      timestamptz,
    last_synced_at   timestamptz,
    last_status      text,
    -- Member-readable: sanitised text only, never Google's raw error body.
    last_error       text,
    last_counts      jsonb,
    created_by       uuid,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint app_sheet_google_links_pk primary key (id),
    constraint app_sheet_google_links_sheet_uniq unique (sheet_id),
    constraint app_sheet_google_links_sheet_fk
        foreign key (sheet_id) references public.app_sheets (id) on delete cascade,
    constraint app_sheet_google_links_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_sheet_google_links_connection_fk
        foreign key (connection_id) references public.app_google_connections (id)
        on delete cascade,
    constraint app_sheet_google_links_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_sheet_google_links_spreadsheet_check
        check (char_length(spreadsheet_id) between 1 and 200),
    constraint app_sheet_google_links_direction_check
        check (direction in ('both', 'push', 'pull')),
    constraint app_sheet_google_links_conflict_check
        check (conflict_policy in ('newest', 'cubes', 'google')),
    constraint app_sheet_google_links_delete_check
        check (delete_policy in ('keep', 'delete')),
    constraint app_sheet_google_links_interval_check
        check (interval_minutes between 5 and 1440),
    constraint app_sheet_google_links_status_check
        check (last_status is null or last_status in ('ok', 'error', 'running')),
    constraint app_sheet_google_links_error_check
        check (last_error is null or char_length(last_error) <= 1000)
);

-- Two Cubes sheets writing the same Google tab would overwrite each other's
-- rows on every run, so a tab is linked at most once.
create unique index if not exists app_sheet_google_links_tab_uindex
    on public.app_sheet_google_links (spreadsheet_id, coalesce(sheet_gid, -1));
create index if not exists app_sheet_google_links_due_index
    on public.app_sheet_google_links (next_run_at) where auto_sync;
create index if not exists app_sheet_google_links_connection_index
    on public.app_sheet_google_links (connection_id);

drop trigger if exists app_sheet_google_links_set_updated_at on public.app_sheet_google_links;
create trigger app_sheet_google_links_set_updated_at
    before update on public.app_sheet_google_links
    for each row execute function public.set_row_updated_at();

-- team_id follows the sheet, and the Google account must be the same
-- workspace's — the routes check both, this makes it impossible to get wrong.
create or replace function public.app_sheet_google_links_check()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _team uuid;
begin
    select s.team_id into _team from public.app_sheets s where s.id = new.sheet_id;
    if _team is null then
        raise exception 'Sheet not found.' using errcode = 'P0002';
    end if;
    new.team_id := _team;
    if not exists (select 1 from public.app_google_connections c
                   where c.id = new.connection_id and c.team_id = _team) then
        raise exception 'That Google account belongs to another workspace.'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

revoke all on function public.app_sheet_google_links_check() from public, anon, authenticated;

drop trigger if exists app_sheet_google_links_team on public.app_sheet_google_links;
create trigger app_sheet_google_links_team
    before insert or update of sheet_id, team_id, connection_id on public.app_sheet_google_links
    for each row execute function public.app_sheet_google_links_check();

alter table public.app_sheet_google_links enable row level security;

drop policy if exists app_sheet_google_links_select on public.app_sheet_google_links;
create policy app_sheet_google_links_select on public.app_sheet_google_links
    for select to authenticated
    using (public.app_sheets_can_access(sheet_id));


-- -----------------------------------------------------------------------------
-- 6. app_sheet_sync_state — the three-way merge's base. No client access.
-- -----------------------------------------------------------------------------
-- One row per synced record: the normalized values both sides agreed on at the
-- last sync. It is what tells "Google changed this cell" from "Cubes changed
-- it", so it is engine-private — a member rewriting it could make the next
-- sync overwrite real edits.
create table if not exists public.app_sheet_sync_state (
    link_id    uuid not null,
    record_key text not null,
    values     jsonb not null,
    synced_at  timestamptz not null default now(),
    constraint app_sheet_sync_state_pk primary key (link_id, record_key),
    constraint app_sheet_sync_state_link_fk
        foreign key (link_id) references public.app_sheet_google_links (id)
        on delete cascade
);

alter table public.app_sheet_sync_state enable row level security;


-- -----------------------------------------------------------------------------
-- 7. app_sheet_sync_runs — run history shown in the Google panel
-- -----------------------------------------------------------------------------
create table if not exists public.app_sheet_sync_runs (
    id          uuid default gen_random_uuid() not null,
    link_id     uuid not null,
    team_id     uuid not null,
    trigger     text not null,
    status      text not null default 'running',
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    counts      jsonb,
    error       text,
    constraint app_sheet_sync_runs_pk primary key (id),
    constraint app_sheet_sync_runs_link_fk
        foreign key (link_id) references public.app_sheet_google_links (id)
        on delete cascade,
    constraint app_sheet_sync_runs_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_sheet_sync_runs_trigger_check
        check (trigger in ('manual', 'auto', 'workflow')),
    constraint app_sheet_sync_runs_status_check
        check (status in ('running', 'ok', 'error')),
    constraint app_sheet_sync_runs_error_check
        check (error is null or char_length(error) <= 1000)
);

create index if not exists app_sheet_sync_runs_link_index
    on public.app_sheet_sync_runs (link_id, started_at desc);

alter table public.app_sheet_sync_runs enable row level security;

drop policy if exists app_sheet_sync_runs_select on public.app_sheet_sync_runs;
create policy app_sheet_sync_runs_select on public.app_sheet_sync_runs
    for select to authenticated
    using (exists (select 1 from public.app_sheet_google_links l
                   where l.id = link_id and public.app_sheets_can_access(l.sheet_id)));


-- -----------------------------------------------------------------------------
-- 8. Engine functions (service_role only)
-- -----------------------------------------------------------------------------

-- Claims a link's lease if nobody holds it. Compare-and-set on the database
-- clock, so a manual "Sync now", the runner tick and a workflow step racing for
-- the same sheet resolve to exactly one winner.
create or replace function public.app_sheets_claim_link(p_link_id uuid, p_lease_seconds integer default 600)
    returns boolean
    language plpgsql
    security definer
    set search_path = public
as
$$
begin
    update public.app_sheet_google_links
       set lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600))),
           last_status = 'running'
     where id = p_link_id
       and (lease_until is null or lease_until < now());
    return found;
end;
$$;

revoke all on function public.app_sheets_claim_link(uuid, integer) from public, anon, authenticated;
grant execute on function public.app_sheets_claim_link(uuid, integer) to service_role;

-- Links whose auto-sync is due. Skips archived sheets and Google accounts that
-- are disconnected or revoked (they would only fail again; reconnecting puts
-- them back in the queue). A null next_run_at means "not scheduled": the sync
-- engine parks a link there when Google access is lost, so it stops retrying
-- the same dead file every interval until a run that works reschedules it.
-- Oldest-due first so a backlog drains fairly.
create or replace function public.app_sheets_due_links(p_limit integer default 10)
    returns table (link_id uuid, team_id uuid, sheet_id uuid)
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select l.id, l.team_id, l.sheet_id
    from public.app_sheet_google_links l
    join public.app_sheets s on s.id = l.sheet_id
    join public.app_google_connections c on c.id = l.connection_id
    where l.auto_sync
      and not s.archived
      and c.enabled
      and c.revoked_at is null
      and l.next_run_at is not null
      and l.next_run_at <= now()
      and (l.lease_until is null or l.lease_until < now())
    order by l.next_run_at
    limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.app_sheets_due_links(integer) from public, anon, authenticated;
grant execute on function public.app_sheets_due_links(integer) to service_role;

-- Merges custom-column values into a row (creating it if needed) in one
-- statement, so two cells of the same row edited at once never drop each
-- other's write the way a read-modify-write from Node would. A null in the
-- patch clears that column.
create or replace function public.app_sheet_rows_patch(
    p_sheet_id uuid,
    p_record_key text,
    p_patch jsonb,
    p_actor uuid default null,
    p_position double precision default null
)
    returns public.app_sheet_rows
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    _row public.app_sheet_rows;
begin
    insert into public.app_sheet_rows as r
        (sheet_id, team_id, record_key, position, data, created_by, updated_by)
    values (p_sheet_id,
            (select s.team_id from public.app_sheets s where s.id = p_sheet_id),
            p_record_key,
            coalesce(p_position, 0),
            jsonb_strip_nulls(coalesce(p_patch, '{}'::jsonb)),
            p_actor, p_actor)
    on conflict (sheet_id, record_key) do update
        set data       = jsonb_strip_nulls(r.data || coalesce(p_patch, '{}'::jsonb)),
            updated_by = coalesce(p_actor, r.updated_by),
            position   = coalesce(p_position, r.position)
    returning * into _row;
    return _row;
end;
$$;

revoke all on function public.app_sheet_rows_patch(uuid, text, jsonb, uuid, double precision) from public, anon, authenticated;
grant execute on function public.app_sheet_rows_patch(uuid, text, jsonb, uuid, double precision) to service_role;


-- -----------------------------------------------------------------------------
-- 9. Grants
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.app_sheets          to authenticated;
grant select, insert, update, delete on public.app_sheet_rows      to authenticated;
grant select, insert, update, delete on public.app_sheet_templates to authenticated;
grant select on public.app_sheet_google_links to authenticated;
grant select on public.app_sheet_sync_runs    to authenticated;

grant all on public.app_sheets             to service_role;
grant all on public.app_sheet_rows         to service_role;
grant all on public.app_sheet_templates    to service_role;
grant all on public.app_sheet_google_links to service_role;
grant all on public.app_sheet_sync_state   to service_role;
grant all on public.app_sheet_sync_runs    to service_role;

-- Load-bearing (see 20261125000000_google_connections.sql): Supabase's default
-- privileges auto-grant every new public table to anon and authenticated.
revoke all on public.app_sheets             from anon;
revoke all on public.app_sheet_rows         from anon;
revoke all on public.app_sheet_templates    from anon;
revoke all on public.app_sheet_google_links from anon;
revoke all on public.app_sheet_sync_runs    from anon;
revoke all on public.app_sheet_sync_state   from public, anon, authenticated;
-- Links and runs are written by the sync engine only: a member flipping
-- direction or pointing a link at another file must go through the routes,
-- which check the Google account and do the first push.
revoke insert, update, delete on public.app_sheet_google_links from authenticated;
revoke insert, update, delete on public.app_sheet_sync_runs    from authenticated;
