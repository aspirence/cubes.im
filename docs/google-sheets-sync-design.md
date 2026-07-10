# Google Sheets ↔ Project Sync — Design (for review)

Status: **DRAFT — awaiting approval before build.** You asked to "design first, then build."

## 1. Goal

Let a project manager connect a Google Sheet to a Cubes project so that:

1. **Fetch** — clicking *Fetch* reads the sheet; each new row becomes a new task, and existing rows update their linked task.
2. **Push status back** — when a task's status/fields change in Cubes, the matching sheet row is updated.
3. **Client feedback flows in** — when a client writes in a `Feedback` column in the sheet, it shows up on the task (as a comment) in Cubes.

It appears as a new **"Sheet" view** in the project (like List/Board/Kanban), added via the "+ View" picker.

## 2. The hard constraint: writing back needs Google auth

There are two viable integration levels. Write-back (goals #2, #3 partially) **requires OAuth or a service account** — a browser cannot write to a private Google Sheet without Google's authorization.

| | A. Full OAuth (2-way) | B. Published-sheet CSV (1-way) |
|---|---|---|
| Connect | User signs in with Google, grants Sheets scope | User pastes a "Publish to web" CSV URL |
| Read rows → create/update tasks | ✅ | ✅ |
| Push task status → sheet | ✅ | ❌ (read-only) |
| Client feedback → task | ✅ (read the cell) | ✅ (read the cell) |
| Setup cost | Google Cloud OAuth app (client id/secret), consent screen, token storage + refresh | None |
| Best for | The full brief | A fast first slice |

**Recommendation:** Build **B first** (fast, no credentials, delivers Fetch + feedback-in), then layer **A** for write-back once you've set up a Google Cloud OAuth app. The data model below supports both from day one.

### Option C (alternative to OAuth): Service account + "share the sheet with a bot"
Instead of per-user OAuth, we host one Google **service account**; the user shares their sheet with its email (`cubes-bot@…iam.gserviceaccount.com`) as Editor. We then read/write via the service account. Simpler than OAuth (no consent screen, no refresh tokens, one server credential), at the cost of the user doing a one-time "Share with this email" step. **This is often the pragmatic sweet spot for two-way sync** and I'd suggest it over full user-OAuth unless you need per-user identity.

## 3. Data model (new migration)

```sql
-- One connection per project↔sheet.
create table public.project_sheet_syncs (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  team_id       uuid not null references teams(id) on delete cascade,
  mode          text not null default 'csv',      -- 'csv' | 'oauth' | 'service_account'
  sheet_id      text,                             -- Google spreadsheet id (A/C)
  sheet_range   text default 'Sheet1',            -- tab / A1 range
  csv_url       text,                             -- published CSV url (B)
  column_map    jsonb not null default '{}',      -- {title,status,assignee,due,feedback,key} -> column header
  status_map    jsonb not null default '{}',      -- sheet status text <-> cubes status_id
  last_synced_at timestamptz,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Row-level link so re-fetches update instead of duplicating, and write-back
-- knows which row to touch.
create table public.project_sheet_rows (
  id           uuid primary key default gen_random_uuid(),
  sync_id      uuid not null references project_sheet_syncs(id) on delete cascade,
  task_id      uuid references tasks(id) on delete set null,
  row_key      text not null,                     -- stable key from the sheet (see §4)
  row_hash     text,                              -- hash of last-seen row (skip no-op updates)
  last_feedback_hash text,                        -- so the same feedback isn't re-imported
  unique (sync_id, row_key)
);
```

RLS: project team members read; project admins write (mirrors existing `is_project_team_admin`). Tokens (for OAuth mode) live in a separate, admin-only table `project_sheet_tokens (sync_id, access_token, refresh_token, expires_at)` — never exposed to the client; only the server route reads them.

## 4. Row identity (the crux of idempotent sync)

To avoid duplicates on re-fetch, every sheet row needs a **stable key**. Priority:

1. A dedicated **`Cubes ID` column** we write back (best — survives row reordering). On first push we stamp each row with the task's id.
2. Else a user-chosen **key column** (e.g. an external ticket id).
3. Else a **content hash** of the row (fragile if text is edited — used only as a last resort).

`project_sheet_rows.row_key` stores whichever is chosen; `row_hash` lets us skip unchanged rows.

## 5. Sync flows

### Fetch (sheet → Cubes)
```
read rows (CSV fetch OR Sheets API values.get)
for each row:
  key = resolve row_key
  existing = project_sheet_rows[key]
  if none:      create task (title, status via status_map, assignee, due) → insert row link
  else:         if row_hash changed → patch the task fields that changed
  feedback cell present & hash changed → add a task comment "(from sheet) …"
mark last_synced_at
report: N created, M updated, K feedback imported
```
Runs in a **server route** (`/api/projects/[id]/sheet-sync/fetch`) so credentials/tokens stay server-side. UI shows a summary + per-row diff before committing (a dry-run toggle).

### Push (Cubes → sheet) — OAuth/service-account only
A DB trigger or the existing task-update path enqueues a change; a server route writes the mapped columns (status, done, dates) back to the row via `spreadsheets.values.update`. Debounced; last-write-wins with a visible "synced HH:MM" stamp. Conflict rule: **Cubes is source of truth for status; the sheet is source of truth for feedback.**

### Feedback (sheet → Cubes)
The `Feedback` column is hashed per row; on change we post it as a task comment attributed to a "Google Sheet" system author and (optionally) reopen the task or set a `changes_requested` status.

## 6. The "Sheet" view (frontend)
- Registered in `src/lib/projects/views.ts` (`key:"sheet"`, icon `table_view`) + a `case "sheet"` in the project page.
- States: **not connected** → a connect card (paste CSV url, or "Sign in with Google" / "Share with bot email"); **connected** → a mapping panel (map columns → task fields, map sheet statuses → project statuses), a **Fetch** button, a last-synced stamp, and a live table preview with per-row status (new / updated / linked).
- Hooks: `use-sheet-sync.ts` — `useSheetSync(projectId)`, `useConnectSheet`, `useFetchSheet` (calls the server route), `useSheetColumnMap`.

## 7. Phased plan
- **Phase 1 (no credentials):** migration + Sheet view + CSV connect + column mapping + **Fetch** (create/update tasks) + feedback-in as comments. Fully usable one-way.
- **Phase 2 (write-back):** add service-account (Option C) → push status/dates back; stamp `Cubes ID` column for stable keys.
- **Phase 3:** scheduled auto-fetch (cron), conflict UI, per-field mapping presets, multi-tab support.

## 8. Decisions I need from you
1. **Auth for write-back:** Service account ("share sheet with bot", simplest) vs full per-user Google OAuth? (I recommend **service account**.)
2. **Start with Phase 1 (CSV, one-way) now**, then write-back — or wait and build two-way in one shot (needs the Google credential first)?
3. **Feedback target:** import feedback as a **comment** (recommended) and/or auto-move the task to `changes_requested`?
4. Is sync **per-project** (one sheet per project) enough, or do you need multiple sheets per project?

Once you pick, I'll build Phase 1 immediately (it needs no external setup) and scope Phase 2 around the auth choice.
