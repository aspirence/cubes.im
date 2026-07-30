# HR-3 — Leave Management (notes)

Migration: `supabase/migrations/20261003000000_hr3_leave.sql`
Test:      `supabase/tests/hr3_rls.sql`

The third slice of the HR module. Builds directly on HR-1
(`20261001000000_hr1_core.sql`) and HR-2 (`20261002000000_hr2_attendance.sql`)
and on Phase 1 tenancy. Nothing here re-creates existing objects — it *reuses*
the established helpers and tables.

## What I built

### Tables (all `hr_` prefixed, snake_case, org-scoped, `org_id` denormalized)

| Table | Purpose | Key constraints |
|-------|---------|-----------------|
| `hr_leave_types` | Per-org catalog of leave kinds (paid?, annual quota, accrual cadence, carry-forward policy, UI color). | `UNIQUE(org_id, code)`; `accrual in ('annual','monthly')`; org CASCADE. |
| `hr_leave_balances` | Per `(employee, type, year)` ledger: `allotted / used / pending / carried_forward`. The canonical "how much leave is left" record. | `UNIQUE(employee_id, leave_type_id, year)`; employee + org + type CASCADE. |
| `hr_leave_requests` | An employee's leave application: range, computed `days`, lifecycle `status`, approver/note. | `status in ('pending','approved','rejected','cancelled')`; `CHECK to_date >= from_date`; approver_id → `users` `ON DELETE SET NULL`. |

`org_id` is denormalized onto **every** employee-scoped row so the RLS policies
can call `is_hr_admin(org_id)` / `can_view_employee(employee_id)` without
recursing back through `hr_employees` (the same decision made in HR-2).

**Reused (not recreated):** `is_org_member(org_id)` [Phase 1],
`is_hr_admin(org_id)` / `current_employee_id(org_id)` [HR-1],
`can_view_employee(_employee_id)` / `can_manage_employee(_employee_id)` [HR-2],
and the `hr_employees` / `hr_holidays` / `hr_attendance` tables.

### Functions (all `SECURITY DEFINER`, `search_path = public, extensions`)

- **`count_working_days(org, from, to) -> numeric`** — inclusive count of dates in
  the range that are neither Sat/Sun nor a non-optional org holiday. Pure/STABLE.
  Reusable (HR-4 payroll loss-of-pay will reuse it).
- **`apply_leave(type, from, to, reason) -> uuid`** — caller applies for leave;
  resolves the caller's `hr_employees` row **in the same org that owns the leave
  type**, computes `days`, auto-provisions this year's balance row (seeding
  `allotted` from the type's `annual_quota`), checks remaining headroom, inserts a
  `pending` request and **reserves** the days against `balance.pending`. Raises
  `insufficient balance` when over budget.
- **`decide_leave(request_id, approve, note) -> void`** — a manager/HR-admin of the
  request's employee (`can_manage_employee`) approves/rejects a *pending* request.
  Approve: `pending -= days`, `used += days`, status `approved`, and a `leave`
  `hr_attendance` row (`source = 'system'`) upserted for each working day. Reject:
  `pending -= days`, status `rejected`. Both stamp `approver_id`/`decided_at`.
- **`cancel_leave(request_id) -> void`** — the request's own employee cancels their
  *pending* request → status `cancelled`, `pending -= days`.
- **`accrue_monthly_leave() -> integer`** — the pg_cron entry point. For every
  still-employed employee × every monthly-accrual leave type in their org, credits
  `annual_quota / 12` to this year's `allotted` (provisioning the row if absent).
  Returns the number of balance rows touched.

The balances ledger is **only** written by these definer RPCs in the normal flow
(plus HR-admin manual corrections via RLS). `remaining = allotted +
carried_forward - used - pending`.

## Working-day / holiday handling

- A "working day" = Mon–Fri (`extract(isodow) < 6`, i.e. 1=Mon … 5=Fri) **and**
  not a **non-optional** holiday for that org in `hr_holidays`.
- `optional = true` holidays (floating/festival days) are intentionally **counted
  as working days** — they only reduce the count when mandatory. This matches the
  semantics of `hr_holidays.optional` introduced in HR-2.
- The same predicate is used in three places — `count_working_days`, the
  approve-leg attendance loop in `decide_leave`, and (implicitly) the day total on
  every request — so the count an employee sees, the balance reserved, and the
  attendance written all agree.
- Weekend definition is fixed (Sat/Sun). Per-employee shift `working_days[]` (HR-2)
  is **not** yet consulted by the leave engine — see deferrals.

## Accrual model

- `hr_leave_types.accrual` is `'annual'` or `'monthly'`.
- **Annual**: the full `annual_quota` lands in `allotted` the first time a balance
  row is created (lazily, on the employee's first `apply_leave` of the year).
- **Monthly**: `annual_quota / 12` is credited each month by
  `accrue_monthly_leave()`, scheduled via pg_cron on the **1st of each month at
  00:00** (`0 0 1 * *`). The cron registration is wrapped in a guarded
  `DO/EXCEPTION` block (mirrors the Phase 7 recurring-task job) so a missing
  pg_cron extension only emits a `NOTICE` and never aborts the migration. Run
  `select public.accrue_monthly_leave();` manually if pg_cron is unavailable.
- "Still-employed" for accrual = `status in ('active','probation','on_notice')`;
  `resigned` / `terminated` employees are excluded.

## RLS summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `hr_leave_types` | `is_org_member` | `is_hr_admin` | `is_hr_admin` | `is_hr_admin` |
| `hr_leave_balances` | `can_view_employee` | `is_hr_admin` | `is_hr_admin` | `is_hr_admin` |
| `hr_leave_requests` | `can_view_employee` | self (employee `user_id = auth.uid()`) | `can_manage_employee` **or** self | `is_hr_admin` |

All policies target `authenticated`; `service_role` bypasses RLS. Every table also
gets explicit `grant select,insert,update,delete … to authenticated` (table-level
access is checked *before* RLS — without the grant you get permission-denied) and
`grant all … to service_role`. Every function gets `grant execute … to
authenticated`. WITH CHECK mirrors USING on every update so a writer cannot
re-point `employee_id`/`org_id`. Balances are normally mutated by the definer
RPCs (which bypass RLS); the HR-admin write policies exist for manual corrections.

## Test coverage (`hr3_rls.sql`, transaction-wrapped, ROLLBACK)

Fixture mirrors HR-2: Alice (org owner = HR admin), Bob (manager), Carol
(self-service report, managed by Bob), Erin (unrelated co-member). Proves:
(a) leave-type read by an org member, write blocked for non-admin / allowed for
admin; (b) `count_working_days` 5→4 across a mid-week mandatory holiday, an
optional holiday left in, weekend = 0; (c) `apply_leave` → pending request,
`days = 5`, `balance.pending = 5`, and an over-balance apply rejected; (d) approve
→ `used = 5`, `pending = 0`, status approved, **5** `leave` attendance rows
written; (e) reject → pending released, status rejected; (f) self-`cancel_leave`
→ pending released, status cancelled; (g) balances/requests visible to self + HR
admin, invisible to an unrelated co-member. Ends with `ALL HR-3 RLS TESTS PASSED`.

## Deferred (out of scope for HR-3)

- **Half-day leave** — `days` is currently whole working days only. A future
  `half_day`/`portion` column (and a `0.5` day path) would feed the same ledger
  (`numeric` columns already allow fractional balances/accrual).
- **Comp-off / time-off-in-lieu** — earned-leave credits from holiday/weekend work
  are not modeled; would be a new `accrual` mode + a credit RPC.
- **Leave encashment** — converting unused balance to payroll is deferred to HR-4
  (payroll), which can reuse `count_working_days` and read `hr_leave_balances`.
- **Negative-balance / loss-of-pay policy** — `apply_leave` hard-blocks when over
  budget. There is no LOP path that lets the balance go negative and flags those
  days for a payroll deduction; that pairs naturally with HR-4.
- **Year-end carry-forward job** — `carry_forward` / `max_carry_forward` are
  **stored but not yet applied**. A future annual job would roll
  `min(remaining, max_carry_forward)` into next year's `carried_forward`. (A
  natural sibling to `accrue_monthly_leave`, scheduled on Jan 1.)
- **Per-employee shift working-days** — the engine uses a fixed Sat/Sun weekend,
  not each employee's `hr_employee_shifts.working_days[]` (HR-2). Wiring that in
  would make `count_working_days` shift-aware.
- **Approval workflow depth** — single-approver model (any manager/HR-admin of the
  employee). Multi-level / delegated approvals are not modeled.

## Risks / things to watch

- **Concurrency**: `apply_leave` `SELECT … FOR UPDATE`s the balance row before the
  headroom check, so two simultaneous applications can't both pass on the same
  remaining balance. `decide_leave` / `cancel_leave` likewise lock the request row
  (`FOR UPDATE`) first. The balance row is created via `ON CONFLICT DO NOTHING`,
  then locked, avoiding a lost-update on the seed.
- **Accrual idempotency**: `accrue_monthly_leave()` is **not** idempotent within a
  month — running it twice double-credits. The monthly cron cadence assumes one run
  per month. If you re-run the migration's DO block it won't duplicate the *job*
  (guarded by `jobname`), but a manual double-`select` of the function would
  double-credit.
- **Year boundary**: the request's year is derived from `from_date`; a leave range
  spanning Dec→Jan reserves/consumes against the `from_date` year's balance only.
  Acceptable for now; revisit if cross-year leave becomes common.
- **`days` trust**: `decide_leave` writes attendance for the freshly-recomputed
  working days of `[from,to]`, while the balance math uses the stored `days`. These
  agree as long as holidays in the range are not edited between apply and decide; a
  holiday added after `apply_leave` would make the attendance-row count differ from
  the reserved `days`. Low risk, noted for completeness.
