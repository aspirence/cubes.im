# HR-4 — Payroll (notes)

Migration: `supabase/migrations/20261004000000_hr4_payroll.sql`
Test:      `supabase/tests/hr4_rls.sql`

The fourth slice of the HR module. Builds directly on HR-1
(`20261001000000_hr1_core.sql`), HR-2 (`20261002000000_hr2_attendance.sql`) and
HR-3 (`20261003000000_hr3_leave.sql`), and on Phase 1 tenancy. Nothing here
re-creates existing objects — it *reuses* the established helpers and tables.

**Design decision: payroll is GENERIC + an optional India preset.** The
computation engine knows nothing India-specific (any currency, any component
layout). `apply_india_salary_preset` is a convenience that just seeds a
conventional Indian breakdown of rows; everything downstream is currency- and
country-agnostic.

## What I built

### Tables (all `hr_` prefixed, snake_case, org-scoped, `org_id` denormalized)

| Table | Purpose | Key constraints |
|-------|---------|-----------------|
| `hr_salary_structures` | A versioned **annual** CTC record per employee. `effective_from` lets multiple structures coexist; the newest one whose `effective_from <= period end` drives that month's payslip. | `ctc >= 0`; employee + org CASCADE. |
| `hr_salary_components` | The line items of a structure: earnings/deductions, each a fixed monthly amount or a percent of CTC / of Basic. `is_basic` anchors percent-of-basic math. | `kind in ('earning','deduction')`; `calc in ('fixed','percent_of_ctc','percent_of_basic')`; structure + org + employee CASCADE. |
| `hr_payroll_runs` | One run per `(org, month, year)`; `draft -> finalized -> paid` lifecycle with rolled-up totals. | `UNIQUE(org_id, period_month, period_year)`; `period_month between 1 and 12`; `status in ('draft','finalized','paid')`; `run_by -> users SET NULL`. |
| `hr_payslips` | Per-employee output of a run: money totals + day counts + earnings/deductions snapshotted as `jsonb`. Created **only** by `run_payroll`. | `UNIQUE(payroll_run_id, employee_id)`; run + employee + org CASCADE. |
| `hr_reimbursements` | An employee expense claim with an approval lifecycle. Approved claims dated in a period are added to that month's payslip. | `status in ('pending','approved','rejected','paid')`; `amount >= 0`; `approver_id -> users SET NULL`. |
| `hr_loans_advances` | A loan/advance with a monthly EMI; active loans' EMIs are deducted from each payslip. | `status in ('active','closed')`; employee + org CASCADE. |
| `hr_bank_details` | One disbursement account per employee. | `UNIQUE(employee_id)`; employee + org CASCADE. |

`org_id` is denormalized onto **every** employee-scoped row (and `employee_id`
onto `hr_salary_components` / `hr_payslips`) so the RLS policies can call
`is_hr_admin(org_id)` / `can_view_employee(employee_id)` without recursing back
through `hr_employees` (the same decision made in HR-2/HR-3).

**Reused (not recreated):** `is_org_member(org_id)` [Phase 1],
`is_hr_admin(org_id)` / `current_employee_id(org_id)` [HR-1],
`can_view_employee(_employee_id)` / `can_manage_employee(_employee_id)` [HR-2],
`count_working_days(org, from, to)` [HR-3], and the `hr_employees` /
`hr_attendance` tables.

### Functions (all `SECURITY DEFINER`, `search_path = public, extensions`)

- **`apply_india_salary_preset(structure_id) -> void`** — HR-admin gated. Seeds the
  conventional Indian monthly split for a structure (see *India preset* below).
- **`compute_payslip(employee_id, month, year) -> jsonb`** — the internal computation
  helper. Returns `{gross, total_deductions, net, working_days, paid_days,
  lop_days, earnings, deductions}`. Returns all-zeros (empty arrays) when the
  employee has no applicable structure.
- **`run_payroll(org_id, month, year) -> uuid`** — HR-admin of `org_id` only.
  Upserts the draft run, wipes prior payslips for the run, inserts one payslip per
  active employee with an applicable structure (via `compute_payslip`), rolls up
  the run totals, returns the run id. **Idempotent** — re-running rebuilds.
- **`finalize_payroll_run(run_id) -> void`** — HR-admin gated; flips `status` to
  `'finalized'` (a lightweight lock; `'paid'` is a separate later transition).

> The signature is `run_payroll(p_org_id uuid, p_month int, p_year int)` (an
> explicit org parameter is cleaner than scanning for the caller's org), gated on
> `is_hr_admin(p_org_id)`.

## Payslip computation model

All component values are **monthly** (CTC is annual; `monthly_ctc = ctc / 12`).

1. **Resolve the structure** — the employee's latest `hr_salary_structures` row
   with `effective_from <= end-of-month`, newest first (`effective_from desc,
   created_at desc`). No structure -> zeroed payslip (and the employee is skipped
   by `run_payroll`).
2. **Resolve Basic first** — the `is_basic` component (else the first named like
   `basic`). `fixed -> value`; `percent_of_ctc -> value/100 * monthly_ctc`. This
   anchors `percent_of_basic`. (A `percent_of_basic` calc *on the basic row* is
   treated as 0 to avoid self-reference.)
3. **Evaluate every component** into a monthly amount (rounded to 2dp):
   - `fixed` -> `value`
   - `percent_of_ctc` -> `value/100 * monthly_ctc`
   - `percent_of_basic` -> `value/100 * basic_amount`
   Sum `kind='earning'` into `gross_base`, `kind='deduction'` into `ded_base`, and
   build the `earnings` / `deductions` jsonb arrays of `{name, amount}`.
4. **Day counts** — `working_days = count_working_days(org, month_start,
   month_end)` (skips weekends + non-optional holidays). `lop_days` = count of
   `hr_attendance` rows in the month with `status='absent'`. `paid_days =
   working_days - lop_days`.
5. **Loss of Pay** — `lop_deduction = round(gross_base/working_days * lop_days, 2)`
   when `working_days > 0`, else 0. Appended to `deductions` as
   `{name:'Loss of Pay', amount}` when `> 0`. (LOP is a *deduction line*, so
   `gross` is unchanged; only `net` falls.)
6. **Loan EMIs** — `sum(emi)` of `status='active'` loans, appended to `deductions`
   as `{name:'Loan EMI', amount}` when `> 0`.
7. **Reimbursements** — `sum(amount)` of `status='approved'` claims *dated within
   the month*, appended to `earnings` as `{name:'Reimbursements', amount}` when
   `> 0`.
8. **Totals** — `gross = gross_base + reimb`;
   `total_deductions = ded_base + lop_deduction + loan_emi`;
   `net = gross - total_deductions`.

**Worked example (the test's CTC 120000):** monthly_ctc 10000 -> Basic 4000 (40% of
CTC) + HRA 2000 (50% of Basic) + Special Allowance 4000 (fixed) = **gross 10000**;
PF 480 (12% of Basic) + Professional Tax 200 = **deductions 680**; **net 9320**.
With one absent day in a 22-working-day month, LOP = round(10000/22*1) = 454.55,
pushing net to 8865.45 (gross stays 10000).

## India preset (`apply_india_salary_preset`)

Given a structure with its annual CTC, inserts (approximate; HR can edit
afterwards):

| Name | Kind | Calc | Value | Notes |
|------|------|------|-------|-------|
| Basic | earning | `percent_of_ctc` | 40 | `is_basic` |
| HRA | earning | `percent_of_basic` | 50 | 50% of Basic |
| Special Allowance | earning | `fixed` | `monthly_ctc - basic - hra` | remainder so earnings ≈ monthly CTC |
| Provident Fund | deduction | `percent_of_basic` | 12 | |
| Professional Tax | deduction | `fixed` | 200 | flat |

It is documented as a **convenience seed, not a statutory engine** — no PF wage
ceiling, no EPS split, no TDS, no PT slabs.

## RLS summary (all policies target `authenticated`; `service_role` bypasses)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `hr_salary_structures` | `can_view_employee` | `is_hr_admin` | `is_hr_admin` | `is_hr_admin` |
| `hr_salary_components` | `can_view_employee` | `is_hr_admin` | `is_hr_admin` | `is_hr_admin` |
| `hr_payroll_runs` | `is_hr_admin` | `is_hr_admin` | `is_hr_admin` | `is_hr_admin` |
| `hr_payslips` | `can_view_employee` | *(none — `run_payroll` only)* | *(none)* | `is_hr_admin` |
| `hr_reimbursements` | `can_view_employee` | employee's own `user_id = auth.uid()` | `can_manage_employee` | `is_hr_admin` |
| `hr_loans_advances` | `can_view_employee` | `is_hr_admin` | `is_hr_admin` | `is_hr_admin` |
| `hr_bank_details` | `can_view_employee` | `is_hr_admin` OR own | `is_hr_admin` OR own | `is_hr_admin` |

`WITH CHECK` mirrors `USING` on every write so a writer cannot re-point
`employee_id`/`org_id` out from under RLS. Every table also gets
`grant select, insert, update, delete ... to authenticated` (+ `grant all ... to
service_role`); every RPC gets `grant execute ... to authenticated`.

## Test coverage (`supabase/tests/hr4_rls.sql`)

Transaction-wrapped (ROLLBACK), HR-3 pattern (works *with* the `handle_new_user`
trigger; assertions switch into `authenticated` + set `request.jwt.claims.sub`).
Fixtures: Alice (org owner / HR admin), Bob (manager), Carol (Bob's report; the
salaried subject), Erin (unrelated co-member; negative case).

- **(a)** salary structure + components: HR admin writes; the employee sees her
  OWN salary; a non-admin cannot write; an unrelated co-member cannot read.
- **(b)** `run_payroll` creates a run + one payslip per employee *with* a structure
  (Carol yes, Erin skipped), asserts **gross 10000 / deductions 680 / net 9320**
  and `net = gross - deductions`, run totals rolled up; a non-admin is blocked.
- **(c)** payslip visible to its employee + HR admin, NOT to an unrelated
  co-member; `finalize_payroll_run` -> `status = 'finalized'`.
- **(d)** reimbursement: the employee inserts a pending claim; the HR admin
  approves it (`status -> approved`); an unrelated insert is blocked.
- **(e)** bank details: the employee upserts her own account; the HR admin reads
  it; an unrelated co-member cannot.
- **(f)** LOP: one `absent` day -> `lop_days = 1`, a positive `Loss of Pay`
  deduction line, `paid_days = working_days - 1`, `gross` unchanged, `net` below
  the no-LOP baseline of 9320.

Prints `ALL HR-4 RLS TESTS PASSED`.

## Deferrals (explicitly out of scope for HR-4)

- **TDS / income-tax slab engine** — no withholding tax computation; deductions are
  only the configured components + LOP + loan EMI.
- **Statutory PF/ESI filing & exports** — the India preset seeds PF/PT *rows* but
  there is no PF wage ceiling, EPS split, ESI eligibility, or ECR/return file
  generation.
- **Payslip PDF rendering** — produced **app-side** from the jsonb breakdown, not
  in the DB.
- **Bank disbursement** — generating bank/NEFT/ACH files and reconciling payment is
  **external**; `hr_bank_details` just stores the account.
- **Loan amortization** — `hr_loans_advances` holds a flat EMI/balance; there is no
  amortization schedule and `balance` is not auto-decremented per run yet.
- **Multi-currency FX, arrears, and mid-month proration** beyond the LOP model
  (e.g. join/exit proration, salary revisions mid-month) are not modelled.
- **Reimbursement `paid` transition / payslip linkage** — approved reimbursements
  feed the month's payslip, but there is no automatic `approved -> paid` flip tied
  to a finalized run.

## Risks / caveats

- `run_payroll` is **idempotent** (deletes + rebuilds payslips for the period), so
  re-running a *finalized* run silently rebuilds its payslips. There is no guard
  preventing a re-run after finalize/paid — add a status check if that matters.
- `compute_payslip` reads **whatever attendance/reimbursement/loan rows exist at
  run time**; a run is a point-in-time snapshot, not a locked ledger. Re-running
  after data changes will produce different payslips.
- LOP uses `gross_base` (pre-reimbursement earnings) as the pro-ration base, which
  is the intended behaviour (reimbursements are not pro-rated by attendance).
- `numeric` is used throughout for money (no float rounding); amounts are rounded
  to 2dp at each component and at the totals.
- The `is_basic` resolution falls back to a name `ILIKE 'basic'` match; a structure
  with neither an `is_basic` flag nor a "Basic"-named component yields
  `basic_amount = 0`, so any `percent_of_basic` components resolve to 0.
