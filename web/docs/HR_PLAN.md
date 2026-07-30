# HR Module Plan (Attendance · Leave · Payroll · Core HR)

A dedicated **HR** section in cubes_local, built on the same stack (Next.js + Supabase, RLS-first) and reusing the existing `organizations → teams → team_members → users` model. Same delivery rhythm as the product phases: **DB → RLS test → UI → API E2E → commit**, one HR sub-phase at a time.

---

## 1. Who can do what (roles)
Three personas, enforced by RLS:
- **Employee (self-service)** — own profile, clock in/out, apply leave, view own payslips/attendance. RLS: `employee.user_id = auth.uid()`.
- **Manager** — view + approve their direct reports (`hr_employees.manager_id = auth.uid()`).
- **HR Admin** — manage everyone in the org. New helper `is_hr_admin(org_id)` = org owner OR a user flagged as HR (a small `hr_admins` table / role), reusing the Phase-8 `is_org_admin` pattern.

## 2. Data model (new `hr_*` tables, org-scoped, all RLS + grants)

**Core HR**
- `hr_departments` (org_id, name, head_user_id)
- `hr_designations` (org_id, title, level)
- `hr_employees` — the HR profile: `user_id`→users, `org_id`, employee_code, department_id, designation_id, `manager_id`→users, date_of_joining, employment_type (full_time/part_time/contract/intern), status (active/probation/on_notice/resigned/terminated), DOB, gender, personal_email, phone, address, emergency_contact, work_location, probation_end
- `hr_documents` — offer letters, IDs, contracts (Supabase Storage, private bucket)

**Attendance & Time**
- `hr_shifts` (name, start_time, end_time, break_minutes, working_days[])
- `hr_employee_shifts` (employee_id, shift_id, effective_from)
- `hr_holidays` (org_id, date, name, optional)
- `hr_attendance` (employee_id, date, clock_in, clock_out, status [present/absent/half_day/wfh/leave/holiday/weekend], work_minutes, source)
- `hr_attendance_regularizations` (employee_id, date, requested_in/out, reason, status, approver_id) — fix missed punches

**Leave**
- `hr_leave_types` (org_id, name, code, paid, annual_quota, accrual [annual/monthly], carry_forward, max_carry_forward, color)
- `hr_leave_balances` (employee_id, leave_type_id, year, allotted, used, pending, carried_forward)
- `hr_leave_requests` (employee_id, leave_type_id, from_date, to_date, days, reason, status [pending/approved/rejected/cancelled], approver_id, decided_at, note)
- Functions: `apply_leave` (computes working days excl. weekends/holidays, checks balance, sets pending), `decide_leave` (approve/reject → deduct balance + write attendance rows), monthly accrual via `pg_cron`.

**Payroll**
- `hr_salary_structures` (employee_id, effective_from, ctc, currency)
- `hr_salary_components` (structure_id, name, kind [earning/deduction], calc [fixed/percent_of_basic], value) — Basic, HRA, allowances, PF, Prof. Tax, TDS…
- `hr_payroll_runs` (org_id, month, year, status [draft/processing/finalized/paid], totals)
- `hr_payslips` (run_id, employee_id, gross, total_deductions, net, paid_days, lop_days, earnings jsonb, deductions jsonb, status, pdf_path)
- `hr_reimbursements` (employee_id, category, amount, date, status, receipt_path, approver_id)
- `hr_loans_advances` (employee_id, type, principal, emi, balance, status)
- `hr_bank_details` (employee_id, account_name, account_number, ifsc/routing, bank_name)
- Functions: `run_payroll(month, year)` → for each active employee compute payslip from salary structure + paid/LOP days (from attendance & approved leave) + reimbursements − deductions; `finalize_payroll_run`.

**Analytics** — RPCs: headcount by dept, attrition, attendance %, leave utilization, payroll cost (HR-admin gated).

## 3. The HR tab (sidebar → "HR", org-scoped, role-aware)
`HRLayout` with sub-nav (items shown by role):
- **Dashboard** — headcount, who's on leave today, attendance snapshot, pending approvals, birthdays/anniversaries
- **Employees** — directory (list/grid) + profile (Personal · Job · Documents · Salary tabs) + add/onboard + org chart
- **Attendance** — my clock in/out + calendar; team attendance (admin); regularizations; shifts; holidays
- **Leave** — my balances + apply + history; approvals (manager); leave types & policies (admin); holiday calendar
- **Payroll** — my payslips; payroll runs (admin: process + payslips); salary structures; reimbursements; loans
- **Reports** — headcount/attrition/attendance/payroll cost/leave utilization
- **Settings** — departments, designations, leave types, shifts, holidays, payroll components

## 4. Phasing (each: DB → RLS test → UI → E2E → commit)
| Phase | Scope |
|---|---|
| **HR-1 Core HR** | departments, designations, hr_employees, documents; **HR sidebar tab** + `is_hr_admin` gating; Employee directory + profile; HR Settings (depts/designations); dashboard shell |
| **HR-2 Attendance** | shifts, attendance, regularization, holidays; **clock in/out widget**, attendance calendar, team attendance, regularization approvals |
| **HR-3 Leave** | leave types/balances/requests + accrual/deduct functions (pg_cron); apply-leave, approvals, balances, holiday calendar |
| **HR-4 Payroll** | salary structures/components, payroll runs, payslips, reimbursements, loans, bank details; **run payroll**, payslip view + **PDF**, salary setup |
| **HR-5 Analytics & polish** | HR reports, org chart, onboarding/offboarding checklists, birthdays/anniversaries, demo HR seed data |

## 5. Cross-cutting
- **Reuse** users/orgs/team_members; `hr_employees` links a user to HR data. Onboarding can invite a user → create their `hr_employees` row.
- **Storage**: private `hr-docs` bucket (RLS: own docs + HR admin); payslip PDFs.
- **Realtime**: attendance punches + approval status live.
- **Currency/locale**: org-level currency; number/date formatting.
- **Payslip PDF**: client-side (jsPDF/react-pdf) for MVP; Edge Function later if needed.
- **Demo data**: extend the existing demo org (Acme Inc, 5 members) with HR profiles, shifts, leave balances, a sample payroll run.

## 6. Out of scope / external (flagged)
- **Actual salary disbursement** (bank/payment-gateway payouts) — needs a provider + your account.
- **Statutory tax filing** integrations (e.g. PF/ESI/TDS e-filing) — formulas configurable, but filing is external.
- **Biometric/geo-fenced device** attendance — web clock-in only for now.

## 7. Decisions to confirm before building
1. **Statutory model** — generic configurable earnings/deductions (works anywhere) **vs** India presets (PF/ESI/PT/TDS like Keka). Recommend: generic + optional India preset pack.
2. **HR Admin** — org owner + admins only, **vs** a dedicated assignable "HR Manager" role. Recommend: dedicated `hr_admins`.
3. **Employees** — only existing app users, **vs** allow record-only employees (no login) that can be invited later. Recommend: allow both.
4. **Scope/order** — all 5 HR phases, **vs** start Core + Attendance + Leave (most-used) and do Payroll after.
