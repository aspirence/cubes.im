# Content Studio: tasks created inside the app

Status: built on dev (Sept 28, 2026), migration `20261149000000_content_studio_tasks.sql`.

## The problem it fixes

The calendar's "Social" scope shows only tasks Content Studio owns — a routine
made them, or a content item links them. Content Studio itself offered no way
to make a task, so a team using the project tab saw "New content" only, and a
project with 55 tasks showed none of them in Social scope.

## What exists now

- **"New task"** in the Content Studio header (next to New content), a hover
  **"+"** on every calendar day (due = that day), and **"New task"** in the
  "aren't social work yet" banner. All three open the product's own
  create-task modal (`src/features/tasks/create-task-modal.tsx`) with the
  project in scope and a due date preselected; the task is an ordinary project
  task (same RPCs, triggers, templates). Hidden for members who cannot create
  tasks in the project (`useCanCreateTasks`, the same gate as Board).
- **The third receipt.** `app_content_studio_tasks(task_id pk → tasks cascade,
  team_id, source 'created' | 'adopted', created_by default auth.uid(),
  created_at)`. RLS: select/delete for a team member who can open the task
  (`is_task_member`); insert additionally pins `team_id` to the task's own
  team; no update policy or grant (a receipt is created or deleted, never
  edited). `useSocialOwnedTaskIds` unions it with the item links and routine
  receipts, tolerating a missing table so prod renders before the migration.
- **`useAdoptContentTask()`** files the receipt (upsert, ignore duplicates)
  and invalidates the owned-ids set; the calendar window is invalidated on
  settle either way, so a task whose receipt failed still appears under
  "All tasks".
- **Timezone fix.** The calendar now buckets by LOCAL day (`dayKey` uses
  dayjs, was a UTC slice) and queries the grid's local-instant window. Before
  this, a task due at IST midnight (stored 18:30Z the evening before) sat on
  the previous cell, and the day "+" would have filed a task one day early.
  Existing chips move to the day `/schedule` already shows them on.
- `CreateTaskModal.onCreated` now also receives `{ projectId, due }`
  (additive; other call sites unchanged).

## Follow-ups (deliberately not in this round)

- A per-chip menu to add/remove an existing task from the Social calendar
  (`source = 'adopted'` is reserved; no migration needed).
- Recurring copies of a task carry no receipt.
- Routines still produce tasks only; making them produce content items is
  Phase 2 of the Content Studio plan.
