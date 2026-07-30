-- =============================================================================
-- Membership lifecycle notifications — the missing "someone joined" family.
-- =============================================================================
-- Join REQUESTS already notify (20261051): request received → org admins,
-- decision → the requester. This adds the remaining membership scenarios, as
-- AFTER triggers so EVERY path generates them (accept_invitation RPC,
-- decide_join_request, manual admin writes — anything that touches the rows):
--
--   1. Member joined     — team_members INSERT (or reactivation): notify the
--      team's admins/owner, excluding the joiner. Covers "invitation accepted"
--      (the reported gap) AND join-request approval landing the member.
--      The very first member (workspace creator) triggers no rows because the
--      recipient list excludes the joiner and nobody else exists yet.
--   2. Invitation received — email_invitations INSERT: when the invited email
--      already belongs to an account, tell that user in-app.
--   3. Role changed      — team_members UPDATE while active: tell the member
--      their access tier changed.
--
-- All rows go through create_notification() (SECURITY DEFINER, honours the
-- recipient's per-team notification preferences). They persist in
-- user_notifications, so the bell shows them on any reload.

-- -----------------------------------------------------------------------------
-- 1. Member joined → team admins/owner
-- -----------------------------------------------------------------------------
create or replace function public.notify_member_joined()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _joiner text;
    _team   text;
    _admin  record;
begin
    if new.user_id is null or new.active is not true then
        return new;
    end if;
    -- UPDATE leg fires only for a reactivation (false/null -> true).
    if tg_op = 'UPDATE' and old.active is true then
        return new;
    end if;

    select coalesce(nullif(trim(u.name), ''), u.email::text, 'Someone')
        into _joiner
    from public.users u where u.id = new.user_id;
    select t.name into _team from public.teams t where t.id = new.team_id;

    for _admin in
        select distinct tm.user_id as uid
        from public.team_members tm
        join public.roles r on r.id = tm.role_id
        where tm.team_id = new.team_id
          and tm.active is true
          and tm.user_id is not null
          and tm.user_id <> new.user_id
          and (r.owner is true or r.admin_role is true)
    loop
        perform public.create_notification(
            _admin.uid,
            coalesce(_joiner, 'Someone') || ' joined "' || coalesce(_team, 'your workspace') || '"',
            'member_joined',
            '/people',
            new.team_id
        );
    end loop;

    return new;
end;
$$;

drop trigger if exists team_members_notify_joined on public.team_members;
create trigger team_members_notify_joined
    after insert or update of active on public.team_members
    for each row
    execute function public.notify_member_joined();

-- -----------------------------------------------------------------------------
-- 2. Invitation created → the invited user (when they already have an account)
-- -----------------------------------------------------------------------------
create or replace function public.notify_invitation_created()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _invitee uuid;
    _team    text;
begin
    select u.id into _invitee from public.users u where u.email = new.email;
    if _invitee is null then
        return new; -- no account yet — the invitation EMAIL covers them
    end if;

    select t.name into _team from public.teams t where t.id = new.team_id;

    perform public.create_notification(
        _invitee,
        'You''ve been invited to join "' || coalesce(_team, 'a workspace') || '"',
        'invitation',
        null,
        -- Deliberately NO team_id: the invitee has no notification_settings row
        -- for a team they haven't joined, and preferences of OTHER teams must
        -- not suppress this.
        null
    );

    return new;
end;
$$;

drop trigger if exists email_invitations_notify_invitee on public.email_invitations;
create trigger email_invitations_notify_invitee
    after insert on public.email_invitations
    for each row
    execute function public.notify_invitation_created();

-- -----------------------------------------------------------------------------
-- 3. Role / access tier changed → the member
-- -----------------------------------------------------------------------------
create or replace function public.notify_member_role_changed()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _team text;
    _tier text;
begin
    -- Only a real change while the membership stays active — the activation
    -- leg belongs to notify_member_joined.
    if new.user_id is null
       or new.active is not true
       or old.active is not true
       or (old.role_id is not distinct from new.role_id
           and old.member_type is not distinct from new.member_type) then
        return new;
    end if;

    select t.name into _team from public.teams t where t.id = new.team_id;
    _tier := coalesce(nullif(trim(new.member_type), ''), 'member');

    perform public.create_notification(
        new.user_id,
        'Your access in "' || coalesce(_team, 'a workspace') || '" changed to ' || _tier,
        'role_changed',
        null,
        new.team_id
    );

    return new;
end;
$$;

drop trigger if exists team_members_notify_role_changed on public.team_members;
create trigger team_members_notify_role_changed
    after update on public.team_members
    for each row
    execute function public.notify_member_role_changed();

-- =============================================================================
-- END membership notifications
-- =============================================================================
