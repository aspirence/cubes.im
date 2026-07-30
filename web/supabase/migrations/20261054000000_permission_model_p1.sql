-- ============================================================================
-- Permission model — Phase 1 (foundation, ADDITIVE / non-breaking).
--
-- Introduces the ClickUp-style tier axis and a configurable capability system
-- WITHOUT touching any existing RLS policy, so current behaviour is unchanged
-- (member_can() defaults reproduce today's "members can do everything"). A
-- later phase wires member_can()/tiers into the write policies for real
-- enforcement.
--
--   Tiers (team_members.member_type): owner | admin | member | limited | guest
--     owner   — workspace owner (org owner = organizations.user_id, unchanged)
--     admin   — owner-level operational access
--     member  — full internal user; capabilities configurable
--     limited — internal but project-scoped (only projects they're added to)
--     guest   — external client; client-portal only
--
--   Capability catalog + per-workspace overrides let owner/admin configure what
--   member & limited can do. member_can(team, capability):
--     owner/admin -> always true, guest -> always false,
--     member/limited -> per-workspace override, else catalog default.
-- ============================================================================

-- ---------------------------------------------------------------- tier column
alter table public.team_members
    add column if not exists member_type text not null default 'member';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'team_members_member_type_check'
    ) then
        alter table public.team_members
            add constraint team_members_member_type_check
            check (member_type in ('owner', 'admin', 'member', 'limited', 'guest'));
    end if;
end $$;

-- Backfill from the existing 3 role booleans.
update public.team_members tm
set member_type = case
        when r.owner is true then 'owner'
        when r.admin_role is true then 'admin'
        else 'member'
    end
from public.roles r
where r.id = tm.role_id;

create index if not exists team_members_team_type_index
    on public.team_members (team_id, member_type) where active is true;

-- Keep member_type in sync with role_id changes (the legacy members UI updates
-- role_id directly) without touching any provisioning function. An explicit
-- member_type change (via set_member_type) is honored and skips derivation, so
-- limited/guest tiers are preserved.
create or replace function public.sync_member_type_from_role()
    returns trigger
    language plpgsql
as
$$
declare
    _owner boolean;
    _admin boolean;
begin
    if tg_op = 'UPDATE' and new.member_type is distinct from old.member_type then
        return new; -- caller explicitly set the tier — honor it
    end if;
    select r.owner, r.admin_role into _owner, _admin
    from public.roles r where r.id = new.role_id;
    if _owner is true then
        new.member_type := 'owner';
    elsif _admin is true then
        new.member_type := 'admin';
    elsif coalesce(new.member_type, 'member') not in ('limited', 'guest') then
        new.member_type := 'member';
    end if;
    return new;
end;
$$;

drop trigger if exists team_members_sync_member_type on public.team_members;
create trigger team_members_sync_member_type
    before insert or update of role_id on public.team_members
    for each row execute function public.sync_member_type_from_role();

-- ------------------------------------------------------------ tier helpers ---
create or replace function public.team_member_type(_team_id uuid)
    returns text
    language sql stable security definer set search_path = public
as
$$
    select tm.member_type
    from public.team_members tm
    where tm.team_id = _team_id and tm.user_id = auth.uid() and tm.active is true
    limit 1;
$$;

create or replace function public.is_guest(_team_id uuid)
    returns boolean language sql stable security definer set search_path = public
as $$ select public.team_member_type(_team_id) = 'guest'; $$;

create or replace function public.is_limited_member(_team_id uuid)
    returns boolean language sql stable security definer set search_path = public
as $$ select public.team_member_type(_team_id) = 'limited'; $$;

-- --------------------------------------------------------- capability catalog
create table if not exists public.permission_capabilities (
    key             text                                              not null,
    label           text                                              not null,
    description     text,
    category        text                     default 'General'        not null,
    default_member  boolean                  default true             not null,
    default_limited boolean                  default false            not null,
    sort            integer                  default 0                not null,
    constraint permission_capabilities_pk primary key (key)
);

insert into public.permission_capabilities (key, label, description, category, default_member, default_limited, sort) values
    ('create_projects',   'Create projects',        'Start new projects in the workspace.',          'Projects',      true,  false, 10),
    ('create_spaces',     'Create spaces',          'Create top-level spaces to group projects.',    'Projects',      true,  false, 20),
    ('delete_projects',   'Delete projects',        'Permanently delete projects they can access.',  'Projects',      false, false, 30),
    ('view_all_projects', 'See all projects',       'See every team-visible project, not just ones they are added to.', 'Projects', true, false, 40),
    ('invite_members',    'Invite people',          'Invite new members into the workspace.',        'People',        false, false, 50),
    ('manage_labels',     'Manage labels',          'Create, edit and delete workspace labels.',     'Customization', true,  false, 60),
    ('manage_templates',  'Manage templates',       'Create and edit task/project/status templates.','Customization', true,  false, 70),
    ('manage_statuses',   'Manage task statuses',   'Add or edit task statuses inside projects.',    'Customization', true,  true,  80),
    ('delete_tasks',      'Delete tasks',           'Delete tasks in projects they can access.',     'Tasks',         true,  false, 90),
    ('manage_automations','Manage automations',     'Create and edit project automations.',          'Automation',    false, false, 100),
    ('manage_clients',    'Manage clients',         'Add and edit clients and client portals.',      'CRM',           false, false, 110),
    ('use_integrations',  'Use integrations',       'Connect apps and create API tokens.',           'Integrations',  false, false, 120),
    ('export_data',       'Export data',            'Export workspace data.',                        'Data',          false, false, 130),
    ('create_channels',   'Create chat channels',   'Create channels in team chat.',                 'Chat',          true,  true,  140)
on conflict (key) do nothing;

alter table public.permission_capabilities enable row level security;
drop policy if exists permission_capabilities_select on public.permission_capabilities;
create policy permission_capabilities_select on public.permission_capabilities
    for select using (true);
revoke insert, update, delete on public.permission_capabilities from authenticated;

-- ------------------------------------------------- per-workspace overrides ---
create table if not exists public.workspace_capability_overrides (
    id             uuid                     default gen_random_uuid() not null,
    team_id        uuid                                               not null,
    capability_key text                                               not null,
    tier           text                                               not null,
    allowed        boolean                                            not null,
    created_at     timestamp with time zone default current_timestamp not null,
    updated_at     timestamp with time zone default current_timestamp not null,
    constraint workspace_capability_overrides_pk primary key (id),
    constraint workspace_capability_overrides_team_fk
        foreign key (team_id) references public.teams (id) on delete cascade,
    constraint workspace_capability_overrides_cap_fk
        foreign key (capability_key) references public.permission_capabilities (key) on delete cascade,
    constraint workspace_capability_overrides_tier_check check (tier in ('member', 'limited')),
    constraint workspace_capability_overrides_unique unique (team_id, capability_key, tier)
);

alter table public.workspace_capability_overrides enable row level security;
drop policy if exists workspace_capability_overrides_select on public.workspace_capability_overrides;
create policy workspace_capability_overrides_select on public.workspace_capability_overrides
    for select using (public.is_team_member(team_id));
-- Writes go through set_capability() only.
revoke insert, update, delete on public.workspace_capability_overrides from authenticated;

-- ------------------------------------------------------ capability check ----
create or replace function public.member_can(_team_id uuid, _capability text)
    returns boolean
    language plpgsql stable security definer set search_path = public, extensions
as
$$
declare
    _mt      text;
    _allowed boolean;
    _default boolean;
begin
    _mt := public.team_member_type(_team_id);
    if _mt is null then
        return false;
    end if;
    if _mt in ('owner', 'admin') then
        return true;
    end if;
    if _mt = 'guest' then
        return false;
    end if;
    -- member or limited: workspace override wins, else the catalog default.
    select o.allowed into _allowed
    from public.workspace_capability_overrides o
    where o.team_id = _team_id and o.capability_key = _capability and o.tier = _mt;
    if found then
        return _allowed;
    end if;
    select case when _mt = 'limited' then c.default_limited else c.default_member end
    into _default
    from public.permission_capabilities c where c.key = _capability;
    return coalesce(_default, false);
end;
$$;

-- ------------------------------------------------------------------ RPCs -----
-- Effective capability matrix for the settings UI.
create or replace function public.list_capabilities(p_team_id uuid)
    returns table (
        key             text,
        label           text,
        description     text,
        category        text,
        sort            integer,
        member_allowed  boolean,
        limited_allowed boolean
    )
    language sql stable security definer set search_path = public
as
$$
    select
        c.key, c.label, c.description, c.category, c.sort,
        coalesce((select o.allowed from public.workspace_capability_overrides o
                  where o.team_id = p_team_id and o.capability_key = c.key and o.tier = 'member'),
                 c.default_member),
        coalesce((select o.allowed from public.workspace_capability_overrides o
                  where o.team_id = p_team_id and o.capability_key = c.key and o.tier = 'limited'),
                 c.default_limited)
    from public.permission_capabilities c
    where public.is_team_member(p_team_id)
    order by c.category, c.sort;
$$;

-- Owner/admin toggles a capability for the member or limited tier.
create or replace function public.set_capability(
    p_team_id uuid, p_capability text, p_tier text, p_allowed boolean
)
    returns void
    language plpgsql security definer set search_path = public, extensions
as
$$
begin
    if not public.is_team_admin(p_team_id) then
        raise exception 'forbidden: only an admin or owner can change permissions';
    end if;
    if p_tier not in ('member', 'limited') then
        raise exception 'invalid tier';
    end if;
    if not exists (select 1 from public.permission_capabilities where key = p_capability) then
        raise exception 'unknown capability';
    end if;
    insert into public.workspace_capability_overrides (team_id, capability_key, tier, allowed)
    values (p_team_id, p_capability, p_tier, p_allowed)
    on conflict (team_id, capability_key, tier)
        do update set allowed = excluded.allowed, updated_at = now();
end;
$$;

-- Change a member's tier. Admins/owners; only an owner may grant/revoke owner;
-- a workspace can never lose its last owner. Keeps role_id in sync for back-compat.
create or replace function public.set_member_type(
    p_team_member_id uuid, p_member_type text
)
    returns void
    language plpgsql security definer set search_path = public, extensions
as
$$
declare
    _team        uuid;
    _cur         text;
    _org         uuid;
    _is_org_owner boolean;
    _new_role    uuid;
begin
    if p_member_type not in ('owner', 'admin', 'member', 'limited', 'guest') then
        raise exception 'invalid member type';
    end if;
    select team_id, member_type into _team, _cur
    from public.team_members where id = p_team_member_id;
    if _team is null then
        raise exception 'member not found';
    end if;
    select organization_id into _org from public.teams where id = _team;
    _is_org_owner := exists (select 1 from public.organizations o where o.id = _org and o.user_id = auth.uid());

    if not (public.is_team_admin(_team) or _is_org_owner) then
        raise exception 'forbidden: only an admin or owner can change roles';
    end if;
    -- Only an owner can assign or remove the owner tier.
    if (p_member_type = 'owner' or _cur = 'owner')
       and not (public.is_team_owner(_team) or _is_org_owner) then
        raise exception 'forbidden: only an owner can assign or remove the owner role';
    end if;
    -- Never remove the last owner.
    if _cur = 'owner' and p_member_type <> 'owner'
       and (select count(*) from public.team_members
            where team_id = _team and member_type = 'owner' and active is true) <= 1 then
        raise exception 'a workspace must always have at least one owner';
    end if;

    select id into _new_role from public.roles
    where team_id = _team
      and (case p_member_type when 'owner' then owner when 'admin' then admin_role else default_role end) is true
    limit 1;

    update public.team_members
    set member_type = p_member_type,
        role_id = coalesce(_new_role, role_id),
        updated_at = now()
    where id = p_team_member_id;
end;
$$;

-- Transfer workspace ownership to another active member.
create or replace function public.transfer_team_ownership(
    p_team_id uuid, p_to_user uuid
)
    returns void
    language plpgsql security definer set search_path = public, extensions
as
$$
declare
    _org         uuid;
    _to_tm       uuid;
    _owner_role  uuid;
    _admin_role  uuid;
begin
    select organization_id into _org from public.teams where id = p_team_id;
    if not (public.is_team_owner(p_team_id)
            or exists (select 1 from public.organizations o where o.id = _org and o.user_id = auth.uid())) then
        raise exception 'forbidden: only the owner can transfer ownership';
    end if;
    select id into _to_tm from public.team_members
    where team_id = p_team_id and user_id = p_to_user and active is true;
    if _to_tm is null then
        raise exception 'that person is not an active member of this workspace';
    end if;
    select id into _owner_role from public.roles where team_id = p_team_id and owner is true limit 1;
    select id into _admin_role from public.roles where team_id = p_team_id and admin_role is true limit 1;

    -- Promote the target first, then demote every other owner to admin.
    update public.team_members
    set member_type = 'owner', role_id = coalesce(_owner_role, role_id), updated_at = now()
    where id = _to_tm;
    update public.team_members
    set member_type = 'admin', role_id = coalesce(_admin_role, role_id), updated_at = now()
    where team_id = p_team_id and member_type = 'owner' and id <> _to_tm;
    update public.teams set user_id = p_to_user, updated_at = now() where id = p_team_id;
end;
$$;

-- Safe founder bootstrap: the first caller becomes the platform superadmin when
-- none exists yet (fixes the no-op email seed). No-op/forbidden once one exists.
create or replace function public.claim_first_superadmin()
    returns boolean
    language plpgsql security definer set search_path = public, extensions
as
$$
begin
    if auth.uid() is null then
        raise exception 'not authenticated';
    end if;
    if exists (select 1 from public.platform_admins) then
        raise exception 'a platform admin already exists';
    end if;
    insert into public.platform_admins (user_id) values (auth.uid())
    on conflict do nothing;
    return true;
end;
$$;

grant execute on function public.team_member_type(uuid) to authenticated;
grant execute on function public.is_guest(uuid) to authenticated;
grant execute on function public.is_limited_member(uuid) to authenticated;
grant execute on function public.member_can(uuid, text) to authenticated;
grant execute on function public.list_capabilities(uuid) to authenticated;
grant execute on function public.set_capability(uuid, text, text, boolean) to authenticated;
grant execute on function public.set_member_type(uuid, text) to authenticated;
grant execute on function public.transfer_team_ownership(uuid, uuid) to authenticated;
grant execute on function public.claim_first_superadmin() to authenticated;
