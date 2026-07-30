-- =============================================================================
-- Project-wide task activity read access.
--
-- The project "Activity" tab shows every action on EVERY task in the project
-- (status changes, assignments, priority, dates, …) — not just the tasks the
-- viewer is assigned to. The original SELECT policy only allowed task members
-- (is_task_member), so a project member saw an almost-empty feed.
--
-- Broaden SELECT so any member of the task's project team can read the log.
-- Writes are still trigger-only (there is intentionally no INSERT policy).
-- =============================================================================

drop policy if exists task_activity_logs_select on public.task_activity_logs;
create policy task_activity_logs_select on public.task_activity_logs
    for select to authenticated
    using (
        public.is_task_member(task_id)
        or public.is_project_team_member(project_id)
    );
