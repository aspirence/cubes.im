# Sheets app, and Workflows as the glue

Status: building (Sept 2026). This is the contract the build is written against;
change it here first if a contract has to change.

History: this document also covered a Marketing app (Meta Ads accounts, spend
and lead sync). The Marketing app was removed on 2026-09-28 — its tables,
routes, code, workflow actions, events and templates are gone. The CRM's own
workflow surface (events, app steps, the "web form → deal" path) is in
[CRM_WORKFLOWS.md](./CRM_WORKFLOWS.md).

## What the user asked for

1. **Sheets** becomes its own app. Install it, activate it in a project, and it
   shows up as a project view. In it you create sheets from templates or your
   own columns. A sheet can be bound to an installed app's data (tasks,
   Content Studio items), and any sheet can be linked to a Google Sheet with
   two-way sync, configured when the sheet is created. Sheets can live in a
   project or at workspace level. Team members can save their own templates.
2. **Workflows are the glue.** Timing ("sync this sheet with Google every day
   at 09:00") and cross-app links ("a web-form post becomes a CRM deal") are
   workflow steps the user arranges — not hard-wired. The workflow engine
   therefore gets a working **schedule trigger** and **app steps**.

The existing Content Studio "Sheet" tab (an OAuth stub) is retired in favour of
the Sheets app; Google OAuth (app_google_connections / app_google_secrets,
src/lib/google/*) is reused as is.

## Keys

| | app_key | view_key | route | table prefix | code |
|---|---|---|---|---|---|
| Sheets | `sheets` | `sheets` | `/apps/sheets` | `app_sheet_*` / `app_sheets` | src/features/app-sheets, src/lib/sheets |

Registered already (catalog.ts, views.ts, app-scope.ts VIEW_KEY_TO_APP_KEY,
projects/[id]/page.tsx, _components/sheets-tab.tsx, apps/sheets/page.tsx).
The workspace takes `{ projectId?: string; embedded?: boolean }` like
ContentStudioWorkspace.

Shared contracts (already written, pure, import-free or type-only imports):
- `src/lib/sheets/types.ts` — SheetSource, ColumnType, SheetColumn, SheetRow, SheetData, GoogleLinkRow, SyncCounts, SheetTemplate, newColumnId
- `src/lib/sheets/sources.ts` — SOURCES (fields per source, writability, dynamic options, config)
- `src/lib/sheets/templates.ts` — BUILT_IN_TEMPLATES
- `src/lib/workflows/app-action-catalog.ts` — APP_ACTIONS, ScheduleTriggerConfig, describeSchedule
- `src/lib/apps/auth.ts` — adminClient, authorizeTeamRequest, callerCanAccessProject, secretMatches, safeErrorText

## Database

All migrations: re-runnable (`if not exists`, `drop policy if exists`,
`create or replace`), RLS on, `revoke all ... from anon`, explicit grants,
`set_row_updated_at()` trigger for updated_at. Secrets tables: RLS on, zero
policies, `revoke all from public, anon, authenticated`, service_role only.
Sweep functions: SECURITY DEFINER, `revoke all ... from public, anon,
authenticated; grant execute ... to service_role`.

### 20261128000000_app_runner_workflows.sql (Workflows owner)

- `workflow_runs.status` check gains `'waiting_app'`.
- `advance_workflow_run`: an `app` step inserts its step_run as `'running'`
  with `input = config`, sets the run to `'waiting_app'` (current_position stays
  at the previous step), records `context._waiting_step_run = <step_run id>`,
  and returns. `human`/`ai` still raise.
- `wf_resume_app_step(p_run_id uuid, p_step_run_id uuid, p_output jsonb, p_error text)`
  (service_role only): on error → step_run error, run error (finished). On
  success → step_run success + output, context.steps.<key> = output,
  current_position = that step's position, run back to `'running'`, then
  `perform advance_workflow_run(p_run_id)`.
- Schedule trigger: `workflow_schedule_next_run(p_config jsonb, p_after timestamptz) returns timestamptz`
  computing the next instant for ScheduleTriggerConfig in its IANA zone
  (use `recurrence_timezone()` from 20261126000000 for zone validation).
  A BEFORE INSERT/UPDATE trigger on `workflows` recomputes `next_run_at`
  whenever trigger_type/trigger_config/enabled change (null unless enabled and
  trigger_type = 'schedule') — the browser never sets it.
- `workflows_claim_due(p_limit int default 20) returns setof uuid` (service_role):
  `for update skip locked` over enabled schedule workflows with
  `next_run_at <= now()`; for each: insert a run (status running,
  trigger_snapshot `{"trigger":"schedule","fired_at":now}`), bump run_count /
  last_run_at, advance next_run_at from now, `perform advance_workflow_run`,
  return the run id. Missed runs are not replayed.
- `start_workflow_run` unchanged for members ("Run now"); a service twin
  `start_workflow_run_system(p_workflow_id uuid, p_trigger jsonb)` for the runner.
- `app_runner_config` singleton (`id boolean pk default true check (id)`,
  `tick_url text`, `tick_secret text`), locked down like billing_config, and a
  pg_cron job `app-runner-tick` every 5 minutes doing
  `net.http_post(tick_url, '{}', headers {'x-runner-secret': tick_secret})`
  when the row is filled (no row / empty url → no-op). The row is filled by
  hand per environment; local dev calls the tick route directly.

### 20261129000000_app_sheets.sql (Sheets backend owner)

```
app_sheets(
  id uuid pk default gen_random_uuid(),
  team_id uuid not null → teams on delete cascade,
  project_id uuid null → projects on delete cascade,      -- null = workspace sheet
  name text not null check 1..120,
  description text check <= 2000,
  source text not null check in ('custom','tasks','content_studio_items'),
  source_config jsonb not null default '{}' check object,
  columns jsonb not null default '[]' check array,          -- SheetColumn[]
  template_key text,
  archived boolean not null default false,
  created_by uuid → users set null, created_at, updated_at)
  -- check: source <> 'tasks' or project_id is not null
app_sheet_rows(
  id uuid pk, sheet_id uuid not null → app_sheets cascade, team_id uuid not null,
  record_key text not null,        -- custom: the row's own id (text); bound: source record id
  position double precision not null default 0,
  data jsonb not null default '{}' check object,   -- custom column values, keyed by column id
  created_by, updated_by uuid → users set null, created_at, updated_at,
  unique (sheet_id, record_key))
app_sheet_templates(
  id uuid pk, team_id uuid not null → teams cascade, name text 1..120, description text,
  icon text, source text (same check), source_config jsonb, columns jsonb, created_by, created_at, updated_at)
app_sheet_google_links(
  id uuid pk, sheet_id uuid not null unique → app_sheets cascade, team_id uuid not null,
  connection_id uuid not null → app_google_connections cascade,
  spreadsheet_id text not null, spreadsheet_url text, sheet_gid integer, sheet_title text,
  direction text not null default 'both' check in ('both','push','pull'),
  conflict_policy text not null default 'newest' check in ('newest','cubes','google'),
  delete_policy text not null default 'keep' check in ('keep','delete'),
  auto_sync boolean not null default true,
  interval_minutes integer not null default 15 check between 5 and 1440,
  next_run_at timestamptz, lease_until timestamptz,
  last_synced_at timestamptz, last_status text check in ('ok','error','running'),
  last_error text check <= 1000, last_counts jsonb,
  created_by, created_at, updated_at)
app_sheet_sync_state(                               -- no client access at all
  link_id uuid → app_sheet_google_links cascade, record_key text,
  values jsonb not null,                            -- normalized cell values keyed by column id at last sync
  synced_at timestamptz not null default now(),
  primary key (link_id, record_key))
app_sheet_sync_runs(
  id uuid pk, link_id uuid → links cascade, team_id uuid not null,
  trigger text check in ('manual','auto','workflow'), status text check in ('running','ok','error'),
  started_at, finished_at, counts jsonb, error text check <= 1000)
```
The `source` check once also allowed the Marketing app's two sources; the
2026-09-28 removal put it back to the three above.

Helper `app_sheets_can_access(p_sheet_id uuid) returns boolean` (SECURITY
DEFINER, stable): the caller is a member of the sheet's team and, when
project_id is set, `is_project_team_member(project_id)`.
RLS: app_sheets — select/insert/update: is_team_member(team_id) and (project_id is null or is_project_team_member(project_id));
delete: creator or is_team_admin. app_sheet_rows — all ops through
app_sheets_can_access(sheet_id). app_sheet_templates — select member, write
member (own) / admin. google_links, sync_runs — select via
app_sheets_can_access; writes only through routes (service_role). sync_state —
no grants to authenticated.
Seed: nothing (built-in templates are code). Index next_run_at where auto_sync.

## Server

### Sheets (Sheets backend owner)
- `src/lib/google/sheets-api.ts` — raw-fetch Sheets v4 client over `getAccessToken`
  (src/lib/google/tokens.ts): createSpreadsheet(title, tabTitle, headers) →
  {spreadsheetId, spreadsheetUrl, sheetGid}; getSheetMeta; readValues(range)
  (UNFORMATTED_VALUE, SERIAL_NUMBER dates); writeValues / batchUpdate values
  (USER_ENTERED for dates, RAW for text); appendRows; formatHeader (bold, frozen
  row 1, "Cubes ID" column A protected with warningOnly and narrow). Handles 401
  (drop cached token, refresh once), 403/404 ("access lost — re-pick the sheet"),
  429/5xx backoff. Base URL `GOOGLE_SHEETS_BASE_URL` override only when
  `NODE_ENV !== 'production'` (tests).
- `src/lib/sheets/adapters/{custom,tasks,content-studio}.ts` implementing
  `SheetAdapter { list(ctx): Promise<AdapterRecord[]>; update(ctx, key, patch: Record<field, unknown>): Promise<void>; create?(ctx, values): Promise<string /*key*/>; remove?(ctx, key) }`
  with `ctx = { admin, sheet, teamId, projectId, actorUserId | null }`.
  **Every adapter scopes its queries by team and project itself** (service_role
  bypasses RLS). Writes validate against the DB rules in the content-studio and
  tasks maps (enums, required fields, FK scope). Task writes go through the same
  columns the drawer writes (status_id, priority_id, start_date/end_date,
  tasks_assignees, task_labels).
- `src/lib/sheets/values.ts` (pure) — per ColumnType: normalize (API value ⇄
  stored), toGoogle (cell value), fromGoogle (cell → value or `{error}`),
  equal(a,b). Dates in the user's day, not UTC.
- `src/lib/sheets/sync-core.ts` (pure, relative imports only) — the three-way
  merge: inputs {columns, cubes: Map<key, values>, google: Map<key|null, values>
  (rows without an id are `null`-keyed with their row index), snapshot:
  Map<key, values>, policy, direction, deletePolicy, writable columns} → plan
  {toGoogle: row writes/appends/deletes, toCubes: updates/creates/deletes,
  newSnapshot, counts, conflicts}. Field-level: a field changed on one side
  wins; changed on both → conflict_policy (newest uses record updatedAt vs
  the Google file modifiedTime). Read-only columns always flow Cubes → Google
  (a Google edit to them is reverted and counted as skipped).
- `src/lib/sheets/google-sync.ts` — `syncSheetLink(admin, {teamId, sheetId, trigger, actorUserId}): Promise<SyncCounts & {status}>`
  (lease via lease_until, run row, sheet read → adapter list → sync-core →
  apply → snapshot, next_run_at = now + interval) and
  `processDueSheetLinks(admin, limit = 10): Promise<number>`.
- `src/lib/sheets/workflow-actions.ts` — `export const sheetsActions: Record<"sheets.sync", AppActionHandler>`.
- Routes (all `runtime = "nodejs"`, session auth first, then adminClient):
  - `GET  /api/sheets/[id]/data` → SheetData
  - `PATCH /api/sheets/[id]/cells` body `{ key, columnId, value }` → `{ row: SheetRow }`
  - `POST /api/sheets/[id]/rows` body `{ values?: Record<columnId, unknown>, position? }` → `{ row }`
  - `DELETE /api/sheets/[id]/rows` body `{ keys: string[] }`
  - `POST /api/sheets/[id]/google` body `{ connectionId, mode: 'create' | 'existing', spreadsheetId?, direction, conflictPolicy, deletePolicy, autoSync, intervalMinutes }` → `{ link }` (create makes a new spreadsheet with headers and does a first push; existing requires a Picker-picked file)
  - `PATCH /api/sheets/[id]/google` (settings) / `DELETE /api/sheets/[id]/google` (unlink; the Google file stays)
  - `POST /api/sheets/[id]/google/sync` → SyncCounts (manual)
  - `GET  /api/sheets/[id]/google/runs` → last 20 runs
  Sheet CRUD (create from template, rename, columns edit, archive) goes through
  the client with RLS; the create path accepts `{ name, projectId|null, source, sourceConfig, columns, templateKey, google? }`
  and, if `google` is present, then calls POST /api/sheets/[id]/google.

### Workflows runner (Workflows owner)
- `src/lib/workflows/app-action-types.ts` (lead, written) — AppActionContext,
  AppActionResult, AppActionHandler. The per-app modules export their action
  maps with the final key sets: `src/lib/sheets/workflow-actions.ts`
  (`sheetsActions`: `sheets.sync`) and `src/lib/crm/workflow-actions.ts`
  (`crmActions`: `crm.create_deal`, `crm.update_deal`, `crm.find_deal` — see
  CRM_WORKFLOWS.md).
- `src/lib/workflows/app-actions.ts` — `runAppAction(key, ctx, params): Promise<AppActionResult>`:
  checks the action exists and its app is installed + enabled for ctx.teamId,
  dispatches to the per-app action maps, never throws (errors become
  `{ ok: false, error }` via safeErrorText).
- `src/lib/workflows/runner.ts` — `tick(admin)`: claim due schedules
  (`workflows_claim_due`), then process up to N `waiting_app` runs
  (oldest first; one at a time per run), then `processDueSheetLinks`. And
  `continueRun(admin, runId, actorUserId)` for "Run now".
- Routes: `POST /api/runner/tick` (header `x-runner-secret` vs env `RUNNER_SECRET`
  via secretMatches; 401 otherwise) and `POST /api/workflows/runs/[id]/continue`
  (session member of the run's team) — the UI calls this right after
  `start_workflow_run` so app steps run immediately instead of waiting for the tick.
- UI (src/app/(app)/workflows/**, src/lib/workflows/capabilities.ts,
  src/features/workflows/*): schedule trigger form (frequency, time, days,
  zone defaulting to the browser's), "App" step picker over APP_ACTIONS
  (only apps installed for the team), param inputs per kind (sheet picker,
  CRM stage / campaign pickers), step run output shown in the run log, and
  ready-made templates in `src/features/workflows/workflow-templates.ts`
  (today the CRM pair, "Web form → CRM deal" and "Deal won → notify").

## Client

### Sheets UI (Sheets UI owner) — src/features/app-sheets/*
- `sheets-workspace.tsx` (replace the placeholder): install gate (InstallPrompt
  pattern), activation via useAppActivatedProjects("sheets"); standalone = a
  left rail with "Workspace sheets" + projects, embedded = the project's
  sheets. Sheet list → open sheet.
- Grid: antd Table (virtual, numeric scroll x/y, fixed widths) with typed
  inline cell editors (copy the useInlineSave contract from
  src/app/(app)/crm/_components/inline-edit.tsx into the feature folder),
  keyboard arrows/Enter/Escape between cells, paste a TSV block from Excel /
  Google Sheets into a range, add row, delete rows (when the source allows),
  add/rename/hide/reorder/delete columns (column editor with type + options),
  search, CSV export, read-only cells visibly locked with a tooltip why.
- New-sheet wizard: template gallery (BUILT_IN_TEMPLATES + team templates;
  category rail, search; app-bound templates disabled with "install X" when the
  app is not installed/active) → source + config (only sources whose app is
  installed and, for project sheets, active in the project) → columns (pick
  source fields + add custom columns) → Google Sheets (none / create new /
  pick existing with the Google Picker via /api/integrations/google/picker-token;
  direction, conflict policy, delete policy, auto-sync + interval; connect
  Google inline if not connected) → create. "Save as template" from a sheet.
- Google panel on an open sheet: link status, open in Google, Sync now,
  last run counts / error, settings, unlink, run history.
- Content Studio's old "Sheet" tab → removed (Sept 28, at the user's request);
  content-calendar sheets are created from the Sheets app itself.

## Environment

- `RUNNER_SECRET` (new; also goes into app_runner_config.tick_secret per env)
- `GOOGLE_SHEETS_BASE_URL`, `GOOGLE_DRIVE_BASE_URL` — test overrides, ignored in production
- existing Google vars (see .env.example); `NEXT_PUBLIC_APP_URL` must be set for the OAuth callback redirect

## Ownership (parallel build — do not edit files you do not own)

| Owner | Owns |
|---|---|
| Workflows | migrations/20261128000000_app_runner_workflows.sql; src/lib/workflows/{app-actions,runner,schedule}.ts; src/app/api/runner/**; src/app/api/workflows/runs/**; src/app/(app)/workflows/**; src/features/workflows/**; src/lib/workflows/capabilities.ts |
| Sheets backend | migrations/20261129000000_app_sheets.sql; src/lib/google/sheets-api.ts; src/lib/sheets/** except types/sources/templates (includes replacing workflow-actions.ts); src/app/api/sheets/** |
| Sheets UI | src/features/app-sheets/**; src/features/app-content-studio/{content-studio-workspace,sheet-sync-panel,use-sheet-sync}.tsx/ts (retire the Sheet tab) |
| Lead (integration) | shared contracts above, src/lib/workflows/app-action-types.ts, catalog/views/app-scope/page registrations, src/types/database.ts, .env files |

Rules: shared contract files are read-only for everyone but the lead — if one
must change, stop and report it. New tables are not in src/types/database.ts;
use `adminClient()` server-side and a local `loose()` cast client-side (as
src/features/templates/use-templates.ts does), with your own Row interfaces
(prefer the ones in the shared contracts). Everyone runs `npx tsc --noEmit` and
eslint on their own files and fixes only their own errors (others are building
at the same time).
