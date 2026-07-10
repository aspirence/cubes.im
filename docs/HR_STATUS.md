# HR Module — Status

The full HR suite is **complete**: 5 phases, ~21 `hr_` tables, all RLS-tested on cloud,
API-E2E-verified, and UI screenshot-verified with demo data. Lives under the **HR** tab.

| Phase | Scope | DB | UI | Verified |
|------|-------|----|----|----------|
| HR-1 | Core HR: employees (user-linked + record-only), departments, designations, documents, HR admins | ✅ | ✅ | RLS + E2E + screenshot |
| HR-2 | Attendance: shifts, clock in/out, monthly calendar, regularization, holidays | ✅ | ✅ | RLS + E2E + screenshot |
| HR-3 | Leave: types, balances, apply/approve/cancel, working-day calc (excl. weekends+holidays), monthly accrual (pg_cron) | ✅ | ✅ | RLS (7/7) + E2E + screenshot |
| HR-4 | Payroll: salary structures/components (generic + India preset), `run_payroll`, payslips (+ jsPDF), reimbursements, loans, bank details | ✅ | ✅ | RLS (6/6) + E2E (net math) + screenshot |
| HR-5 | Analytics dashboard, HR reports, org chart, onboarding/offboarding checklists | ✅ | ✅ | RLS (3/3) + screenshot |

## Roles & access
- **HR Manager** role via `hr_admins` (org owner is implicitly HR admin). RLS helpers:
  `is_hr_admin`, `can_view_employee` (self / manager / HR admin), `can_manage_employee` (manager / HR admin).
- Employees see their own data (attendance, leave, payslips, bank, onboarding); managers see reports; HR admins see all.

## Key functions
- `count_working_days`, `apply_leave` / `decide_leave` / `cancel_leave`, `accrue_monthly_leave`
- `compute_payslip`, `run_payroll`, `finalize_payroll_run`, `apply_india_salary_preset`
- `hr_org_analytics`, `seed_onboarding_checklist`

## HR navigation
Dashboard · Employees · Org Chart · Onboarding · Settings · Attendance · Leave · Payroll · Reports

## Payroll model (generic)
Annual CTC → monthly amounts. Components resolve `fixed` / `percent_of_ctc` / `percent_of_basic`
(Basic resolved first). LOP from `absent` attendance (pro-rated), plus loan EMIs and approved
reimbursements. India preset seeds Basic 40% CTC, HRA 50% Basic, Special Allowance, PF 12%, PT ₹200.

## Demo data (org "Acme Inc")
`scripts/seed-hr-demo.mjs` (HR-1) · `seed-hr2-demo.mjs` (attendance) · `seed-hr3-demo.mjs` (leave) ·
`seed-hr4-demo.mjs` (payroll) · `seed-hr5-demo.sql` (birthdays/anniversaries/onboarding).

## Deferrals (documented per phase in docs/hr*-notes.md)
TDS/tax-slab engine, statutory PF/ESI filings, configurable checklist templates, asset tracking,
e-sign offer letters, half-day/comp-off leave, leave encashment, attrition trend series, bank
disbursement files. These are external/policy-specific and were intentionally left as future work.
