# HR-1 — Core HR (departments · designations · employees · documents)

Migration: `supabase/migrations/20261001000000_hr1_core.sql`
Test:      `supabase/tests/hr1_rls.sql` (transaction-wrapped, ROLLBACK at end)

The first slice of the HR module (see `docs/HR_PLAN.md`). It is
org-scoped, RLS-first, and reuses the existing `organizations → teams →
team_members → users` model. No UI or API yet — this is the DB + RLS-test step.

## What this phase builds

A new HR-Admin role, the core HR directory (departments, designations,
employees), per-employee document storage, and the helpers + RLS that gate them.

### Tables (all `hr_` prefixed, org-scoped)

| Table | Purpose | Key columns | RLS summary |
|---|---|---|---|
| `hr_admins` | Designates a user as HR Admin for an org | `org_id`→organizations CASCADE, `user_id`→users CASCADE, `created_at`; **UNIQUE(org_id, user_id)** | **SELECT** `is_org_member(org_id)`; **INSERT/DELETE** `is_hr_admin(org_id)` (org owner or an existing HR admin may designate others). No UPDATE. |
| `hr_departments` | Org departments | `org_id`→organizations CASCADE, `name` NOT NULL, `head_user_id`→users SET NULL (nullable) | **SELECT** `is_org_member`; **INSERT/UPDATE/DELETE** `is_hr_admin`. |
| `hr_designations` | Job titles + seniority | `org_id`→organizations CASCADE, `title` NOT NULL, `level` int default 0 | **SELECT** `is_org_member`; **INSERT/UPDATE/DELETE** `is_hr_admin`. |
| `hr_employees` | The HR profile | `org_id` CASCADE, `user_id`→users SET NULL **(nullable — record-only)**, `employee_code`, `full_name` NOT NULL, `work_email` citext, `department_id`/`designation_id`→hr_* SET NULL, `manager_id`→hr_employees SET NULL (self-ref), `employment_type` (full_time\|part_time\|contract\|intern), `status` (active\|probation\|on_notice\|resigned\|terminated), `date_of_joining`, `date_of_birth`, `gender`, `personal_email` citext, `phone`, `address`, `emergency_contact`, `work_location`, `probation_end`, `created_at`, `updated_at`; **UNIQUE(org_id, employee_code)** | **SELECT** `is_org_member` (directory is org-wide visible); **INSERT/DELETE** `is_hr_admin`; **UPDATE** `is_hr_admin(org_id) OR user_id = auth.uid()` (self may edit own profile). |
| `hr_documents` | Per-employee files | `employee_id`→hr_employees CASCADE, `org_id`→organizations CASCADE, `doc_type`, `name` NOT NULL, `storage_path` NOT NULL, `uploaded_by`→users SET NULL, `created_at` | **SELECT** `is_hr_admin(org_id)` OR the owning employee (`hr_employees.user_id = auth.uid()`); **INSERT/DELETE** `is_hr_admin`. No UPDATE (immutable; replace = delete + insert). |

### Helper functions (SECURITY DEFINER, `search_path = public, extensions`)

| Function | Returns | Logic |
|---|---|---|
| `is_hr_admin(_org_id uuid)` | boolean | TRUE if the caller OWNS the org (`organizations.user_id = auth.uid()`) **OR** has a row in `hr_admins` for `(_org_id, auth.uid())`. SECURITY DEFINER so it reads `hr_admins` with RLS bypassed — which is exactly why the `hr_admins` policies that CALL it do **not** recurse. Mirrors the Phase-8 `is_org_admin` shape (owner-or-flagged), but the flag is an `hr_admins` row, not team-admin status. |
| `current_employee_id(_org_id uuid)` | uuid | The caller's `hr_employees.id` in that org (linked via `user_id`), or NULL. Convenience for self-service UI ("my profile / my documents"). |

Both are granted `execute` to `authenticated`.

### Trigger

`set_hr_employee_updated_at()` (BEFORE UPDATE on `hr_employees`) bumps
`updated_at` — mirrors Phase 4's `set_task_updated_at`.

## The record-only-employee model (decision: HR_PLAN §7.3)

`hr_employees.user_id` is **NULLABLE**, and `full_name` + `work_email` live **on
the row**. So an employee can be onboarded as a pure HR record with no app login
(e.g. a contractor or a not-yet-invited hire) and is fully usable from the on-row
fields. When that person later gets an app account, set `user_id` to link them —
self-service (own-profile UPDATE, own-document SELECT) then activates because the
RLS predicates key off `hr_employees.user_id = auth.uid()`. On user delete the FK
is `SET NULL`, so the HR record survives the account going away.

## HR Admin model (decision: HR_PLAN §7.2)

HR Admin is a **dedicated, assignable** role via the `hr_admins` table — **not**
every org/team admin. The Phase-8 `is_org_admin` (org owner or any team admin) is
intentionally **not** reused as the HR gate; HR access is narrower and explicit.
The org **owner** is always an implicit HR Admin (so a fresh org can bootstrap its
first `hr_admins` rows). Designating an HR admin is itself an HR-admin power
(`hr_admins` INSERT is gated by `is_hr_admin`).

## Storage — `hr-docs` bucket + path convention

- Private bucket `hr-docs` (created `on conflict do nothing`; served via signed
  URLs / RLS-checked downloads).
- **Path convention:** `<org_id>/<employee_id>/<file>`. The **first** path
  segment is the `org_id`, so `(storage.foldername(name))[1]` resolves to it.
- `storage.objects` policies (drop-then-create → re-runnable):
  - **SELECT** — `is_org_member(<org_id from path>)` (directory-style read; the
    `hr_documents` row RLS still narrows which DB rows a non-admin actually sees).
  - **INSERT / UPDATE / DELETE** — `is_hr_admin(<org_id from path>)`.
- The DB row's `storage_path` should match this convention so the bucket policy
  and the row policy agree.

## Conventions followed (matches Phases 1-8)

- UUID PKs via `extensions.gen_random_uuid()` column DEFAULT; `citext` columns
  declared plainly and rely on the implicit assignment cast (no explicit
  `::citext` anywhere). Helper fns pin `search_path = public, extensions`.
- Every table: RLS enabled + policies + table grants to `authenticated`
  (`grant ... to authenticated`) and `grant all ... to service_role`, else
  queries fail with permission-denied before RLS runs.
- Drop-then-create policies, `create ... if not exists`, `create or replace`
  functions — re-runnable where practical.

## Test coverage (`hr1_rls.sql`)

Fixtures: Alice (owns org A), Bob + Carol (non-admin members of Alice's team),
Dave (separate tenant org D). Runs under the real `handle_new_user` trigger.

- **(a)** `is_hr_admin`: owner (Alice) TRUE; a user added to `hr_admins` (Bob)
  TRUE; an unrelated user (Dave) FALSE; a non-admin member cannot self-designate.
- **(b)** depts/designations: an org member (Carol) can READ; a non-HR-admin
  member CANNOT insert; an HR admin (Alice) CAN.
- **(c)** `hr_employees`: org members see the directory, cross-org (Dave)
  invisible; HR admin creates BOTH a user-linked AND a record-only (user_id NULL)
  employee; a linked employee (Carol) UPDATEs her OWN row but not another's.
- **(d)** `hr_documents`: visible to the HR admin + the owning employee only; a
  non-owning, non-admin org member sees none.

Prints `ALL HR-1 RLS TESTS PASSED` and ROLLS BACK.

## Deferrals (later HR phases — see HR_PLAN.md)

- **HR-2 Attendance** — shifts, attendance, regularizations, holidays + clock-in.
- **HR-3 Leave** — leave types/balances/requests, accrual/deduct fns, `pg_cron`.
- **HR-4 Payroll** — salary structures/components, payroll runs, payslips (PDF),
  reimbursements, loans, bank details.
- **HR-5 Analytics & polish** — HR reports, org chart, onboarding/offboarding,
  birthdays/anniversaries, demo HR seed data.
- Also deferred here: an `apply_*`/onboarding RPC, manager-scoped policies
  (HR_PLAN §1 "Manager" persona — direct-report visibility), and a unique index
  on `hr_employees(org_id, user_id)` if a user must map to ≤1 employee per org.

## Risks / notes

- **`employee_code` uniqueness vs NULLs.** `UNIQUE(org_id, employee_code)` allows
  multiple NULL codes per org (Postgres treats NULLs as distinct in a UNIQUE
  constraint), which is intended (record-only rows may have no code). Two rows
  with the *same non-null* code in one org are rejected.
- **No DB guard that one user maps to ≤1 employee per org.** Not enforced yet; if
  required, add `create unique index ... on hr_employees(org_id, user_id) where
  user_id is not null`. `current_employee_id` uses `limit 1` defensively.
- **Storage SELECT is org-wide** (`is_org_member` on the path's org). Any org
  member who can guess/enumerate an object path could read it via the bucket,
  even though the `hr_documents` *row* is admin/owner-only. If document **bytes**
  must be as tightly scoped as the rows, tighten the bucket SELECT policy to
  `is_hr_admin(org) OR <path's employee_id maps to auth.uid()>` in a follow-up.
- **`is_hr_admin` is not cheap to call per-row.** It is STABLE and SECURITY
  DEFINER (two EXISTS lookups). Fine for the small HR tables here; revisit if a
  policy applies it across very large result sets.
- **manager_id is a free self-reference.** No cycle prevention (an employee could
  be set as their own/each-other's manager). Org-chart integrity is an HR-5
  concern.
