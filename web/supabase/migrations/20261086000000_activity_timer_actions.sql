-- Admit timer actions (and 'unassigned') into the task activity whitelist.
-- 4.4 The activity action whitelist predates timers — admit the two new
--     actions (plus 'unassigned', which describeActivity already renders).
alter table public.task_activity_logs
    drop constraint if exists task_activity_logs_action_check;
alter table public.task_activity_logs
    add constraint task_activity_logs_action_check
    check (action in ('created', 'renamed', 'status_changed', 'priority_changed',
                      'assigned', 'unassigned', 'completed',
                      'timer_started', 'timer_stopped'));
