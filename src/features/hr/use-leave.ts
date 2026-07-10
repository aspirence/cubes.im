"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import dayjs from "dayjs";
import { createClient } from "@/lib/supabase/client";
import { useHrAccess } from "./use-hr";
import { useMyEmployee } from "./use-attendance";
import type {
  ApplyLeaveInput,
  CreateLeaveTypeInput,
  DecideLeaveInput,
  HrLeaveBalanceWithType,
  HrLeaveRequestWithEmployee,
  HrLeaveRequestWithType,
  HrLeaveTypeRow,
  UpdateLeaveTypeInput,
} from "./types";

export type {
  ApplyLeaveInput,
  CreateLeaveTypeInput,
  DecideLeaveInput,
  HrLeaveBalanceRow,
  HrLeaveBalanceWithType,
  HrLeaveRequestRow,
  HrLeaveRequestWithEmployee,
  HrLeaveRequestWithType,
  HrLeaveTypeRow,
  LeaveStatus,
  UpdateLeaveTypeInput,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Query keys                                                                 */
/* -------------------------------------------------------------------------- */

const HR_ROOT = "hr" as const;

const leaveTypesKey = (orgId: string | undefined) =>
  [HR_ROOT, "leave-types", orgId] as const;
const myBalancesKey = (employeeId: string | undefined, year: number) =>
  [HR_ROOT, "leave", "balances", "mine", employeeId, year] as const;
const myRequestsKey = (employeeId: string | undefined) =>
  [HR_ROOT, "leave", "requests", "mine", employeeId] as const;
const pendingRequestsKey = (orgId: string | undefined) =>
  [HR_ROOT, "leave", "requests", "pending", orgId] as const;

/** PostgREST embed of a request's leave type (name + color). */
const LEAVE_TYPE_NAME_EMBED =
  "leave_type:hr_leave_types!leave_type_id(name, color)" as const;
/** PostgREST embed of a balance's leave type (name, color, paid). */
const LEAVE_TYPE_BALANCE_EMBED =
  "leave_type:hr_leave_types!leave_type_id(name, color, paid)" as const;
/** PostgREST embed of the requesting employee's name. */
const EMPLOYEE_NAME_EMBED =
  "employee:hr_employees!employee_id(id, full_name)" as const;

/** The current calendar year (matches `hr_leave_balances.year`). */
function currentYear(): number {
  return dayjs().year();
}

/* -------------------------------------------------------------------------- */
/* Leave types (org-scoped CRUD)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Lists the org's leave types (alphabetical). Disabled until the org is
 * resolved; RLS scopes reads to the org.
 */
export function useLeaveTypes() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: leaveTypesKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrLeaveTypeRow[]> => {
      const { data, error } = await supabase
        .from("hr_leave_types")
        .select("*")
        .eq("org_id", orgId as string)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a leave type in the active org (HR admins only via RLS). */
export function useCreateLeaveType() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: CreateLeaveTypeInput,
    ): Promise<HrLeaveTypeRow> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_leave_types")
        .insert({ ...input, org_id: orgId })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leaveTypesKey(orgId) });
    },
  });
}

/** Updates a leave type by id (HR admins only via RLS). */
export function useUpdateLeaveType() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: UpdateLeaveTypeInput,
    ): Promise<HrLeaveTypeRow> => {
      const { data, error } = await supabase
        .from("hr_leave_types")
        .update(input.patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leaveTypesKey(orgId) });
    },
  });
}

/** Deletes a leave type by id (HR admins only via RLS). */
export function useDeleteLeaveType() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("hr_leave_types")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leaveTypesKey(orgId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* My balances / my requests                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The caller's leave balances for the current year, with each balance's leave
 * type name/color/paid embedded. Disabled until the caller's employee row is
 * known. AVAILABLE = allotted + carried_forward - used - pending.
 */
export function useMyLeaveBalances() {
  const supabase = useMemo(() => createClient(), []);
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;
  const year = currentYear();

  return useQuery({
    queryKey: myBalancesKey(employeeId, year),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<HrLeaveBalanceWithType[]> => {
      const { data, error } = await supabase
        .from("hr_leave_balances")
        .select(`*, ${LEAVE_TYPE_BALANCE_EMBED}`)
        .eq("employee_id", employeeId as string)
        .eq("year", year);
      if (error) throw error;
      return (data ?? []) as unknown as HrLeaveBalanceWithType[];
    },
  });
}

/**
 * The caller's own leave requests (newest first) with the leave type name
 * embedded. Disabled until the caller's employee row is known.
 */
export function useMyLeaveRequests() {
  const supabase = useMemo(() => createClient(), []);
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;

  return useQuery({
    queryKey: myRequestsKey(employeeId),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<HrLeaveRequestWithType[]> => {
      const { data, error } = await supabase
        .from("hr_leave_requests")
        .select(`*, ${LEAVE_TYPE_NAME_EMBED}`)
        .eq("employee_id", employeeId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as HrLeaveRequestWithType[];
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Apply / cancel                                                             */
/* -------------------------------------------------------------------------- */

/** Invalidates the caller's balances + requests and the org pending list. */
function useInvalidateLeave() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({
      queryKey: [HR_ROOT, "leave", "balances"],
    });
    queryClient.invalidateQueries({
      queryKey: [HR_ROOT, "leave", "requests"],
    });
  };
}

/**
 * Files a leave request via the `apply_leave` RPC. Maps the friendly input to
 * the RPC's `p_*` args; returns the new request id. Invalidates balances and
 * requests (the request consumes pending balance).
 */
export function useApplyLeave() {
  const supabase = useMemo(() => createClient(), []);
  const invalidate = useInvalidateLeave();

  return useMutation({
    mutationFn: async (input: ApplyLeaveInput): Promise<string> => {
      const { data, error } = await supabase.rpc("apply_leave", {
        p_leave_type_id: input.leaveTypeId,
        p_from: input.from,
        p_to: input.to,
        p_reason: input.reason ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(),
  });
}

/**
 * Cancels one of the caller's own leave requests via the `cancel_leave` RPC.
 * Invalidates balances and requests (cancelling releases pending balance).
 */
export function useCancelLeave() {
  const supabase = useMemo(() => createClient(), []);
  const invalidate = useInvalidateLeave();

  return useMutation({
    mutationFn: async (requestId: string): Promise<void> => {
      const { error } = await supabase.rpc("cancel_leave", {
        p_request_id: requestId,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });
}

/* -------------------------------------------------------------------------- */
/* Approver: pending / decide                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The org's pending leave requests with the requesting employee's name and the
 * leave type name embedded — for approvers (RLS scopes the visible rows).
 * Disabled until the org is resolved.
 */
export function usePendingLeaveRequests() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: pendingRequestsKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrLeaveRequestWithEmployee[]> => {
      const { data, error } = await supabase
        .from("hr_leave_requests")
        .select(`*, ${EMPLOYEE_NAME_EMBED}, ${LEAVE_TYPE_NAME_EMBED}`)
        .eq("org_id", orgId as string)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as HrLeaveRequestWithEmployee[];
    },
  });
}

/**
 * Approves or rejects a leave request via the `decide_leave` RPC. Invalidates
 * balances (approval moves pending -> used) and requests (mine + pending).
 */
export function useDecideLeave() {
  const supabase = useMemo(() => createClient(), []);
  const invalidate = useInvalidateLeave();

  return useMutation({
    mutationFn: async (input: DecideLeaveInput): Promise<void> => {
      const { error } = await supabase.rpc("decide_leave", {
        p_request_id: input.id,
        p_approve: input.approve,
        p_note: input.note ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(),
  });
}
