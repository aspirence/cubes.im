# Data Manager — Backup · Restore · Clear (owner-only app)

An installable first-party app (App Center → **Data Manager**) that gives the
**workspace owner** three tools:

| Tool | What it does | Enforcement |
| --- | --- | --- |
| **Backup** | Downloads a portable `cubes-backup-*.json` of the workspace's work data | Client-side reads through the owner's RLS session |
| **Restore** | Validates a backup file and imports it — additive, never touches existing data | Same RPCs the app uses (`create_project` / `create_task`) + RLS writes |
| **Clear** | Wipes the workspace's work data after a type-the-workspace-name confirm | `clear_team_data` RPC, `SECURITY DEFINER`, re-checks `is_team_owner` server-side |

## Owner-only — why a new check

The codebase's standard gate `is_team_admin` treats the Owner and Admin roles
as equivalent (`r.owner OR r.admin_role`). Data destruction must be stricter,
so this feature adds **`is_team_owner(_team_id)`** (migration
`20261043000000_app_data_manager.sql`): true only when the caller's active
membership holds the role flagged `owner`. Because team admins can edit roles
(and could self-promote to Owner), `clear_team_data` additionally requires the
caller to be the team's creator (`teams.user_id`) or the organization owner
(`organizations.user_id`) — neither column is admin-mutable (migration
`20261044000000_data_manager_hardening.sql`). The page also gates the UI via
`useIsTeamOwner()`, but the real enforcement is in the RPC — a non-owner
calling `clear_team_data` directly gets `forbidden`.

Installing the app stays team-admin (standard `installed_apps` RLS); opening
it as a non-owner shows a 403 explainer.

## Backup format (v1)

`{ format: "cubes-backup", version: 1, exportedAt, workspace, folders[], labels[], projects[] }`

Design rules that make it **portable and importable anywhere**:

- No internal UUIDs required to import. In-file references use local ids
  (`lid`); people are referenced **by email**, labels/statuses/priorities
  **by name** — the importer re-resolves them against the target workspace.
- Included: folder tree, projects (color, notes, dates, folder), per-project
  statuses (lid + name + todo/doing/done bucket + order), tasks (name,
  description, dates, completion timestamp, archived flag, sort order, subtask
  hierarchy at any depth, priority, status by lid with name fallback, labels,
  assignee emails), team label definitions.
- Exports paginate every query (`.range()` pages of 1000 with stable ordering)
  — PostgREST caps un-ranged responses at `max_rows` and large workspaces
  would otherwise produce silently truncated backups.
- Excluded in v1 (documented, candidates for v2): comments, attachments/files
  (storage objects), time logs, automations, project views, app data (docs,
  video review, social studio, portals), clients, HR.
- `validateBackup()` checks the whole file before anything is written:
  format/version, required fields, duplicate lids, unknown parent/folder
  references, and subtask cycles — errors name the offending element.

## Import semantics

1. Labels: reuse by name (case-insensitive), create the missing ones with
   their original casing preserved.
2. Folders: same-name folders are **reused** (the DB enforces per-team unique
   folder names); the rest are created parents-first with `created_by` set.
3. Projects: `create_project` (statuses To Do/Doing/Done get seeded by
   trigger); each backup status claims at most one seeded row by name — the
   claimed row's bucket/sort are updated to match the backup, duplicates get
   their own rows; project name clashes get a numbered suffix (reported).
   `create_project` itself now uniquifies the derived 3-letter project key, so
   renamed imports ("Marketing (2)" → key MAR2) no longer hit the unique key
   index.
4. Tasks: created level-by-level (parents before subtasks) with bounded
   concurrency; description, dates, `completed_at`, `archived`, and the
   backup's `sort_order` written after create (the authoritative sort_order
   write also makes create_task's append-counter race harmless); labels
   linked; assignees resolved by member email — unresolvable ones are skipped
   and counted in the summary.
5. Everything is **additive** — existing data is never modified. The import is
   not transactional: on a mid-import failure, items imported before the
   failure remain (the UI says so and shows what landed).

## Clear semantics

`clear_team_data(p_team_id)` deletes: **projects** (cascading tasks, statuses,
assignees, label links, comments, attachments, views, automations, and
per-project app rows), **folders**, **team labels**, **clients**,
**project/task/status templates**, **workflows + agents** (team-scoped, not
covered by the projects cascade), and team-scoped **video-review videos and
Files-app rows** (their project FK is SET NULL, so they'd otherwise survive as
orphans). It returns per-table counts for the UI. Kept: members/roles,
installed apps, workspace settings/details, personal todos, notifications
history, HR (org-scoped).

## Files

- `supabase/migrations/20261043000000_app_data_manager.sql` — `is_team_owner` + `clear_team_data`
- `supabase/migrations/20261044000000_data_manager_hardening.sql` — project-key uniquification, extended wipe coverage, hardened owner gate
- `src/lib/apps-platform/catalog.ts` — `data_manager` descriptor (Operations)
- `src/features/app-data-manager/backup-format.ts` — format + validator
- `src/features/app-data-manager/backup-engine.ts` — exporter + importer
- `src/features/app-data-manager/use-data-manager.ts` — hooks (`useIsTeamOwner`, export/import/clear mutations)
- `src/app/(app)/apps/data-manager/page.tsx` — install gate → owner gate → Backup / Restore / Danger zone

## v2 candidates

Comments & attachments in the backup (needs storage object export), clients,
scheduled automatic backups to storage, cross-version import migrations,
soft-delete ("trash with 30-day restore") in front of the hard clear.
