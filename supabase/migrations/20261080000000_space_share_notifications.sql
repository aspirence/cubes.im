-- =============================================================================
-- Space-share notifications — "you were given access to a space".
-- =============================================================================
-- The "Share this space" modal inserts into space_members but nothing told the
-- person they got access (the project_members counterpart landed in
-- 20261078). Same shape: AFTER-INSERT trigger so every path notifies; the
-- actor comes from added_by (falling back to auth.uid()), self-adds stay
-- silent, and create_notification() honours the recipient's preferences.

create or replace function public.notify_space_member_added()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _recipient uuid;
    _team_id   uuid;
    _space     text;
    _actor_id  uuid := coalesce(new.added_by, auth.uid());
    _actor     text;
begin
    select tm.user_id, tm.team_id into _recipient, _team_id
    from public.team_members tm
    where tm.id = new.team_member_id;

    -- Record-only members, or the actor sharing with themselves: silent.
    if _recipient is null or _recipient = _actor_id then
        return new;
    end if;

    select f.name into _space from public.project_folders f where f.id = new.folder_id;

    select coalesce(nullif(trim(u.name), ''), u.email::text)
        into _actor
    from public.users u where u.id = _actor_id;

    perform public.create_notification(
        _recipient,
        coalesce(_actor, 'Someone')
            || ' gave you access to the space "' || coalesce(_space, 'Untitled') || '"'
            || case when new.role = 'admin' then ' as an admin' else '' end,
        'project_shared',
        '/projects',
        _team_id
    );

    return new;
end;
$$;

drop trigger if exists space_members_notify_added on public.space_members;
create trigger space_members_notify_added
    after insert on public.space_members
    for each row
    execute function public.notify_space_member_added();

-- =============================================================================
-- END space share notifications
-- =============================================================================
