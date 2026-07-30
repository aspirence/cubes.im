-- ============================================================================
-- create_team: let an organization admin/owner create additional teams.
--
-- Signup provisions one team per user (handle_new_user). There was no way to
-- create further teams inside the same organization. This mirrors the team +
-- roles + owner-membership steps of handle_new_user, scoped to the caller's org.
-- ============================================================================

create or replace function public.create_team(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  _uid        uuid := auth.uid();
  _org_id     uuid;
  _team_id    uuid;
  _owner_role uuid;
  _name       text := left(coalesce(nullif(trim(p_name), ''), 'New Team'), 55);
begin
  if _uid is null then
    raise exception 'not authenticated';
  end if;

  -- Resolve the caller's organization via their active team, falling back to an
  -- organization they own.
  select t.organization_id into _org_id
  from public.users u
  join public.teams t on t.id = u.active_team
  where u.id = _uid;

  if _org_id is null then
    select id into _org_id from public.organizations where user_id = _uid limit 1;
  end if;

  if _org_id is null then
    raise exception 'no organization for user';
  end if;

  -- Only an organization admin/owner may create teams.
  if not (
    public.is_org_admin(_org_id)
    or exists (select 1 from public.organizations o
               where o.id = _org_id and o.user_id = _uid)
  ) then
    raise exception 'only an organization admin can create a team';
  end if;

  insert into public.teams (name, user_id, organization_id)
  values (_name, _uid, _org_id)
  returning id into _team_id;

  insert into public.roles (name, team_id, default_role) values ('Member', _team_id, true);
  insert into public.roles (name, team_id, admin_role)   values ('Admin', _team_id, true);
  insert into public.roles (name, team_id, owner)        values ('Owner', _team_id, true)
    returning id into _owner_role;

  insert into public.team_members (user_id, team_id, role_id, active)
  values (_uid, _team_id, _owner_role, true);

  return _team_id;
end;
$$;

grant execute on function public.create_team(text) to authenticated;
