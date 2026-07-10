# Attendance, Payroll, and Future App Integration Plan

## Objective

Turn the current HR attendance module into a reusable platform inside Cubes:

- attendance should be captured in a clean, auditable way
- payroll should consume a frozen attendance snapshot, not live mutable rows
- future apps should integrate through stable RPCs and projections, not raw table writes
- policy logic should stay configurable per org and not be hardcoded into UI flows

This document is based on the current implementation in:

- `supabase/migrations/20261002000000_hr2_attendance.sql`
- `supabase/migrations/20261003000000_hr3_leave.sql`
- `supabase/migrations/20261004000000_hr4_payroll.sql`
- `src/features/hr/use-attendance.ts`
- `src/features/hr/use-payroll.ts`
- `src/app/(app)/hr/attendance/page.tsx`

## Current State in This Repo

### What exists today

Attendance currently has:

- `hr_shifts`
- `hr_employee_shifts`
- `hr_holidays`
- `hr_attendance`
- `hr_attendance_regularizations`

Payroll currently has:

- `hr_salary_structures`
- `hr_salary_components`
- `hr_payroll_runs`
- `hr_payslips`
- `hr_reimbursements`
- `hr_loans_advances`
- `hr_bank_details`

Working flows already present:

- employee self clock in
- employee self clock out
- monthly self attendance view
- regularization request and approval
- leave approval writes `hr_attendance` rows with `status = 'leave'`
- payroll run generates payslips from salary structure plus `absent` day count

### What is good in the current design

- org-scoped HR data model
- RLS-first implementation
- salary structure is versioned
- leave and holidays are already first-class concepts
- payroll output is snapshotted into payslips
- the project availability pattern already exists through narrow RPCs

### What is weak or missing

The current model is enough for MVP attendance, but not enough as a reusable platform.

1. `clock_in()` and `clock_out()` resolve the first employee row for `auth.uid()` and do not take an explicit org. That is fragile for multi-org users.
2. `hr_attendance` is a single daily row, not an event ledger. It cannot properly model multiple punches, breaks, kiosk imports, mobile punches, or biometric/device sync.
3. There is no clean separation between raw input, approved correction, daily summary, and payroll interpretation.
4. Payroll reads live attendance data. Re-running payroll after an attendance edit changes historical output.
5. `compute_payslip()` only deducts for `absent`. It does not treat half-day, unpaid leave, paid leave, late penalties, overtime, comp-off, or shift-specific rules.
6. Leave has `paid` semantics in `hr_leave_types`, but payroll does not consume that meaning directly.
7. There is no period close / lock step before payroll.
8. There is no stable integration contract for future apps beyond direct table access or custom RPCs.
9. There is no generic audit/event stream for attendance changes.

## Design Principles

1. Attendance capture and attendance result are different things.
2. Payroll should read frozen inputs, not raw mutable attendance rows.
3. Every write path should be auditable.
4. Future apps should integrate through service contracts, not table coupling.
5. Policy should be org-configurable and effective-dated.
6. RLS should continue to protect tenant data, but app integrations should use narrow `SECURITY DEFINER` RPCs for approved projections.

## Target Architecture

Build attendance as five layers.

### 1. Policy layer

Defines what "present", "late", "half day", "overtime", and "loss of pay" mean for an org.

Recommended additions:

- `hr_attendance_policies`
  - `org_id`
  - `name`
  - `effective_from`
  - `grace_in_minutes`
  - `grace_out_minutes`
  - `half_day_threshold_minutes`
  - `full_day_threshold_minutes`
  - `overtime_after_minutes`
  - `count_weekends_as_working`
  - `count_optional_holidays_as_working`
  - `late_penalty_mode`
  - `late_penalty_config jsonb`
  - `payroll_rounding_config jsonb`

- `hr_shift_day_overrides`
  - date-level override for a specific employee
  - use this for shift swaps, special working Saturdays, exceptions

Keep `hr_shifts` and `hr_employee_shifts`, but make them policy inputs instead of the final attendance truth.

### 2. Capture layer

Stores what actually happened.

Recommended additions:

- `hr_attendance_events`
  - `id`
  - `employee_id`
  - `org_id`
  - `event_type` (`clock_in`, `clock_out`, `break_start`, `break_end`, `manual_mark`, `device_import`)
  - `occurred_at`
  - `source` (`web`, `mobile`, `kiosk`, `api`, `device`, `regularization`, `system`)
  - `source_app`
  - `external_ref`
  - `context jsonb`
  - `location jsonb`
  - `device_metadata jsonb`
  - `created_by`
  - `superseded_by_event_id`

Why this matters:

- multiple punches become possible
- break tracking becomes explicit
- future apps can submit attendance events without corrupting daily summaries
- every correction can preserve the original event trail

### 3. Daily derived layer

Stores the final daily interpretation for one employee on one date.

Recommended additions:

- `hr_attendance_days`
  - `employee_id`
  - `org_id`
  - `date`
  - `shift_id`
  - `policy_id`
  - `status`
  - `scheduled_minutes`
  - `worked_minutes`
  - `break_minutes`
  - `late_minutes`
  - `early_exit_minutes`
  - `overtime_minutes`
  - `paid_day_fraction`
  - `unpaid_day_fraction`
  - `is_holiday`
  - `is_weekend`
  - `leave_request_id`
  - `approval_state`
  - `derived_from`
  - `source_of_truth`
  - `notes`
  - `finalized_at`
  - `updated_at`

This becomes the canonical row that attendance UI reads.

`hr_attendance` should become a compatibility layer during migration:

- either keep it as a v1 summary mirror
- or replace it later with a view over `hr_attendance_days`

### 4. Adjustment and approval layer

Stores human decisions separately from machine-derived output.

Recommended additions:

- `hr_attendance_adjustments`
  - `employee_id`
  - `org_id`
  - `date`
  - `adjustment_type` (`regularization`, `manual_override`, `payroll_override`, `shift_override`)
  - `requested_payload jsonb`
  - `approved_payload jsonb`
  - `status`
  - `reason`
  - `requested_by`
  - `approved_by`
  - `decided_at`

Current `hr_attendance_regularizations` can be folded into this model later, but do not break the current table immediately. Migrate in phases.

### 5. Payroll input layer

Freezes what payroll should pay for.

Recommended additions:

- `hr_payroll_periods`
  - `org_id`
  - `period_month`
  - `period_year`
  - `attendance_cutoff_at`
  - `status` (`open`, `review`, `locked`, `processed`, `paid`)

- `hr_payroll_attendance_inputs`
  - `payroll_period_id`
  - `employee_id`
  - `org_id`
  - `working_days`
  - `paid_days`
  - `unpaid_days`
  - `present_days`
  - `wfh_days`
  - `leave_paid_days`
  - `leave_unpaid_days`
  - `half_days`
  - `absent_days`
  - `late_minutes`
  - `overtime_minutes`
  - `lop_days`
  - `input_breakdown jsonb`
  - `derived_at`
  - `locked_at`

This is the missing bridge between attendance and payroll.

## How Attendance Should Be Added

Attendance data should enter the system through a small number of canonical write paths.

### A. Self-service punch flow

Used by web, mobile, kiosk, or a future attendance app.

Required RPCs:

- `attendance_clock_in(p_org_id uuid, p_source text default 'web', p_context jsonb default '{}'::jsonb)`
- `attendance_clock_out(p_org_id uuid, p_source text default 'web', p_context jsonb default '{}'::jsonb)`
- `attendance_start_break(...)`
- `attendance_end_break(...)`

Behavior:

1. validate active employee in the same org
2. write an event row to `hr_attendance_events`
3. rebuild that employee's `hr_attendance_days` row for the date
4. emit a domain event for downstream consumers

### B. Manager / HR manual attendance

Used when someone was present but missed punching, or when payroll cutoff cleanup is needed.

Required RPCs:

- `attendance_mark_day(p_org_id, p_employee_id, p_date, p_status, p_payload jsonb)`
- `attendance_bulk_mark_days(...)`

Behavior:

- writes an adjustment record
- writes synthetic manual events only when needed
- recomputes the daily row
- preserves who changed what and why

### C. Regularization flow

Current regularization concept is correct, but it should update the adjustment layer instead of writing directly to the daily row as the only audit record.

Required RPCs:

- `attendance_request_adjustment(...)`
- `attendance_decide_adjustment(...)`

### D. Leave / holiday / weekend system flow

Attendance should not rely only on punch data.

System-derived attendance days must also be created from:

- approved leave
- org holidays
- policy-defined weekends
- shift-day overrides

The system should run a deterministic builder:

- `attendance_rebuild_day(employee_id, date)`
- `attendance_rebuild_range(org_id, from_date, to_date, employee_id default null)`

### E. Imports and external devices

Future apps or hardware integrations should not insert raw rows into attendance tables.

Required ingest flow:

- `attendance_import_events(p_org_id, p_source_app, p_events jsonb)`

Rules:

- each imported item carries `external_ref`
- imports are idempotent
- invalid items are rejected with line-level results
- imported events rebuild affected attendance days

## How Payroll Should Connect to Attendance

Payroll should consume a normalized, frozen attendance contract.

### Current gap

Today:

- leave approval writes `status = 'leave'`
- payroll only counts `status = 'absent'` as LOP

This means paid leave, unpaid leave, half-day, and attendance penalties are not modeled properly for payroll.

### Target payroll attendance contract

For each employee-period, payroll should receive:

- total working days
- present days
- paid leave days
- unpaid leave days
- half days
- absent days
- payable day fraction
- loss of pay day fraction
- overtime minutes or overtime payable units
- late penalty units if the policy uses them

Recommended interpretation model:

| Attendance outcome | Paid day | Unpaid day | Notes |
|---|---:|---:|---|
| Present | 1.0 | 0.0 | default working day |
| WFH | 1.0 | 0.0 | payroll-equivalent to present unless policy differs |
| Paid leave | 1.0 | 0.0 | comes from leave type policy |
| Unpaid leave | 0.0 | 1.0 | must flow from leave type directly |
| Half day paid | 0.5 | 0.5 | or policy-specific split |
| Absent | 0.0 | 1.0 | default LOP |
| Holiday | policy | policy | usually not counted as working day |
| Weekend | policy | policy | depends on org rules |

### Payroll run flow

1. Attendance remains editable while the period is `open`.
2. Before payroll, HR moves the period to `review`.
3. The system builds `hr_payroll_attendance_inputs` from `hr_attendance_days`.
4. HR reviews exceptions and warnings.
5. The period is `locked`.
6. `run_payroll()` reads `hr_payroll_attendance_inputs`, not raw `hr_attendance`.
7. Payslips are generated.
8. Finalized runs cannot silently recalculate unless explicitly reopened.

### Required changes to payroll engine

`compute_payslip()` should stop deriving LOP directly from raw `hr_attendance.status = 'absent'`.

Instead, it should read:

- `paid_days`
- `lop_days`
- any overtime units
- any penalty units

from `hr_payroll_attendance_inputs`.

This gives three benefits:

1. payroll becomes deterministic
2. attendance policy can evolve without changing payslip math every time
3. retro edits do not mutate already-reviewed runs unless HR intentionally rebuilds the input snapshot

## Future App Integration Model

This is the part that makes attendance reusable across future Cubes apps.

### Rule 1: apps should not write directly to HR tables

Apps must use RPCs or service hooks. Otherwise every app will reimplement policy badly and break payroll trust.

### Rule 2: expose stable read models

Recommended read RPCs:

- `get_employee_attendance_day(p_employee_id, p_date)`
- `get_employee_attendance_month(p_employee_id, p_year, p_month)`
- `get_team_attendance_day(p_org_id, p_date)`
- `get_team_attendance_summary(p_org_id, p_from, p_to, p_filters jsonb default '{}'::jsonb)`
- `get_project_member_availability(...)`
- `get_team_member_availability(...)`
- `get_payroll_attendance_preview(p_org_id, p_month, p_year)`

These should return narrow projection payloads, not raw internal tables.

### Rule 3: standardize app-origin metadata

Every event or write path should be able to store:

- `source_app`
- `external_ref`
- `context_type`
- `context_id`
- `context jsonb`

Examples:

- a mobile app can submit a punch with geolocation
- a shift-planning app can create day overrides
- a workforce analytics app can read monthly attendance summaries
- a payroll app can preview unpaid-day impact before running payroll

### Rule 4: publish domain events

Recommended addition:

- `hr_domain_events`
  - `aggregate_type`
  - `aggregate_id`
  - `event_type`
  - `org_id`
  - `employee_id`
  - `payload jsonb`
  - `created_at`
  - `dispatched_at`

This does not need a message bus on day one. A persisted outbox table is enough.

Useful events:

- `attendance.event.recorded`
- `attendance.day.rebuilt`
- `attendance.adjustment.approved`
- `attendance.period.locked`
- `payroll.inputs.built`
- `payroll.run.finalized`

### Rule 5: app integration should happen at one of four levels

1. Read-only consumer
   - examples: dashboards, reports, project staffing
2. Context provider
   - examples: shift planner, calendar, roster app
3. Attendance source
   - examples: mobile punch app, kiosk, biometric bridge
4. Payroll consumer
   - examples: payroll preview, finance disbursement app

Each level should use a different approved contract instead of one shared raw-table interface.

## Security and Permissions

Keep the existing RLS philosophy.

### Attendance writes

- self punches: employee only for own active employee record in the selected org
- manual mark / bulk import / approvals: HR admin or configured manager scopes
- payroll input build / period lock: HR admin only

### Attendance reads

- self detail: own rows
- manager: direct reports or policy-approved scope
- HR admin: org-wide
- apps: RPC projection scope only

### Important hardening change

Replace org-implicit attendance RPCs with org-explicit RPCs.

Current:

- `clock_in()`
- `clock_out()`

Recommended:

- `attendance_clock_in(p_org_id uuid, ...)`
- `attendance_clock_out(p_org_id uuid, ...)`

This is a necessary fix before expanding attendance further.

## Migration Strategy From the Current Model

Do this without breaking the current HR screens immediately.

### Phase 0: harden current implementation

1. make punch RPCs org-explicit
2. add guard so finalized payroll runs cannot be silently rebuilt
3. define paid vs unpaid leave mapping for payroll
4. add admin manual attendance entry UI and RPC

### Phase 1: introduce the ledger and summary model

1. add `hr_attendance_events`
2. add `hr_attendance_days`
3. backfill one synthetic `clock_in` and `clock_out` event per existing `hr_attendance` row where possible
4. keep current UI reading `hr_attendance`, but rebuild it from the new daily row in parallel

### Phase 2: move regularization and corrections to the adjustment model

1. add `hr_attendance_adjustments`
2. migrate approvals to write adjustments plus event rebuilds
3. keep the old regularization table until the UI is cut over

### Phase 3: create payroll attendance snapshots

1. add `hr_payroll_periods`
2. add `hr_payroll_attendance_inputs`
3. update payroll preview to read snapshot rows
4. update `compute_payslip()` and `run_payroll()` to use the snapshot

### Phase 4: publish integration contracts

1. add summary RPCs
2. extend the capacity/availability RPC pattern to attendance
3. add `hr_domain_events` outbox

### Phase 5: advanced attendance

Optional later work:

- geo-fence
- kiosk mode
- biometric sync
- comp-off
- overtime approval
- attendance anomaly inbox
- statutory payroll deductions per country

## Recommended Data Contract for Leave to Payroll

This is the most important semantic fix.

`hr_leave_types` should eventually expose payroll meaning directly, not only `paid boolean`.

Recommended additions:

- `payroll_treatment`
  - `paid_leave`
  - `unpaid_leave`
  - `half_paid_leave`
  - `informational_only`

Then attendance-day builder should set:

- `paid_day_fraction`
- `unpaid_day_fraction`

based on leave type plus shift/day policy.

Payroll should never have to infer leave meaning from a plain text attendance status.

## Recommended First Implementation Slice in This Repo

If the goal is maximum value with minimum churn, do this first:

1. fix org ambiguity in attendance RPCs
2. add admin manual attendance mark flow
3. add `hr_payroll_periods`
4. add `hr_payroll_attendance_inputs`
5. teach payroll to consume snapshot rows
6. add paid vs unpaid leave mapping

That slice does not require a full mobile/device attendance platform yet, but it fixes the biggest business risk: payroll depending on weak attendance semantics.

## Final Recommendation

Treat attendance as a shared platform, not a screen-level feature.

The correct long-term split is:

- raw events for what happened
- derived day rows for operational attendance
- adjustments for approvals and overrides
- payroll inputs for money-impacting snapshots
- RPC projections and domain events for future apps

If Cubes follows this split, then any future app such as:

- a mobile attendance app
- a shift planning app
- a payroll app
- a workforce analytics app
- a project staffing / availability app

can integrate cleanly without bypassing HR policy or corrupting payroll calculations.
