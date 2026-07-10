-- =============================================================================
-- Notification snooze ("remind me later").
-- =============================================================================
-- Adds a nullable remind_at to user_notifications. The client hides a
-- notification (and drops it from the unread counts) while remind_at is in the
-- future, and it re-surfaces automatically once that time passes — no
-- background job needed, since the list query filters on now(). Existing RLS
-- (user_id = auth.uid() for select/update/delete) already governs this column.

alter table public.user_notifications
    add column if not exists remind_at timestamp with time zone;

-- Speeds up the "visible now" filter (unread, not snoozed) the bell runs often.
create index if not exists user_notifications_remind_at_index
    on public.user_notifications (user_id, remind_at);
