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
import type {
  CreateHolidayInput,
  CreateShiftInput,
  DecideRegularizationInput,
  HrAttendanceRow,
  HrAttendanceWithEmployee,
  HrEmployeeRow,
  HrHolidayRow,
  HrRegularizationRow,
  HrRegularizationWithEmployee,
  HrShiftRow,
  RequestRegularizationInput,
  UpdateShiftInput,
} from "./types";

export type {
  AttendanceStatus,
  CreateHolidayInput,
  CreateShiftInput,
  DecideRegularizationInput,
  HrAttendanceRow,
  HrAttendanceWithEmployee,
  HrHolidayRow,
  HrRegularizationRow,
  HrRegularizationWithEmployee,
  HrShiftRow,
  RequestRegularizationInput,
  UpdateShiftInput,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Query keys                                                                 */
/* -------------------------------------------------------------------------- */

const HR_ROOT = "hr" as const;

const myEmployeeKey = (orgId: string | undefined) =>
  [HR_ROOT, "my-employee", orgId] as const;
const todayAttendanceKey = (
  employeeId: string | undefined,
  dateISO: string,
) => [HR_ROOT, "attendance", "today", employeeId, dateISO] as const;
const myAttendanceKey = (
  employeeId: string | undefined,
  year: number,
  month: number,
) => [HR_ROOT, "attendance", "month", employeeId, year, month] as const;
const teamAttendanceKey = (orgId: string | undefined, dateISO: string) =>
  [HR_ROOT, "attendance", "team", orgId, dateISO] as const;
const myRegularizationsKey = (employeeId: string | undefined) =>
  [HR_ROOT, "regularizations", "mine", employeeId] as const;
const pendingRegularizationsKey = (orgId: string | undefined) =>
  [HR_ROOT, "regularizations", "pending", orgId] as const;
const shiftsKey = (orgId: string | undefined) =>
  [HR_ROOT, "shifts", orgId] as const;
const holidaysKey = (orgId: string | undefined) =>
  [HR_ROOT, "holidays", orgId] as const;

/** A trimmed employee embed: only the columns the views display. */
const EMPLOYEE_NAME_EMBED =
  "employee:hr_employees!employee_id(id, full_name)" as const;

/** Today's date as a calendar `YYYY-MM-DD` string (DB `date` column). */
function todayISO(): string {
  return dayjs().format("YYYY-MM-DD");
}

/* -------------------------------------------------------------------------- */
/* Current employee                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the caller's own `hr_employees` row in the active org (matched on
 * `user_id`), or `null` when the caller has no employee record. Disabled until
 * the org is resolved; RLS lets a user read their own employee row.
 */
export function useMyEmployee() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: myEmployeeKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrEmployeeRow | null> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return null;

      const { data, error } = await supabase
        .from("hr_employees")
        .select("*")
        .eq("org_id", orgId as string)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Today / clock in-out                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Today's attendance row for the caller's employee, or `null` before the first
 * clock-in. Disabled until the caller's employee row is known.
 */
export function useTodayAttendance() {
  const supabase = useMemo(() => createClient(), []);
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;
  const date = todayISO();

  return useQuery({
    queryKey: todayAttendanceKey(employeeId, date),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<HrAttendanceRow | null> => {
      const { data, error } = await supabase
        .from("hr_attendance")
        .select("*")
        .eq("employee_id", employeeId as string)
        .eq("date", date)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

/** Invalidates the today + current-month attendance queries after a punch. */
function useInvalidateAttendance() {
  const queryClient = useQueryClient();
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;

  return () => {
    const now = dayjs();
    queryClient.invalidateQueries({
      queryKey: todayAttendanceKey(employeeId, now.format("YYYY-MM-DD")),
    });
    queryClient.invalidateQueries({
      queryKey: myAttendanceKey(employeeId, now.year(), now.month() + 1),
    });
  };
}

/**
 * Clocks the caller in via the `clock_in()` RPC (acts on the current user's
 * employee record; no args). Returns the attendance id; invalidates today and
 * the current month.
 */
export function useClockIn() {
  const supabase = useMemo(() => createClient(), []);
  const invalidate = useInvalidateAttendance();

  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("clock_in");
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(),
  });
}

/**
 * Clocks the caller out via the `clock_out()` RPC (acts on the current user's
 * employee record; no args). Invalidates today and the current month.
 */
export function useClockOut() {
  const supabase = useMemo(() => createClient(), []);
  const invalidate = useInvalidateAttendance();

  return useMutation({
    mutationFn: async (): Promise<string> => {
      const { data, error } = await supabase.rpc("clock_out");
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidate(),
  });
}

/* -------------------------------------------------------------------------- */
/* My attendance (month)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The caller's own attendance rows for a calendar month (`month` is 1-based:
 * 1 = January). Disabled until the caller's employee row is known.
 */
export function useMyAttendance(year: number, month: number) {
  const supabase = useMemo(() => createClient(), []);
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;

  const start = dayjs(new Date(year, month - 1, 1));
  const startISO = start.format("YYYY-MM-DD");
  const endISO = start.endOf("month").format("YYYY-MM-DD");

  return useQuery({
    queryKey: myAttendanceKey(employeeId, year, month),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<HrAttendanceRow[]> => {
      const { data, error } = await supabase
        .from("hr_attendance")
        .select("*")
        .eq("employee_id", employeeId as string)
        .gte("date", startISO)
        .lte("date", endISO)
        .order("date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Team attendance (a single date)                                            */
/* -------------------------------------------------------------------------- */

/**
 * All of the org's attendance rows for a single date, with each employee's name
 * embedded — for HR admins / managers (RLS scopes the visible rows). Disabled
 * until the org is resolved.
 */
export function useTeamAttendance(dateISO: string) {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: teamAttendanceKey(orgId, dateISO),
    enabled: Boolean(orgId) && Boolean(dateISO),
    queryFn: async (): Promise<HrAttendanceWithEmployee[]> => {
      const { data, error } = await supabase
        .from("hr_attendance")
        .select(`*, ${EMPLOYEE_NAME_EMBED}`)
        .eq("org_id", orgId as string)
        .eq("date", dateISO);
      if (error) throw error;
      return (data ?? []) as unknown as HrAttendanceWithEmployee[];
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Regularizations                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The caller's own regularization requests (newest first). Disabled until the
 * caller's employee row is known.
 */
export function useMyRegularizations() {
  const supabase = useMemo(() => createClient(), []);
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;

  return useQuery({
    queryKey: myRegularizationsKey(employeeId),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<HrRegularizationRow[]> => {
      const { data, error } = await supabase
        .from("hr_attendance_regularizations")
        .select("*")
        .eq("employee_id", employeeId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Files a regularization request via the `request_regularization` RPC. Returns
 * the new request id; invalidates the caller's regularization list.
 */
export function useRequestRegularization() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: employee } = useMyEmployee();
  const employeeId = employee?.id;

  return useMutation({
    mutationFn: async (
      input: RequestRegularizationInput,
    ): Promise<string> => {
      const { data, error } = await supabase.rpc("request_regularization", {
        p_date: input.date,
        p_in: input.in,
        p_out: input.out,
        p_reason: input.reason ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: myRegularizationsKey(employeeId),
      });
    },
  });
}

/**
 * The org's pending regularization requests with the requesting employee's name
 * embedded — for approvers (RLS scopes the visible rows). Disabled until the
 * org is resolved.
 */
export function usePendingRegularizations() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: pendingRegularizationsKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrRegularizationWithEmployee[]> => {
      const { data, error } = await supabase
        .from("hr_attendance_regularizations")
        .select(`*, ${EMPLOYEE_NAME_EMBED}`)
        .eq("org_id", orgId as string)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as HrRegularizationWithEmployee[];
    },
  });
}

/**
 * Approves or rejects a regularization via the `decide_regularization` RPC.
 * Invalidates the org pending list (and the requester's own list).
 */
export function useDecideRegularization() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: DecideRegularizationInput,
    ): Promise<void> => {
      const { error } = await supabase.rpc("decide_regularization", {
        p_id: input.id,
        p_approve: input.approve,
        p_note: input.note ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: pendingRegularizationsKey(orgId),
      });
      queryClient.invalidateQueries({
        queryKey: [HR_ROOT, "regularizations", "mine"],
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Shifts                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Lists the org's shifts (default first, then alphabetical). Disabled until the
 * org is resolved.
 */
export function useShifts() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: shiftsKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrShiftRow[]> => {
      const { data, error } = await supabase
        .from("hr_shifts")
        .select("*")
        .eq("org_id", orgId as string)
        .order("is_default", { ascending: false })
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a shift in the active org (HR admins only via RLS). */
export function useCreateShift() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (input: CreateShiftInput): Promise<HrShiftRow> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_shifts")
        .insert({ ...input, org_id: orgId })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftsKey(orgId) });
    },
  });
}

/** Updates a shift by id (HR admins only via RLS). */
export function useUpdateShift() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (input: UpdateShiftInput): Promise<HrShiftRow> => {
      const { data, error } = await supabase
        .from("hr_shifts")
        .update(input.patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftsKey(orgId) });
    },
  });
}

/** Deletes a shift by id (HR admins only via RLS). */
export function useDeleteShift() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("hr_shifts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: shiftsKey(orgId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Holidays                                                                    */
/* -------------------------------------------------------------------------- */

/** Lists the org's holidays ordered by date. Disabled until org resolved. */
export function useHolidays() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: holidaysKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrHolidayRow[]> => {
      const { data, error } = await supabase
        .from("hr_holidays")
        .select("*")
        .eq("org_id", orgId as string)
        .order("date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a holiday in the active org (HR admins only via RLS). */
export function useCreateHoliday() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (input: CreateHolidayInput): Promise<HrHolidayRow> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_holidays")
        .insert({ ...input, org_id: orgId })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: holidaysKey(orgId) });
    },
  });
}

/** Deletes a holiday by id (HR admins only via RLS). */
export function useDeleteHoliday() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("hr_holidays")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: holidaysKey(orgId) });
    },
  });
}
