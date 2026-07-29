-- =============================================================================
-- Time analytics — role-scoped per-task time RPC (`time_analytics`)
-- =============================================================================
-- Powers the /reporting/time page: every member can see where THEIR time went
-- (per task, per project, per day), and workspace admins/owners can see the
-- same analytics for any member or the whole team.
--
-- Access model (enforced HERE, server-side — the UI only shapes the offer):
--   * caller must be an ACTIVE member of p_team_id;
--   * is_team_admin (owner or admin role)  -> p_user_id targets anyone;
--     p_user_id NULL means "everyone";
--   * everyone else (member / limited / guest) -> ALWAYS their own logs only;
--     whatever p_user_id they pass is ignored (forced to auth.uid()).
--
-- Others' logs are additionally filtered by can_access_project for the CALLER
-- (mirrors report_time_logs): an admin still only sees time on projects they
-- can access. One's OWN logs are never filtered — your work is your work.
--
-- Source data: task_work_log (time_spent in SECONDS) joined to tasks /
-- projects / users. Returns raw per-log rows; the client aggregates (per task,
-- per day, per project) so one RPC serves the table and both charts.
-- =============================================================================

create or replace function public.time_analytics(
    p_team_id uuid,
    p_user_id uuid default null,
    p_from    date default null,
    p_to      date default null
)
    returns table (
        log_id        uuid,
        task_id       uuid,
        task_name     text,
        project_id    uuid,
        project_name  text,
        project_color text,
        user_id       uuid,
        user_name     text,
        avatar_url    text,
        seconds       bigint,
        is_billable   boolean,
        logged_at     timestamp with time zone
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
declare
    _self   uuid := auth.uid();
    _target uuid;
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'time_analytics: caller is not a member of team %', p_team_id;
    end if;

    if public.is_team_admin(p_team_id) then
        _target := p_user_id;  -- null = everyone
    else
        _target := _self;      -- non-admins: own analytics only
    end if;

    return query
    select
        wl.id,
        t.id,
        t.name,
        p.id,
        p.name,
        p.color_code,
        wl.user_id,
        u.name,
        u.avatar_url,
        wl.time_spent::bigint,
        wl.is_billable,
        wl.created_at
    from public.task_work_log wl
    join public.tasks    t on t.id = wl.task_id
    join public.projects p on p.id = t.project_id
    join public.users    u on u.id = wl.user_id
    where p.team_id = p_team_id
      and (_target is null or wl.user_id = _target)
      and (
          wl.user_id = _self
          or public.can_access_project(p.id, p.team_id, p.visibility, p.owner_id)
      )
      and (p_from is null or wl.created_at >= p_from::timestamptz)
      and (p_to   is null or wl.created_at < (p_to + 1)::timestamptz)
    order by wl.created_at desc;
end;
$$;

grant execute on function public.time_analytics(uuid, uuid, date, date) to authenticated;
