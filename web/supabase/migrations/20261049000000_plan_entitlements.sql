-- =============================================================================
-- Cloud plans + free-tier entitlement enforcement.
--
-- Design goals:
--   * SAFE to apply everywhere. All enforcement is gated by `cloud_mode()`,
--     which reads a singleton flag DEFAULTING TO FALSE. So on self-hosted
--     installs (and on Cloud until an operator flips it on) these triggers are
--     behavioural no-ops — nothing changes for existing create/upload paths.
--   * Enforced via BEFORE INSERT triggers rather than by editing the
--     create_team / create_project SECURITY DEFINER RPCs, so every path
--     (RPC, onboarding, templates, direct insert) is covered and the fragile
--     RPC bodies are left untouched.
--   * Plans are per-workspace (per team). A "paid" workspace = a
--     team_subscriptions row with plan='cloud', status='active', and a
--     non-expired period.
--
-- Free caps (mirror src/lib/entitlements.ts — keep in sync):
--   1 workspace / account · 2 projects / ws · 3 members / ws · 1GB storage / ws
--   · 25MB max single upload.
-- =============================================================================

/* --------------------------------------------------------- platform_config */
create table if not exists public.platform_config (
    id         boolean                  primary key default true,
    cloud_mode boolean                  not null default false,
    updated_at timestamp with time zone not null default current_timestamp,
    constraint platform_config_singleton check (id = true)
);
insert into public.platform_config (id) values (true) on conflict (id) do nothing;

alter table public.platform_config enable row level security;

drop policy if exists platform_config_select on public.platform_config;
create policy platform_config_select on public.platform_config
    for select to anon, authenticated using (true);

drop policy if exists platform_config_write on public.platform_config;
create policy platform_config_write on public.platform_config
    for all to authenticated
    using (public.is_platform_admin())
    with check (public.is_platform_admin());

revoke all on public.platform_config from public, anon;
grant select on public.platform_config to anon, authenticated;
grant update on public.platform_config to authenticated;
grant all on public.platform_config to service_role;

-- Cheap, stable read used by every enforcement trigger.
create or replace function public.cloud_mode()
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as $$
    select coalesce((select cloud_mode from public.platform_config where id), false);
$$;
grant execute on function public.cloud_mode() to anon, authenticated, service_role;

/* ------------------------------------------------ team_subscriptions: plans */
alter table public.team_subscriptions
    add column if not exists plan                 text        not null default 'free',
    add column if not exists dodo_customer_id     text,
    add column if not exists dodo_subscription_id text,
    add column if not exists current_period_end   timestamp with time zone;

do $$ begin
    alter table public.team_subscriptions
        add constraint team_subscriptions_plan_check check (plan in ('free', 'cloud'));
exception when duplicate_object then null; end $$;

-- Every team should have a subscription row (default: free). Backfill + keep new
-- teams covered via a trigger so team_is_paid() / usage always resolve.
insert into public.team_subscriptions (team_id, storage_gb, status, plan)
select t.id, 1, 'active', 'free'
from public.teams t
where not exists (select 1 from public.team_subscriptions s where s.team_id = t.id)
on conflict (team_id) do nothing;

create or replace function public.ensure_team_subscription()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as $$
begin
    insert into public.team_subscriptions (team_id, storage_gb, status, plan)
    values (new.id, 1, 'active', 'free')
    on conflict (team_id) do nothing;
    return new;
end;
$$;

drop trigger if exists ensure_team_subscription_ai on public.teams;
create trigger ensure_team_subscription_ai
    after insert on public.teams
    for each row execute function public.ensure_team_subscription();

-- A workspace is "paid" iff it has an active, non-expired cloud subscription.
create or replace function public.team_is_paid(_team_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
as $$
    select exists (
        select 1 from public.team_subscriptions s
        where s.team_id = _team_id
          and s.plan = 'cloud'
          and s.status = 'active'
          and (s.current_period_end is null or s.current_period_end > current_timestamp)
    );
$$;
grant execute on function public.team_is_paid(uuid) to authenticated, service_role;

/* ---------------------------------------------------- storage usage tracking */
create table if not exists public.team_storage_usage (
    team_id    uuid                     primary key references public.teams (id) on delete cascade,
    bytes_used bigint                   not null default 0,
    updated_at timestamp with time zone not null default current_timestamp,
    constraint team_storage_usage_nonneg check (bytes_used >= 0)
);
alter table public.team_storage_usage enable row level security;

drop policy if exists team_storage_usage_select on public.team_storage_usage;
create policy team_storage_usage_select on public.team_storage_usage
    for select to authenticated using (public.is_team_member(team_id));

revoke all on public.team_storage_usage from public, anon;
grant select on public.team_storage_usage to authenticated;
grant all on public.team_storage_usage to service_role;

create or replace function public.bump_storage_usage(_team_id uuid, _delta bigint)
    returns void
    language sql
    security definer
    set search_path = public
as $$
    insert into public.team_storage_usage as u (team_id, bytes_used, updated_at)
    values (_team_id, greatest(_delta, 0), current_timestamp)
    on conflict (team_id) do update
        set bytes_used = greatest(0, u.bytes_used + _delta),
            updated_at = current_timestamp;
$$;

-- Maintains bytes_used for any table carrying a `team_id` + a size column
-- (`size_bytes` on app_files_files, `size` on task_attachments). Runs always,
-- so the counter is accurate whenever cloud_mode is later enabled.
create or replace function public.tr_storage_usage()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as $$
declare
    _team uuid;
    _size bigint;
begin
    if tg_op = 'DELETE' then
        _team := (to_jsonb(old) ->> 'team_id')::uuid;
        _size := coalesce((to_jsonb(old) ->> 'size_bytes')::bigint, (to_jsonb(old) ->> 'size')::bigint, 0);
        if _team is not null then perform public.bump_storage_usage(_team, -_size); end if;
        return old;
    else
        _team := (to_jsonb(new) ->> 'team_id')::uuid;
        _size := coalesce((to_jsonb(new) ->> 'size_bytes')::bigint, (to_jsonb(new) ->> 'size')::bigint, 0);
        if _team is not null then perform public.bump_storage_usage(_team, _size); end if;
        return new;
    end if;
end;
$$;

drop trigger if exists tr_storage_usage_app_files on public.app_files_files;
create trigger tr_storage_usage_app_files
    after insert or delete on public.app_files_files
    for each row execute function public.tr_storage_usage();

drop trigger if exists tr_storage_usage_attachments on public.task_attachments;
create trigger tr_storage_usage_attachments
    after insert or delete on public.task_attachments
    for each row execute function public.tr_storage_usage();

-- Backfill the counter from existing files.
insert into public.team_storage_usage (team_id, bytes_used)
select team_id, sum(b) from (
    select team_id, coalesce(size_bytes, 0) b from public.app_files_files where team_id is not null
    union all
    select team_id, coalesce(size, 0) b from public.task_attachments where team_id is not null
) x
group by team_id
on conflict (team_id) do update set bytes_used = excluded.bytes_used, updated_at = current_timestamp;

/* =========================================================================
 * Enforcement triggers — all no-op unless cloud_mode() AND the workspace is
 * on the free plan.
 * ========================================================================= */

-- Workspaces: a free account (no active paid workspace) is capped at 1 team.
create or replace function public.enforce_workspace_limit()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as $$
begin
    if public.cloud_mode() then
        if not exists (
            select 1 from public.team_subscriptions s
            join public.teams t on t.id = s.team_id
            where t.organization_id = new.organization_id
              and s.plan = 'cloud' and s.status = 'active'
              and (s.current_period_end is null or s.current_period_end > current_timestamp)
        ) and (
            select count(*) from public.teams where organization_id = new.organization_id
        ) >= 1 then
            raise exception 'PLAN_LIMIT_WORKSPACES: the free plan allows one workspace — upgrade to add more';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_workspace_limit_bi on public.teams;
create trigger enforce_workspace_limit_bi
    before insert on public.teams
    for each row execute function public.enforce_workspace_limit();

-- Projects: 2 per free workspace.
create or replace function public.enforce_project_limit()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as $$
begin
    if public.cloud_mode() and not public.team_is_paid(new.team_id) then
        if (select count(*) from public.projects where team_id = new.team_id) >= 2 then
            raise exception 'PLAN_LIMIT_PROJECTS: free workspaces are limited to 2 projects — upgrade for unlimited';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_project_limit_bi on public.projects;
create trigger enforce_project_limit_bi
    before insert on public.projects
    for each row execute function public.enforce_project_limit();

-- Members: 3 active per free workspace (covers direct add + invite acceptance).
create or replace function public.enforce_member_limit()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as $$
begin
    -- A BEFORE trigger sees committed rows, so the row being inserted (or the
    -- member being (re)activated, still committed as active=false) is NOT in
    -- this count — no self-exclusion needed.
    if public.cloud_mode()
       and new.active
       and (tg_op = 'INSERT' or old.active is distinct from new.active)
       and not public.team_is_paid(new.team_id) then
        if (select count(*) from public.team_members
            where team_id = new.team_id and active) >= 3 then
            raise exception 'PLAN_LIMIT_MEMBERS: free workspaces are limited to 3 members — upgrade for more';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_member_limit_biu on public.team_members;
create trigger enforce_member_limit_biu
    before insert or update of active on public.team_members
    for each row execute function public.enforce_member_limit();

-- Storage: 1GB total + 25MB per single upload on free workspaces. Generic over
-- app_files_files (size_bytes) and task_attachments (size).
create or replace function public.enforce_storage_limit()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as $$
declare
    _team uuid  := (to_jsonb(new) ->> 'team_id')::uuid;
    _size bigint := coalesce((to_jsonb(new) ->> 'size_bytes')::bigint, (to_jsonb(new) ->> 'size')::bigint, 0);
    _used bigint;
begin
    if public.cloud_mode() and _team is not null and not public.team_is_paid(_team) then
        if _size > 26214400 then  -- 25 MB
            raise exception 'PLAN_LIMIT_FILESIZE: the free plan limits uploads to 25MB — upgrade for larger files';
        end if;
        _used := coalesce((select bytes_used from public.team_storage_usage where team_id = _team), 0);
        if _used + _size > 1073741824 then  -- 1 GB
            raise exception 'PLAN_LIMIT_STORAGE: the free plan includes 1GB of storage — upgrade for more';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_storage_limit_app_files on public.app_files_files;
create trigger enforce_storage_limit_app_files
    before insert on public.app_files_files
    for each row execute function public.enforce_storage_limit();

drop trigger if exists enforce_storage_limit_attachments on public.task_attachments;
create trigger enforce_storage_limit_attachments
    before insert on public.task_attachments
    for each row execute function public.enforce_storage_limit();
