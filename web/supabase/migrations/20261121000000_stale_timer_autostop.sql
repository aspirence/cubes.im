-- =============================================================================
-- Stale timer auto-stop — a running timer must not count the night
-- =============================================================================
-- Observed in production: 17–68 HOUR task_work_log entries, all logged_by_timer,
-- all closing out the next morning. The sequence (task_activity_logs):
--
--   evening  timer_stopped  (the member stops their timer — end of day)
--   evening  status_changed → Doing on tomorrow's task  ← queueing next work
--            timer_started                              ← team_pulse_auto_timer
--   [nothing all night / weekend]
--   morning  timer_stopped  new_value = 147281 (40.9h)
--
-- The Team Pulse auto_timer rule reads "assignee moved a task into the Active
-- stage" as "working on it right now", so queueing tomorrow's task silently
-- re-arms the timer the member just stopped — and nothing server-side ever
-- stops a forgotten timer. This sweeper is that missing backstop, for ALL
-- timers however they were started (auto or via the play button).
--
--   * stop_stale_timers() — closes every timer that has run past the team's
--     cap, logging time CAPPED at the limit (the overrun is presumed idle;
--     the work-log description says so, so a human can correct it), exactly
--     the way stop_timer closes out: work log + activity entry +
--     tasks.total_minutes + delete. The owner is notified.
--   * Cap: Team Pulse config key `timer_max_hours` (default 8; teams without
--     Team Pulse get the default too — timers exist independent of the app).
--   * pg_cron every 15 minutes, so a runaway shows at most ~15 min of drift
--     past the cap. Each timer closes in its own sub-block: one bad row must
--     not strand the rest of the sweep.
--
-- Re-runnable: create or replace / guarded cron scheduling.
-- =============================================================================

create or replace function public.stop_stale_timers()
    returns integer
    language plpgsql
    security definer
    set search_path = public, extensions
as
$$
declare
    _t         record;
    _start     timestamp with time zone;
    _cap_hours numeric;
    _cap_secs  integer;
    _elapsed   integer;
    _logged    integer;
    _count     integer := 0;
begin
    for _t in
        select tt.id, tt.task_id, tt.user_id, tt.start_time,
               k.project_id, k.name as task_name, p.team_id
        from public.task_timers tt
        join public.tasks k on k.id = tt.task_id
        join public.projects p on p.id = k.project_id
        order by tt.start_time
    loop
        begin
            -- Per-team cap from Team Pulse config; junk / absent → 8h.
            select case
                       when (ia.config ->> 'timer_max_hours') ~ '^[0-9]+(\.[0-9]+)?$'
                       then (ia.config ->> 'timer_max_hours')::numeric
                   end
              into _cap_hours
            from public.installed_apps ia
            where ia.team_id = _t.team_id
              and ia.app_key = 'team_pulse'
              and ia.enabled
            limit 1;
            _cap_hours := coalesce(_cap_hours, 8);
            if _cap_hours <= 0 then
                _cap_hours := 8;
            end if;
            _cap_secs := (_cap_hours * 3600)::integer;

            -- Lock the row and re-read start_time under the lock: a concurrent
            -- stop may have removed it, and start_timer re-arms the SAME row
            -- (on conflict do update) — closing a freshly re-armed timer here
            -- would log cap-hours of work that never happened.
            select tt.start_time into _start
            from public.task_timers tt
            where tt.id = _t.id
            for update;
            if _start is null then
                continue;
            end if;

            _elapsed := greatest(0, floor(extract(epoch from (now() - _start)))::integer);
            if _elapsed <= _cap_secs then
                continue;
            end if;

            _logged := _cap_secs;

            insert into public.task_work_log
                (task_id, user_id, time_spent, description, is_billable, logged_by_timer)
            values (_t.task_id, _t.user_id, _logged,
                    'Auto-stopped: timer ran past the ' || _cap_hours || 'h limit '
                        || '(started ' || to_char(_start, 'YYYY-MM-DD HH24:MI TZ')
                        || '; ' || round(_elapsed / 3600.0, 1) || 'h elapsed, '
                        || _cap_hours || 'h logged).',
                    true, true);

            insert into public.task_activity_logs
                (task_id, project_id, user_id, action, field, new_value)
            values (_t.task_id, _t.project_id, _t.user_id,
                    'timer_stopped', 'timer', _logged::text);

            update public.tasks
                set total_minutes = total_minutes + ceil(_logged::numeric / 60)
                where id = _t.task_id;

            delete from public.task_timers where id = _t.id;
            _count := _count + 1;

            -- Tell the owner — a silently vanishing timer is as confusing as a
            -- silently starting one. Best-effort: never fail the sweep over it.
            begin
                perform public.create_notification(
                    p_user_id    => _t.user_id,
                    p_message    => 'Your timer on "' || _t.task_name
                        || '" ran past ' || _cap_hours || 'h and was stopped — '
                        || _cap_hours || 'h logged. Adjust the work log if needed.',
                    p_type       => 'info',
                    p_url        => null,
                    p_team_id    => _t.team_id,
                    p_task_id    => _t.task_id,
                    p_project_id => _t.project_id
                );
            exception when others then
                null;
            end;
        exception when others then
            -- One stuck row (deleted task, bad config, lock trouble) must not
            -- leave every other stale timer running another sweep interval.
            null;
        end;
    end loop;

    return _count;
end;
$$;

-- The sweep is infrastructure, not an app call.
revoke all on function public.stop_stale_timers() from public, anon, authenticated;
grant execute on function public.stop_stale_timers() to service_role;

-- Every 15 minutes: a forgotten timer overshoots its cap by minutes, not hours.
-- Guarded so the migration still succeeds where pg_cron is unavailable.
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.unschedule('stop-stale-timers');
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule(
            'stop-stale-timers',
            '*/15 * * * *',
            $cron$ select public.stop_stale_timers(); $cron$
        );
        raise notice 'Timers: scheduled pg_cron job "stop-stale-timers" (every 15 min).';
    else
        raise notice 'Timers: pg_cron unavailable — call stop_stale_timers() manually.';
    end if;
exception
    when others then
        raise notice 'Timers: pg_cron setup skipped (% — %).', sqlstate, sqlerrm;
end $$;
