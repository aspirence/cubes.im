-- ============================================================================
-- Fix: accepting an invitation must release the user from onboarding.
-- accept_invitation materialized the membership but never set
-- users.setup_completed / active_team, so the proxy kept bouncing the invitee
-- back to /setup after they accepted. Mirror decide_join_request: switch the
-- caller's active_team to the joined workspace and mark setup complete.
-- ============================================================================
create or replace function public.accept_invitation(p_invitation_id uuid)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _user_id      uuid := auth.uid();
    _user_email   citext;
    _team_id      uuid;
    _invite_role  uuid;
    _member_type  text;
    _role_id      uuid;
    _existing     uuid;
begin
    if _user_id is null then
        raise exception 'accept_invitation: no authenticated user';
    end if;

    select u.email into _user_email from public.users u where u.id = _user_id;
    if _user_email is null then
        raise exception 'accept_invitation: caller has no profile';
    end if;

    select ei.team_id, ei.role_id, ei.member_type
    into _team_id, _invite_role, _member_type
    from public.email_invitations ei
    where ei.id = p_invitation_id
      and ei.email = _user_email;

    if _team_id is null then
        raise exception 'accept_invitation: invitation % not found for this user', p_invitation_id;
    end if;

    if _member_type is null then
        _member_type := case
            when exists (select 1 from public.roles r
                         where r.id = _invite_role and (r.admin_role is true or r.owner is true))
            then 'admin' else 'member' end;
    end if;
    if _member_type = 'owner' then
        _member_type := 'admin';
    end if;

    if _member_type = 'admin' then
        select r.id into _role_id from public.roles r
        where r.team_id = _team_id and r.admin_role is true limit 1;
    else
        select r.id into _role_id from public.roles r
        where r.team_id = _team_id and r.default_role is true limit 1;
    end if;
    if _role_id is null then
        select r.id into _role_id from public.roles r where r.team_id = _team_id limit 1;
    end if;
    if _role_id is null then
        raise exception 'accept_invitation: no role resolvable for team %', _team_id;
    end if;

    select tm.id into _existing
    from public.team_members tm
    where tm.team_id = _team_id and tm.user_id = _user_id;

    if _existing is not null then
        update public.team_members
        set active = true, role_id = _role_id, member_type = _member_type,
            updated_at = current_timestamp
        where id = _existing;
    else
        insert into public.team_members (user_id, team_id, role_id, member_type, active)
        values (_user_id, _team_id, _role_id, _member_type, true);
    end if;

    -- Release the invitee from onboarding and drop them into the joined team.
    update public.users
    set active_team = _team_id, setup_completed = true, updated_at = current_timestamp
    where id = _user_id;

    delete from public.email_invitations where id = p_invitation_id;

    return _team_id;
end;
$$;
