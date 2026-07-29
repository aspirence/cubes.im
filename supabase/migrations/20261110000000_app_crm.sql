-- =============================================================================
-- Cubes CRM app (`app_crm_*`) — a Twenty-inspired CRM behind the apps platform
-- =============================================================================
-- Feature app (docs/APPS_PLATFORM.md): installed per-team via `installed_apps`
-- (app_key = 'crm'). Models Twenty CRM's core objects on Cubes' tenancy:
--
--   * app_crm_admins       — per-team ACCESS GRANTS. Decision: CRM data is NOT
--     visible to every team member. The team OWNER always has access; everyone
--     else needs a row here (granted by the owner from CRM Settings). Mirrors
--     hr_admins, but team-scoped (apps are team installs, not org installs).
--   * is_crm_admin(_team_id) — team owner OR (granted AND still an active team
--     member). SECURITY DEFINER so the app_crm_admins policies that call it do
--     not recurse.
--   * app_crm_stages       — the deal pipeline (per-team, orderable, colored).
--     Twenty's defaults (New / Screening / Meeting / Proposal / Customer) are
--     seeded by a trigger on `installed_apps` when the CRM app is installed.
--   * app_crm_companies    — accounts. Optional link to the core `clients` row
--     so a CRM account can back a billing client / client portal.
--   * app_crm_people       — contacts, optionally attached to a company.
--   * app_crm_deals        — opportunities: amount + currency, close date,
--     stage, company, point-of-contact person, owner. `position` orders cards
--     inside a kanban column.
--   * app_crm_tasks        — CRM to-dos (TODO / IN_PROGRESS / DONE, due date,
--     assignee) + app_crm_task_targets linking a task to person/company/deal.
--   * app_crm_notes        — free-form notes + app_crm_note_targets (same
--     polymorphic person/company/deal linking — Twenty's noteTargets).
--   * app_crm_activities   — the record timeline. Written ONLY by triggers
--     (created / updated / stage_changed / deleted / restored on the three
--     core objects; note_added / task_added on the target tables). No insert
--     policy for authenticated: direct writes are refused, triggers run
--     SECURITY DEFINER.
--
-- Soft delete: companies / people / deals / tasks / notes carry `deleted_at`
-- (Twenty's universal soft delete). The app filters on it; restore = null it.
-- Uninstalling the app keeps the data (FKs cascade from teams, not from
-- installed_apps) — reinstalling picks it back up, like other feature apps.
--
-- Re-runnable: create table if not exists / drop policy if exists / create or
-- replace function / drop trigger if exists.
-- =============================================================================


-- =============================================================================
-- SECTION 1: Tables (dependency order)
-- =============================================================================

-- 1.1 app_crm_admins — access grants. UNIQUE(team_id, user_id); both FKs
--     CASCADE so a grant never outlives the team or the user.
create table if not exists public.app_crm_admins (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    user_id    uuid                                               not null,
    created_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_crm_admins_pk primary key (id),
    constraint app_crm_admins_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_admins_user_id_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint app_crm_admins_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_crm_admins_team_user_uindex unique (team_id, user_id)
);

-- 1.2 app_crm_stages — the per-team pipeline. `position` orders columns.
create table if not exists public.app_crm_stages (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    name       text                                               not null,
    color      text                     default '#4a4ad0'         not null,
    position   integer                  default 0                 not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint app_crm_stages_pk primary key (id),
    constraint app_crm_stages_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_stages_name_check check (char_length(name) between 1 and 100)
);

-- 1.3 app_crm_companies — accounts. client_id optionally ties the account to
--     the core `clients` row (projects / client portal integration).
create table if not exists public.app_crm_companies (
    id               uuid                     default gen_random_uuid() not null,
    team_id          uuid                                               not null,
    name             text                                               not null,
    domain           text,
    linkedin_url     text,
    address_street   text,
    address_city     text,
    address_state    text,
    address_zip      text,
    address_country  text,
    annual_revenue   numeric,
    currency_code    text                     default 'USD'             not null,
    employees        integer,
    icp              boolean                  default false             not null,
    account_owner_id uuid,
    client_id        uuid,
    created_by       uuid,
    created_at       timestamp with time zone default current_timestamp not null,
    updated_at       timestamp with time zone default current_timestamp not null,
    deleted_at       timestamp with time zone,
    constraint app_crm_companies_pk primary key (id),
    constraint app_crm_companies_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_companies_account_owner_fk
        foreign key (account_owner_id) references public.users (id) on delete set null,
    constraint app_crm_companies_client_id_fk
        foreign key (client_id) references public.clients (id) on delete set null,
    constraint app_crm_companies_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_crm_companies_name_check check (char_length(name) between 1 and 300)
);

-- 1.4 app_crm_people — contacts. company SET NULL so a contact survives its
--     company being deleted (Twenty: person.companyId ON DELETE SET NULL).
create table if not exists public.app_crm_people (
    id           uuid                     default gen_random_uuid() not null,
    team_id      uuid                                               not null,
    first_name   text                     default ''                not null,
    last_name    text                     default ''                not null,
    email        text,
    phone        text,
    job_title    text,
    city         text,
    linkedin_url text,
    avatar_url   text,
    company_id   uuid,
    created_by   uuid,
    created_at   timestamp with time zone default current_timestamp not null,
    updated_at   timestamp with time zone default current_timestamp not null,
    deleted_at   timestamp with time zone,
    constraint app_crm_people_pk primary key (id),
    constraint app_crm_people_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_people_company_id_fk
        foreign key (company_id) references public.app_crm_companies (id) on delete set null,
    constraint app_crm_people_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_crm_people_name_check
        check (char_length(first_name || last_name) between 1 and 300)
);

-- 1.5 app_crm_deals — opportunities. stage SET NULL (a deal outlives a deleted
--     stage; the board shows it under "No stage"). `position` is double
--     precision for fractional between-cards inserts on the kanban.
create table if not exists public.app_crm_deals (
    id            uuid                     default gen_random_uuid() not null,
    team_id       uuid                                               not null,
    name          text                                               not null,
    amount        numeric,
    currency_code text                     default 'USD'             not null,
    close_date    date,
    stage_id      uuid,
    company_id    uuid,
    contact_id    uuid,
    owner_id      uuid,
    position      double precision         default 0                 not null,
    created_by    uuid,
    created_at    timestamp with time zone default current_timestamp not null,
    updated_at    timestamp with time zone default current_timestamp not null,
    deleted_at    timestamp with time zone,
    constraint app_crm_deals_pk primary key (id),
    constraint app_crm_deals_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_deals_stage_id_fk
        foreign key (stage_id) references public.app_crm_stages (id) on delete set null,
    constraint app_crm_deals_company_id_fk
        foreign key (company_id) references public.app_crm_companies (id) on delete set null,
    constraint app_crm_deals_contact_id_fk
        foreign key (contact_id) references public.app_crm_people (id) on delete set null,
    constraint app_crm_deals_owner_id_fk
        foreign key (owner_id) references public.users (id) on delete set null,
    constraint app_crm_deals_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_crm_deals_name_check check (char_length(name) between 1 and 300)
);

-- 1.6 app_crm_tasks — Twenty's task: TODO / IN_PROGRESS / DONE + due + assignee.
create table if not exists public.app_crm_tasks (
    id          uuid                     default gen_random_uuid() not null,
    team_id     uuid                                               not null,
    title       text                                               not null,
    body        text,
    due_at      timestamp with time zone,
    status      text                     default 'TODO'            not null,
    assignee_id uuid,
    created_by  uuid,
    created_at  timestamp with time zone default current_timestamp not null,
    updated_at  timestamp with time zone default current_timestamp not null,
    deleted_at  timestamp with time zone,
    constraint app_crm_tasks_pk primary key (id),
    constraint app_crm_tasks_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_tasks_assignee_id_fk
        foreign key (assignee_id) references public.users (id) on delete set null,
    constraint app_crm_tasks_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null,
    constraint app_crm_tasks_title_check check (char_length(title) between 1 and 300),
    constraint app_crm_tasks_status_check
        check (status in ('TODO', 'IN_PROGRESS', 'DONE'))
);

-- 1.7 app_crm_notes.
create table if not exists public.app_crm_notes (
    id         uuid                     default gen_random_uuid() not null,
    team_id    uuid                                               not null,
    title      text                     default ''                not null,
    body       text,
    created_by uuid,
    created_at timestamp with time zone default current_timestamp not null,
    updated_at timestamp with time zone default current_timestamp not null,
    deleted_at timestamp with time zone,
    constraint app_crm_notes_pk primary key (id),
    constraint app_crm_notes_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_notes_created_by_fk
        foreign key (created_by) references public.users (id) on delete set null
);

-- 1.8 Polymorphic target tables (Twenty's taskTargets / noteTargets). No FK on
--     target_id (it points at people OR companies OR deals); target rows are
--     cleaned up by the app when a record is permanently destroyed, and are
--     harmless orphans otherwise (joins simply drop them).
create table if not exists public.app_crm_task_targets (
    id          uuid                     default gen_random_uuid() not null,
    team_id     uuid                                               not null,
    task_id     uuid                                               not null,
    target_type text                                               not null,
    target_id   uuid                                               not null,
    created_at  timestamp with time zone default current_timestamp not null,
    constraint app_crm_task_targets_pk primary key (id),
    constraint app_crm_task_targets_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_task_targets_task_id_fk
        foreign key (task_id) references public.app_crm_tasks (id) on delete cascade,
    constraint app_crm_task_targets_type_check
        check (target_type in ('person', 'company', 'deal')),
    constraint app_crm_task_targets_uindex unique (task_id, target_type, target_id)
);

create table if not exists public.app_crm_note_targets (
    id          uuid                     default gen_random_uuid() not null,
    team_id     uuid                                               not null,
    note_id     uuid                                               not null,
    target_type text                                               not null,
    target_id   uuid                                               not null,
    created_at  timestamp with time zone default current_timestamp not null,
    constraint app_crm_note_targets_pk primary key (id),
    constraint app_crm_note_targets_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_note_targets_note_id_fk
        foreign key (note_id) references public.app_crm_notes (id) on delete cascade,
    constraint app_crm_note_targets_type_check
        check (target_type in ('person', 'company', 'deal')),
    constraint app_crm_note_targets_uindex unique (note_id, target_type, target_id)
);

-- 1.9 app_crm_activities — the timeline. Trigger-written only.
create table if not exists public.app_crm_activities (
    id          uuid                     default gen_random_uuid() not null,
    team_id     uuid                                               not null,
    target_type text                                               not null,
    target_id   uuid                                               not null,
    event       text                                               not null,
    properties  jsonb                    default '{}'::jsonb       not null,
    actor_id    uuid,
    created_at  timestamp with time zone default current_timestamp not null,
    constraint app_crm_activities_pk primary key (id),
    constraint app_crm_activities_team_id_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_crm_activities_actor_id_fk
        foreign key (actor_id) references public.users (id) on delete set null,
    constraint app_crm_activities_type_check
        check (target_type in ('person', 'company', 'deal'))
);

-- Indexes: every table scans by team; targets/activities also scan by target.
create index if not exists app_crm_admins_team_idx      on public.app_crm_admins (team_id);
create index if not exists app_crm_stages_team_idx      on public.app_crm_stages (team_id, position);
create index if not exists app_crm_companies_team_idx   on public.app_crm_companies (team_id);
create index if not exists app_crm_people_team_idx      on public.app_crm_people (team_id);
create index if not exists app_crm_people_company_idx   on public.app_crm_people (company_id);
create index if not exists app_crm_deals_team_idx       on public.app_crm_deals (team_id);
create index if not exists app_crm_deals_stage_idx      on public.app_crm_deals (stage_id);
create index if not exists app_crm_deals_company_idx    on public.app_crm_deals (company_id);
create index if not exists app_crm_tasks_team_idx       on public.app_crm_tasks (team_id);
create index if not exists app_crm_task_targets_target_idx
    on public.app_crm_task_targets (team_id, target_type, target_id);
create index if not exists app_crm_note_targets_target_idx
    on public.app_crm_note_targets (team_id, target_type, target_id);
create index if not exists app_crm_activities_target_idx
    on public.app_crm_activities (team_id, target_type, target_id, created_at desc);
create index if not exists app_crm_activities_team_idx
    on public.app_crm_activities (team_id, created_at desc);


-- =============================================================================
-- SECTION 2: Access helper (SECURITY DEFINER — reads app_crm_admins directly,
-- which is what lets the app_crm_admins policies call it without recursion)
-- =============================================================================

-- is_crm_admin: team OWNER, or granted in app_crm_admins AND still an active
-- team member (a stale grant after removal from the team confers nothing).
create or replace function public.is_crm_admin(_team_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select public.is_team_owner(_team_id)
        or (
            exists (
                select 1 from public.app_crm_admins a
                where a.team_id = _team_id
                  and a.user_id = auth.uid()
            )
            and public.is_team_member(_team_id)
        );
$$;


-- =============================================================================
-- SECTION 3: Triggers — updated_at, stage seeding, timeline
-- =============================================================================

drop trigger if exists app_crm_companies_set_updated_at on public.app_crm_companies;
create trigger app_crm_companies_set_updated_at
    before update on public.app_crm_companies
    for each row execute function public.set_row_updated_at();

drop trigger if exists app_crm_people_set_updated_at on public.app_crm_people;
create trigger app_crm_people_set_updated_at
    before update on public.app_crm_people
    for each row execute function public.set_row_updated_at();

drop trigger if exists app_crm_deals_set_updated_at on public.app_crm_deals;
create trigger app_crm_deals_set_updated_at
    before update on public.app_crm_deals
    for each row execute function public.set_row_updated_at();

drop trigger if exists app_crm_tasks_set_updated_at on public.app_crm_tasks;
create trigger app_crm_tasks_set_updated_at
    before update on public.app_crm_tasks
    for each row execute function public.set_row_updated_at();

drop trigger if exists app_crm_notes_set_updated_at on public.app_crm_notes;
create trigger app_crm_notes_set_updated_at
    before update on public.app_crm_notes
    for each row execute function public.set_row_updated_at();

-- Seed Twenty's default pipeline when the CRM app is installed. SECURITY
-- DEFINER: the installer is a team admin but not necessarily a CRM admin, so
-- the insert must bypass the app_crm_stages policies.
create or replace function public.app_crm_seed_stages()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    if new.app_key = 'crm'
       and not exists (select 1 from public.app_crm_stages s where s.team_id = new.team_id)
    then
        -- Colors CVD-validated as an adjacent sequence (dataviz six checks).
        insert into public.app_crm_stages (team_id, name, color, position)
        values (new.team_id, 'New',       '#dc2626', 0),
               (new.team_id, 'Screening', '#ca8a04', 1),
               (new.team_id, 'Meeting',   '#9333ea', 2),
               (new.team_id, 'Proposal',  '#0284c7', 3),
               (new.team_id, 'Customer',  '#16a34a', 4);
    end if;
    return new;
end;
$$;

drop trigger if exists installed_apps_crm_seed_stages on public.installed_apps;
create trigger installed_apps_crm_seed_stages
    after insert on public.installed_apps
    for each row execute function public.app_crm_seed_stages();

-- Timeline writer for the three core objects. tg_argv[0] = target_type.
-- Diffs old/new via jsonb (ignoring bookkeeping columns); a deal's stage_id
-- change is promoted to a first-class 'stage_changed' event with stage names.
create or replace function public.app_crm_track_record()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _target  text := tg_argv[0];
    _event   text;
    _props   jsonb := '{}'::jsonb;
    _changed text[];
begin
    if tg_op = 'INSERT' then
        _event := 'created';
    elsif old.deleted_at is null and new.deleted_at is not null then
        _event := 'deleted';
    elsif old.deleted_at is not null and new.deleted_at is null then
        _event := 'restored';
    else
        select coalesce(array_agg(o.key order by o.key), '{}'::text[])
        into _changed
        from jsonb_each(to_jsonb(old)) as o(key, value)
        join jsonb_each(to_jsonb(new)) as n(key, value) on n.key = o.key
        where o.value is distinct from n.value
          and o.key not in ('updated_at', 'created_at', 'position', 'deleted_at');

        if coalesce(array_length(_changed, 1), 0) = 0 then
            return new;
        end if;

        _event := 'updated';
        _props := jsonb_build_object('fields', to_jsonb(_changed));

        if _target = 'deal' and 'stage_id' = any (_changed) then
            _event := 'stage_changed';
            _props := _props || jsonb_build_object(
                'from', (select s.name from public.app_crm_stages s where s.id = old.stage_id),
                'to',   (select s.name from public.app_crm_stages s where s.id = new.stage_id));
        end if;
    end if;

    insert into public.app_crm_activities (team_id, target_type, target_id, event, properties, actor_id)
    values (new.team_id, _target, new.id, _event, _props, auth.uid());
    return new;
end;
$$;

drop trigger if exists app_crm_companies_track on public.app_crm_companies;
create trigger app_crm_companies_track
    after insert or update on public.app_crm_companies
    for each row execute function public.app_crm_track_record('company');

drop trigger if exists app_crm_people_track on public.app_crm_people;
create trigger app_crm_people_track
    after insert or update on public.app_crm_people
    for each row execute function public.app_crm_track_record('person');

drop trigger if exists app_crm_deals_track on public.app_crm_deals;
create trigger app_crm_deals_track
    after insert or update on public.app_crm_deals
    for each row execute function public.app_crm_track_record('deal');

-- Timeline writer for note/task attachment (the target record's feed).
create or replace function public.app_crm_track_attach()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _title text;
begin
    if tg_table_name = 'app_crm_note_targets' then
        select coalesce(nullif(n.title, ''), 'Untitled note') into _title
        from public.app_crm_notes n where n.id = new.note_id;
        insert into public.app_crm_activities (team_id, target_type, target_id, event, properties, actor_id)
        values (new.team_id, new.target_type, new.target_id, 'note_added',
                jsonb_build_object('title', _title, 'note_id', new.note_id), auth.uid());
    else
        select t.title into _title
        from public.app_crm_tasks t where t.id = new.task_id;
        insert into public.app_crm_activities (team_id, target_type, target_id, event, properties, actor_id)
        values (new.team_id, new.target_type, new.target_id, 'task_added',
                jsonb_build_object('title', _title, 'task_id', new.task_id), auth.uid());
    end if;
    return new;
end;
$$;

drop trigger if exists app_crm_note_targets_track on public.app_crm_note_targets;
create trigger app_crm_note_targets_track
    after insert on public.app_crm_note_targets
    for each row execute function public.app_crm_track_attach();

drop trigger if exists app_crm_task_targets_track on public.app_crm_task_targets;
create trigger app_crm_task_targets_track
    after insert on public.app_crm_task_targets
    for each row execute function public.app_crm_track_attach();


-- =============================================================================
-- SECTION 4: RLS
-- =============================================================================

alter table public.app_crm_admins       enable row level security;
alter table public.app_crm_stages       enable row level security;
alter table public.app_crm_companies    enable row level security;
alter table public.app_crm_people       enable row level security;
alter table public.app_crm_deals        enable row level security;
alter table public.app_crm_tasks        enable row level security;
alter table public.app_crm_notes        enable row level security;
alter table public.app_crm_task_targets enable row level security;
alter table public.app_crm_note_targets enable row level security;
alter table public.app_crm_activities   enable row level security;

-- Grants: CRM admins can see who has access; only the team OWNER grants or
-- revokes, and only to active members of that team.
drop policy if exists app_crm_admins_select on public.app_crm_admins;
create policy app_crm_admins_select on public.app_crm_admins
    for select to authenticated
    using (public.is_crm_admin(team_id));

drop policy if exists app_crm_admins_insert on public.app_crm_admins;
create policy app_crm_admins_insert on public.app_crm_admins
    for insert to authenticated
    with check (
        public.is_team_owner(team_id)
        and exists (
            select 1 from public.team_members tm
            where tm.team_id = app_crm_admins.team_id
              and tm.user_id = app_crm_admins.user_id
              and tm.active is true
        )
    );

drop policy if exists app_crm_admins_delete on public.app_crm_admins;
create policy app_crm_admins_delete on public.app_crm_admins
    for delete to authenticated
    using (public.is_team_owner(team_id));

-- All CRM data: full CRUD for CRM admins (owner + granted members).
drop policy if exists app_crm_stages_all on public.app_crm_stages;
create policy app_crm_stages_all on public.app_crm_stages
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

drop policy if exists app_crm_companies_all on public.app_crm_companies;
create policy app_crm_companies_all on public.app_crm_companies
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

drop policy if exists app_crm_people_all on public.app_crm_people;
create policy app_crm_people_all on public.app_crm_people
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

drop policy if exists app_crm_deals_all on public.app_crm_deals;
create policy app_crm_deals_all on public.app_crm_deals
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

drop policy if exists app_crm_tasks_all on public.app_crm_tasks;
create policy app_crm_tasks_all on public.app_crm_tasks
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

drop policy if exists app_crm_notes_all on public.app_crm_notes;
create policy app_crm_notes_all on public.app_crm_notes
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

drop policy if exists app_crm_task_targets_all on public.app_crm_task_targets;
create policy app_crm_task_targets_all on public.app_crm_task_targets
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

drop policy if exists app_crm_note_targets_all on public.app_crm_note_targets;
create policy app_crm_note_targets_all on public.app_crm_note_targets
    for all to authenticated
    using (public.is_crm_admin(team_id))
    with check (public.is_crm_admin(team_id));

-- Activities: read-only for CRM admins. Deliberately NO insert/update/delete
-- policies for authenticated — the timeline is written by the SECURITY DEFINER
-- triggers above and is immutable from the client.
drop policy if exists app_crm_activities_select on public.app_crm_activities;
create policy app_crm_activities_select on public.app_crm_activities
    for select to authenticated
    using (public.is_crm_admin(team_id));


-- =============================================================================
-- SECTION 5: Grants
-- =============================================================================

grant execute on function public.is_crm_admin(uuid) to authenticated;

grant select, insert, update, delete on public.app_crm_admins       to authenticated;
grant select, insert, update, delete on public.app_crm_stages       to authenticated;
grant select, insert, update, delete on public.app_crm_companies    to authenticated;
grant select, insert, update, delete on public.app_crm_people       to authenticated;
grant select, insert, update, delete on public.app_crm_deals        to authenticated;
grant select, insert, update, delete on public.app_crm_tasks        to authenticated;
grant select, insert, update, delete on public.app_crm_notes        to authenticated;
grant select, insert, update, delete on public.app_crm_task_targets to authenticated;
grant select, insert, update, delete on public.app_crm_note_targets to authenticated;
grant select                         on public.app_crm_activities   to authenticated;

grant all on public.app_crm_admins       to service_role;
grant all on public.app_crm_stages       to service_role;
grant all on public.app_crm_companies    to service_role;
grant all on public.app_crm_people       to service_role;
grant all on public.app_crm_deals        to service_role;
grant all on public.app_crm_tasks        to service_role;
grant all on public.app_crm_notes       to service_role;
grant all on public.app_crm_task_targets to service_role;
grant all on public.app_crm_note_targets to service_role;
grant all on public.app_crm_activities   to service_role;

revoke all on public.app_crm_admins       from anon;
revoke all on public.app_crm_stages       from anon;
revoke all on public.app_crm_companies    from anon;
revoke all on public.app_crm_people      from anon;
revoke all on public.app_crm_deals        from anon;
revoke all on public.app_crm_tasks        from anon;
revoke all on public.app_crm_notes        from anon;
revoke all on public.app_crm_task_targets from anon;
revoke all on public.app_crm_note_targets from anon;
revoke all on public.app_crm_activities   from anon;
