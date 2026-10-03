# Pabbly-style automation, and the Client app

Status: building (Sept 2026). The contract the owners build against; change it here
first. Research behind the choices: `scratchpad/research/*.md` (agency↔client month,
Pabbly/Zapier/Make matrix) and the two code maps.

History: this document opened with a part on Marketing funnels. The Marketing app was
removed on 2026-09-28, and with it the funnels, their workflow actions and event, and
the `funnel` share kind in the Client app. Nothing below depends on it.

## What we are building

1. **Workflows that feel like Pabbly Connect.** Webhook triggers with captured sample
   payloads, a field picker built from those samples, filters that skip rather than
   halt, routers, delays, an outbound HTTP step, per-step retries, replay, and a run
   history that explains itself.
2. **A Client app.** Installed on a project, shared to a client contact **by email**,
   the client signs in with a magic link and gets the things clients actually use:
   **the work you chose to show, approvals, and requests that become real tasks.**

Deliberately NOT in v1 (research says they get built and ignored): client-facing
Kanban, in-portal messaging, client-visible time tracking.

## Hard rules for everyone

- Dev database only (`sivarqzgyeniuveqnjtq`), never prod. Migrations re-runnable and
  additive; apply your own with `psql "$U" -X -1 -v ON_ERROR_STOP=1 -f <file>`.
- RLS on every table; `revoke all ... from anon` unless a route needs anon; secrets in
  a service-role-only table, never in step config or a client payload.
- **Record-level filtering happens in SQL, never in the UI.** Anything a client must
  not see is absent from the payload, not hidden with CSS.
- New tables are not in `src/types/database.ts`: use `adminClient()` server-side and a
  local `loose()` cast client-side with your own Row interfaces.
- Everyone: `npx tsc --noEmit` and `eslint` clean **for your own files** (others are
  building at the same time), and tests before you report done.

---

# Part 1 — Workflows, Pabbly-style

Migration `20261132000000_workflow_automation.sql` (Workflows backend owner).
Build in this order; each step is shippable on its own.

### 1.1 Filters that skip, not halt
`workflow_steps.config` for `condition` becomes
`{mode: 'filter'|'stop', match: 'all'|'any', rules: [{left, op, right}]}` with ops
`= != > >= < <= contains not_contains starts_with ends_with is_empty is_not_empty`.
`wf_eval_condition` handles groups; on a false `filter` the step run is `skipped`, the
run continues; on a false `stop` it ends as today (status `success`, `_stop_reason`).
Old single-rule configs must keep working (`{left, op, right}` = one rule, mode `stop`).

### 1.2 Webhook triggers
```
workflow_webhooks(id uuid pk, workflow_id uuid unique → workflows cascade, team_id not null,
  token text not null unique,            -- 32 random bytes, base64url; the URL path
  signing_secret text,                   -- optional HMAC check of the raw body
  capture_mode boolean not null default true,  -- true = store, do not run (the "waiting for a request…" state)
  dedupe_path text,                      -- dot-path whose value must be unique
  enabled boolean not null default true,
  last_event_at timestamptz, created_by, created_at, updated_at)
workflow_webhook_events(id uuid pk, webhook_id → cascade, team_id not null,
  headers jsonb not null default '{}', payload jsonb not null default '{}',
  dedupe_key text, run_id uuid null → workflow_runs on delete set null,
  status text not null check in ('captured','queued','ran','duplicate','error'),
  error text, received_at timestamptz default now(),
  unique (webhook_id, dedupe_key) where dedupe_key is not null)
```
`workflows.trigger_type` check gains `'webhook'`. Route `POST /api/hooks/[token]`
(public, `runtime = "nodejs"`, no session): body ≤ 1 MB, optional
`x-cubes-signature` HMAC-SHA256 of the raw body, always 200 with `{received: true}`
unless the token is unknown (404) — never leak workflow existence. It records the
event; if `capture_mode` it stops there, else it starts a run with
`trigger_payload = payload` and drives app steps through the existing runner path.
`GET /api/hooks/[token]` answers a `hub.challenge` echo so provider-style
verification works later.

### 1.3 Sample data + field picker
`workflows.trigger_sample jsonb`, `workflow_steps.sample_output jsonb`.
Route `POST /api/workflows/steps/[id]/test` (session, team member): runs THAT step
alone with a context built from the trigger sample plus earlier steps' samples,
stores `sample_output`, returns the exact payload. Trigger sample comes from the last
captured webhook event, a manual paste, or a schedule's `{fired_at}`.
No engine change: `wf_interpolate` already resolves `{{steps.key.path}}`.

### 1.4 Router (one level, max 5 routes)
`workflow_steps.step_type` gains `'router'`, `'delay'`, `'http'`, `'format'`.
`workflow_steps.branch_key text` + `parent_step_id uuid → workflow_steps`.
A `router` step config is `{routes: [{key, label, match, rules}]}`; it writes the
matched route key to `context._routes[step_key]`; `advance_workflow_run` skips any
step whose `parent_step_id` is that router and whose `branch_key` is not the match.
Unmatched → the route keyed `fallback` if present, else the router ends the run as
`success` with `_stop_reason = 'no_route'`.

### 1.5 Delay
`workflow_runs.resume_at timestamptz` + index; status check gains `'waiting_delay'`.
A `delay` step (`{for: {minutes|hours|days}}` or `{until: '{{steps.x.date}}'}`) parks
the run; `wf_claim_resumable()` (service role, called from `tick()`) resumes runs whose
`resume_at` has passed. Cap: 30 days.

### 1.6 Outbound HTTP step
App action `http.request {method, url, headers, body, timeout_ms}` — the thing that
makes us interoperate with everything we have no connector for. **Guards:** https only;
resolve the host and refuse private/loopback/link-local addresses (SSRF); per-team
allowlist table `team_http_allowlist(team_id, host, created_by, created_at)` that an
admin manages; 10 s default timeout, 1 MB response cap; response `{status, headers, body}`
becomes the step output (JSON parsed when possible). Secrets never inline: a header
value may be `{{connection.<id>.token}}`, resolved server-side from the connection's
secrets row.

### 1.7 Retries, replay, history
- `workflow_step_runs.attempt integer not null default 1`, `workflow_runs.next_attempt_at timestamptz`.
  App/HTTP step config may carry `{retry: {max: 1..5, backoff: 'fixed'|'exponential'}}`;
  `wf_resume_app_step` re-parks instead of failing while `attempt < max`.
- `workflow_runs.trigger_payload jsonb` (raw) and `workflow_runs.replay_of uuid`.
  Route `POST /api/workflows/runs/[id]/replay` (session, admin) starts a new run with
  the same trigger payload.
- `workflow_runs.expires_at` (default now() + 30 days) and a delete sweep inside
  `tick()`; step runs cascade.
- `workflow_runs.task_count integer` — incremented for app/http steps only; logic steps
  are free, exactly as Pabbly counts them.

### 1.8 Events (what the Client app and the CRM emit)
`trigger_type = 'event'` finally works: `workflow_events(id, team_id, key, payload jsonb, created_at)`
written by SECURITY DEFINER emitters, and `tick()` starts runs for enabled workflows
whose `trigger_config.event_key` matches, oldest first, marking each event consumed
(`workflow_event_deliveries(event_id, workflow_id, run_id, created_at, unique(event_id, workflow_id))`).
v1 event keys: `client.request_created`, `client.approval_decided`, `crm.deal_created`,
`crm.deal_status_changed`, `crm.deal_stage_changed` (payloads in
[CRM_WORKFLOWS.md](./CRM_WORKFLOWS.md)), `sheets.row_created`.

### Builder UI (Workflows UI owner)
Trigger picker (Manual / Schedule / Webhook / Event) with, for webhooks: the URL, a
Copy button, "Waiting for a request…" that polls the capture buffer, the captured
payload shown as a tree, and a "use as sample" button. Step list with step types
(App action / Filter / Router / Delay / HTTP / Notify / Create task), each with a
**field picker** — a tree of `trigger` + earlier steps' samples with example values,
inserting `{{steps.key.path}}` at the cursor. "Test this step" on every step showing
the exact request/response. Run history: status, duration, per-step input/output/error,
a Replay button, and a filter for failures. On/off toggle separate from delete.

---

# Part 2 — The Client app

App key **`client`** (new; the old `client_portal` app stays installed and untouched —
its share-link portal keeps working, and the new app supersedes it for project work).
Route `/apps/client` + project view `client`. Migration
`20261133000000_app_client.sql` (Client backend owner).

```
app_client_contacts(
  id uuid pk, team_id not null → teams cascade,
  client_id uuid null → clients on delete set null,
  email citext not null, name text, role text not null default 'viewer'
    check in ('viewer','approver','requester','manager'),   -- approving is its own permission
  status text not null default 'invited' check in ('invited','active','revoked'),
  last_seen_at timestamptz, invited_by uuid → users set null,
  created_at, updated_at, unique (team_id, email))
app_client_project_access(                 -- what this contact may see, opt-in per project
  contact_id → cascade, project_id → projects cascade, team_id not null,
  can_request boolean not null default true, can_approve boolean not null default false,
  shared_by uuid, created_at, primary key (contact_id, project_id))
app_client_sessions(
  id uuid pk, contact_id → cascade, team_id not null,
  token_hash text not null unique,        -- sha256 of the cookie value; never store the value
  issued_at, expires_at timestamptz not null, last_used_at, revoked_at,
  user_agent text, ip_hash text)
app_client_magic_links(
  id uuid pk, contact_id → cascade, team_id not null,
  token_hash text not null unique, expires_at timestamptz not null,  -- 15 minutes
  used_at timestamptz, created_at)         -- single use, per the research
app_client_shares(                         -- the opt-in list of what is visible
  id uuid pk, team_id not null, project_id → cascade,
  kind text not null check in ('task','file','sheet','update'),
  ref_id uuid not null, title text, shared_by uuid, created_at,
  unique (project_id, kind, ref_id))
app_client_requests(                       -- the intake that becomes work
  id uuid pk, team_id not null, project_id → cascade, contact_id → set null,
  request_type text not null default 'general',
  title text not null 1..200, details text <= 8000,
  priority text check in ('low','normal','high'),
  status text not null default 'new' check in ('new','accepted','declined','done'),
  task_id uuid null → tasks on delete set null,   -- set when the agency accepts
  decided_by uuid, decided_at, due_by date, created_at, updated_at)
app_client_approvals(
  id uuid pk, team_id not null, project_id → cascade,
  subject_kind text not null check in ('task','content_item','video_review','file'),
  subject_id uuid not null, version integer not null default 1,
  title text, note text,
  state text not null default 'pending' check in ('pending','approved','changes_requested'),
  requested_by uuid, requested_at timestamptz default now(),
  decided_by_contact uuid → app_client_contacts on delete set null,
  decided_at timestamptz, decision_note text,
  unique (project_id, subject_kind, subject_id, version))
app_client_events(id, team_id, contact_id, project_id, kind, detail jsonb, created_at)  -- audit: every login, view, decision
```
(`app_client_shares.kind` once also allowed `'funnel'`; the 2026-09-28 removal put
the check back to the four kinds above.)

**Auth.** `/portal` gets a sign-in page: enter email → if an `active`/`invited` contact
exists, create a magic link (15 min, single use) and email it; always answer "check
your email" whether or not the contact exists. `/portal/auth/[token]` verifies, marks
the link used, creates a session row and sets an httpOnly, SameSite=Lax, Secure cookie
holding a random value whose sha256 is `token_hash`; session length 30 days, sliding.
Every client read/write goes through SECURITY DEFINER RPCs that take the session token
and resolve the contact — **never** through PostgREST with anon rights:
`client_session_context(p_token)`, `client_portal_projects(p_token)`,
`client_project_overview(p_token, p_project_id)` (shared items + approvals +
requests), `client_submit_request(p_token, ...)`,
`client_decide_approval(p_token, p_approval_id, p_state, p_note)`,
`client_signed_file_url` (service-role route, like the video-review share route).
Revoking a contact deletes their sessions.

**What the client sees** (nothing else): the projects shared with them; for each, the
shared items, the approvals waiting on them, and their requests with status. Never:
internal comments, other clients, team chatter, time tracking, margins, unshared tasks.

**Requests become tasks.** The agency sees a request queue on the project's Client tab;
Accept opens the create-task modal prefilled (title, details, requester) and links
`task_id` back; Decline records a reason. Accept is deliberate — that gate is what
stops scope creep. Emits event `client.request_created` on submit and
`client.approval_decided` on a decision, so workflows can notify, assign or escalate.

**Email.** New template keys `client.invitation`, `client.magic_link`,
`client.approval_requested`, `client.request_received` seeded into
`platform_email_triggers` + `DEFAULT_TEMPLATES`, sent through the existing
`composeEmail`/dispatch path. **The UI must not claim an email was sent when the
dispatcher returns `skipped`** (today's invite modal does; do not copy that) — surface
"email not configured" honestly and offer a copyable link.

**Agency UI** (Client UI owner): project tab "Client" — contacts (invite by email,
role, last seen, revoke, resend), what's shared (add task/file/sheet/update,
remove), the request queue (accept → task, decline), the approvals board (request an
approval on a task/content item, see state and who decided), and a preview-as-client
button. `/apps/client` lists every client across projects.

**Client UI** (Client UI owner): `/portal` sign-in, `/portal/home` (their projects),
`/portal/p/[id]` (shared work, approvals, requests + "New request" form).
Branded with the workspace logo/accent already on the portal tables. Mobile-first —
the research says clients open these on a phone from a WhatsApp message.

---

## Ownership

| Owner | Files |
|---|---|
| Workflows backend | `supabase/migrations/20261132000000_workflow_automation.sql`; `src/lib/workflows/**` (engine, runner, http-step, events); `src/app/api/hooks/**`; `src/app/api/workflows/**` |
| Workflows UI | `src/app/(app)/workflows/**`; `src/features/workflows/**`; `src/lib/workflows/app-action-catalog.ts` (add step-type descriptors only) |
| Client backend | `supabase/migrations/20261133000000_app_client.sql`; `src/lib/client-portal/**`; `src/app/api/client/**`; email templates in `src/lib/email/templates.ts` (append only) |
| Client UI | `src/features/app-client/**`; `src/app/(app)/apps/client/**`; `src/app/(app)/projects/[id]/_components/client-tab.tsx`; `src/app/portal/**` (new sign-in + signed-in pages; leave `/portal/[token]` working) |
| Lead | `src/lib/apps-platform/catalog.ts`, `src/lib/projects/views.ts`, `src/features/apps-platform/app-scope.ts`, `src/app/(app)/projects/[id]/page.tsx`, this document |
