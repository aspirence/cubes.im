-- =============================================================================
-- tasks.status_changed_at — when the task last moved between statuses
-- =============================================================================
-- The board orders each column by status recency. updated_at can't feed that:
-- the touch trigger bumps it on EVERY edit (description, timer totals, drag
-- renumbering), so ordering by it makes unrelated edits look like movement.
-- A dedicated column, bumped only when status_id actually changes, is one
-- cheap indexed read — no activity-log scans, no comment joins.
--
-- Re-runnable: guarded DDL / create or replace / idempotent backfill.
-- =============================================================================

alter table public.tasks
    add column if not exists status_changed_at timestamp with time zone
        default current_timestamp;

-- Backfill: the task's last real status move from the activity log where one
-- was recorded; otherwise fall back to created_at (never updated_at — that
-- would seed the very noise this column exists to avoid).
update public.tasks t
set status_changed_at = coalesce(
        (select max(al.created_at)
         from public.task_activity_logs al
         where al.task_id = t.id
           and al.action = 'status_changed'),
        t.created_at
    )
where t.status_changed_at is null;

create or replace function public.set_task_status_changed_at()
    returns trigger
    language plpgsql
    set search_path = public
as
$$
begin
    if new.status_id is distinct from old.status_id then
        new.status_changed_at := current_timestamp;
    end if;
    return new;
end;
$$;

drop trigger if exists tasks_set_status_changed_at on public.tasks;
create trigger tasks_set_status_changed_at
    before update on public.tasks
    for each row execute function public.set_task_status_changed_at();
