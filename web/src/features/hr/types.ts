"use client";

import type { Database } from "@/types/database";

/** Base HR table row types (generated). */
export type HrEmployeeRow =
  Database["public"]["Tables"]["hr_employees"]["Row"];
export type HrDepartmentRow =
  Database["public"]["Tables"]["hr_departments"]["Row"];
export type HrDesignationRow =
  Database["public"]["Tables"]["hr_designations"]["Row"];
export type HrAdminRow = Database["public"]["Tables"]["hr_admins"]["Row"];
export type HrDocumentRow =
  Database["public"]["Tables"]["hr_documents"]["Row"];
export type HrLetterTemplateRow =
  Database["public"]["Tables"]["hr_letter_templates"]["Row"];
export type HrGeneratedDocumentRow =
  Database["public"]["Tables"]["hr_generated_documents"]["Row"];

/** HR-2 attendance table row types (generated). */
export type HrAttendanceRow =
  Database["public"]["Tables"]["hr_attendance"]["Row"];
export type HrRegularizationRow =
  Database["public"]["Tables"]["hr_attendance_regularizations"]["Row"];
export type HrShiftRow = Database["public"]["Tables"]["hr_shifts"]["Row"];
export type HrHolidayRow = Database["public"]["Tables"]["hr_holidays"]["Row"];

/** HR-4 payroll table row types (generated). */
export type HrSalaryStructureRow =
  Database["public"]["Tables"]["hr_salary_structures"]["Row"];
export type HrSalaryComponentRow =
  Database["public"]["Tables"]["hr_salary_components"]["Row"];
export type HrPayrollRunRow =
  Database["public"]["Tables"]["hr_payroll_runs"]["Row"];
export type HrPayslipRow = Database["public"]["Tables"]["hr_payslips"]["Row"];
export type HrReimbursementRow =
  Database["public"]["Tables"]["hr_reimbursements"]["Row"];
export type HrLoanAdvanceRow =
  Database["public"]["Tables"]["hr_loans_advances"]["Row"];
export type HrBankDetailsRow =
  Database["public"]["Tables"]["hr_bank_details"]["Row"];

/** Narrowed salary-component kind/calc values (DB columns are free `text`). */
export type SalaryComponentKind = "earning" | "deduction";
export type SalaryComponentCalc =
  | "fixed"
  | "percent_of_ctc"
  | "percent_of_basic";

/** Narrowed payroll-run status values (DB column is free `text`). */
export type PayrollRunStatus = "draft" | "finalized" | "paid";

/** Narrowed reimbursement status values (DB column is free `text`). */
export type ReimbursementStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "paid";

/**
 * One earning/deduction line inside a payslip's `earnings`/`deductions` JSON
 * arrays. Stored as `Json`; this is the shape the payroll engine writes.
 */
export type PayslipLine = { name: string; amount: number };

/**
 * A salary structure together with its components — the shape
 * `useEmployeeSalary` resolves (latest structure + its ordered components).
 */
export type EmployeeSalary = {
  structure: HrSalaryStructureRow | null;
  components: HrSalaryComponentRow[];
};

/** A payslip with the related employee's name embedded (run detail view). */
export type HrPayslipWithEmployee = HrPayslipRow & {
  employee: ManagerEmbed;
};

/** A reimbursement with the claiming employee's name embedded (approver view). */
export type HrReimbursementWithEmployee = HrReimbursementRow & {
  employee: ManagerEmbed;
};

/** A trimmed payroll-run embed: the period + status a payslip view shows. */
export type PayrollRunEmbed = Pick<
  HrPayrollRunRow,
  "period_month" | "period_year" | "status"
> | null;

/** A payslip with its payroll run's period/status embedded (my-payslips view). */
export type HrPayslipWithRun = HrPayslipRow & {
  run: PayrollRunEmbed;
};

/** Input for upserting a salary structure; `org_id` is injected by the hook. */
export type UpsertSalaryStructureInput = {
  employeeId: string;
  ctc: number;
  currency?: string;
  effectiveFrom?: string;
};

/** Input for adding a salary component; `org_id` is injected by the hook. */
export type AddSalaryComponentInput = {
  structureId: string;
  employeeId: string;
  name: string;
  kind: SalaryComponentKind;
  calc: SalaryComponentCalc;
  value: number;
  isBasic?: boolean;
  sortOrder?: number;
};

/** Args for the `run_payroll` RPC (`month` is 1-based). */
export type RunPayrollInput = { month: number; year: number };

/** Input for submitting a reimbursement; `org_id`/employee are injected. */
export type SubmitReimbursementInput = {
  category: string;
  amount: number;
  date: string;
};

/** Input for approving/rejecting a reimbursement. */
export type DecideReimbursementInput = { id: string; approve: boolean };

/** Input for creating a loan/advance; `org_id` is injected by the hook. */
export type CreateLoanInput = Omit<
  Database["public"]["Tables"]["hr_loans_advances"]["Insert"],
  "org_id"
>;

/** Input for updating a loan/advance. */
export type UpdateLoanInput = {
  id: string;
  patch: Database["public"]["Tables"]["hr_loans_advances"]["Update"];
};

/** Input for upserting the caller's bank details; `org_id` is injected. */
export type UpsertBankDetailsInput = Omit<
  Database["public"]["Tables"]["hr_bank_details"]["Insert"],
  "org_id" | "employee_id"
>;

/** HR-5 onboarding/offboarding table row type (generated). */
export type HrOnboardingTaskRow =
  Database["public"]["Tables"]["hr_onboarding_tasks"]["Row"];

/** First-class HR letter/document types used by the template + generator UI. */
export type HrLetterDocumentType =
  | "offer_letter"
  | "appointment_letter"
  | "experience_letter"
  | "relieving_letter"
  | "salary_certificate"
  | "nda"
  | "internship_letter"
  | "warning_letter"
  | "custom";

/** A generated document with the employee's name embedded for list views. */
export type HrGeneratedDocumentWithEmployee = HrGeneratedDocumentRow & {
  employee: ManagerEmbed;
};

/** Narrowed onboarding-task kind values (DB column is free `text`). */
export type OnboardingTaskKind = "onboarding" | "offboarding";

/** Narrowed onboarding-task status values (DB column is free `text`). */
export type OnboardingTaskStatus = "pending" | "in_progress" | "done";

/** Input for creating an onboarding/offboarding task; `org_id` is injected. */
export type CreateOnboardingTaskInput = {
  employeeId: string;
  kind: OnboardingTaskKind;
  title: string;
  dueDate?: string | null;
};

/** Input for updating an onboarding/offboarding task. */
export type UpdateOnboardingTaskInput = {
  id: string;
  patch: Database["public"]["Tables"]["hr_onboarding_tasks"]["Update"];
};

/** Input for creating a document template; `org_id`/audit users are injected. */
export type CreateLetterTemplateInput = Omit<
  Database["public"]["Tables"]["hr_letter_templates"]["Insert"],
  "org_id" | "created_by" | "updated_by"
>;

/** Input for updating a document template. */
export type UpdateLetterTemplateInput = {
  id: string;
  patch: Omit<
    Database["public"]["Tables"]["hr_letter_templates"]["Update"],
    "org_id" | "created_by"
  >;
};

/** Args for the `seed_onboarding_checklist` RPC. */
export type SeedChecklistInput = {
  employeeId: string;
  kind: OnboardingTaskKind;
};

/** One `{name,count}`-style bucket the org analytics RPC returns. */
export type AnalyticsBucket = { name: string; count: number };

/** A `by_status` bucket from the org analytics RPC. */
export type AnalyticsStatusBucket = { status: string; count: number };

/** A `by_type` bucket from the org analytics RPC. */
export type AnalyticsTypeBucket = { type: string; count: number };

/** A `by_location` bucket from the org analytics RPC. */
export type AnalyticsLocationBucket = { location: string; count: number };

/** The `payroll_last` summary from the org analytics RPC (or null). */
export type AnalyticsPayrollLast = {
  period_month: number;
  period_year: number;
  total_net: number;
  employee_count: number;
  status: string;
} | null;

/** An entry in the analytics `upcoming_birthdays` list. */
export type AnalyticsBirthday = {
  full_name: string;
  date_of_birth: string;
  day: string;
};

/** An entry in the analytics `upcoming_anniversaries` list. */
export type AnalyticsAnniversary = {
  full_name: string;
  date_of_joining: string;
  years: number;
  day: string;
};

/**
 * Shape of the single JSON object returned by the `hr_org_analytics` RPC.
 *
 * The RPC returns `jsonb`, so numeric fields may arrive as numbers or as
 * strings (Postgres `numeric` serializes to a string). Consumers should
 * `Number()` values before arithmetic/formatting where it matters.
 */
export type OrgAnalytics = {
  headcount: number;
  total_employees: number;
  by_department: AnalyticsBucket[];
  by_status: AnalyticsStatusBucket[];
  by_type: AnalyticsTypeBucket[];
  by_location: AnalyticsLocationBucket[];
  on_probation: number;
  new_joiners_30d: number;
  exits_30d: number;
  present_today: number;
  attendance_rate_month: number | null;
  leave_pending: number;
  payroll_last: AnalyticsPayrollLast;
  upcoming_birthdays: AnalyticsBirthday[];
  upcoming_anniversaries: AnalyticsAnniversary[];
};

/** HR-3 leave table row types (generated). */
export type HrLeaveTypeRow =
  Database["public"]["Tables"]["hr_leave_types"]["Row"];
export type HrLeaveBalanceRow =
  Database["public"]["Tables"]["hr_leave_balances"]["Row"];
export type HrLeaveRequestRow =
  Database["public"]["Tables"]["hr_leave_requests"]["Row"];

/**
 * Narrowed leave-request status values (DB column is free `text`). `apply_leave`
 * sets `pending`; `decide_leave` sets `approved`/`rejected`; `cancel_leave` sets
 * `cancelled`.
 */
export type LeaveStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

/** A trimmed leave-type embed: just the columns the leave views display. */
export type LeaveTypeEmbed = Pick<
  HrLeaveTypeRow,
  "name" | "color" | "paid"
> | null;

/** A balance row with its leave type's name/color/paid embedded. */
export type HrLeaveBalanceWithType = HrLeaveBalanceRow & {
  leave_type: LeaveTypeEmbed;
};

/** A leave request with the leave type's name embedded (my-requests view). */
export type HrLeaveRequestWithType = HrLeaveRequestRow & {
  leave_type: Pick<HrLeaveTypeRow, "name" | "color"> | null;
};

/**
 * A pending leave request with the requesting employee's name and the leave
 * type's name embedded (approver view).
 */
export type HrLeaveRequestWithEmployee = HrLeaveRequestRow & {
  employee: ManagerEmbed;
  leave_type: Pick<HrLeaveTypeRow, "name" | "color"> | null;
};

/** Input for creating a leave type; `org_id` is injected by the hook. */
export type CreateLeaveTypeInput = Omit<
  Database["public"]["Tables"]["hr_leave_types"]["Insert"],
  "org_id"
>;

/** Input for updating a leave type. */
export type UpdateLeaveTypeInput = {
  id: string;
  patch: Database["public"]["Tables"]["hr_leave_types"]["Update"];
};

/** Args for the `apply_leave` RPC (dates are `YYYY-MM-DD`). */
export type ApplyLeaveInput = {
  leaveTypeId: string;
  from: string;
  to: string;
  reason?: string | null;
};

/** Args for the `decide_leave` RPC. */
export type DecideLeaveInput = {
  id: string;
  approve: boolean;
  note?: string | null;
};

/**
 * Narrowed attendance status values (DB column is free `text`). `clock_in`
 * sets `present`; the rest are produced by attendance jobs / overrides.
 */
export type AttendanceStatus =
  | "present"
  | "absent"
  | "half_day"
  | "wfh"
  | "leave"
  | "holiday"
  | "weekend";

/** An attendance row with the related employee's name embedded (team view). */
export type HrAttendanceWithEmployee = HrAttendanceRow & {
  employee: ManagerEmbed;
};

/** A regularization row with the requesting employee's name embedded. */
export type HrRegularizationWithEmployee = HrRegularizationRow & {
  employee: ManagerEmbed;
};

/** Args for the `request_regularization` RPC. */
export type RequestRegularizationInput = {
  date: string;
  /** Requested clock-in timestamp (ISO/timestamptz). */
  in: string;
  /** Requested clock-out timestamp (ISO/timestamptz). */
  out: string;
  reason?: string | null;
};

/** Args for the `decide_regularization` RPC. */
export type DecideRegularizationInput = {
  id: string;
  approve: boolean;
  note?: string | null;
};

/** Input for creating a shift; `org_id` is injected by the hook. */
export type CreateShiftInput = Omit<
  Database["public"]["Tables"]["hr_shifts"]["Insert"],
  "org_id"
>;

/** Input for updating a shift. */
export type UpdateShiftInput = {
  id: string;
  patch: Database["public"]["Tables"]["hr_shifts"]["Update"];
};

/** Input for creating a holiday; `org_id` is injected by the hook. */
export type CreateHolidayInput = Omit<
  Database["public"]["Tables"]["hr_holidays"]["Insert"],
  "org_id"
>;

/** Allowed employment types (DB is a free `text` column, narrowed here). */
export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "intern";

/** Allowed employee statuses (DB is a free `text` column, narrowed here). */
export type EmployeeStatus =
  | "active"
  | "probation"
  | "on_notice"
  | "resigned"
  | "terminated";

/** A trimmed relation embed: just the column we display. */
export type DepartmentEmbed = Pick<HrDepartmentRow, "id" | "name"> | null;
export type DesignationEmbed = Pick<HrDesignationRow, "id" | "title"> | null;
export type ManagerEmbed = Pick<HrEmployeeRow, "id" | "full_name"> | null;

/**
 * An employee row with the related department, designation and manager
 * embedded. The embed aliases come from the PostgREST `select` below; the
 * self-FK manager embed is aliased `manager`.
 */
export type HrEmployeeWithRelations = HrEmployeeRow & {
  department: DepartmentEmbed;
  designation: DesignationEmbed;
  manager: ManagerEmbed;
};

/** A user row trimmed to what an HR admin list needs. */
export type HrAdminUser = {
  id: string;
  name: string;
  email: string;
};

/** An hr_admins row joined to the underlying user. */
export type HrAdminWithUser = HrAdminRow & {
  user: HrAdminUser | null;
};

/** Input for creating an employee; `org_id` is injected by the hook. */
export type CreateEmployeeInput = Omit<
  Database["public"]["Tables"]["hr_employees"]["Insert"],
  "org_id"
>;

/** Input for updating an employee. */
export type UpdateEmployeeInput = {
  id: string;
  patch: Database["public"]["Tables"]["hr_employees"]["Update"];
};

/** Input for creating a department; `org_id` is injected by the hook. */
export type CreateDepartmentInput = Omit<
  Database["public"]["Tables"]["hr_departments"]["Insert"],
  "org_id"
>;

/** Input for updating a department. */
export type UpdateDepartmentInput = {
  id: string;
  patch: Database["public"]["Tables"]["hr_departments"]["Update"];
};

/** Input for creating a designation; `org_id` is injected by the hook. */
export type CreateDesignationInput = Omit<
  Database["public"]["Tables"]["hr_designations"]["Insert"],
  "org_id"
>;

/** Input for adding an HR admin; `org_id` is injected by the hook. */
export type AddHrAdminInput = { userId: string };

/** Input for uploading an employee document. */
export type UploadEmployeeDocumentInput = {
  employeeId: string;
  file: File;
  /** Optional logical document type (e.g. "offer_letter", "id_proof"). */
  docType?: string | null;
};
