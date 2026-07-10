# HR-5 — Analytics + Onboarding (notes)

Migration: `supabase/migrations/20261005000000_hr5_analytics.sql`
Test:      `supabase/tests/hr5_rls.sql`

The fifth and final slice of the HR module. Builds on Phase 1
(identity/tenancy + `is_org_member`), HR-1 (`hr_employees` / `hr_departments` +
`is_hr_admin` / `current_employee_id`), HR-2 (`can_view_employee` /
`can_manage_employee` + `hr_attendance`), HR-3 (`hr_leave_requests` +
`count_working_days`) and HR-4 (`hr_payroll_runs`). Nothing here re-creates an
existing object — it **reuses** the established helpers and tables.

**Reused (not recreated):** `is_org_member(org_id)` [Phase 1],
`is_hr_admin(org_id)` / `current_employee_id(org_id)` [HR-1],
`can_view_employee(_employee_id)` / `can_manage_employee(_employee_id)` [HR-2],
plus the `hr_employees` / `hr_departments` / `hr_attendance` /
`hr_leave_requests` / `hr_payroll_runs` tables.

## What I built

### One pre-existing-constraint amendment

HR-1 shipped `hr_employees_status_check` allowing only
`('active','probation','on_notice','resigned','terminated')`. The HR module (and
this slice's headcount / `by_status` logic) treats **`on_leave`** as a valid
directory status (an employee currently on leave is still on the rolls). Section 0
drops and re-adds the CHECK to widen the allowed set — re-runnable, no data
migration (only widens).

### Table: `hr_onboarding_tasks`

A single checklist item for an employee's onboarding (joining) or offboarding
(exit).

| Column | Notes |
|--------|-------|
| `id` | uuid PK, `gen_random_uuid()` default |
| `org_id` | -> `organizations` CASCADE. **Denormalized** for simple RLS. |
| `employee_id` | -> `hr_employees` CASCADE |
| `kind` | `text default 'onboarding'`, CHECK `in ('onboarding','offboarding')` |
| `title` | `text not null` (<= 300 chars) |
| `status` | `text default 'pending'`, CHECK `in ('pending','in_progress','done')` |
| `due_date` | `date` nullable |
| `assignee_id` | -> `users` **SET NULL** (the app user who owns the item) |
| `sort_order` | `int default 0` — orders the list |
| `created_at` | `timestamptz default current_timestamp` |
| `completed_at` | `timestamptz` — stamped by the UI when `status` flips to `done` |

`org_id` is denormalized onto every row (same decision made in HR-2/HR-3/HR-4) so
the RLS policies call `is_hr_admin(org_id)` / `can_view_employee(employee_id)` /
`can_manage_employee(employee_id)` **without recursing** through `hr_employees`'
RLS.

**RLS (policies target `authenticated`; service_role bypasses):**
- SELECT: `can_view_employee(employee_id)` (self / HR admin / the employee's manager).
- INSERT / UPDATE / DELETE: `is_hr_admin(org_id) OR can_manage_employee(employee_id)`.
- UPDATE's `with check` mirrors `using` so a row cannot be re-pointed to escape the policy.

Indexes: `org_id`, `employee_id`, `(employee_id, kind)` (the idempotency lookup),
`assignee_id`. Table grants to `authenticated` + `service_role`.

### Function: `seed_onboarding_checklist(p_employee_id uuid, p_kind text default 'onboarding') -> integer`

SECURITY DEFINER, `search_path = public, extensions`. **Gate:** caller must
`can_manage_employee(p_employee_id)` (HR admin of the employee's org OR the
employee's manager); else raises. Resolves the org from the employee row (definer
=> RLS bypassed). **Idempotent:** if any task of that `kind` already exists for the
employee it inserts nothing and returns `0`. Inserts the default checklist with an
incrementing `sort_order` and returns the count inserted.

**Default checklists (verbatim titles):**
- `onboarding` (7): Sign offer letter · Complete paperwork · Set up workstation &
  accounts · Add to payroll · Assign onboarding buddy · Day-1 orientation ·
  30-day check-in.
- `offboarding` (5): Knowledge transfer · Revoke system access · Collect company
  assets · Final payroll settlement · Exit interview.

### Function: `hr_org_analytics(p_org_id uuid) -> jsonb`

SECURITY DEFINER, `stable`, `search_path = public, extensions`. **Gate:** caller
must `is_org_member(p_org_id)`; else raises. Runs as definer so the aggregates read
across `hr_employees` / `hr_attendance` / `hr_leave_requests` / `hr_payroll_runs`
with RLS bypassed — the org-member gate is the access boundary. Returns **one**
jsonb object assembled with `jsonb_build_object` + `coalesce(..., '[]'::jsonb)`;
each sub-aggregate is built with a CTE/subquery.

**Returned fields (15):**

| Field | Definition |
|-------|-----------|
| `headcount` | count of employees with status in `('active','probation','on_notice','on_leave')` — i.e. everyone still on the rolls. |
| `total_employees` | count of all employees in the org. |
| `by_department` | `[{name, count}]`, active-ish employees grouped by department name (`'Unassigned'` for null dept), ordered count desc. |
| `by_status` | `[{status, count}]` over **all** employees, count desc. |
| `by_type` | `[{type, count}]` over `employment_type` (all employees), count desc. |
| `by_location` | `[{location, count}]` over `work_location` (`'Unspecified'` for null/blank), count desc. |
| `on_probation` | count of status = `'probation'`. |
| `new_joiners_30d` | count where `date_of_joining` in `[today-30, today]`. |
| `exits_30d` | **PROXY** — count currently in a terminal status `('terminated','resigned')` (see below). |
| `present_today` | count of **distinct** employees with a `hr_attendance` row today in status `('present','wfh')`. |
| `attendance_rate_month` | `round( present-ish / total-marked * 100, 1)` over this calendar month, where present-ish = `('present','wfh','half_day')` and total-marked = those + `('absent','leave')`. `nullif(...,0)` -> `null` for an unmarked month. |
| `leave_pending` | count of `hr_leave_requests` in the org with status = `'pending'`. |
| `payroll_last` | the most-recent `hr_payroll_runs` row (by year, month, then `run_at`) as `{period_month, period_year, total_net, employee_count, status}`, or `null`. |
| `upcoming_birthdays` | `[{full_name, date_of_birth, day}]`, birthday (month/day) in the next 30 days inclusive, ordered by upcoming day, cap 10. |
| `upcoming_anniversaries` | `[{full_name, date_of_joining, years, day}]`, work anniversary in the next 30 days, `years` = completed tenure on the upcoming anniversary, excludes brand-new (`years >= 1`), ordered by upcoming day, cap 10. |

### Birthday / anniversary window — the across-the-year-boundary approach

For each candidate the **next occurrence** of its `(month, day)` is computed as the
date in the **current year** if that is still `>= today`, otherwise the same
`(month, day)` in the **next year**:

```
next_occ =
  CASE WHEN make_date(year(today),   month(d), day(d)) >= today
       THEN make_date(year(today),   month(d), day(d))
       ELSE make_date(year(today)+1, month(d), day(d))
  END
```

A row qualifies when `next_occ BETWEEN today AND today + 30` (inclusive). This is
correct across December->January (a Jan 3 birthday viewed on Dec 28 lands on next
year's Jan 3, inside the window). For anniversaries, `years` =
`extract(year from age(next_occ, date_of_joining))` — the number of completed years
**on** that upcoming anniversary — and we keep only `years >= 1` to drop people who
just joined. Both lists are restricted to active-ish employees and capped at 10,
ordered by `next_occ`.

**Leap-day note:** Feb-29 birthdays/anniversaries are **excluded** from the two
lists, because `make_date(non_leap_year, 2, 29)` errors. This is a deliberate,
documented simplification (see deferrals) rather than a special-cased Feb-28/Mar-1
fallback — it affects a vanishing fraction of rows and never produces a wrong/abort
result.

### `exits_30d` proxy — why

`hr_employees` has no `exit_date` / termination-date column, so a true "left in the
last 30 days" count is not derivable from the current schema. `exits_30d` is
therefore a **point-in-time** count of rows **currently** in a terminal status
(`resigned` / `terminated`) — read it as "people who have left", not "left in the
last 30 days". A faithful trailing-30-day attrition figure needs the deferred
status-history / exit-date work below.

## RLS test (`supabase/tests/hr5_rls.sql`)

Transaction-wrapped (ROLLBACK), no pgTAP, runs with the `handle_new_user` trigger
(postgres is not superuser here). Seeds three auth users -> Alice OWNS org A
(implicit HR admin); Bob is an `active` Engineering employee with a birthday and a
2-year joining anniversary both 5 days out (built relative to `current_date`); Erin
is an unrelated `active` co-member with no department (-> `'Unassigned'`). Fixture
also seeds an `Engineering` department, a `Casual Leave` type, a `present`
attendance row for Bob today, a finalized payroll run (net 95000, 2 employees), and
a **self-service** pending leave request inserted **as Bob** (the
`hr_leave_requests` INSERT policy requires `employee = auth.uid()`).

- **(a)** `seed_onboarding_checklist`: Alice seeds Bob's list -> 7; a second call ->
  0 (idempotent); Erin (non-manager) cannot seed Bob's checklist.
- **(b)** onboarding-task RLS: Bob sees his own 7 tasks; Erin sees 0; Alice (HR
  admin) updates a task's `status` -> `done`.
- **(c)** `hr_org_analytics`: `headcount`=2, `total_employees`=2, `by_department`
  Engineering=1 / Unassigned=1, `leave_pending`=1, `present_today`>=1,
  `payroll_last` net=95000 / status=finalized, `upcoming_birthdays` and
  `upcoming_anniversaries` both include Bob (anniversary `years`=2); a brand-new
  non-member's call raises.

Prints `ALL HR-5 RLS TESTS PASSED`.

## Deferrals (out of scope for HR-5)

- **Attrition trend time-series** — a real trailing-30-day (and month-over-month)
  attrition rate. Needs a `status` history / `exit_date` column on `hr_employees`
  (or an `hr_employee_status_log`); `exits_30d` is a point-in-time proxy until then.
- **Configurable checklist templates** — onboarding/offboarding titles are hard-coded
  in `seed_onboarding_checklist`. A future `hr_checklist_templates` table would let
  each org define its own items, default assignees and due-date offsets.
- **Asset tracking** — "Collect company assets" / "Set up workstation" are bare
  checklist lines; an `hr_assets` table (laptop, badge, …) with assign/return state
  would make them actionable.
- **E-signature on offer letters** — "Sign offer letter" is a manual tick; no
  e-sign integration / signed-document capture.
- **Headcount forecasting** — projected headcount from open requisitions / planned
  joiners / notice-period exits. Not modeled.

## Risks / caveats

- **Definer aggregation is org-wide.** `hr_org_analytics` deliberately bypasses
  per-row RLS (it runs as definer and only gates on `is_org_member`). This is
  intentional for a dashboard, but means any org member sees org-level aggregates
  (counts, not individuals' salaries/PII — those tables aren't touched here). The
  birthday/anniversary lists DO expose names + dates org-wide; acceptable for a
  "celebrations" widget, but note it if PII policy tightens.
- **`make_date` + Feb-29** excluded (documented above).
- **`attendance_rate_month` can be `null`** (no marked days yet this month); the UI
  must treat null as "no data", not 0%.
- **Status amendment** widens `hr_employees_status_check`; any external code that
  enumerated the old 5-value set should add `on_leave`.
