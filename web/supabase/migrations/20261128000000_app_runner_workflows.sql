-- =============================================================================
-- Workflows: a working schedule trigger, and "app" steps run by the Node runner.
-- =============================================================================
-- Phase B shipped the engine with the schedule trigger declared but never fired,
-- and 'app' steps raising "not yet supported". This migration makes both real:
--
--  * Schedule trigger. workflows.trigger_config holds a ScheduleTriggerConfig
--    (src/lib/workflows/app-action-catalog.ts). workflow_schedule_next_run turns
--    it into the next absolute instant in the workflow's own IANA zone, and a
--    BEFORE trigger keeps workflows.next_run_at in step with it, so the browser
--    never computes (or forges) a run time. workflows_claim_due is the sweep the
--    runner calls: it starts a run for every due workflow exactly once.
--
--  * App steps. An app step needs HTTP (Meta, Google), which SQL cannot do, so
--    advance_workflow_run parks the run in 'waiting_app' on that step and
--    returns. The Node runner (src/lib/workflows/runner.ts) claims parked runs,
--    executes the action and hands the result back to wf_resume_app_step, which
--    writes the output into the context and advances the run as usual.
--
--  * app_runner_config + a pg_cron job that pokes POST /api/runner/tick every
--    five minutes, the billing_config pattern: the row is filled by hand per
--    environment, and with no row the job is a no-op.
--
-- See docs/SHEETS_WORKFLOWS.md. Re-runnable and purely additive.

create extension if not exists pg_net;

-- ------------------------------------------------------------ run status ----

-- 'waiting_app' = parked on an app step until the runner resumes it.
alter table public.workflow_runs drop constraint if exists workflow_runs_status_check;
alter table public.workflow_runs add constraint workflow_runs_status_check
    check (status in ('running', 'waiting_human', 'waiting_app', 'success', 'error', 'stopped'));

-- The runner's claim on a parked run. A sync can take a minute or two and the
-- tick fires every five, so without a lease two ticks (or a tick and a "Run
-- now") could execute the same step twice. Cleared when the step resumes.
alter table public.workflow_runs add column if not exists lease_until timestamp with time zone;

-- Who the run acts as for steps that must be authorized as a person
-- (create_task). "Run now" has a session, but a scheduled run — and every run
-- the Node runner resumes after an app step — does not, and create_task
-- refuses to run without one. Recorded on the first pass through
-- advance_workflow_run; scheduled runs fall back to the workflow's creator.
alter table public.workflow_runs add column if not exists actor_user_id uuid
    references public.users(id) on delete set null;

-- Step runs are ordered by started_at in the run log, but the column defaulted
-- to CURRENT_TIMESTAMP — the *transaction* clock — so every step a single pass
-- of advance_workflow_run executes got the identical timestamp and the log's
-- order was whatever the planner happened to produce (observed: s1, s4, s2, s3
-- for a four-step run). clock_timestamp() advances inside the transaction, so
-- the recorded order is the real order.
alter table public.workflow_step_runs alter column started_at set default clock_timestamp();

create index if not exists workflow_runs_waiting_app_index
    on public.workflow_runs (started_at) where status = 'waiting_app';
create index if not exists workflows_next_run_at_index
    on public.workflows (next_run_at) where enabled and trigger_type = 'schedule';

-- =============================================================================
-- SECTION 1: Schedule — next run instant
-- =============================================================================

-- The first instant strictly after p_after that matches a ScheduleTriggerConfig:
--   { frequency: every_n_minutes | hourly | daily | weekly,
--     interval_minutes?, time?: "HH:MM", days?: [0..6], timezone }
-- Wall-clock times are read in the config's zone (recurrence_timezone falls
-- back to UTC for a bogus one, so a typo never throws). Returns null when the
-- config is not a schedule at all.
--
-- The TypeScript twin in src/lib/workflows/schedule.ts previews these times in
-- the builder and must stay in lock-step with this function, including how a
-- wall-clock time that does not exist (spring-forward gap) or exists twice
-- (fall-back overlap) maps to an instant: Postgres assigns the standard-time
-- offset in both cases, i.e. the offset before a gap and the offset after an
-- overlap.
create or replace function public.workflow_schedule_next_run(p_config jsonb, p_after timestamptz)
    returns timestamptz
    language plpgsql
    stable
    set search_path = public, extensions
as
$$
declare
    _freq    text := p_config ->> 'frequency';
    _zone    text := public.recurrence_timezone(p_config ->> 'timezone');
    _time    text := coalesce(p_config ->> 'time', '');
    _hh      integer;
    _mm      integer;
    _n       integer;
    _secs    bigint;
    _local   timestamp;
    _day     date;
    _cand    timestamptz;
    _days    integer[];
    _i       integer;
begin
    if p_config is null or jsonb_typeof(p_config) <> 'object' or _freq is null or p_after is null then
        return null;
    end if;

    -- "HH:MM" -> hour/minute; anything unparseable falls back to 09:00, the
    -- same default describeSchedule() shows.
    if _time ~ '^\d{1,2}:\d{2}$' then
        _hh := split_part(_time, ':', 1)::integer;
        _mm := split_part(_time, ':', 2)::integer;
    end if;
    if _hh is null or _hh > 23 or _mm is null or _mm > 59 then
        _hh := 9;
        _mm := 0;
    end if;

    if _freq = 'every_n_minutes' then
        -- A fixed grid from the Unix epoch rather than "p_after + n": editing
        -- the workflow (which recomputes from now()) then never shifts the
        -- cadence, and the grid is the same in every zone.
        _n := coalesce(case when (p_config ->> 'interval_minutes') ~ '^\d+$'
                            then (p_config ->> 'interval_minutes')::integer end, 60);
        _n := least(greatest(_n, 15), 720);
        _secs := _n * 60;
        return to_timestamp((floor(extract(epoch from p_after) / _secs)::bigint + 1) * _secs);

    elsif _freq = 'hourly' then
        -- The next whole minute after p_after whose local minute is _mm. Zones
        -- are offset by 30/45 minutes in places, so this is done on local time,
        -- and re-checked after the jump in case it crossed an offset change.
        _cand := date_trunc('minute', p_after) + interval '1 minute';
        for _i in 1..4 loop
            _n := extract(minute from (_cand at time zone _zone))::integer;
            exit when _n = _mm;
            _cand := _cand + make_interval(mins => ((_mm - _n + 60) % 60));
        end loop;
        return _cand;

    elsif _freq in ('daily', 'weekly') then
        if _freq = 'weekly' then
            select coalesce(array_agg(distinct d::integer), '{}')
              into _days
              from jsonb_array_elements_text(
                       case when jsonb_typeof(p_config -> 'days') = 'array'
                            then p_config -> 'days' else '[]'::jsonb end) d
             where d ~ '^[0-6]$';
            if cardinality(_days) = 0 then
                _days := array[1];
            end if;
        end if;

        _local := p_after at time zone _zone;
        _day := _local::date;
        -- Eight days covers "same weekday next week" when today's slot passed.
        for _i in 0..8 loop
            if _freq = 'daily' or extract(dow from _day)::integer = any (_days) then
                _cand := (_day + make_time(_hh, _mm, 0)) at time zone _zone;
                if _cand > p_after then
                    return _cand;
                end if;
            end if;
            _day := _day + 1;
        end loop;
        return null;
    end if;

    return null;
end;
$$;

-- Keeps workflows.next_run_at honest: recomputed from the config whenever the
-- trigger, its config or the enabled flag change, and never taken from a
-- browser. A member's plain edit (rename, description) leaves it alone; a
-- direct attempt to write it is reverted. The SECURITY DEFINER sweep runs as
-- the function owner, so its own next_run_at bumps pass through.
create or replace function public.workflows_schedule_next_run_trg()
    returns trigger
    language plpgsql
    set search_path = public, extensions
as
$$
begin
    if tg_op = 'INSERT'
       or new.trigger_type is distinct from old.trigger_type
       or new.trigger_config is distinct from old.trigger_config
       or new.enabled is distinct from old.enabled then
        new.next_run_at := case
            when new.enabled and new.trigger_type = 'schedule'
                then public.workflow_schedule_next_run(new.trigger_config, now())
            end;
    elsif current_user in ('authenticated', 'anon') then
        new.next_run_at := old.next_run_at;
    end if;
    return new;
end;
$$;

drop trigger if exists workflows_schedule_next_run on public.workflows;
create trigger workflows_schedule_next_run
    before insert or update on public.workflows
    for each row execute function public.workflows_schedule_next_run_trg();

-- Existing rows: give any enabled schedule workflow its first run time. (The
-- update goes through the trigger only when a watched column changes, so it is
-- written directly here.)
update public.workflows
   set next_run_at = public.workflow_schedule_next_run(trigger_config, now())
 where enabled and trigger_type = 'schedule' and next_run_at is null;

-- =============================================================================
-- SECTION 2: Executor — advance_workflow_run with parked app steps
-- =============================================================================
-- Copied from 20261012000000 unchanged except the final branch: an 'app' step
-- is parked for the runner instead of raising. human / ai still raise.

create or replace function public.advance_workflow_run(p_run_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _run     public.workflow_runs;
    _team_id uuid;
    _org_id  uuid;
    _step    public.workflow_steps;
    _sr_id   uuid;
    _ctx     jsonb;
    _output  jsonb;
    _agent   public.agents;
    _skill   jsonb;
    _passed  boolean;
    _cfg     jsonb;
    _action  text;
    _msg     text;
    _uid     uuid;
    _new_id  uuid;
    _actor   uuid;
begin
    select * into _run from public.workflow_runs where id = p_run_id for update;
    if not found or _run.status <> 'running' then
        return;
    end if;
    _team_id := _run.team_id;

    -- The run's acting member, pinned on the first pass. "Run now" arrives with
    -- a session; the passes that follow an app step (wf_resume_app_step, run by
    -- the service-role runner) and every scheduled run have none, and steps that
    -- authorize a person would otherwise fail with "no authenticated user".
    if auth.uid() is not null and _run.actor_user_id is null then
        update public.workflow_runs set actor_user_id = auth.uid() where id = _run.id;
        _run.actor_user_id := auth.uid();
    end if;
    select organization_id into _org_id from public.teams where id = _team_id;
    _ctx := _run.context;
    -- jsonb_set cannot create a missing intermediate key, so guarantee the
    -- `steps` container exists before merging any steps.<key> output into it.
    if not (_ctx ? 'steps') then
        _ctx := _ctx || jsonb_build_object('steps', '{}'::jsonb);
    end if;

    for _step in
        select * from public.workflow_steps
         where workflow_id = _run.workflow_id
           and enabled
           and position > _run.current_position
         order by position, id
    loop
        insert into public.workflow_step_runs (run_id, step_id, step_key, step_type, status)
        values (_run.id, _step.id, _step.step_key, _step.step_type, 'running')
        returning id into _sr_id;

        update public.workflow_step_runs set input = _step.config where id = _sr_id;

        begin
            _cfg := _step.config;
            _output := '{}'::jsonb;

            if _step.step_type = 'agent' then
                select * into _agent from public.agents
                 where id = (_cfg ->> 'agent_id')::uuid and team_id = _team_id;
                if not found then
                    raise exception 'agent not found or not in this team';
                end if;
                for _skill in select * from jsonb_array_elements(_agent.skills)
                loop
                    _output := _output || jsonb_build_object(
                        _skill ->> 'skill',
                        public.wf_run_skill(
                            _skill ->> 'skill', _team_id, _org_id,
                            coalesce(_skill -> 'params', '{}'::jsonb)));
                end loop;

            elsif _step.step_type = 'condition' then
                _passed := public.wf_eval_condition(_ctx, _cfg);
                _output := jsonb_build_object('passed', _passed);
                if not _passed then
                    -- Linear stop: the run completes successfully, gated here.
                    update public.workflow_step_runs
                       set status = 'success', output = _output, finished_at = clock_timestamp()
                     where id = _sr_id;
                    _ctx := jsonb_set(_ctx, array['steps', _step.step_key], _output, true);
                    _ctx := _ctx || jsonb_build_object(
                        '_stopped_at', _step.step_key, '_stop_reason', 'condition');
                    update public.workflow_runs
                       set status = 'success', context = _ctx,
                           current_position = _step.position, finished_at = now()
                     where id = _run.id;
                    return;
                end if;

            elsif _step.step_type = 'action' then
                _action := _cfg ->> 'action';
                if _action = 'notify_user' then
                    _uid := (_cfg ->> 'user_id')::uuid;
                    -- The recipient must be an active member of the run's team,
                    -- else a workflow could deliver interpolated org/HR data to an
                    -- outsider who has no RLS access to it.
                    if _uid is null or not exists (
                        select 1 from public.team_members tm
                        where tm.team_id = _team_id and tm.user_id = _uid
                          and coalesce(tm.active, true) = true
                    ) then
                        raise exception 'notify_user: recipient is not an active member of this team';
                    end if;
                    _msg := public.wf_interpolate(
                        coalesce(nullif(trim(_cfg ->> 'message'), ''),
                                 'Workflow notification'), _ctx);
                    perform public.create_notification(
                        p_user_id => _uid, p_message => _msg,
                        p_type => 'info', p_url => nullif(_cfg ->> 'url', ''),
                        p_team_id => _team_id);
                    _output := jsonb_build_object('notified', _uid);
                elsif _action = 'create_task' then
                    -- create_task RPC is itself is_project_team_member-gated on
                    -- auth.uid(), so cross-tenant creation raises inside it.
                    -- With no session (scheduled run, or a run the Node runner
                    -- resumed after an app step) the run acts as the member who
                    -- started it, else as the workflow's creator: the claim is
                    -- set only around this one call, so create_task's own checks
                    -- still decide, and the run can never do more than that
                    -- person could. Without such a person the step fails loudly.
                    if auth.uid() is not null then
                        _new_id := public.create_task(
                            public.wf_interpolate(coalesce(_cfg ->> 'name', 'Task'), _ctx),
                            (_cfg ->> 'project_id')::uuid);
                    else
                        _actor := coalesce(
                            _run.actor_user_id,
                            (select w.created_by from public.workflows w where w.id = _run.workflow_id));
                        if _actor is null then
                            raise exception 'create_task: this workflow has no owner to create the task as';
                        end if;
                        if not exists (
                            select 1 from public.team_members tm
                             where tm.team_id = _team_id and tm.user_id = _actor
                               and coalesce(tm.active, true) = true
                        ) then
                            raise exception 'create_task: the workflow owner is no longer a member of this team';
                        end if;
                        perform set_config('request.jwt.claim.sub', _actor::text, true);
                        _new_id := public.create_task(
                            public.wf_interpolate(coalesce(_cfg ->> 'name', 'Task'), _ctx),
                            (_cfg ->> 'project_id')::uuid);
                        perform set_config('request.jwt.claim.sub', '', true);
                    end if;
                    _output := jsonb_build_object('task_id', _new_id);
                else
                    -- 'add_comment' was removed: a raw SECURITY DEFINER insert into
                    -- task_comments bypassed is_task_member and allowed cross-tenant
                    -- writes. Re-add only via a gated RPC + a registry entry.
                    raise exception 'unknown action %', coalesce(_action, '(null)');
                end if;

            elsif _step.step_type = 'app' then
                -- App steps call Meta / Google over HTTP, which SQL cannot, so
                -- the run parks here: the step run stays 'running' (its input
                -- is the step config), current_position stays at the previous
                -- step, and the Node runner resumes it via wf_resume_app_step.
                if coalesce(_cfg ->> 'action', '') = '' then
                    raise exception 'app step has no action chosen';
                end if;
                _ctx := _ctx || jsonb_build_object(
                    '_waiting_step_run', _sr_id, '_waiting_position', _step.position);
                update public.workflow_runs
                   set status = 'waiting_app', context = _ctx
                 where id = _run.id;
                return;

            else
                -- human / ai: valid enum, not yet implemented.
                raise exception 'step type "%" is not yet supported', _step.step_type;
            end if;

            -- Success: merge output into context.steps.<key> and advance.
            _ctx := jsonb_set(_ctx, array['steps', _step.step_key], _output, true);
            update public.workflow_step_runs
               set status = 'success', output = _output, finished_at = clock_timestamp()
             where id = _sr_id;
            update public.workflow_runs
               set context = _ctx, current_position = _step.position
             where id = _run.id;

        exception when others then
            update public.workflow_step_runs
               set status = 'error', error = sqlerrm, finished_at = clock_timestamp()
             where id = _sr_id;
            update public.workflow_runs
               set status = 'error', error = sqlerrm, finished_at = now()
             where id = _run.id;
            return;
        end;
    end loop;

    -- All steps done.
    update public.workflow_runs
       set status = 'success', context = _ctx, finished_at = now()
     where id = _run.id;
end;
$$;


-- =============================================================================
-- SECTION 3: Resuming a parked app step
-- =============================================================================

-- The runner's hand-back. On error the step and the run fail (the run is
-- finished; later steps never run). On success the output lands in
-- context.steps.<step_key> exactly as an in-SQL step's would, the run moves
-- past the step and advance_workflow_run carries on — possibly parking again
-- on the next app step. A stale call (run no longer parked on that step run)
-- is a no-op, so a retried request cannot run a step twice. Returns the run's
-- status afterwards.
create or replace function public.wf_resume_app_step(
    p_run_id      uuid,
    p_step_run_id uuid,
    p_output      jsonb,
    p_error       text
)
    returns text
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _run    public.workflow_runs;
    _sr     public.workflow_step_runs;
    _pos    integer;
    _ctx    jsonb;
    _output jsonb := case when jsonb_typeof(p_output) = 'object' then p_output else '{}'::jsonb end;
    _err    text := left(nullif(trim(coalesce(p_error, '')), ''), 1000);
begin
    select * into _run from public.workflow_runs where id = p_run_id for update;
    if not found then
        return null;
    end if;
    if _run.status <> 'waiting_app'
       or (_run.context ->> '_waiting_step_run') is distinct from p_step_run_id::text then
        return _run.status;
    end if;

    select * into _sr from public.workflow_step_runs
     where id = p_step_run_id and run_id = p_run_id;
    if not found then
        return _run.status;
    end if;

    -- The position was recorded when the run parked, so a step deleted from the
    -- workflow while the run waited still resumes at the right place.
    _pos := coalesce((_run.context ->> '_waiting_position')::integer,
                     (select position from public.workflow_steps where id = _sr.step_id),
                     _run.current_position);
    _ctx := _run.context - '_waiting_step_run' - '_waiting_position';
    if not (_ctx ? 'steps') then
        _ctx := _ctx || jsonb_build_object('steps', '{}'::jsonb);
    end if;

    if _err is not null then
        update public.workflow_step_runs
           set status = 'error', error = _err, finished_at = clock_timestamp()
         where id = _sr.id;
        update public.workflow_runs
           set status = 'error', error = _err, context = _ctx,
               lease_until = null, finished_at = now()
         where id = _run.id;
        return 'error';
    end if;

    update public.workflow_step_runs
       set status = 'success', output = _output, finished_at = clock_timestamp()
     where id = _sr.id;
    _ctx := jsonb_set(_ctx, array['steps', _sr.step_key], _output, true);
    update public.workflow_runs
       set status = 'running', context = _ctx, current_position = _pos, lease_until = null
     where id = _run.id;

    perform public.advance_workflow_run(_run.id);
    return (select status from public.workflow_runs where id = _run.id);
end;
$$;

-- Claims parked runs for the runner: each returned run is leased for fifteen
-- minutes so an overlapping tick skips it. p_run_id narrows the claim to one
-- run ("Run now" continuing its own run). Oldest first, so a backlog drains in
-- order. A run whose parked step run has vanished is failed rather than left
-- waiting forever.
create or replace function public.wf_claim_app_runs(p_limit integer default 10, p_run_id uuid default null)
    returns table (
        run_id      uuid,
        step_run_id uuid,
        team_id     uuid,
        workflow_id uuid,
        step_key    text,
        config      jsonb,
        trigger_kind text
    )
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _run public.workflow_runs;
    _sr  public.workflow_step_runs;
begin
    for _run in
        select * from public.workflow_runs r
         where r.status = 'waiting_app'
           and (p_run_id is null or r.id = p_run_id)
           and (r.lease_until is null or r.lease_until < now())
         order by r.started_at
         limit greatest(coalesce(p_limit, 10), 1)
         for update skip locked
    loop
        select * into _sr from public.workflow_step_runs s
         where s.id = nullif(_run.context ->> '_waiting_step_run', '')::uuid
           and s.run_id = _run.id
           and s.status = 'running';
        if not found then
            update public.workflow_runs
               set status = 'error', error = 'The app step this run was waiting on is gone.',
                   lease_until = null, finished_at = now()
             where id = _run.id;
            continue;
        end if;

        update public.workflow_runs set lease_until = now() + interval '15 minutes' where id = _run.id;

        run_id      := _run.id;
        step_run_id := _sr.id;
        team_id     := _run.team_id;
        workflow_id := _run.workflow_id;
        step_key    := _sr.step_key;
        config      := _sr.input;
        trigger_kind := coalesce(nullif(_run.trigger_snapshot ->> 'trigger', ''), 'manual');
        return next;
    end loop;
end;
$$;

-- =============================================================================
-- SECTION 4: Starting runs without a member session
-- =============================================================================

-- start_workflow_run's twin for the runner: no is_team_member check (there is
-- no auth.uid() under the runner or pg_cron — the workflow's own team is the
-- authority). service_role only.
create or replace function public.start_workflow_run_system(
    p_workflow_id uuid,
    p_trigger     jsonb default '{}'::jsonb
)
    returns uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _wf     public.workflows;
    _run_id uuid;
begin
    select * into _wf from public.workflows where id = p_workflow_id;
    if not found then
        raise exception 'workflow not found';
    end if;

    insert into public.workflow_runs (workflow_id, team_id, status, trigger_snapshot)
    values (_wf.id, _wf.team_id, 'running', coalesce(p_trigger, '{}'::jsonb))
    returning id into _run_id;

    update public.workflows
       set run_count = run_count + 1, last_run_at = now()
     where id = _wf.id;

    perform public.advance_workflow_run(_run_id);
    return _run_id;
end;
$$;

-- The schedule sweep. Each due workflow gets exactly one run per claim:
-- FOR UPDATE SKIP LOCKED keeps overlapping calls apart, and next_run_at moves
-- forward (from now, so missed slots are skipped, never replayed) in the same
-- transaction that starts the run. Each workflow is its own sub-transaction so
-- one broken workflow never blocks the rest; it still has its next_run_at
-- moved on, or it would be retried every tick forever.
create or replace function public.workflows_claim_due(p_limit integer default 20)
    returns setof uuid
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _wf     public.workflows;
    _run_id uuid;
    _now    timestamptz := now();
begin
    for _wf in
        select * from public.workflows w
         where w.enabled
           and w.trigger_type = 'schedule'
           and w.next_run_at is not null
           and w.next_run_at <= _now
         order by w.next_run_at
         limit greatest(coalesce(p_limit, 20), 1)
         for update skip locked
    loop
        begin
            insert into public.workflow_runs (workflow_id, team_id, status, trigger_snapshot)
            values (_wf.id, _wf.team_id, 'running',
                    jsonb_build_object('trigger', 'schedule', 'fired_at', _now,
                                       'scheduled_for', _wf.next_run_at))
            returning id into _run_id;

            update public.workflows
               set run_count = run_count + 1,
                   last_run_at = _now,
                   next_run_at = public.workflow_schedule_next_run(trigger_config, _now)
             where id = _wf.id;

            perform public.advance_workflow_run(_run_id);
            return next _run_id;
        exception when others then
            update public.workflows
               set next_run_at = public.workflow_schedule_next_run(trigger_config, _now)
             where id = _wf.id;
            raise notice 'workflows_claim_due: workflow % skipped (% — %)', _wf.id, sqlstate, sqlerrm;
        end;
    end loop;
end;
$$;

-- =============================================================================
-- SECTION 5: The runner tick — config row + pg_cron job
-- =============================================================================

-- Where the database reaches the Node runner. Filled by hand per environment
-- (tick_url = https://<host>/api/runner/tick, tick_secret = RUNNER_SECRET) so
-- no secret is ever committed. No row, or an empty URL, and the job does
-- nothing — local dev calls the tick route directly.
create table if not exists public.app_runner_config (
    id          boolean primary key default true,
    tick_url    text,
    tick_secret text,
    constraint app_runner_config_singleton check (id)
);
alter table public.app_runner_config enable row level security;
revoke all on public.app_runner_config from public, anon, authenticated;
grant all on public.app_runner_config to service_role;

create or replace function public.app_runner_tick_dispatch()
    returns void
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _url    text;
    _secret text;
begin
    select tick_url, tick_secret into _url, _secret from public.app_runner_config limit 1;
    if _url is null or _url = '' then
        return;
    end if;
    -- pg_net is fire-and-forget: the timeout only bounds how long it keeps the
    -- response around, not how long the route may run.
    perform net.http_post(
        url := _url,
        body := '{}'::jsonb,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-runner-secret', coalesce(_secret, '')),
        timeout_milliseconds := 120000);
end;
$$;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.unschedule('app-runner-tick');
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule(
            'app-runner-tick',
            '*/5 * * * *',
            $cron$ select public.app_runner_tick_dispatch(); $cron$
        );
        raise notice 'Runner: scheduled pg_cron job "app-runner-tick" (every 5 min).';
    else
        raise notice 'Runner: pg_cron unavailable — call POST /api/runner/tick yourself.';
    end if;
exception
    when others then
        raise notice 'Runner: pg_cron setup skipped (% — %).', sqlstate, sqlerrm;
end $$;

-- =============================================================================
-- SECTION 6: Grants
-- =============================================================================
-- Supabase default privileges grant EXECUTE on new functions to anon and
-- authenticated, so every internal function is revoked from those roles by
-- name. workflow_schedule_next_run is pure arithmetic over its arguments and
-- stays callable, so a client could preview with it if it ever wanted to.
revoke all on function public.advance_workflow_run(uuid) from public, authenticated, anon;
revoke all on function public.wf_resume_app_step(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.wf_resume_app_step(uuid, uuid, jsonb, text) to service_role;
revoke all on function public.wf_claim_app_runs(integer, uuid) from public, anon, authenticated;
grant execute on function public.wf_claim_app_runs(integer, uuid) to service_role;
revoke all on function public.start_workflow_run_system(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_workflow_run_system(uuid, jsonb) to service_role;
revoke all on function public.workflows_claim_due(integer) from public, anon, authenticated;
grant execute on function public.workflows_claim_due(integer) to service_role;
revoke all on function public.app_runner_tick_dispatch() from public, anon, authenticated;
grant execute on function public.app_runner_tick_dispatch() to service_role;
revoke all on function public.workflow_schedule_next_run(jsonb, timestamptz) from public, anon;
grant execute on function public.workflow_schedule_next_run(jsonb, timestamptz) to authenticated, service_role;
