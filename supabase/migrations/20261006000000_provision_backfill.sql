-- ============================================================================
-- Provision backfill: heal orphaned auth users.
--
-- Accounts created in auth.users before the provisioning trigger existed (or
-- whose public rows were dropped when the public schema was rebuilt) can log in
-- but have no public.users profile, organization, team, or active_team — so the
-- whole app shows "Select team" / "No data". handle_new_user only fires on NEW
-- signups, so it never heals these.
--
-- This migration adds an idempotent provision_user_account(uuid) (a parametrised
-- version of handle_new_user), a provision_my_account() self-heal RPC for the
-- client, and a one-time backfill over every orphaned auth user.
-- ============================================================================

create or replace function public.provision_user_account(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  _au           auth.users%rowtype;
  _display_name text;
  _email        text;
  _team_name    text;
  _timezone_id  uuid;
  _org_id       uuid;
  _team_id      uuid;
  _owner_role   uuid;
begin
  -- Already fully provisioned (has an active team)? Nothing to do.
  select active_team into _team_id from public.users where id = p_user_id;
  if found and _team_id is not null then
    return _team_id;
  end if;

  select * into _au from auth.users where id = p_user_id;
  if not found then
    raise exception 'auth user % not found', p_user_id;
  end if;

  _email := lower(trim(_au.email));
  _display_name := left(coalesce(
      nullif(trim(_au.raw_user_meta_data ->> 'name'), ''),
      nullif(trim(_au.raw_user_meta_data ->> 'full_name'), ''),
      split_part(_email, '@', 1)
  ), 55);
  _team_name := left(coalesce(
      nullif(trim(_au.raw_user_meta_data ->> 'team_name'), ''),
      _display_name || '''s Team'
  ), 55);

  select id into _timezone_id from public.timezones where name = 'UTC' limit 1;

  -- 1. profile row (insert if missing)
  insert into public.users (id, name, email, timezone_id)
  values (p_user_id, _display_name, _email, _timezone_id)
  on conflict (id) do nothing;

  -- Reuse an already-owned team if partial provisioning happened before.
  select id into _team_id from public.teams where user_id = p_user_id limit 1;

  if _team_id is null then
    -- 2. organization (owner = user)
    insert into public.organizations (user_id, organization_name, trial_in_progress,
                                      trial_expire_date, subscription_status)
    values (p_user_id, _team_name, true, current_date + interval '9999 days', 'active')
    returning id into _org_id;

    -- 3. team
    insert into public.teams (name, user_id, organization_id)
    values (_team_name, p_user_id, _org_id)
    returning id into _team_id;

    -- 4. default roles
    insert into public.roles (name, team_id, default_role) values ('Member', _team_id, true);
    insert into public.roles (name, team_id, admin_role)   values ('Admin', _team_id, true);
    insert into public.roles (name, team_id, owner)        values ('Owner', _team_id, true)
      returning id into _owner_role;

    -- 5. owner membership
    insert into public.team_members (user_id, team_id, role_id, active)
    values (p_user_id, _team_id, _owner_role, true);
  end if;

  -- 6. mark active team
  update public.users set active_team = _team_id where id = p_user_id and active_team is null;
  return _team_id;
end;
$$;

grant execute on function public.provision_user_account(uuid) to authenticated, service_role;

-- Client self-heal: provision the CURRENT caller if they were orphaned. Safe to
-- call on every app load — it no-ops once the user has an active team.
create or replace function public.provision_my_account()
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  return public.provision_user_account(auth.uid());
end;
$$;

grant execute on function public.provision_my_account() to authenticated;

-- One-time backfill of existing orphaned auth users.
do $$
declare r record;
begin
  for r in
    select au.id
    from auth.users au
    left join public.users u on u.id = au.id
    where u.id is null or u.active_team is null
  loop
    perform public.provision_user_account(r.id);
  end loop;
end $$;
