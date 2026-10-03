-- =============================================================================
-- Client app — contacts with an email identity, magic-link sessions, opt-in
-- shares, requests that become real tasks, and approvals with a proof trail.
-- =============================================================================
-- See docs/AUTOMATION_CLIENT.md, Part 3. This supersedes the old
-- `client_portal` app for project work; that app's share-link portal keeps
-- working untouched (app_client_portal_* tables are not modified here).
--
-- THE ONE RULE THIS FILE EXISTS TO ENFORCE: a client's payload is built in SQL.
-- Hiding a row in the UI is not security, so every client-facing read is a
-- SECURITY DEFINER function that resolves the caller's session to exactly one
-- contact and then selects only what that contact was explicitly shared. There
-- is no client-facing RLS policy and no anon grant anywhere in this file —
-- `anon` and `authenticated` cannot execute a single client_* function, and the
-- session/magic-link tables are service_role-only at the grant level, so a
-- token hash cannot be read back even by a workspace admin.
--
-- AUTH SHAPE (from the research: magic links must be single-use and short-lived
-- so a forwarded email is worthless): request → 15-minute single-use link →
-- 30-day sliding session cookie whose value is random and only ever stored as
-- a sha256. Revoking a contact deletes their sessions, by trigger, so it cannot
-- be forgotten on any one code path.
--
-- Re-runnable: create table if not exists / create or replace / drop policy if
-- exists. Purely additive — nothing outside this file is altered.
-- =============================================================================

set search_path = public, extensions;


-- -----------------------------------------------------------------------------
-- 1. app_client_contacts — the person at the client, identified by email
-- -----------------------------------------------------------------------------
-- This is the identity the old portal never had: one row per human, revocable
-- on its own, with `role` deciding what they may do. Approving is deliberately
-- its own permission ('approver'/'manager', or can_approve on a project row) —
-- a client editor is not automatically a client approver.
create table if not exists public.app_client_contacts (
    id           uuid default extensions.gen_random_uuid() not null,
    team_id      uuid not null,
    -- Optional link to the agency's own client record, so the Client app can
    -- group contacts by company. Null when the contact predates the client row.
    client_id    uuid,
    email        citext not null,
    name         text,
    role         text not null default 'viewer',
    status       text not null default 'invited',
    last_seen_at timestamptz,
    invited_by   uuid,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    constraint app_client_contacts_pk primary key (id),
    constraint app_client_contacts_email_uniq unique (team_id, email),
    -- Child tables carry team_id too; this composite target lets them prove
    -- with a FK that they were filed under the contact's own workspace, which
    -- is the only thing that would catch a service_role write gone wrong.
    constraint app_client_contacts_id_team_uniq unique (id, team_id),
    constraint app_client_contacts_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_client_contacts_client_fk
        foreign key (client_id) references public.clients (id) on delete set null,
    constraint app_client_contacts_invited_by_fk
        foreign key (invited_by) references public.users (id) on delete set null,
    constraint app_client_contacts_role_check
        check (role in ('viewer', 'approver', 'requester', 'manager')),
    constraint app_client_contacts_status_check
        check (status in ('invited', 'active', 'revoked')),
    constraint app_client_contacts_email_check
        check (char_length(email::text) between 3 and 320),
    constraint app_client_contacts_name_check
        check (name is null or char_length(name) <= 120)
);

create index if not exists app_client_contacts_team_index
    on public.app_client_contacts (team_id, status);
create index if not exists app_client_contacts_email_index
    on public.app_client_contacts (email);


-- -----------------------------------------------------------------------------
-- 2. app_client_project_access — opt-in, one row per project this contact sees
-- -----------------------------------------------------------------------------
-- No row means no access. "Show the whole project and hope" is exactly the
-- failure mode the research warns about, so there is no team-wide fallback.
create table if not exists public.app_client_project_access (
    contact_id  uuid not null,
    project_id  uuid not null,
    team_id     uuid not null,
    can_request boolean not null default true,
    can_approve boolean not null default false,
    shared_by   uuid,
    created_at  timestamptz not null default now(),
    constraint app_client_project_access_pk primary key (contact_id, project_id),
    constraint app_client_project_access_contact_fk
        foreign key (contact_id, team_id)
        references public.app_client_contacts (id, team_id) on delete cascade,
    constraint app_client_project_access_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_client_project_access_shared_by_fk
        foreign key (shared_by) references public.users (id) on delete set null
);

create index if not exists app_client_project_access_project_index
    on public.app_client_project_access (project_id);


-- -----------------------------------------------------------------------------
-- 3. app_client_sessions — the cookie, stored only as a hash
-- -----------------------------------------------------------------------------
-- The cookie VALUE never exists in the database. `token_hash` is sha256 of it,
-- so a database dump cannot be replayed as a login. service_role only.
create table if not exists public.app_client_sessions (
    id           uuid default extensions.gen_random_uuid() not null,
    contact_id   uuid not null,
    team_id      uuid not null,
    token_hash   text not null,
    issued_at    timestamptz not null default now(),
    expires_at   timestamptz not null,
    last_used_at timestamptz,
    revoked_at   timestamptz,
    user_agent   text,
    -- Hashed, not the address: enough to spot "a different machine", never
    -- enough to be personal data about the client's network.
    ip_hash      text,
    constraint app_client_sessions_pk primary key (id),
    constraint app_client_sessions_token_uniq unique (token_hash),
    constraint app_client_sessions_contact_fk
        foreign key (contact_id, team_id)
        references public.app_client_contacts (id, team_id) on delete cascade,
    constraint app_client_sessions_agent_check
        check (user_agent is null or char_length(user_agent) <= 400)
);

create index if not exists app_client_sessions_contact_index
    on public.app_client_sessions (contact_id);


-- -----------------------------------------------------------------------------
-- 4. app_client_magic_links — 15 minutes, one use
-- -----------------------------------------------------------------------------
create table if not exists public.app_client_magic_links (
    id         uuid default extensions.gen_random_uuid() not null,
    contact_id uuid not null,
    team_id    uuid not null,
    token_hash text not null,
    expires_at timestamptz not null,
    used_at    timestamptz,
    created_at timestamptz not null default now(),
    constraint app_client_magic_links_pk primary key (id),
    constraint app_client_magic_links_token_uniq unique (token_hash),
    constraint app_client_magic_links_contact_fk
        foreign key (contact_id, team_id)
        references public.app_client_contacts (id, team_id) on delete cascade
);

create index if not exists app_client_magic_links_contact_index
    on public.app_client_magic_links (contact_id, created_at desc);


-- -----------------------------------------------------------------------------
-- 5. app_client_shares — the opt-in list of what is visible
-- -----------------------------------------------------------------------------
-- `ref_id` is deliberately untyped (no FK): it points at a task, a file, a
-- a sheet or a portal update, and those live in four different tables,
-- two of which are being built in parallel. Resolution happens at read time and
-- a dangling share simply disappears from the payload.
create table if not exists public.app_client_shares (
    id         uuid default extensions.gen_random_uuid() not null,
    team_id    uuid not null,
    project_id uuid not null,
    kind       text not null,
    ref_id     uuid not null,
    -- Snapshot of the label at share time, so a share still reads sensibly if
    -- the underlying row is renamed or removed.
    title      text,
    shared_by  uuid,
    created_at timestamptz not null default now(),
    constraint app_client_shares_pk primary key (id),
    constraint app_client_shares_uniq unique (project_id, kind, ref_id),
    constraint app_client_shares_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_client_shares_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_client_shares_shared_by_fk
        foreign key (shared_by) references public.users (id) on delete set null,
    constraint app_client_shares_kind_check
        check (kind in ('task', 'file', 'sheet', 'update')),
    constraint app_client_shares_title_check
        check (title is null or char_length(title) <= 300)
);

create index if not exists app_client_shares_project_index
    on public.app_client_shares (project_id, kind);


-- -----------------------------------------------------------------------------
-- 6. app_client_requests — the intake that becomes work
-- -----------------------------------------------------------------------------
-- Accept is a deliberate agency action, never an auto-create: that gate is the
-- change-order moment the scope-creep research says everything hinges on.
create table if not exists public.app_client_requests (
    id           uuid default extensions.gen_random_uuid() not null,
    team_id      uuid not null,
    project_id   uuid not null,
    contact_id   uuid,
    request_type text not null default 'general',
    title        text not null,
    details      text,
    priority     text,
    status       text not null default 'new',
    -- Filled when the agency accepts and a real task is created.
    task_id      uuid,
    decided_by   uuid,
    decided_at   timestamptz,
    decision_note text,
    due_by       date,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    constraint app_client_requests_pk primary key (id),
    constraint app_client_requests_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_client_requests_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_client_requests_contact_fk
        foreign key (contact_id) references public.app_client_contacts (id) on delete set null,
    constraint app_client_requests_task_fk
        foreign key (task_id) references public.tasks (id) on delete set null,
    constraint app_client_requests_decided_by_fk
        foreign key (decided_by) references public.users (id) on delete set null,
    constraint app_client_requests_title_check
        check (char_length(title) between 1 and 200),
    constraint app_client_requests_details_check
        check (details is null or char_length(details) <= 8000),
    constraint app_client_requests_priority_check
        check (priority is null or priority in ('low', 'normal', 'high')),
    constraint app_client_requests_status_check
        check (status in ('new', 'accepted', 'declined', 'done')),
    constraint app_client_requests_type_check
        check (char_length(request_type) between 1 and 60),
    constraint app_client_requests_note_check
        check (decision_note is null or char_length(decision_note) <= 2000)
);

create index if not exists app_client_requests_project_index
    on public.app_client_requests (project_id, status, created_at desc);
create index if not exists app_client_requests_contact_index
    on public.app_client_requests (contact_id, created_at desc);


-- -----------------------------------------------------------------------------
-- 7. app_client_approvals — the single most valuable thing a client does
-- -----------------------------------------------------------------------------
-- Versioned, so round 3 is its own record and round 2's decision survives. The
-- unique key is the proof: one decision per (project, subject, version).
create table if not exists public.app_client_approvals (
    id                 uuid default extensions.gen_random_uuid() not null,
    team_id            uuid not null,
    project_id         uuid not null,
    subject_kind       text not null,
    subject_id         uuid not null,
    version            integer not null default 1,
    title              text,
    note               text,
    state              text not null default 'pending',
    requested_by       uuid,
    requested_at       timestamptz not null default now(),
    decided_by_contact uuid,
    decided_at         timestamptz,
    decision_note      text,
    constraint app_client_approvals_pk primary key (id),
    constraint app_client_approvals_uniq
        unique (project_id, subject_kind, subject_id, version),
    constraint app_client_approvals_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_client_approvals_project_fk
        foreign key (project_id) references public.projects (id) on delete cascade,
    constraint app_client_approvals_requested_by_fk
        foreign key (requested_by) references public.users (id) on delete set null,
    constraint app_client_approvals_contact_fk
        foreign key (decided_by_contact) references public.app_client_contacts (id) on delete set null,
    constraint app_client_approvals_kind_check
        check (subject_kind in ('task', 'content_item', 'video_review', 'file')),
    constraint app_client_approvals_state_check
        check (state in ('pending', 'approved', 'changes_requested')),
    constraint app_client_approvals_version_check check (version >= 1),
    constraint app_client_approvals_title_check
        check (title is null or char_length(title) <= 300),
    constraint app_client_approvals_note_check
        check (note is null or char_length(note) <= 4000),
    constraint app_client_approvals_decision_note_check
        check (decision_note is null or char_length(decision_note) <= 2000)
);

create index if not exists app_client_approvals_project_index
    on public.app_client_approvals (project_id, state, requested_at desc);


-- -----------------------------------------------------------------------------
-- 8. app_client_events — every login, view and decision
-- -----------------------------------------------------------------------------
-- "Who approved it, when, and from which role" is what settles a scope dispute,
-- so the audit trail is a product feature, not compliance overhead. Append-only
-- for everybody: there is no update or delete policy.
create table if not exists public.app_client_events (
    id         uuid default extensions.gen_random_uuid() not null,
    team_id    uuid not null,
    contact_id uuid,
    project_id uuid,
    kind       text not null,
    detail     jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    constraint app_client_events_pk primary key (id),
    constraint app_client_events_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint app_client_events_contact_fk
        foreign key (contact_id) references public.app_client_contacts (id) on delete set null,
    constraint app_client_events_project_fk
        foreign key (project_id) references public.projects (id) on delete set null,
    constraint app_client_events_kind_check
        check (char_length(kind) between 1 and 60)
);

create index if not exists app_client_events_team_index
    on public.app_client_events (team_id, created_at desc);
create index if not exists app_client_events_contact_index
    on public.app_client_events (contact_id, created_at desc);


-- =============================================================================
-- RLS — agency side only. No policy here ever grants a CLIENT anything; the
-- client never reaches PostgREST at all.
-- =============================================================================

alter table public.app_client_contacts       enable row level security;
alter table public.app_client_project_access enable row level security;
alter table public.app_client_sessions       enable row level security;
alter table public.app_client_magic_links    enable row level security;
alter table public.app_client_shares         enable row level security;
alter table public.app_client_requests       enable row level security;
alter table public.app_client_approvals      enable row level security;
alter table public.app_client_events         enable row level security;

drop policy if exists app_client_contacts_select on public.app_client_contacts;
create policy app_client_contacts_select on public.app_client_contacts
    for select to authenticated
    using (public.is_team_member(team_id));

-- Creating and editing a contact is team-member work, exactly like the
-- `clients` table it sits next to: the account manager on the project is the
-- person who knows which contact belongs there, and a contact row carries no
-- secret — it is an address and a role. Deleting one erases an audit subject,
-- so that stays with admins; the ordinary way to end access is Revoke.
drop policy if exists app_client_contacts_write on public.app_client_contacts;
drop policy if exists app_client_contacts_insert on public.app_client_contacts;
create policy app_client_contacts_insert on public.app_client_contacts
    for insert to authenticated
    with check (public.is_team_member(team_id));

drop policy if exists app_client_contacts_update on public.app_client_contacts;
create policy app_client_contacts_update on public.app_client_contacts
    for update to authenticated
    using (public.is_team_member(team_id))
    with check (public.is_team_member(team_id));

drop policy if exists app_client_contacts_delete on public.app_client_contacts;
create policy app_client_contacts_delete on public.app_client_contacts
    for delete to authenticated
    using (public.is_team_admin(team_id));

-- Sharing a project with a client is a project-level act, so it needs project
-- membership rather than workspace admin: the account manager on the project is
-- the person who knows which contact belongs there.
drop policy if exists app_client_project_access_select on public.app_client_project_access;
create policy app_client_project_access_select on public.app_client_project_access
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists app_client_project_access_write on public.app_client_project_access;
create policy app_client_project_access_write on public.app_client_project_access
    for all to authenticated
    using (public.is_project_team_member(project_id))
    with check (public.is_project_team_member(project_id));

drop policy if exists app_client_shares_select on public.app_client_shares;
create policy app_client_shares_select on public.app_client_shares
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists app_client_shares_write on public.app_client_shares;
create policy app_client_shares_write on public.app_client_shares
    for all to authenticated
    using (public.is_project_team_member(project_id))
    with check (public.is_project_team_member(project_id));

drop policy if exists app_client_requests_select on public.app_client_requests;
create policy app_client_requests_select on public.app_client_requests
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists app_client_requests_write on public.app_client_requests;
create policy app_client_requests_write on public.app_client_requests
    for all to authenticated
    using (public.is_project_team_member(project_id))
    with check (public.is_project_team_member(project_id));

drop policy if exists app_client_approvals_select on public.app_client_approvals;
create policy app_client_approvals_select on public.app_client_approvals
    for select to authenticated
    using (public.is_project_team_member(project_id));

drop policy if exists app_client_approvals_write on public.app_client_approvals;
create policy app_client_approvals_write on public.app_client_approvals
    for all to authenticated
    using (public.is_project_team_member(project_id))
    with check (public.is_project_team_member(project_id));

-- The audit log is readable by workspace members and written only by the
-- SECURITY DEFINER helpers below — nobody gets to forge or erase an entry.
drop policy if exists app_client_events_select on public.app_client_events;
create policy app_client_events_select on public.app_client_events
    for select to authenticated
    using (public.is_team_member(team_id));

-- Sessions and magic links get NO policy at all: with RLS on and no policy,
-- `authenticated` sees nothing even though the grant below is revoked anyway.
-- Belt and braces, because these rows are the login itself.


-- =============================================================================
-- Grants. Default privileges hand ALL on a new public table to authenticated
-- and anon, so the revokes here are load-bearing (see 20261011000000).
-- =============================================================================

grant select, insert, update, delete on public.app_client_contacts       to authenticated;
grant select, insert, update, delete on public.app_client_project_access to authenticated;
grant select, insert, update, delete on public.app_client_shares         to authenticated;
grant select, insert, update, delete on public.app_client_requests       to authenticated;
grant select, insert, update, delete on public.app_client_approvals      to authenticated;
grant select                         on public.app_client_events         to authenticated;

grant all on public.app_client_contacts       to service_role;
grant all on public.app_client_project_access to service_role;
grant all on public.app_client_sessions       to service_role;
grant all on public.app_client_magic_links    to service_role;
grant all on public.app_client_shares         to service_role;
grant all on public.app_client_requests       to service_role;
grant all on public.app_client_approvals      to service_role;
grant all on public.app_client_events         to service_role;

revoke all on public.app_client_sessions    from authenticated, anon;
revoke all on public.app_client_magic_links from authenticated, anon;
revoke all on public.app_client_contacts       from anon;
revoke all on public.app_client_project_access from anon;
revoke all on public.app_client_shares         from anon;
revoke all on public.app_client_requests       from anon;
revoke all on public.app_client_approvals      from anon;
revoke all on public.app_client_events         from anon;
-- The audit trail is append-only; members read it, the definer helpers write it.
revoke insert, update, delete on public.app_client_events from authenticated;


-- =============================================================================
-- Triggers
-- =============================================================================

create or replace function public.app_client_touch_updated_at()
    returns trigger
    language plpgsql
    set search_path = public, extensions
as
$$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists app_client_contacts_touch on public.app_client_contacts;
create trigger app_client_contacts_touch
    before update on public.app_client_contacts
    for each row execute function public.app_client_touch_updated_at();

drop trigger if exists app_client_requests_touch on public.app_client_requests;
create trigger app_client_requests_touch
    before update on public.app_client_requests
    for each row execute function public.app_client_touch_updated_at();

-- Revoking a contact must kill their access everywhere, immediately. Doing it
-- in a trigger rather than in the revoke route means no future code path can
-- forget: flip the status from anywhere and the sessions and unused links go.
create or replace function public.app_client_revoke_cascade()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    if new.status = 'revoked' and coalesce(old.status, '') <> 'revoked' then
        delete from public.app_client_sessions where contact_id = new.id;
        delete from public.app_client_magic_links
            where contact_id = new.id and used_at is null;
        insert into public.app_client_events (team_id, contact_id, kind, detail)
        values (new.team_id, new.id, 'contact_revoked', '{}'::jsonb);
    end if;
    return new;
end;
$$;

drop trigger if exists app_client_contacts_revoke on public.app_client_contacts;
create trigger app_client_contacts_revoke
    after update of status on public.app_client_contacts
    for each row execute function public.app_client_revoke_cascade();


-- =============================================================================
-- Internal helpers (service_role only)
-- =============================================================================

-- Writes to the workflow event bus, which the Workflows owner is building in
-- parallel. Defensive on purpose: a client pressing Approve must never fail
-- because the bus does not exist yet or its shape moved under us.
create or replace function public.client_emit_workflow_event(
    p_team_id uuid,
    p_key     text,
    p_payload jsonb
)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    if to_regclass('public.workflow_events') is null then
        return;
    end if;
    execute 'insert into public.workflow_events (team_id, key, payload) values ($1, $2, $3)'
        using p_team_id, p_key, coalesce(p_payload, '{}'::jsonb);
exception
    when others then
        -- Swallow: the event bus is best-effort, the client's action is not.
        return;
end;
$$;

create or replace function public.client_log_event(
    p_team_id    uuid,
    p_contact_id uuid,
    p_project_id uuid,
    p_kind       text,
    p_detail     jsonb default '{}'::jsonb
)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
begin
    insert into public.app_client_events (team_id, contact_id, project_id, kind, detail)
    values (p_team_id, p_contact_id, p_project_id, p_kind, coalesce(p_detail, '{}'::jsonb));
end;
$$;

-- Resolves a cookie value to exactly one live contact, and slides the session.
-- Everything client-facing starts here; nothing client-facing takes an id.
create or replace function public.client_resolve_session(p_token text)
    returns table (
        session_id uuid,
        contact_id uuid,
        team_id    uuid,
        role       text,
        name       text,
        email      text
    )
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _hash text;
    _row  record;
begin
    if p_token is null or char_length(p_token) < 20 then
        return;
    end if;
    _hash := encode(digest(p_token, 'sha256'), 'hex');

    select s.id as sid, s.contact_id as cid, s.team_id as tid,
           c.role as crole, c.name as cname, c.email::text as cemail
      into _row
      from public.app_client_sessions s
      join public.app_client_contacts c on c.id = s.contact_id
     where s.token_hash = _hash
       and s.revoked_at is null
       and s.expires_at > now()
       and c.status = 'active';
    if not found then
        return;
    end if;

    -- Sliding 30-day window, and the contact's "last seen" the agency shows.
    update public.app_client_sessions
       set last_used_at = now(), expires_at = now() + interval '30 days'
     where id = _row.sid;
    update public.app_client_contacts
       set last_seen_at = now()
     where id = _row.cid;

    session_id := _row.sid;
    contact_id := _row.cid;
    team_id    := _row.tid;
    role       := _row.crole;
    name       := _row.cname;
    email      := _row.cemail;
    return next;
end;
$$;


-- =============================================================================
-- Auth RPCs
-- =============================================================================

-- Mints a magic link for every live contact with this address. One address can
-- legitimately belong to contacts in two agencies' workspaces, so this returns
-- a row per workspace and the route emails each; the route answers the same
-- either way, so "no rows" never leaks that the address is unknown.
create or replace function public.client_issue_magic_links(p_email text)
    returns table (
        contact_id uuid,
        team_id    uuid,
        team_name  text,
        email      text,
        name       text,
        token      text,
        expires_at timestamptz
    )
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _c     record;
    _token text;
begin
    if p_email is null or trim(p_email) = '' then
        return;
    end if;

    for _c in
        select c.id, c.team_id, c.email, c.name, t.name as team_name
          from public.app_client_contacts c
          join public.teams t on t.id = c.team_id
         where c.email = trim(p_email)::citext
           and c.status in ('invited', 'active')
           -- Throttle: five live links in fifteen minutes is already generous
           -- for a person who mistyped their address, and it stops the sign-in
           -- form being used to mail-bomb a client.
           and (select count(*) from public.app_client_magic_links m
                 where m.contact_id = c.id
                   and m.created_at > now() - interval '15 minutes') < 5
         order by c.created_at
         limit 5
    loop
        _token := encode(extensions.gen_random_bytes(32), 'hex');
        insert into public.app_client_magic_links (contact_id, team_id, token_hash, expires_at)
        values (_c.id, _c.team_id,
                encode(digest(_token, 'sha256'), 'hex'),
                now() + interval '15 minutes');

        insert into public.app_client_events (team_id, contact_id, kind, detail)
        values (_c.team_id, _c.id, 'magic_link_sent', '{}'::jsonb);

        contact_id := _c.id;
        team_id    := _c.team_id;
        team_name  := _c.team_name;
        email      := _c.email::text;
        name       := _c.name;
        token      := _token;
        expires_at := now() + interval '15 minutes';
        return next;
    end loop;
end;
$$;

-- Verifies a magic link and turns it into a session. Single use: the update
-- that stamps used_at is the claim, and it is conditional, so two concurrent
-- redemptions cannot both succeed.
create or replace function public.client_consume_magic_link(
    p_token      text,
    p_user_agent text default null,
    p_ip_hash    text default null
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _hash          text;
    _link          record;
    _contact       record;
    _session_token text;
begin
    if p_token is null or char_length(p_token) < 20 then
        return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;
    _hash := encode(digest(p_token, 'sha256'), 'hex');

    update public.app_client_magic_links
       set used_at = now()
     where token_hash = _hash
       and used_at is null
       and expires_at > now()
    returning id, contact_id, team_id into _link;

    if _link.id is null then
        -- Unknown, already used, or expired — one answer for all three, so a
        -- probe learns nothing about which.
        return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;

    select c.id, c.team_id, c.status, c.role, c.name, c.email::text as email
      into _contact
      from public.app_client_contacts c
     where c.id = _link.contact_id;

    if _contact.id is null or _contact.status = 'revoked' then
        return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;

    -- First successful sign-in promotes an invited contact to active.
    if _contact.status = 'invited' then
        update public.app_client_contacts set status = 'active' where id = _contact.id;
    end if;

    _session_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.app_client_sessions
        (contact_id, team_id, token_hash, expires_at, last_used_at, user_agent, ip_hash)
    values (_contact.id, _contact.team_id,
            encode(digest(_session_token, 'sha256'), 'hex'),
            now() + interval '30 days', now(),
            left(coalesce(p_user_agent, ''), 400), p_ip_hash);

    update public.app_client_contacts set last_seen_at = now() where id = _contact.id;

    insert into public.app_client_events (team_id, contact_id, kind, detail)
    values (_contact.team_id, _contact.id, 'login', '{}'::jsonb);

    return jsonb_build_object(
        'ok', true,
        'session_token', _session_token,
        'contact_id', _contact.id,
        'team_id', _contact.team_id,
        'expires_at', now() + interval '30 days'
    );
end;
$$;

create or replace function public.client_end_session(p_token text)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _hash text;
    _row  record;
begin
    if p_token is null or char_length(p_token) < 20 then
        return jsonb_build_object('ok', true);
    end if;
    _hash := encode(digest(p_token, 'sha256'), 'hex');

    delete from public.app_client_sessions
     where token_hash = _hash
    returning contact_id, team_id into _row;

    if _row.contact_id is not null then
        insert into public.app_client_events (team_id, contact_id, kind, detail)
        values (_row.team_id, _row.contact_id, 'logout', '{}'::jsonb);
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

-- Who am I, and what is the workspace called? Used on every portal page load.
create or replace function public.client_session_context(p_token text)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s      record;
    _brand  record;
    _count  integer;
begin
    select * into _s from public.client_resolve_session(p_token);
    if _s.contact_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;

    select t.name as team_name,
           (select p.title from public.app_client_portal_portals p
             where p.team_id = t.id order by p.created_at limit 1) as portal_title,
           (select p.logo_url from public.app_client_portal_portals p
             where p.team_id = t.id and p.logo_url is not null
             order by p.created_at limit 1) as logo_url,
           (select p.accent from public.app_client_portal_portals p
             where p.team_id = t.id and p.accent is not null
             order by p.created_at limit 1) as accent
      into _brand
      from public.teams t
     where t.id = _s.team_id;

    select count(*) into _count
      from public.app_client_project_access a
     where a.contact_id = _s.contact_id;

    return jsonb_build_object(
        'ok', true,
        'contact', jsonb_build_object(
            'id', _s.contact_id, 'name', _s.name, 'email', _s.email, 'role', _s.role),
        'workspace', jsonb_build_object(
            'id', _s.team_id, 'name', _brand.team_name,
            'logo_url', _brand.logo_url, 'accent', _brand.accent),
        'project_count', _count
    );
end;
$$;


-- =============================================================================
-- Client-facing reads. Every one of these filters by contact_id in SQL.
-- =============================================================================

create or replace function public.client_portal_projects(p_token text)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s    record;
    _rows jsonb;
begin
    select * into _s from public.client_resolve_session(p_token);
    if _s.contact_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;

    select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into _rows
      from (
        select jsonb_build_object(
                 'id', p.id,
                 'name', p.name,
                 'color_code', p.color_code,
                 'client_name', cl.name,
                 'can_request', a.can_request,
                 'can_approve', a.can_approve,
                 -- Counts describe only what this contact can see, never the
                 -- size of the project as a whole.
                 'shared_count', (select count(*) from public.app_client_shares s
                                   where s.project_id = p.id),
                 'pending_approvals', (select count(*) from public.app_client_approvals ap
                                        where ap.project_id = p.id and ap.state = 'pending'),
                 'open_requests', (select count(*) from public.app_client_requests r
                                    where r.project_id = p.id
                                      and r.contact_id = _s.contact_id
                                      and r.status in ('new', 'accepted'))
               ) as x
          from public.app_client_project_access a
          join public.projects p on p.id = a.project_id
          left join public.clients cl on cl.id = p.client_id
         where a.contact_id = _s.contact_id
           -- Belt and braces against a project that somehow moved workspace.
           and p.team_id = _s.team_id
      ) q;

    perform public.client_log_event(_s.team_id, _s.contact_id, null, 'view_home', '{}'::jsonb);
    return jsonb_build_object('ok', true, 'projects', _rows);
end;
$$;

-- The whole client payload for one project. Nothing here reads a comment, a
-- work log, a budget or another contact's request — those columns are simply
-- never selected, which is the only version of "hidden" that is real.
create or replace function public.client_project_overview(
    p_token      text,
    p_project_id uuid
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s         record;
    _access    record;
    _project   record;
    _tasks     jsonb;
    _files     jsonb;
    _sheets    jsonb;
    _updates   jsonb;
    _approvals jsonb;
    _requests  jsonb;
    _can_approve boolean;
begin
    select * into _s from public.client_resolve_session(p_token);
    if _s.contact_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;

    select a.can_request, a.can_approve
      into _access
      from public.app_client_project_access a
     where a.contact_id = _s.contact_id and a.project_id = p_project_id;
    if _access is null or _access.can_request is null then
        -- Not shared with this contact: same answer as "no such project".
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    select p.id, p.name, p.color_code, p.start_date, p.end_date, cl.name as client_name
      into _project
      from public.projects p
      left join public.clients cl on cl.id = p.client_id
     where p.id = p_project_id and p.team_id = _s.team_id;
    if _project.id is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    -- Approving is its own permission: the role OR the per-project flag.
    _can_approve := coalesce(_access.can_approve, false)
                    or _s.role in ('approver', 'manager');

    -- Shared tasks. Name, status and due date only — no description, no
    -- assignee, no estimate, no comments, no time.
    select coalesce(jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'task_id', t.id,
               'name', t.name,
               'status', st.name,
               'status_color', cat.color_code,
               'done', t.done,
               'end_date', t.end_date
           ) order by t.name), '[]'::jsonb)
      into _tasks
      from public.app_client_shares s
      join public.tasks t on t.id = s.ref_id
      left join public.task_statuses st on st.id = t.status_id
      left join public.sys_task_status_categories cat on cat.id = st.category_id
     where s.project_id = p_project_id and s.kind = 'task'
       and t.archived is not true;

    select coalesce(jsonb_agg(jsonb_build_object(
               'share_id', s.id,
               'file_id', f.id,
               'name', f.name,
               'mime', f.mime,
               'size_bytes', f.size_bytes,
               'created_at', f.created_at
           ) order by f.created_at desc), '[]'::jsonb)
      into _files
      from public.app_client_shares s
      join public.app_files_files f on f.id = s.ref_id
     where s.project_id = p_project_id and s.kind = 'file';

    select coalesce(jsonb_agg(jsonb_build_object(
               'share_id', s.id, 'sheet_id', sh.id, 'name', sh.name,
               'description', sh.description
           ) order by sh.name), '[]'::jsonb)
      into _sheets
      from public.app_client_shares s
      join public.app_sheets sh on sh.id = s.ref_id
     where s.project_id = p_project_id and s.kind = 'sheet'
       and sh.archived is not true;

    select coalesce(jsonb_agg(jsonb_build_object(
               'share_id', s.id, 'update_id', u.id, 'title', u.title,
               'body', u.body, 'created_at', u.created_at
           ) order by u.created_at desc), '[]'::jsonb)
      into _updates
      from public.app_client_shares s
      join public.app_client_portal_updates u on u.id = s.ref_id
     where s.project_id = p_project_id and s.kind = 'update';

    select coalesce(jsonb_agg(jsonb_build_object(
               'id', ap.id,
               'subject_kind', ap.subject_kind,
               'subject_id', ap.subject_id,
               'version', ap.version,
               'title', ap.title,
               'note', ap.note,
               'state', ap.state,
               'requested_at', ap.requested_at,
               'decided_at', ap.decided_at,
               'decision_note', ap.decision_note,
               'decided_by_me', ap.decided_by_contact = _s.contact_id,
               'can_decide', _can_approve and ap.state = 'pending'
           ) order by ap.requested_at desc), '[]'::jsonb)
      into _approvals
      from public.app_client_approvals ap
     where ap.project_id = p_project_id;

    -- Only this contact's own requests. Another contact's intake is another
    -- client's business, even inside the same project.
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'title', r.title, 'details', r.details,
               'request_type', r.request_type, 'priority', r.priority,
               'status', r.status, 'due_by', r.due_by,
               'created_at', r.created_at, 'decided_at', r.decided_at,
               'decision_note', r.decision_note,
               -- Whether it became work, never which task or who owns it.
               'accepted', r.task_id is not null
           ) order by r.created_at desc), '[]'::jsonb)
      into _requests
      from public.app_client_requests r
     where r.project_id = p_project_id and r.contact_id = _s.contact_id;

    perform public.client_log_event(_s.team_id, _s.contact_id, p_project_id,
                                    'view_project', '{}'::jsonb);

    return jsonb_build_object(
        'ok', true,
        'project', jsonb_build_object(
            'id', _project.id, 'name', _project.name,
            'color_code', _project.color_code, 'client_name', _project.client_name,
            'start_date', _project.start_date, 'end_date', _project.end_date),
        'permissions', jsonb_build_object(
            'can_request', coalesce(_access.can_request, false),
            'can_approve', _can_approve),
        'tasks', _tasks, 'files', _files, 'sheets', _sheets,
        'updates', _updates,
        'approvals', _approvals, 'requests', _requests
    );
end;
$$;

-- Resolves a shared file to its storage path, for the signed-URL route. The
-- route never trusts a path from the browser; it passes the share id and gets
-- back a path only if this contact was actually given that file.
create or replace function public.client_file_for_share(
    p_token    text,
    p_share_id uuid
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s    record;
    _file record;
begin
    select * into _s from public.client_resolve_session(p_token);
    if _s.contact_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;

    select f.id, f.name, f.mime, f.storage_path, f.allow_download, s.project_id
      into _file
      from public.app_client_shares s
      join public.app_client_project_access a
        on a.project_id = s.project_id and a.contact_id = _s.contact_id
      join public.app_files_files f on f.id = s.ref_id
     where s.id = p_share_id and s.kind = 'file' and s.team_id = _s.team_id;

    if _file.id is null or _file.storage_path is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    perform public.client_log_event(_s.team_id, _s.contact_id, _file.project_id,
                                    'view_file', jsonb_build_object('share_id', p_share_id));

    return jsonb_build_object(
        'ok', true, 'name', _file.name, 'mime', _file.mime,
        'storage_path', _file.storage_path,
        'allow_download', coalesce(_file.allow_download, true));
end;
$$;


-- =============================================================================
-- Client-facing writes
-- =============================================================================

create or replace function public.client_submit_request(
    p_token        text,
    p_project_id   uuid,
    p_title        text,
    p_details      text default null,
    p_priority     text default 'normal',
    p_request_type text default 'general',
    p_due_by       date default null
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s        record;
    _access   record;
    _title    text;
    _id       uuid;
    _notify   record;
    _emails   jsonb := '[]'::jsonb;
    _project_name text;
begin
    select * into _s from public.client_resolve_session(p_token);
    if _s.contact_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;

    select a.can_request into _access
      from public.app_client_project_access a
     where a.contact_id = _s.contact_id and a.project_id = p_project_id;
    if _access is null or _access.can_request is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    -- The per-project switch is the gate, not the role: role decides approving
    -- (which is its own permission), can_request decides intake.
    if _access.can_request is not true then
        return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;

    _title := left(trim(coalesce(p_title, '')), 200);
    if _title = '' then
        return jsonb_build_object('ok', false, 'reason', 'title_required');
    end if;

    select p.name into _project_name
      from public.projects p where p.id = p_project_id and p.team_id = _s.team_id;
    if _project_name is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    insert into public.app_client_requests
        (team_id, project_id, contact_id, request_type, title, details, priority, due_by)
    values (_s.team_id, p_project_id, _s.contact_id,
            left(coalesce(nullif(trim(p_request_type), ''), 'general'), 60),
            _title, left(nullif(trim(coalesce(p_details, '')), ''), 8000),
            case when p_priority in ('low', 'normal', 'high') then p_priority else 'normal' end,
            p_due_by)
    returning id into _id;

    -- Tell the people who can act on it. The old portal's requests arrived
    -- silently, which is why they were never worked on.
    for _notify in
        select distinct u.id as user_id, u.email::text as email, u.name
          from public.users u
         where u.id in (
                   select tm.user_id
                     from public.project_members pm
                     join public.team_members tm on tm.id = pm.team_member_id
                    where pm.project_id = p_project_id and tm.active is true
                   union
                   -- A project with no explicit members still has an owner, and
                   -- they are the person who must see the request.
                   select p.owner_id from public.projects p
                    where p.id = p_project_id and p.owner_id is not null
               )
         limit 25
    loop
        perform public.create_notification(
            _notify.user_id,
            coalesce(_s.name, _s.email) || ' requested: ' || _title,
            'info',
            '/projects/' || p_project_id::text || '?view=client&request=' || _id::text,
            _s.team_id, null, p_project_id);
        _emails := _emails || jsonb_build_array(
            jsonb_build_object('email', _notify.email, 'name', _notify.name));
    end loop;

    perform public.client_log_event(_s.team_id, _s.contact_id, p_project_id,
                                    'request_created', jsonb_build_object('request_id', _id));

    perform public.client_emit_workflow_event(_s.team_id, 'client.request_created',
        jsonb_build_object(
            'request_id', _id, 'project_id', p_project_id, 'project_name', _project_name,
            'contact_id', _s.contact_id, 'contact_name', _s.name, 'contact_email', _s.email,
            'title', _title, 'priority', p_priority, 'request_type', p_request_type,
            'due_by', p_due_by));

    return jsonb_build_object('ok', true, 'request_id', _id, 'title', _title,
                              'project_name', _project_name, 'notify', _emails);
end;
$$;

create or replace function public.client_decide_approval(
    p_token       text,
    p_approval_id uuid,
    p_state       text,
    p_note        text default null
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _s      record;
    _access record;
    _ap     record;
    _note   text;
begin
    if p_state not in ('approved', 'changes_requested') then
        return jsonb_build_object('ok', false, 'reason', 'bad_state');
    end if;

    select * into _s from public.client_resolve_session(p_token);
    if _s.contact_id is null then
        return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;

    select ap.* into _ap
      from public.app_client_approvals ap
      join public.app_client_project_access a
        on a.project_id = ap.project_id and a.contact_id = _s.contact_id
     where ap.id = p_approval_id and ap.team_id = _s.team_id;
    if _ap.id is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    select a.can_approve into _access
      from public.app_client_project_access a
     where a.contact_id = _s.contact_id and a.project_id = _ap.project_id;
    if not (coalesce(_access.can_approve, false) or _s.role in ('approver', 'manager')) then
        return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;

    if _ap.state <> 'pending' then
        return jsonb_build_object('ok', false, 'reason', 'already_decided');
    end if;

    _note := left(nullif(trim(coalesce(p_note, '')), ''), 2000);

    update public.app_client_approvals
       set state = p_state, decided_by_contact = _s.contact_id,
           decided_at = now(), decision_note = _note
     where id = p_approval_id and state = 'pending';
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'already_decided');
    end if;

    if _ap.requested_by is not null then
        perform public.create_notification(
            _ap.requested_by,
            coalesce(_s.name, _s.email) || ' '
              || case when p_state = 'approved' then 'approved' else 'requested changes on' end
              || ' ' || coalesce(_ap.title, 'an item'),
            case when p_state = 'approved' then 'success' else 'warning' end,
            '/projects/' || _ap.project_id::text || '?view=client&approval=' || _ap.id::text,
            _s.team_id,
            case when _ap.subject_kind = 'task' then _ap.subject_id end,
            _ap.project_id);
    end if;

    perform public.client_log_event(_s.team_id, _s.contact_id, _ap.project_id,
        'approval_decided',
        jsonb_build_object('approval_id', _ap.id, 'state', p_state,
                           'subject_kind', _ap.subject_kind, 'version', _ap.version));

    perform public.client_emit_workflow_event(_s.team_id, 'client.approval_decided',
        jsonb_build_object(
            'approval_id', _ap.id, 'project_id', _ap.project_id,
            'subject_kind', _ap.subject_kind, 'subject_id', _ap.subject_id,
            'version', _ap.version, 'title', _ap.title, 'state', p_state,
            'note', _note, 'contact_id', _s.contact_id,
            'contact_name', _s.name, 'contact_email', _s.email));

    return jsonb_build_object('ok', true, 'approval_id', _ap.id, 'state', p_state,
                              'decided_at', now(),
                              'decided_by', jsonb_build_object(
                                  'contact_id', _s.contact_id,
                                  'name', _s.name, 'email', _s.email));
end;
$$;


-- =============================================================================
-- Agency-side helper: link an accepted request to the task it became.
-- =============================================================================
-- The task itself is created through the normal create_task RPC, as the signed-in
-- agency user, so every capability check (can_create_tasks, the project's
-- limited_task_creation override) applies exactly as it does anywhere else.
-- This only records the decision and the link, and it re-checks membership
-- itself so it is safe even though the route already authorized.
create or replace function public.client_link_request_task(
    p_request_id uuid,
    p_task_id    uuid,
    p_note       text default null
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _req  record;
    _task record;
begin
    select r.* into _req from public.app_client_requests r where r.id = p_request_id;
    if _req.id is null then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if not public.is_project_team_member(_req.project_id) then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    select t.id, t.project_id into _task from public.tasks t where t.id = p_task_id;
    if _task.id is null or _task.project_id <> _req.project_id then
        return jsonb_build_object('ok', false, 'reason', 'task_mismatch');
    end if;

    update public.app_client_requests
       set status = 'accepted', task_id = p_task_id,
           decided_by = auth.uid(), decided_at = now(),
           decision_note = left(nullif(trim(coalesce(p_note, '')), ''), 2000)
     where id = p_request_id;

    perform public.client_log_event(_req.team_id, _req.contact_id, _req.project_id,
        'request_accepted', jsonb_build_object('request_id', _req.id, 'task_id', p_task_id));

    return jsonb_build_object('ok', true, 'request_id', _req.id, 'task_id', p_task_id);
end;
$$;

revoke all on function public.client_link_request_task(uuid, uuid, text) from public, anon;
grant execute on function public.client_link_request_task(uuid, uuid, text) to authenticated, service_role;

-- Decline. A reason is recorded because "no" without a reason is the thing that
-- pushes the client back into WhatsApp.
create or replace function public.client_decline_request(
    p_request_id uuid,
    p_note       text default null
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _req record;
begin
    select r.* into _req from public.app_client_requests r where r.id = p_request_id;
    if _req.id is null or not public.is_project_team_member(_req.project_id) then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if _req.status <> 'new' then
        return jsonb_build_object('ok', false, 'reason', 'already_decided');
    end if;

    update public.app_client_requests
       set status = 'declined', decided_by = auth.uid(), decided_at = now(),
           decision_note = left(nullif(trim(coalesce(p_note, '')), ''), 2000)
     where id = p_request_id and status = 'new';
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'already_decided');
    end if;

    perform public.client_log_event(_req.team_id, _req.contact_id, _req.project_id,
        'request_declined', jsonb_build_object('request_id', _req.id));

    return jsonb_build_object('ok', true, 'request_id', _req.id, 'status', 'declined');
end;
$$;

revoke all on function public.client_decline_request(uuid, text) from public, anon;
grant execute on function public.client_decline_request(uuid, text) to authenticated, service_role;

-- Ask a client for a decision. Returns the contacts who may actually decide, so
-- the route emails exactly them and nobody else.
create or replace function public.client_request_approval(
    p_project_id   uuid,
    p_subject_kind text,
    p_subject_id   uuid,
    p_title        text default null,
    p_note         text default null,
    p_version      integer default null
)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _team_id uuid;
    _version integer;
    _id      uuid;
    _targets jsonb;
begin
    if p_subject_kind not in ('task', 'content_item', 'video_review', 'file') then
        return jsonb_build_object('ok', false, 'reason', 'bad_subject_kind');
    end if;
    if p_project_id is null or p_subject_id is null
       or not public.is_project_team_member(p_project_id) then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    _team_id := public.team_id_of_project(p_project_id);

    -- A new round is a new version, so round 2's decision survives round 3.
    if p_version is not null and p_version >= 1 then
        _version := p_version;
    else
        select coalesce(max(ap.version), 0) + 1 into _version
          from public.app_client_approvals ap
         where ap.project_id = p_project_id
           and ap.subject_kind = p_subject_kind
           and ap.subject_id = p_subject_id;
    end if;

    insert into public.app_client_approvals
        (team_id, project_id, subject_kind, subject_id, version, title, note, requested_by)
    values (_team_id, p_project_id, p_subject_kind, p_subject_id, _version,
            left(nullif(trim(coalesce(p_title, '')), ''), 300),
            left(nullif(trim(coalesce(p_note, '')), ''), 4000),
            auth.uid())
    on conflict (project_id, subject_kind, subject_id, version) do nothing
    returning id into _id;

    if _id is null then
        return jsonb_build_object('ok', false, 'reason', 'version_exists');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'contact_id', c.id, 'email', c.email::text, 'name', c.name)), '[]'::jsonb)
      into _targets
      from public.app_client_project_access a
      join public.app_client_contacts c on c.id = a.contact_id
     where a.project_id = p_project_id
       and c.status in ('invited', 'active')
       and (a.can_approve is true or c.role in ('approver', 'manager'));

    perform public.client_log_event(_team_id, null, p_project_id,
        'approval_requested',
        jsonb_build_object('approval_id', _id, 'subject_kind', p_subject_kind,
                           'version', _version));

    return jsonb_build_object('ok', true, 'approval_id', _id, 'version', _version,
                              'notify', _targets);
end;
$$;

revoke all on function public.client_request_approval(uuid, text, uuid, text, text, integer) from public, anon;
grant execute on function public.client_request_approval(uuid, text, uuid, text, text, integer) to authenticated, service_role;


-- =============================================================================
-- Execute grants. NOTHING client-facing is reachable by anon or authenticated:
-- every one of these runs from a Next.js route holding the service role, after
-- that route has read the session cookie. PostgREST is not a client surface.
--
-- `revoke ... from public` is NOT enough on Supabase: the project ships
-- `alter default privileges in schema public grant execute on functions to
-- anon, authenticated`, which creates explicit grants to those two roles on
-- every function the moment it is created. They have to be revoked by name, or
-- a client RPC would be callable straight from the browser with the anon key —
-- exactly the hole this design exists to close.
-- =============================================================================

revoke all on function public.client_emit_workflow_event(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.client_log_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.client_resolve_session(text) from public, anon, authenticated;
revoke all on function public.client_issue_magic_links(text) from public, anon, authenticated;
revoke all on function public.client_consume_magic_link(text, text, text) from public, anon, authenticated;
revoke all on function public.client_end_session(text) from public, anon, authenticated;
revoke all on function public.client_session_context(text) from public, anon, authenticated;
revoke all on function public.client_portal_projects(text) from public, anon, authenticated;
revoke all on function public.client_project_overview(text, uuid) from public, anon, authenticated;
revoke all on function public.client_file_for_share(text, uuid) from public, anon, authenticated;
revoke all on function public.client_submit_request(text, uuid, text, text, text, text, date) from public, anon, authenticated;
revoke all on function public.client_decide_approval(text, uuid, text, text) from public, anon, authenticated;

grant execute on function public.client_emit_workflow_event(uuid, text, jsonb) to service_role;
grant execute on function public.client_log_event(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.client_resolve_session(text) to service_role;
grant execute on function public.client_issue_magic_links(text) to service_role;
grant execute on function public.client_consume_magic_link(text, text, text) to service_role;
grant execute on function public.client_end_session(text) to service_role;
grant execute on function public.client_session_context(text) to service_role;
grant execute on function public.client_portal_projects(text) to service_role;
grant execute on function public.client_project_overview(text, uuid) to service_role;
grant execute on function public.client_file_for_share(text, uuid) to service_role;
grant execute on function public.client_submit_request(text, uuid, text, text, text, text, date) to service_role;
grant execute on function public.client_decide_approval(text, uuid, text, text) to service_role;


-- =============================================================================
-- Email triggers for the four client scenarios
-- =============================================================================
-- Default templates live in src/lib/email/templates.ts. `on conflict do nothing`
-- keeps a super admin's later enable/disable edits across re-runs.
insert into public.platform_email_triggers (event_key, label, description, category, enabled)
values
    ('client.invitation', 'Client invitation',
     'Sent to a client contact when the agency shares a project with their email address.',
     'client', true),
    ('client.magic_link', 'Client sign-in link',
     'The single-use, 15-minute link a client requests from the portal sign-in page.',
     'client', true),
    ('client.approval_requested', 'Approval requested',
     'Sent to a client contact who can approve when the agency asks for a decision.',
     'client', true),
    ('client.request_received', 'Client request received',
     'Sent to the project team when a client submits a request in the portal.',
     'client', true)
on conflict (event_key) do nothing;

-- =============================================================================
-- END Client app
-- =============================================================================
