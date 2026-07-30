-- =============================================================================
-- Capacity-aware planning: member availability RPCs
--
-- Bridges the HR module (approved leave + org holidays) into the PM workspace
-- so task assignment and workload views can warn about unavailable members.
--
-- Privacy note: PM team members must NOT read hr_leave_requests directly (its
-- RLS is self / manager / HR-admin only). These SECURITY DEFINER functions
-- expose a deliberately narrow projection — the day, the kind ('leave' /
-- 'holiday') and a display label (leave type name / holiday name). Reasons,
-- balances and request details stay HR-scoped.
--
-- Mapping: team_members.user_id -> hr_employees.user_id within the team's
-- organization (teams.organization_id -> hr_employees.org_id). Record-only
-- employees (user_id null) and orgs without HR data simply yield no rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_team_member_availability(team_id, from, to)
--
-- Returns one row per unavailable-member-day plus one row per org holiday:
--   * kind = 'leave'   -> team_member_id / user_id set; label = leave type name.
--                         Only working days are emitted (weekends and
--                         non-optional holidays are excluded), matching
--                         decide_leave()'s attendance semantics.
--   * kind = 'holiday' -> team_member_id / user_id are NULL (applies to the
--                         whole org); label = holiday name.
--
-- Callable by any active member of the team (is_team_member).
-- -----------------------------------------------------------------------------
create or replace function public.get_team_member_availability(
    p_team_id uuid,
    p_from    date,
    p_to      date
)
    returns table (
        team_member_id uuid,
        user_id        uuid,
        day            date,
        kind           text,
        label          text
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
declare
    _org_id uuid;
begin
    if p_from is null or p_to is null or p_to < p_from then
        raise exception 'Invalid date range';
    end if;

    -- Guard against unbounded scans; a year+ window is plenty for any view.
    if p_to - p_from > 400 then
        raise exception 'Date range too large (max 400 days)';
    end if;

    if not public.is_team_member(p_team_id) then
        raise exception 'Not a member of this team';
    end if;

    select t.organization_id into _org_id
    from public.teams t
    where t.id = p_team_id;

    if _org_id is null then
        return;
    end if;

    return query
    -- Approved leave, expanded to per-day rows over the requested window.
    select tm.id                as team_member_id,
           tm.user_id           as user_id,
           d.day::date          as day,
           'leave'::text        as kind,
           lt.name              as label
    from public.team_members tm
    join public.hr_employees e
        on e.org_id = _org_id
       and e.user_id = tm.user_id
       -- On-the-rolls statuses only (matches HR-5 analytics); also guards
       -- against fan-out if a departed duplicate employee row shares user_id.
       and e.status in ('active', 'probation', 'on_notice', 'on_leave')
    join public.hr_leave_requests lr
        on lr.employee_id = e.id
       and lr.status = 'approved'
       and lr.from_date <= p_to
       and lr.to_date >= p_from
    join public.hr_leave_types lt
        on lt.id = lr.leave_type_id
    cross join lateral generate_series(
        greatest(lr.from_date, p_from),
        least(lr.to_date, p_to),
        interval '1 day'
    ) as d(day)
    where tm.team_id = p_team_id
      and tm.active is true
      and tm.user_id is not null
      -- Working days only: weekends and non-optional holidays are already
      -- non-working, so leave there would double-report unavailability.
      and extract(isodow from d.day) < 6
      and not exists (
            select 1
            from public.hr_holidays h
            where h.org_id = _org_id
              and h.date = d.day::date
              and h.optional = false
      )

    union all

    -- Org-wide non-optional holidays (team_member_id / user_id NULL).
    select null::uuid            as team_member_id,
           null::uuid            as user_id,
           h.date                as day,
           'holiday'::text       as kind,
           h.name                as label
    from public.hr_holidays h
    where h.org_id = _org_id
      and h.optional = false
      and h.date between p_from and p_to;
end;
$$;

grant execute on function public.get_team_member_availability(uuid, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- get_project_member_availability(project_id, from, to)
--
-- Convenience wrapper for project-scoped surfaces (task drawer): resolves the
-- project's team and delegates. The team-membership check happens inside
-- get_team_member_availability.
-- -----------------------------------------------------------------------------
create or replace function public.get_project_member_availability(
    p_project_id uuid,
    p_from       date,
    p_to         date
)
    returns table (
        team_member_id uuid,
        user_id        uuid,
        day            date,
        kind           text,
        label          text
    )
    language plpgsql
    stable
    security definer
    set search_path = public, extensions
as
$$
declare
    _team_id uuid;
begin
    select p.team_id into _team_id
    from public.projects p
    where p.id = p_project_id;

    -- No explicit missing-project branch: a null _team_id falls through to
    -- is_team_member(null) = false below, so unknown and inaccessible project
    -- ids raise the SAME error — no cross-tenant existence oracle.
    return query
    select * from public.get_team_member_availability(_team_id, p_from, p_to);
end;
$$;

grant execute on function public.get_project_member_availability(uuid, date, date) to authenticated;
