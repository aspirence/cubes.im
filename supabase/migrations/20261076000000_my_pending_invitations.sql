-- =============================================================================
-- my_pending_invitations() — invitations addressed to the caller, WITH the
-- workspace name.
-- =============================================================================
-- The onboarding chooser surfaces "you've been invited to <team>" before the
-- invitee is a member, but teams RLS (rightly) hides team rows from
-- non-members — so a plain PostgREST embed returns NULL for the name and the
-- UI degrades to "A workspace". SECURITY DEFINER exposes exactly ONE fact
-- about a team the caller was explicitly invited to: its display name.

create or replace function public.my_pending_invitations()
    returns table (
        id          uuid,
        team_id     uuid,
        email       text,
        name        text,
        member_type text,
        created_at  timestamp with time zone,
        team_name   text
    )
    language sql
    stable
    security definer
    set search_path = public, extensions
as
$$
    select i.id,
           i.team_id,
           i.email::text,
           i.name,
           coalesce(i.member_type, 'member'),
           i.created_at,
           t.name
    from public.email_invitations i
    join public.teams t on t.id = i.team_id
    where i.email = (select u.email from public.users u where u.id = auth.uid())
    order by i.created_at desc;
$$;

grant execute on function public.my_pending_invitations() to authenticated;

-- =============================================================================
-- END my_pending_invitations
-- =============================================================================
