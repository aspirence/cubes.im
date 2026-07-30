-- =============================================================================
-- Join a workspace by company email domain (with org-admin approval).
--
-- Adds:
--   * blocked_email_domains  — free/public providers that can't be claimed.
--   * organization_domains   — an org's claimed + verified email domains.
--   * workspace_join_requests — a user's request to join an org (pending→decided),
--                               mirrors hr_leave_requests.
--   * RPCs: normalize_email_domain, claim_org_domain, lookup_joinable_org,
--           request_to_join, decide_join_request, cancel_join_request.
--
-- Security: the two write-sensitive tables are RPC-only — INSERT/UPDATE/DELETE
-- are REVOKED from `authenticated` so nobody can, e.g., insert a self-verified
-- domain or a spoofed request. All mutations flow through SECURITY DEFINER RPCs.
-- Domain claiming (v1) is verified by requiring the claiming admin's own signup
-- email host to equal the domain; it's safe because an admin still manually
-- approves every join request (domain match only ROUTES a request).
-- =============================================================================

/* --------------------------------------------------------- domain helper */
create or replace function public.normalize_email_domain(p text)
    returns citext
    language plpgsql
    immutable
as $$
declare
    _d text;
begin
    if p is null then return null; end if;
    _d := lower(trim(p));
    if position('@' in _d) > 0 then _d := split_part(_d, '@', 2); end if;
    _d := regexp_replace(_d, '^[a-z]+://', '');           -- strip scheme
    _d := split_part(split_part(_d, '/', 1), ':', 1);     -- strip path + port
    _d := trim(_d);
    if _d = '' then return null; end if;
    if _d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
        return null;
    end if;
    return _d::citext;
end;
$$;
grant execute on function public.normalize_email_domain(text) to authenticated, service_role;

/* --------------------------------------------------- blocked_email_domains */
create table if not exists public.blocked_email_domains (
    domain citext primary key
);
alter table public.blocked_email_domains enable row level security;

drop policy if exists blocked_email_domains_select on public.blocked_email_domains;
create policy blocked_email_domains_select on public.blocked_email_domains
    for select to anon, authenticated using (true);

revoke insert, update, delete on public.blocked_email_domains from authenticated;
grant select on public.blocked_email_domains to anon, authenticated;
grant all on public.blocked_email_domains to service_role;

insert into public.blocked_email_domains (domain) values
    ('gmail.com'),('googlemail.com'),('outlook.com'),('hotmail.com'),('hotmail.co.uk'),
    ('live.com'),('live.co.uk'),('msn.com'),('yahoo.com'),('yahoo.co.uk'),('yahoo.co.in'),
    ('ymail.com'),('rocketmail.com'),('icloud.com'),('me.com'),('mac.com'),('aol.com'),
    ('proton.me'),('protonmail.com'),('pm.me'),('gmx.com'),('gmx.net'),('gmx.de'),
    ('mail.com'),('zoho.com'),('yandex.com'),('yandex.ru'),('qq.com'),('163.com'),
    ('126.com'),('naver.com'),('hey.com'),('fastmail.com'),('tutanota.com'),('tuta.io'),
    ('hushmail.com'),('yopmail.com'),('mailinator.com'),('example.com'),('test.com')
on conflict (domain) do nothing;

/* ---------------------------------------------------- organization_domains */
create table if not exists public.organization_domains (
    id                  uuid                     primary key default gen_random_uuid(),
    organization_id     uuid                     not null references public.organizations (id) on delete cascade,
    domain              citext                   not null,
    verified            boolean                  not null default false,
    verification_method text                     not null default 'admin_email',
    verification_token  text,
    verified_at         timestamp with time zone,
    created_by          uuid                     references public.users (id) on delete set null,
    created_at          timestamp with time zone not null default current_timestamp,
    updated_at          timestamp with time zone not null default current_timestamp,
    constraint organization_domains_org_domain_uindex unique (organization_id, domain),
    constraint organization_domains_method_check check (verification_method in ('admin_email', 'dns_txt')),
    constraint organization_domains_domain_check
        check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);
-- At most one VERIFIED org per domain (unverified duplicates allowed until one wins).
create unique index if not exists organization_domains_one_verified_uindex
    on public.organization_domains (domain) where verified is true;
create index if not exists organization_domains_org_id_index
    on public.organization_domains (organization_id);

alter table public.organization_domains enable row level security;

drop policy if exists organization_domains_select on public.organization_domains;
create policy organization_domains_select on public.organization_domains
    for select to authenticated using (public.is_org_member(organization_id));

revoke insert, update, delete on public.organization_domains from authenticated;
grant select on public.organization_domains to authenticated;
grant all on public.organization_domains to service_role;

/* -------------------------------------------------- workspace_join_requests */
create table if not exists public.workspace_join_requests (
    id                uuid                     primary key default gen_random_uuid(),
    org_id            uuid                     not null references public.organizations (id) on delete cascade,
    requester_user_id uuid                     not null references public.users (id) on delete cascade,
    requester_email   citext                   not null,
    requester_domain  citext                   not null,
    status            text                     not null default 'pending',
    assigned_team_id  uuid                     references public.teams (id) on delete set null,
    assigned_role_id  uuid                     references public.roles (id) on delete set null,
    approver_id       uuid                     references public.users (id) on delete set null,
    note              text,
    decided_at        timestamp with time zone,
    created_at        timestamp with time zone not null default current_timestamp,
    updated_at        timestamp with time zone not null default current_timestamp,
    constraint workspace_join_requests_status_check
        check (status in ('pending', 'approved', 'rejected', 'cancelled'))
);
create index if not exists workspace_join_requests_org_status_index
    on public.workspace_join_requests (org_id, status);
create index if not exists workspace_join_requests_requester_index
    on public.workspace_join_requests (requester_user_id);
-- One open request per user per org (rejected/cancelled never block a re-request).
create unique index if not exists workspace_join_requests_one_open_uindex
    on public.workspace_join_requests (requester_user_id, org_id) where status = 'pending';

alter table public.workspace_join_requests enable row level security;

drop policy if exists workspace_join_requests_select on public.workspace_join_requests;
create policy workspace_join_requests_select on public.workspace_join_requests
    for select to authenticated
    using (requester_user_id = auth.uid() or public.is_org_admin(org_id));

revoke insert, update, delete on public.workspace_join_requests from authenticated;
grant select on public.workspace_join_requests to authenticated;
grant all on public.workspace_join_requests to service_role;

/* ============================================================= RPCs ====== */

-- claim_org_domain: an org admin claims a domain. v1 verifies inline by
-- requiring the caller's own email host to equal the domain.
create or replace function public.claim_org_domain(
    p_org_id uuid,
    p_domain text,
    p_method text default 'admin_email'
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as $$
declare
    _uid       uuid := auth.uid();
    _domain    citext;
    _my_domain text;
    _id        uuid;
begin
    if _uid is null then raise exception 'not_authenticated'; end if;
    if not public.is_org_admin(p_org_id) then raise exception 'forbidden'; end if;

    _domain := public.normalize_email_domain(p_domain);
    if _domain is null then raise exception 'invalid_domain'; end if;

    if exists (select 1 from public.blocked_email_domains b where b.domain = _domain) then
        raise exception 'blocked_domain';
    end if;

    select split_part(u.email::text, '@', 2) into _my_domain from public.users u where u.id = _uid;
    if lower(coalesce(_my_domain, '')) is distinct from lower(_domain::text) then
        raise exception 'email_domain_mismatch';
    end if;

    if exists (
        select 1 from public.organization_domains d
        where d.domain = _domain and d.verified is true and d.organization_id <> p_org_id
    ) then
        raise exception 'domain_already_claimed';
    end if;

    insert into public.organization_domains
        (organization_id, domain, verified, verification_method, verified_at, created_by)
    values (p_org_id, _domain, true, 'admin_email', now(), _uid)
    on conflict (organization_id, domain) do update
        set verified = true, verification_method = 'admin_email', verified_at = now(), updated_at = current_timestamp
    returning id into _id;

    return _id;
end;
$$;
grant execute on function public.claim_org_domain(uuid, text, text) to authenticated;

-- lookup_joinable_org: the ONLY way a non-member learns the matched org's name.
create or replace function public.lookup_joinable_org()
    returns table(org_id uuid, org_name text, domain citext, already_member boolean, pending boolean)
    language plpgsql
    security definer
    stable
    set search_path = public, extensions
as $$
declare
    _uid    uuid := auth.uid();
    _email  citext;
    _domain citext;
    _org    uuid;
begin
    if _uid is null then return; end if;
    select u.email into _email from public.users u where u.id = _uid;
    _domain := public.normalize_email_domain(_email::text);
    if _domain is null then return; end if;
    if exists (select 1 from public.blocked_email_domains b where b.domain = _domain) then return; end if;
    select d.organization_id into _org
    from public.organization_domains d where d.domain = _domain and d.verified is true limit 1;
    if _org is null then return; end if;

    return query
        select o.id,
               o.organization_name,
               _domain,
               public.is_org_member(o.id),
               exists (
                   select 1 from public.workspace_join_requests w
                   where w.requester_user_id = _uid and w.org_id = o.id and w.status = 'pending'
               )
        from public.organizations o where o.id = _org;
end;
$$;
grant execute on function public.lookup_joinable_org() to authenticated;

-- request_to_join: derive caller's domain, route a pending request to org admins.
create or replace function public.request_to_join()
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as $$
declare
    _uid    uuid := auth.uid();
    _email  citext;
    _name   text;
    _domain citext;
    _org    uuid;
    _req    uuid;
    _admin  record;
begin
    if _uid is null then raise exception 'not_authenticated'; end if;
    select u.email, u.name into _email, _name from public.users u where u.id = _uid;
    _domain := public.normalize_email_domain(_email::text);
    if _domain is null or exists (select 1 from public.blocked_email_domains b where b.domain = _domain) then
        raise exception 'no_matching_org';
    end if;
    select d.organization_id into _org
    from public.organization_domains d where d.domain = _domain and d.verified is true limit 1;
    if _org is null then raise exception 'no_matching_org'; end if;
    if public.is_org_member(_org) then raise exception 'already_member'; end if;
    if exists (
        select 1 from public.workspace_join_requests w
        where w.requester_user_id = _uid and w.org_id = _org and w.status = 'pending'
    ) then
        raise exception 'already_pending';
    end if;

    insert into public.workspace_join_requests (org_id, requester_user_id, requester_email, requester_domain, status)
    values (_org, _uid, _email, _domain, 'pending')
    returning id into _req;

    -- Let the requester out of the /setup gate — they can use their personal
    -- workspace while the request is pending.
    update public.users set setup_completed = true, updated_at = current_timestamp
    where id = _uid and setup_completed = false;

    -- Notify org admins (owner + any team admin), de-duplicated.
    for _admin in
        select distinct uid from (
            select o.user_id as uid from public.organizations o where o.id = _org
            union
            select tm.user_id as uid
            from public.team_members tm
            join public.teams t on t.id = tm.team_id
            join public.roles r on r.id = tm.role_id
            where t.organization_id = _org
              and tm.active is true and tm.user_id is not null
              and (r.owner is true or r.admin_role is true)
        ) s where uid is not null
    loop
        perform public.create_notification(
            _admin.uid,
            coalesce(_name, 'Someone') || ' (' || _email::text || ') requested to join your organization',
            'join_request',
            '/admin-center/join-requests',
            null
        );
    end loop;

    return _req;
end;
$$;
grant execute on function public.request_to_join() to authenticated;

-- decide_join_request: an org admin approves (assign workspace + role) or rejects.
create or replace function public.decide_join_request(
    p_request_id uuid,
    p_approve    boolean,
    p_team_id    uuid default null,
    p_role_id    uuid default null,
    p_note       text default null
)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as $$
declare
    _uid       uuid := auth.uid();
    _org       uuid;
    _req_user  uuid;
    _status    text;
    _role      uuid;
    _org_name  text;
    _team_name text;
begin
    if _uid is null then raise exception 'not_authenticated'; end if;

    select org_id, requester_user_id, status
        into _org, _req_user, _status
    from public.workspace_join_requests where id = p_request_id
    for update;

    if _org is null then raise exception 'not_found'; end if;
    if not public.is_org_admin(_org) then raise exception 'forbidden'; end if;
    if _status is distinct from 'pending' then raise exception 'already_decided'; end if;

    if p_approve then
        if p_team_id is null or not exists (
            select 1 from public.teams t where t.id = p_team_id and t.organization_id = _org
        ) then
            raise exception 'invalid_team';
        end if;

        if p_role_id is not null then
            if not exists (select 1 from public.roles r where r.id = p_role_id and r.team_id = p_team_id) then
                raise exception 'invalid_role';
            end if;
            _role := p_role_id;
        else
            select r.id into _role from public.roles r
            where r.team_id = p_team_id and r.default_role is true limit 1;
            if _role is null then raise exception 'no_role'; end if;
        end if;

        -- Insert or reactivate membership (mirrors accept_invitation).
        if exists (select 1 from public.team_members tm where tm.team_id = p_team_id and tm.user_id = _req_user) then
            update public.team_members
                set active = true, role_id = _role, updated_at = current_timestamp
                where team_id = p_team_id and user_id = _req_user;
        else
            insert into public.team_members (user_id, team_id, role_id, active)
            values (_req_user, p_team_id, _role, true);
        end if;

        update public.workspace_join_requests
            set status = 'approved', approver_id = _uid, decided_at = now(),
                assigned_team_id = p_team_id, assigned_role_id = _role, note = p_note,
                updated_at = current_timestamp
            where id = p_request_id;

        -- Switch the requester into the joined workspace + release onboarding.
        update public.users
            set active_team = p_team_id, setup_completed = true, updated_at = current_timestamp
            where id = _req_user;

        select o.organization_name into _org_name from public.organizations o where o.id = _org;
        select t.name into _team_name from public.teams t where t.id = p_team_id;
        perform public.create_notification(
            _req_user,
            'Your request to join ' || coalesce(_org_name, 'the organization') ||
                ' was approved — welcome to ' || coalesce(_team_name, 'the workspace'),
            'join_approved', '/home', p_team_id
        );
    else
        update public.workspace_join_requests
            set status = 'rejected', approver_id = _uid, decided_at = now(),
                note = p_note, updated_at = current_timestamp
            where id = p_request_id;

        select o.organization_name into _org_name from public.organizations o where o.id = _org;
        perform public.create_notification(
            _req_user,
            'Your request to join ' || coalesce(_org_name, 'the organization') || ' was not approved',
            'join_rejected', null, null
        );
    end if;
end;
$$;
grant execute on function public.decide_join_request(uuid, boolean, uuid, uuid, text) to authenticated;

-- cancel_join_request: a requester withdraws their own pending request.
create or replace function public.cancel_join_request(p_request_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as $$
declare
    _uid      uuid := auth.uid();
    _req_user uuid;
    _status   text;
begin
    if _uid is null then raise exception 'not_authenticated'; end if;
    select requester_user_id, status into _req_user, _status
    from public.workspace_join_requests where id = p_request_id for update;
    if _req_user is null then raise exception 'not_found'; end if;
    if _req_user <> _uid then raise exception 'forbidden'; end if;
    if _status is distinct from 'pending' then raise exception 'already_decided'; end if;
    update public.workspace_join_requests
        set status = 'cancelled', updated_at = current_timestamp where id = p_request_id;
end;
$$;
grant execute on function public.cancel_join_request(uuid) to authenticated;
