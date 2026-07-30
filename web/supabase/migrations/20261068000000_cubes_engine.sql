-- =============================================================================
-- Cubes gamification engine — ledger + configurable rules + auto-accrual.
-- =============================================================================
-- Members earn "cubes" (points) for the work they do. Every change is an
-- auditable ledger entry (cube_events); a member's balance is the sum of their
-- entries. Owners/admins configure how many cubes each event is worth
-- (cube_rules), and a trigger auto-awards cubes when tasks complete.
--
-- Entities: cubes are per USER (the people who do tasks). The HR org chart's
-- hr_employees.cubes stays a separate manual score for now.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cube_rules — event -> points, editable per workspace
-- -----------------------------------------------------------------------------
create table if not exists public.cube_rules (
    id         uuid default gen_random_uuid() not null,
    team_id    uuid not null,
    event_key  text not null,
    label      text not null,
    points     integer not null default 0,
    enabled    boolean not null default true,
    updated_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint cube_rules_pk primary key (id),
    constraint cube_rules_team_fk foreign key (team_id) references public.teams (id) on delete cascade,
    constraint cube_rules_updated_by_fk foreign key (updated_by) references public.users (id) on delete set null,
    constraint cube_rules_unique unique (team_id, event_key)
);

-- -----------------------------------------------------------------------------
-- 2. cube_events — the append-only ledger
-- -----------------------------------------------------------------------------
create table if not exists public.cube_events (
    id          uuid default gen_random_uuid() not null,
    team_id     uuid not null,
    user_id     uuid not null,
    points      integer not null,
    reason      text,
    rule_key    text,
    source_type text,
    source_id   uuid,
    created_by  uuid,
    created_at  timestamptz not null default now(),
    constraint cube_events_pk primary key (id),
    constraint cube_events_team_fk foreign key (team_id) references public.teams (id) on delete cascade,
    constraint cube_events_user_fk foreign key (user_id) references public.users (id) on delete cascade
);

create index if not exists cube_events_team_user_idx on public.cube_events (team_id, user_id);
create index if not exists cube_events_team_created_idx on public.cube_events (team_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 3. RLS — team members read; all writes go through SECURITY DEFINER paths
-- -----------------------------------------------------------------------------
alter table public.cube_rules enable row level security;
alter table public.cube_events enable row level security;

drop policy if exists cube_rules_select on public.cube_rules;
create policy cube_rules_select on public.cube_rules
    for select to authenticated using (public.is_team_member(team_id));

drop policy if exists cube_events_select on public.cube_events;
create policy cube_events_select on public.cube_events
    for select to authenticated using (public.is_team_member(team_id));

revoke insert, update, delete on public.cube_rules from authenticated, anon;
revoke insert, update, delete on public.cube_events from authenticated, anon;
grant select on public.cube_rules to authenticated;
grant select on public.cube_events to authenticated;
grant all on public.cube_rules to service_role;
grant all on public.cube_events to service_role;

-- -----------------------------------------------------------------------------
-- 4. Default rules — seeded per team (trigger + backfill)
-- -----------------------------------------------------------------------------
create or replace function public.seed_cube_rules(p_team_id uuid)
    returns void language plpgsql security definer set search_path = public, extensions
as
$$
begin
    insert into public.cube_rules (team_id, event_key, label, points, enabled) values
        (p_team_id, 'task_completed',    'Task completed',           10, true),
        (p_team_id, 'subtask_completed', 'Subtask completed',         3, true),
        (p_team_id, 'task_on_time',      'On-time completion bonus',  5, true),
        (p_team_id, 'task_overdue',      'Late completion penalty',  -3, true)
    on conflict (team_id, event_key) do nothing;
end;
$$;
revoke all on function public.seed_cube_rules(uuid) from public, anon, authenticated;

create or replace function public.on_team_created_cube_rules()
    returns trigger language plpgsql security definer set search_path = public, extensions
as
$$
begin
    perform public.seed_cube_rules(new.id);
    return null;
exception when others then
    return null;
end;
$$;

drop trigger if exists on_team_created_cube_rules on public.teams;
create trigger on_team_created_cube_rules
    after insert on public.teams for each row
    execute function public.on_team_created_cube_rules();

-- Backfill existing teams.
select public.seed_cube_rules(t.id) from public.teams t;

-- -----------------------------------------------------------------------------
-- 5. rule lookup + internal award helper
-- -----------------------------------------------------------------------------
create or replace function public.cube_rule_points(_team_id uuid, _event_key text)
    returns integer language sql stable security definer set search_path = public
as
$$
    select coalesce(
        (select r.points from public.cube_rules r
          where r.team_id = _team_id and r.event_key = _event_key and r.enabled is true),
        0);
$$;

-- Internal: append a ledger entry (skips zero-point no-ops). Not client-callable.
create or replace function public._cube_award(
    _team_id uuid, _user_id uuid, _points integer, _reason text,
    _rule_key text, _source_type text, _source_id uuid, _created_by uuid
)
    returns void language plpgsql security definer set search_path = public, extensions
as
$$
begin
    if _points is null or _points = 0 or _user_id is null or _team_id is null then
        return;
    end if;
    insert into public.cube_events (team_id, user_id, points, reason, rule_key, source_type, source_id, created_by)
    values (_team_id, _user_id, _points, _reason, _rule_key, _source_type, _source_id, _created_by);
end;
$$;
revoke all on function public._cube_award(uuid, uuid, integer, text, text, text, uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Auto-accrual — award cubes to assignees when a task completes
-- -----------------------------------------------------------------------------
create or replace function public.award_cubes_on_task_done()
    returns trigger language plpgsql security definer set search_path = public, extensions
as
$$
declare
    _team_id   uuid;
    _base_key  text;
    _rec       record;
    _completed timestamptz := coalesce(new.completed_at, now());
begin
    _team_id := public.team_id_of_project(new.project_id);
    if _team_id is null then return new; end if;

    _base_key := case when new.parent_task_id is not null then 'subtask_completed' else 'task_completed' end;

    for _rec in
        select tm.user_id
        from public.tasks_assignees ta
        join public.team_members tm on tm.id = ta.team_member_id
        where ta.task_id = new.id and tm.user_id is not null
    loop
        -- Base points for completing the task/subtask.
        perform public._cube_award(
            _team_id, _rec.user_id, public.cube_rule_points(_team_id, _base_key),
            'Completed: ' || coalesce(new.name, 'a task'),
            _base_key, 'task', new.id, null);

        -- On-time bonus / overdue penalty (only when the task had a due date).
        if new.end_date is not null then
            if _completed <= new.end_date then
                perform public._cube_award(
                    _team_id, _rec.user_id, public.cube_rule_points(_team_id, 'task_on_time'),
                    'On time: ' || coalesce(new.name, 'a task'),
                    'task_on_time', 'task', new.id, null);
            else
                perform public._cube_award(
                    _team_id, _rec.user_id, public.cube_rule_points(_team_id, 'task_overdue'),
                    'Late: ' || coalesce(new.name, 'a task'),
                    'task_overdue', 'task', new.id, null);
            end if;
        end if;
    end loop;

    return new;
end;
$$;

drop trigger if exists tasks_award_cubes on public.tasks;
create trigger tasks_award_cubes
    after update of done on public.tasks
    for each row
    when (old.done is distinct from new.done and new.done is true)
    execute function public.award_cubes_on_task_done();

-- -----------------------------------------------------------------------------
-- 7. Client RPCs
-- -----------------------------------------------------------------------------

-- List the workspace's rules (any team member).
create or replace function public.list_cube_rules(p_team_id uuid)
    returns setof public.cube_rules language sql stable security definer set search_path = public
as
$$
    select * from public.cube_rules
    where team_id = p_team_id and public.is_team_member(p_team_id)
    order by case event_key
        when 'task_completed' then 1 when 'subtask_completed' then 2
        when 'task_on_time' then 3 when 'task_overdue' then 4 else 9 end, label;
$$;
revoke all on function public.list_cube_rules(uuid) from public;
grant execute on function public.list_cube_rules(uuid) to authenticated;

-- Edit a rule's points / enabled (admins/owners only).
create or replace function public.set_cube_rule(
    p_team_id uuid, p_event_key text, p_points integer, p_enabled boolean
)
    returns void language plpgsql security definer set search_path = public, extensions
as
$$
begin
    if not public.is_team_admin(p_team_id) then
        raise exception 'set_cube_rule: not permitted';
    end if;
    update public.cube_rules
       set points = p_points, enabled = coalesce(p_enabled, enabled),
           updated_by = auth.uid(), updated_at = now()
     where team_id = p_team_id and event_key = p_event_key;
    if not found then
        raise exception 'set_cube_rule: unknown rule %', p_event_key;
    end if;
end;
$$;
revoke all on function public.set_cube_rule(uuid, text, integer, boolean) from public;
grant execute on function public.set_cube_rule(uuid, text, integer, boolean) to authenticated;

-- Manually award/deduct cubes (admins/owners only).
create or replace function public.award_cubes_manual(
    p_team_id uuid, p_user_id uuid, p_points integer, p_reason text
)
    returns void language plpgsql security definer set search_path = public, extensions
as
$$
begin
    if not public.is_team_admin(p_team_id) then
        raise exception 'award_cubes_manual: not permitted';
    end if;
    if not exists (select 1 from public.team_members tm
                   where tm.team_id = p_team_id and tm.user_id = p_user_id and tm.active is true) then
        raise exception 'award_cubes_manual: user is not an active member';
    end if;
    perform public._cube_award(
        p_team_id, p_user_id, p_points,
        coalesce(nullif(btrim(p_reason), ''), 'Manual adjustment'),
        'manual', 'manual', null, auth.uid());
end;
$$;
revoke all on function public.award_cubes_manual(uuid, uuid, integer, text) from public;
grant execute on function public.award_cubes_manual(uuid, uuid, integer, text) to authenticated;

-- Leaderboard: per-member totals (any team member).
create or replace function public.cube_leaderboard(p_team_id uuid)
    returns table (
        user_id uuid, name text, email text, avatar_url text,
        member_type text, cubes bigint, events_count bigint, last_event timestamptz
    )
    language plpgsql stable security definer set search_path = public, extensions
as
$$
begin
    if not public.is_team_member(p_team_id) then
        raise exception 'cube_leaderboard: not a member';
    end if;
    return query
    select u.id, u.name, u.email, u.avatar_url, tm.member_type,
           coalesce(sum(ce.points), 0)::bigint,
           count(ce.id)::bigint,
           max(ce.created_at)
    from public.team_members tm
    join public.users u on u.id = tm.user_id
    left join public.cube_events ce on ce.team_id = p_team_id and ce.user_id = u.id
    where tm.team_id = p_team_id and tm.active is true
      and tm.member_type <> 'guest'
    group by u.id, u.name, u.email, u.avatar_url, tm.member_type
    order by coalesce(sum(ce.points), 0) desc, u.name;
end;
$$;
revoke all on function public.cube_leaderboard(uuid) from public;
grant execute on function public.cube_leaderboard(uuid) to authenticated;
