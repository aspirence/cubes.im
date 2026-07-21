-- =============================================================================
-- Tasks — let any project member delete a task.
-- =============================================================================
-- Previously only project admins/owner or the task's reporter could delete
-- (see 20260401 §8.3). Deleting is now a normal member action, so widen the
-- policy to any project team member. Reads/inserts/updates are already
-- member-scoped; this brings delete in line. Deleting a task still cascades to
-- its subtasks, assignees, comments, attachments and references via FKs, and
-- unlinks (SET NULL) anything that merely references it (review videos, etc.).

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
    for delete to authenticated
    using (public.is_project_team_member(project_id));
