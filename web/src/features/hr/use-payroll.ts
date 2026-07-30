"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHrAccess } from "./use-hr";
import { useMyEmployee } from "./use-attendance";
import type {
  AddSalaryComponentInput,
  CreateLoanInput,
  DecideReimbursementInput,
  EmployeeSalary,
  HrLoanAdvanceRow,
  HrPayrollRunRow,
  HrPayslipWithEmployee,
  HrPayslipWithRun,
  HrReimbursementRow,
  HrReimbursementWithEmployee,
  HrSalaryComponentRow,
  HrSalaryStructureRow,
  RunPayrollInput,
  SubmitReimbursementInput,
  UpdateLoanInput,
  UpsertBankDetailsInput,
  UpsertSalaryStructureInput,
} from "./types";
import type { HrBankDetailsRow } from "./types";

export type {
  AddSalaryComponentInput,
  CreateLoanInput,
  DecideReimbursementInput,
  EmployeeSalary,
  HrBankDetailsRow,
  HrLoanAdvanceRow,
  HrPayrollRunRow,
  HrPayslipRow,
  HrPayslipWithEmployee,
  HrPayslipWithRun,
  HrReimbursementRow,
  HrSalaryComponentRow,
  HrSalaryStructureRow,
  PayrollRunStatus,
  PayslipLine,
  ReimbursementStatus,
  RunPayrollInput,
  SalaryComponentCalc,
  SalaryComponentKind,
  SubmitReimbursementInput,
  UpdateLoanInput,
  UpsertBankDetailsInput,
  UpsertSalaryStructureInput,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Query keys                                                                 */
/* -------------------------------------------------------------------------- */

const HR_ROOT = "hr" as const;

const salaryKey = (employeeId: string | undefined) =>
  [HR_ROOT, "salary", employeeId] as const;
const runsKey = (orgId: string | undefined) =>
  [HR_ROOT, "payroll-runs", orgId] as const;
const runPayslipsKey = (runId: string | undefined) =>
  [HR_ROOT, "payslips", "run", runId] as const;
const myPayslipsKey = (employeeId: string | undefined) =>
  [HR_ROOT, "payslips", "mine", employeeId] as const;
const myReimbursementsKey = (employeeId: string | undefined) =>
  [HR_ROOT, "reimbursements", "mine", employeeId] as const;
const pendingReimbursementsKey = (orgId: string | undefined) =>
  [HR_ROOT, "reimbursements", "pending", orgId] as const;
const loansKey = (orgId: string | undefined) =>
  [HR_ROOT, "loans", orgId] as const;
const myBankKey = (employeeId: string | undefined) =>
  [HR_ROOT, "bank", employeeId] as const;

/** A trimmed employee embed: only the columns the payslip views display. */
const EMPLOYEE_NAME_EMBED =
  "employee:hr_employees!employee_id(id, full_name)" as const;

/** A trimmed payroll-run embed for the my-payslips view. */
const RUN_PERIOD_EMBED =
  "payroll_run:hr_payroll_runs!payroll_run_id(period_month, period_year, status)" as const;

/* -------------------------------------------------------------------------- */
/* Salary structures + components                                             */
/* -------------------------------------------------------------------------- */

/**
 * Resolves an employee's latest salary structure (newest `effective_from`) plus
 * that structure's components (ordered). Returns `{ structure: null,
 * components: [] }` when no structure exists. Disabled until an employee id is
 * known; RLS scopes reads to the caller's org.
 */
export function useEmployeeSalary(employeeId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: salaryKey(employeeId),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<EmployeeSalary> => {
      const { data: structure, error: structureError } = await supabase
        .from("hr_salary_structures")
        .select("*")
        .eq("employee_id", employeeId as string)
        .order("effective_from", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (structureError) throw structureError;
      if (!structure) return { structure: null, components: [] };

      const { data: components, error: componentsError } = await supabase
        .from("hr_salary_components")
        .select("*")
        .eq("structure_id", structure.id)
        .order("sort_order", { ascending: true });
      if (componentsError) throw componentsError;

      return {
        structure: structure as HrSalaryStructureRow,
        components: (components ?? []) as HrSalaryComponentRow[],
      };
    },
  });
}

/**
 * Inserts a salary structure for an employee (`org_id` injected from
 * `useHrAccess`, `employee_id` from input). HR admins only via RLS. Invalidates
 * the employee's salary query.
 */
export function useUpsertSalaryStructure() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: UpsertSalaryStructureInput,
    ): Promise<HrSalaryStructureRow> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_salary_structures")
        .insert({
          org_id: orgId,
          employee_id: input.employeeId,
          ctc: input.ctc,
          ...(input.currency ? { currency: input.currency } : {}),
          ...(input.effectiveFrom
            ? { effective_from: input.effectiveFrom }
            : {}),
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (structure) => {
      queryClient.invalidateQueries({
        queryKey: salaryKey(structure.employee_id),
      });
    },
  });
}

/**
 * Adds a single earning/deduction component to a salary structure (`org_id`
 * injected). HR admins only via RLS. Invalidates the employee's salary query.
 */
export function useAddSalaryComponent() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: AddSalaryComponentInput,
    ): Promise<HrSalaryComponentRow> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_salary_components")
        .insert({
          org_id: orgId,
          structure_id: input.structureId,
          employee_id: input.employeeId,
          name: input.name,
          kind: input.kind,
          calc: input.calc,
          value: input.value,
          ...(input.isBasic !== undefined ? { is_basic: input.isBasic } : {}),
          ...(input.sortOrder !== undefined
            ? { sort_order: input.sortOrder }
            : {}),
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (component) => {
      queryClient.invalidateQueries({
        queryKey: salaryKey(component.employee_id),
      });
    },
  });
}

/**
 * Deletes a salary component by id (HR admins only via RLS). The whole salary
 * cache is invalidated since the owning employee is not known from a bare id.
 */
export function useDeleteSalaryComponent() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (componentId: string): Promise<void> => {
      const { error } = await supabase
        .from("hr_salary_components")
        .delete()
        .eq("id", componentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [HR_ROOT, "salary"] });
    },
  });
}

/**
 * Applies the built-in India salary preset to a structure via the
 * `apply_india_salary_preset` RPC (seeds standard earning/deduction
 * components). HR admins only via RLS. The caller passes the structure id; on
 * success the whole salary cache is invalidated.
 */
export function useApplyIndiaPreset() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (structureId: string): Promise<void> => {
      const { error } = await supabase.rpc("apply_india_salary_preset", {
        p_structure_id: structureId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [HR_ROOT, "salary"] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Payroll runs                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Lists the org's payroll runs newest-first (by period then run time). Disabled
 * until the org is resolved; RLS scopes reads to the org.
 */
export function usePayrollRuns() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: runsKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrPayrollRunRow[]> => {
      const { data, error } = await supabase
        .from("hr_payroll_runs")
        .select("*")
        .eq("org_id", orgId as string)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .order("run_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Runs (or rebuilds) payroll for a month via the `run_payroll` RPC. Returns the
 * run id. HR admins only via RLS. Invalidates the org's run list.
 */
export function useRunPayroll() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (input: RunPayrollInput): Promise<string> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase.rpc("run_payroll", {
        p_org_id: orgId,
        p_month: input.month,
        p_year: input.year,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKey(orgId) });
    },
  });
}

/**
 * Finalizes a payroll run via the `finalize_payroll_run` RPC (locks the run).
 * HR admins only via RLS. Invalidates the org's run list and the run's payslips.
 */
export function useFinalizeRun() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (runId: string): Promise<void> => {
      const { error } = await supabase.rpc("finalize_payroll_run", {
        p_run_id: runId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, runId) => {
      queryClient.invalidateQueries({ queryKey: runsKey(orgId) });
      queryClient.invalidateQueries({ queryKey: runPayslipsKey(runId) });
    },
  });
}

/**
 * Lists the payslips for a payroll run with each employee's name embedded.
 * Disabled until a run id is known; RLS scopes reads to the org.
 */
export function useRunPayslips(runId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: runPayslipsKey(runId),
    enabled: Boolean(runId),
    queryFn: async (): Promise<HrPayslipWithEmployee[]> => {
      const { data, error } = await supabase
        .from("hr_payslips")
        .select(`*, ${EMPLOYEE_NAME_EMBED}`)
        .eq("payroll_run_id", runId as string);
      if (error) throw error;
      return (data ?? []) as unknown as HrPayslipWithEmployee[];
    },
  });
}

/* -------------------------------------------------------------------------- */
/* My payslips                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The caller's own payslips (newest first by run period) with the run's
 * period/status embedded. Disabled until the caller's employee row is known.
 */
export function useMyPayslips() {
  const supabase = useMemo(() => createClient(), []);
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;

  return useQuery({
    queryKey: myPayslipsKey(employeeId),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<HrPayslipWithRun[]> => {
      const { data, error } = await supabase
        .from("hr_payslips")
        .select(`*, ${RUN_PERIOD_EMBED}`)
        .eq("employee_id", employeeId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as HrPayslipWithRun[];
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Reimbursements                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The caller's own reimbursement claims (newest first). Disabled until the
 * caller's employee row is known.
 */
export function useMyReimbursements() {
  const supabase = useMemo(() => createClient(), []);
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;

  return useQuery({
    queryKey: myReimbursementsKey(employeeId),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<HrReimbursementRow[]> => {
      const { data, error } = await supabase
        .from("hr_reimbursements")
        .select("*")
        .eq("employee_id", employeeId as string)
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Submits a reimbursement claim for the caller's employee (`org_id` and
 * `employee_id` injected; status defaults to `pending` server-side). Disabled
 * until the caller's employee row is known. Invalidates the caller's list.
 */
export function useSubmitReimbursement() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;

  return useMutation({
    mutationFn: async (
      input: SubmitReimbursementInput,
    ): Promise<HrReimbursementRow> => {
      if (!orgId) throw new Error("No organization");
      if (!employeeId) throw new Error("No employee record");
      const { data, error } = await supabase
        .from("hr_reimbursements")
        .insert({
          org_id: orgId,
          employee_id: employeeId,
          category: input.category,
          amount: input.amount,
          date: input.date,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: myReimbursementsKey(employeeId),
      });
      queryClient.invalidateQueries({
        queryKey: pendingReimbursementsKey(orgId),
      });
    },
  });
}

/**
 * The org's pending reimbursement claims with the claiming employee's name
 * embedded — for approvers (RLS scopes the visible rows). Disabled until the
 * org is resolved.
 */
export function usePendingReimbursements() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: pendingReimbursementsKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrReimbursementWithEmployee[]> => {
      const { data, error } = await supabase
        .from("hr_reimbursements")
        .select(`*, ${EMPLOYEE_NAME_EMBED}`)
        .eq("org_id", orgId as string)
        .eq("status", "pending")
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as HrReimbursementWithEmployee[];
    },
  });
}

/**
 * Approves or rejects a reimbursement by setting its status (`approver_id` and
 * `decided_at` stamped). HR admins only via RLS. Invalidates the org pending
 * list and the claimants' own lists.
 */
export function useDecideReimbursement() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: DecideReimbursementInput,
    ): Promise<void> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;

      const { error } = await supabase
        .from("hr_reimbursements")
        .update({
          status: input.approve ? "approved" : "rejected",
          approver_id: user?.id ?? null,
          decided_at: new Date().toISOString(),
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: pendingReimbursementsKey(orgId),
      });
      queryClient.invalidateQueries({
        queryKey: [HR_ROOT, "reimbursements", "mine"],
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Loans & advances                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Lists the org's loans/advances (newest first). Disabled until the org is
 * resolved; RLS scopes reads to the org.
 */
export function useLoans() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: loansKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrLoanAdvanceRow[]> => {
      const { data, error } = await supabase
        .from("hr_loans_advances")
        .select("*")
        .eq("org_id", orgId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a loan/advance in the active org (`org_id` injected; HR admins). */
export function useCreateLoan() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (input: CreateLoanInput): Promise<HrLoanAdvanceRow> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_loans_advances")
        .insert({ ...input, org_id: orgId })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: loansKey(orgId) });
    },
  });
}

/** Updates a loan/advance by id (HR admins only via RLS). */
export function useUpdateLoan() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (input: UpdateLoanInput): Promise<HrLoanAdvanceRow> => {
      const { data, error } = await supabase
        .from("hr_loans_advances")
        .update(input.patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: loansKey(orgId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Bank details                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The caller's own bank details (one row, `employee_id` UNIQUE), or `null` when
 * not yet set. Disabled until the caller's employee row is known.
 */
export function useMyBankDetails() {
  const supabase = useMemo(() => createClient(), []);
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;

  return useQuery({
    queryKey: myBankKey(employeeId),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<HrBankDetailsRow | null> => {
      const { data, error } = await supabase
        .from("hr_bank_details")
        .select("*")
        .eq("employee_id", employeeId as string)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

/**
 * Upserts the caller's bank details (`org_id` and `employee_id` injected;
 * conflict on the UNIQUE `employee_id`). Disabled until the caller's employee
 * row is known. Invalidates the caller's bank query.
 */
export function useUpsertBankDetails() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;

  return useMutation({
    mutationFn: async (
      input: UpsertBankDetailsInput,
    ): Promise<HrBankDetailsRow> => {
      if (!orgId) throw new Error("No organization");
      if (!employeeId) throw new Error("No employee record");
      const { data, error } = await supabase
        .from("hr_bank_details")
        .upsert(
          { ...input, org_id: orgId, employee_id: employeeId },
          { onConflict: "employee_id" },
        )
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myBankKey(employeeId) });
    },
  });
}
