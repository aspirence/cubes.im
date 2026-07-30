# HR-2 — Attendance (shifts · employee-shifts · holidays · attendance · regularizations)

Migration: `supabase/migrations/20261002000000_hr2_attendance.sql`
Test:      `supabase/tests/hr2_rls.sql` (transaction-wrapped, ROLLBACK at end)

The second slice of the HR module (see `docs/HR_PLAN.md`, follows
`docs/hr1-notes.md`). Org-scoped, RLS-first. Builds on HR-1 (`is_hr_admin`,
`current_employee_id`, `hr_employees`) and Phase 1 (`is_org_member`). No UI or API
yet — this is the DB + RLS-test step.

## What this phase builds

A clock-in/out attendance system: shifts, per-employee shift assignment, an org
holiday calendar, daily attendance rows, and an approval flow for "I forgot to
punch" regularizations — plus two **reusable** employee-authorization helpers that
HR-3 (leave) and HR-4 (payroll) will share.

### Tables (all `hr_` prefixed, org-scoped; `org_id` DENORMALIZED on employee rows)

| Table | Purpose | Key columns | RLS summary |
|---|---|---|---|
| `hr_shifts` | Named work shifts | `org_id`→organizations CASCADE, `name`, `start_time`/`end_time` time, `break_minutes` int≥0 default 0, `working_days` int[] default `{1,2,3,4,5}` (0=Sun..6=Sat), `is_default` bool, `created_at` | **SELECT** `is_org_member`; **INSERT/UPDATE/DELETE** `is_hr_admin`. |
| `hr_employee_shifts` | Assigns a shift to an employee from a date | `employee_id`→hr_employees CASCADE, `org_id`→organizations CASCADE, `shift_id`→hr_shifts **SET NULL**, `effective_from` date default `current_date`, `created_at` | **SELECT** `can_view_employee(employee_id) OR is_org_member(org_id)`; **WRITE** `is_hr_admin`. |
| `hr_holidays` | Org holiday calendar | `org_id`→organizations CASCADE, `date` NOT NULL, `name` NOT NULL, `optional` bool default false, `created_at`; **UNIQUE(org_id, date, name)** | **SELECT** `is_org_member`; **INSERT/UPDATE/DELETE** `is_hr_admin`. |
| `hr_attendance` | One row per (employee, date) | `employee_id`→hr_employees CASCADE, `org_id`→organizations CASCADE, `date` NOT NULL, `clock_in`/`clock_out` timestamptz, `status` (present\|absent\|half_day\|wfh\|leave\|holiday\|weekend) default present, `work_minutes` int, `source` (web\|manual\|regularized\|system) default web, `notes`, `created_at`, `updated_at`; **UNIQUE(employee_id, date)** | **SELECT/INSERT/UPDATE** `can_view_employee(employee_id)`; **DELETE** `is_hr_admin`. |
| `hr_attendance_regularizations` | Punch-correction requests + approvals | `employee_id`→hr_employees CASCADE, `org_id`→organizations CASCADE, `date` NOT NULL, `requested_in`/`requested_out` timestamptz, `reason`, `status` (pending\|approved\|rejected) default pending, `approver_id`→users **SET NULL**, `decided_at`, `created_at` | **SELECT** `can_view_employee`; **INSERT** the employee themselves (`hr_employees.user_id = auth.uid()`); **UPDATE** `can_manage_employee`. No DELETE policy (audit trail; cascades with employee). |

### Reusable helpers (SECURITY DEFINER, `search_path = public, extensions`)

These are the headline reusable pieces — **HR-3 leave** and **HR-4 payroll** will
gate their own employee-scoped rows with the same two functions.

| Function | Returns | Logic |
|---|---|---|
| `can_view_employee(_employee_id)` | boolean | Caller **IS** that employee (`hr_employees.user_id = auth.uid()`) **OR** `is_hr_admin(employee's org)` **OR** caller is the employee's **manager** (the `manager_id` hr_employees row links to `auth.uid()`). |
| `can_manage_employee(_employee_id)` | boolean | `is_hr_admin(employee's org)` **OR** caller is the employee's **manager**. (No "self" — you manage reports, not yourself.) |

Both are SECURITY DEFINER so they read `hr_employees` with RLS bypassed — which is
exactly why the attendance/regularization policies that CALL them do **not**
recurse through `hr_employees`' RLS. Both granted `execute` to `authenticated`.

Plus an internal helper `hr_shift_break_minutes(_employee_id, _date)` — resolves
the break minutes from the latest `hr_employee_shifts` assignment effective on/
before a date (0 if none); used to compute `work_minutes`.

### RPCs (SECURITY DEFINER, `search_path = public, extensions`, granted to `authenticated`)

| RPC | Returns | Behavior |
|---|---|---|
| `clock_in()` | uuid | Resolves the caller's `hr_employees` row (any org, `limit 1`); raises `no employee record` if none. **Upserts** today's `hr_attendance` on `UNIQUE(employee_id, date)`: sets `clock_in = now()` only if not already set (`coalesce`), `status='present'`, `source='web'`. Returns the attendance id. |
| `clock_out()` | uuid | Finds today's row (`for update`); raises if no `clock_in`. Sets `clock_out = now()`, `work_minutes = greatest(0, round((out-in)/60) − resolvable shift break)`. Returns the id. |
| `request_regularization(p_date, p_in, p_out, p_reason)` | uuid | Inserts a **pending** regularization for the caller's own employee. |
| `decide_regularization(p_id, p_approve, p_note)` | void | Caller must `can_manage_employee(the request's employee)` (else raises). Sets status approved/rejected, `approver_id = auth.uid()`, `decided_at = now()`, appends the note. On **approve**, upserts `hr_attendance` for that employee+date with the requested in/out, `status='present'`, `source='regularized'`, `work_minutes` computed. |

### Trigger

`set_hr_attendance_updated_at()` (BEFORE UPDATE on `hr_attendance`) bumps
`updated_at` — mirrors HR-1's `set_hr_employee_updated_at`.

## The denormalized `org_id` pattern (key design decision)

Every **employee-scoped** table (`hr_employee_shifts`, `hr_attendance`,
`hr_attendance_regularizations`) carries its own `org_id` column (FK to
`organizations`, CASCADE) set on insert by the RPCs / HR-admin writes. This lets
the RLS policies call `is_hr_admin(org_id)` / `is_org_member(org_id)` **directly
off the row** rather than joining back through `hr_employees` to discover the org.
That avoids a recursive RLS evaluation (a policy on table X that joins to
`hr_employees`, whose own policy might re-enter) and keeps the predicates cheap.
The denormalized `org_id` always matches the employee's `org_id`; the RPCs read it
from the resolved `hr_employees` row so they cannot diverge.

## Self-service via SECURITY DEFINER RPCs

Own punches flow through `clock_in`/`clock_out`, which run as the definer (RLS
bypassed) but gate explicitly on `auth.uid()`. So the `hr_attendance`
INSERT/UPDATE RLS does not need to be the *only* guard — it stays at
`can_view_employee(employee_id)` (which already covers self, manager, and HR
admin) so HR admins / managers can also make **manual** corrections directly. The
regularization flow likewise: employees `request_regularization` (INSERT gated to
self), managers/HR-admins `decide_regularization` (UPDATE gated to
`can_manage_employee`, and the RPC re-checks it).

## Conventions followed (matches Phases 1-9 / HR-1)

- UUID PKs via `gen_random_uuid()` column DEFAULT (the fn lives in `extensions`);
  helper/RPC bodies that generate UUIDs or call helpers pin
  `search_path = public, extensions`. The trigger fn pins `search_path = public`.
- Every table: RLS enabled + policies + table grants to `authenticated`
  (`grant select,insert,update,delete`) and `grant all ... to service_role`, else
  queries fail with permission-denied before RLS runs.
- Drop-then-create policies, `create table if not exists`, `create index if not
  exists`, `create or replace` functions — re-runnable where practical.
- RPC style mirrors Phase-6 `start_timer`/`stop_timer`: `language plpgsql`,
  `security definer`, `auth.uid()` null-check, `raise exception` with a
  `fn_name: …` prefix, `on conflict` upserts, `for update` row locks.

## Test coverage (`hr2_rls.sql`)

Fixtures: Alice (owns org A, HR admin), Bob (member + **manager** of Carol), Carol
(member, managed by Bob; the self-service employee), Erin (member, **unrelated**
co-member), Dave (separate tenant org D). Runs under the real `handle_new_user`
trigger; ROLLS BACK.

- **(a)** `can_view_employee` / `can_manage_employee`: self TRUE; HR admin TRUE/
  TRUE; manager-of TRUE/TRUE; unrelated co-member FALSE/FALSE.
- **(b)** `hr_shifts` / `hr_holidays`: an org member reads; a non-HR-admin cannot
  write; an HR admin can.
- **(c)** `clock_in()` then `clock_out()` create today's attendance and compute
  `work_minutes` (asserts the row exists, both timestamps set, `work_minutes` not
  null and ≥ 0 — since the span uses `now()`).
- **(d)** attendance visible to self + HR admin, NOT to an unrelated co-member.
- **(e)** `request_regularization` by the employee + `decide_regularization` by an
  HR admin → approved, and a `source='regularized'`, `status='present'`
  attendance row is written with `work_minutes` computed.
- **(f)** a non-manager non-admin co-member (Erin) CANNOT decide a regularization
  (RPC raises; the request stays `pending`).

Prints `ALL HR-2 RLS TESTS PASSED` and ROLLS BACK.

## Deferrals (later work)

- **Geo / biometric capture** — no lat/long, IP, device, or biometric punch
  source. `source` enum has room (`'system'`) and could add `'geo'`/`'biometric'`.
- **Shift rotation / scheduling** — `hr_employee_shifts` is a flat
  effective-from assignment; no rotating rosters, weekly patterns, or
  shift-swap requests.
- **Overtime / late-grace / half-day rules** — `work_minutes` is a raw computed
  span minus break; no overtime thresholds, grace windows, or auto half-day/
  late-mark policy. `status` has the enum values (`half_day`, etc.) but nothing
  sets them automatically yet.
- **Auto weekend / holiday marking** — `working_days[]` and `hr_holidays` exist as
  data, but no job marks `status='weekend'/'holiday'` for non-working days. A
  later `pg_cron` job (cf. HR-3 leave accrual) can backfill day statuses.
- **Monthly attendance summaries / reports** — no rollup tables or report RPCs
  (HR-5 analytics concern), so payroll (HR-4) will aggregate `work_minutes`
  itself for now.

## Risks / notes

- **`clock_in`/`clock_out` pick one employee record per user** (`limit 1`, any
  org). HR-1 does not enforce ≤1 `hr_employees` per (org, user) or per user; if a
  user is an employee in multiple orgs, the punch lands on an arbitrary one. If
  multi-org employment is real, parameterize the RPCs by `org_id` (resolve via
  `current_employee_id(org_id)`) in a follow-up.
- **`hr_attendance` INSERT/UPDATE RLS is `can_view_employee`** — deliberately
  permissive so HR admins / managers can hand-correct rows. A self-employee can
  therefore also write their own raw `hr_attendance` directly (not only via the
  RPCs). The `UNIQUE(employee_id, date)` + WITH-CHECK mirror keep this bounded to
  their own row; tighten to `can_manage_employee OR (own + via-RPC marker)` if
  manual self-writes must be forbidden.
- **`work_minutes` ignores midnight-spanning shifts** — it is a plain
  `clock_out − clock_in` span. A night shift that crosses midnight is fine as long
  as both punches are timestamps (the date key is the clock-in day), but the
  status/weekend logic and any per-day rollup would need care. Not modeled.
- **No cycle/own-manager guard** (inherited from HR-1) — an employee could be set
  as their own manager, which would make `can_manage_employee` self-true. Org-chart
  integrity is an HR-5 concern.
- **`decide_regularization` overwrites an existing attendance row** for that day
  on approve (upsert `do update`), including clobbering a prior `web` punch's
  `clock_in`/`clock_out`. Intended (a regularization is the corrected truth), but
  the prior punch is not preserved as history.
- **Helper cost** — `can_view_employee` / `can_manage_employee` are STABLE
  SECURITY DEFINER with nested EXISTS (employee + manager lookups). Fine for the
  small per-employee result sets here; revisit if applied across very large
  attendance scans (e.g. an org-wide month export) — consider a manager-id index
  assist or a materialized membership.
