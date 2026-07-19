-- =============================================================================
-- Project-share notifications — "you were added to a project".
-- =============================================================================
-- Adding someone to project_members (sharing a project — at creation or later)
-- generated nothing. AFTER-INSERT trigger so EVERY path notifies: the project
-- form's member picker, invite flows, direct writes. The added member gets a
-- notification with the sharer's name and a link to the project; the actor
-- adding THEMSELVES (e.g. the creator auto-joining their own project) stays
-- silent. Goes through create_notification(), so the recipient's per-team
-- preferences are honoured and the row persists for any reload.

create or replace function public.notify_project_member_added()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _recipient uuid;
    _team_id   uuid;
    _project   text;
    _actor     text;
begin
    select tm.user_id, tm.team_id into _recipient, _team_id
    from public.team_members tm
    where tm.id = new.team_member_id;

    -- Record-only members, or the actor sharing with themselves: nothing to say.
    if _recipient is null or _recipient = auth.uid() then
        return new;
    end if;

    select p.name into _project from public.projects p where p.id = new.project_id;

    -- auth.uid() is null on service-role/system writes — fall back gracefully.
    select coalesce(nullif(trim(u.name), ''), u.email::text)
        into _actor
    from public.users u where u.id = auth.uid();

    perform public.create_notification(
        _recipient,
        coalesce(_actor, 'Someone')
            || ' shared the project "' || coalesce(_project, 'Untitled') || '" with you',
        'project_shared',
        '/projects/' || new.project_id::text,
        _team_id,
        null,
        new.project_id
    );

    return new;
end;
$$;

drop trigger if exists project_members_notify_added on public.project_members;
create trigger project_members_notify_added
    after insert on public.project_members
    for each row
    execute function public.notify_project_member_added();

-- =============================================================================
-- END project share notifications
-- =============================================================================
