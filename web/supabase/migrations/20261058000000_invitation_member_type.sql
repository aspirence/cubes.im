-- ============================================================================
-- Invitations carry a member tier (admin | member | limited | guest — never
-- owner), so you can invite someone straight into the right tier. accept_
-- invitation() materializes the membership with that tier (role_id kept in
-- sync for back-compat: admin -> Admin role, everyone else -> Member role;
-- the tier is the source of truth).
-- ============================================================================
alter table public.email_invitations
    add column if not exists member_type text not null default 'member';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'email_invitations_member_type_check') then
        alter table public.email_invitations
            add constraint email_invitations_member_type_check
            check (member_type in ('admin', 'member', 'limited', 'guest'));
    end if;
end $$;

-- Backfill pending invites from their role (admin role -> admin, else member).
update public.email_invitations ei
set member_type = 'admin'
from public.roles r
where r.id = ei.role_id and (r.admin_role is true or r.owner is true);

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

    -- Resolve the tier: invite's member_type, else derive from the legacy role.
    if _member_type is null then
        _member_type := case
            when exists (select 1 from public.roles r
                         where r.id = _invite_role and (r.admin_role is true or r.owner is true))
            then 'admin' else 'member' end;
    end if;
    -- Never accept an invitation as owner.
    if _member_type = 'owner' then
        _member_type := 'admin';
    end if;

    -- role_id for the FK: admin -> Admin role, everyone else -> Member role.
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

    delete from public.email_invitations where id = p_invitation_id;

    return _team_id;
end;
$$;
