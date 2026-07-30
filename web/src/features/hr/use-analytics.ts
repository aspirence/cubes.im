"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHrAccess } from "./use-hr";
import type {
  CreateOnboardingTaskInput,
  HrOnboardingTaskRow,
  OrgAnalytics,
  SeedChecklistInput,
  UpdateOnboardingTaskInput,
} from "./types";

export type {
  AnalyticsAnniversary,
  AnalyticsBirthday,
  AnalyticsBucket,
  AnalyticsLocationBucket,
  AnalyticsPayrollLast,
  AnalyticsStatusBucket,
  AnalyticsTypeBucket,
  CreateOnboardingTaskInput,
  HrOnboardingTaskRow,
  OnboardingTaskKind,
  OnboardingTaskStatus,
  OrgAnalytics,
  SeedChecklistInput,
  UpdateOnboardingTaskInput,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Query keys                                                                 */
/* -------------------------------------------------------------------------- */

const HR_ROOT = "hr" as const;

const analyticsKey = (orgId: string | undefined) =>
  [HR_ROOT, "analytics", orgId] as const;
/** Root key for every onboarding/offboarding query — used for invalidation. */
const onboardingRoot = [HR_ROOT, "onboarding"] as const;
const onboardingKey = (employeeId: string | undefined) =>
  [HR_ROOT, "onboarding", employeeId] as const;

/* -------------------------------------------------------------------------- */
/* Org analytics                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Loads the org's HR analytics snapshot via the `hr_org_analytics(p_org_id)`
 * RPC, which returns a single JSON object (see `OrgAnalytics`). Disabled until
 * the org is resolved; RLS scopes the data to the caller's org.
 *
 * The RPC returns `jsonb`, so numeric fields may arrive as strings — the UI
 * should `Number()` values where it does arithmetic/formatting.
 */
export function useOrgAnalytics() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: analyticsKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<OrgAnalytics> => {
      const { data, error } = await supabase.rpc("hr_org_analytics", {
        p_org_id: orgId as string,
      });
      if (error) throw error;
      // The RPC returns one jsonb object; cast through `unknown` to the loose
      // OrgAnalytics shape (numbers may come back as strings from jsonb).
      return (data ?? {}) as unknown as OrgAnalytics;
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Onboarding / offboarding tasks                                             */
/* -------------------------------------------------------------------------- */

/**
 * Lists all onboarding + offboarding tasks for an employee (both kinds),
 * grouped by `kind` then ordered by `sort_order`. Disabled until an employee
 * id is known; RLS scopes reads to the caller's org.
 */
export function useOnboardingTasks(employeeId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: onboardingKey(employeeId),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<HrOnboardingTaskRow[]> => {
      const { data, error } = await supabase
        .from("hr_onboarding_tasks")
        .select("*")
        .eq("employee_id", employeeId as string)
        .order("kind", { ascending: true })
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Creates an onboarding/offboarding task for an employee (HR admins only via
 * RLS). `org_id` is injected from `useHrAccess`. Invalidates onboarding lists.
 */
export function useCreateOnboardingTask() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: CreateOnboardingTaskInput,
    ): Promise<HrOnboardingTaskRow> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_onboarding_tasks")
        .insert({
          org_id: orgId,
          employee_id: input.employeeId,
          kind: input.kind,
          title: input.title,
          due_date: input.dueDate ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: onboardingRoot });
    },
  });
}

/**
 * Updates an onboarding/offboarding task by id (HR admins only via RLS). When
 * the patch transitions `status` to `done`, `completed_at` is stamped to now
 * (and cleared when moving away from `done`, unless the caller set it
 * explicitly). Invalidates onboarding lists.
 */
export function useUpdateOnboardingTask() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: UpdateOnboardingTaskInput,
    ): Promise<HrOnboardingTaskRow> => {
      const patch = { ...input.patch };
      if (patch.status !== undefined && patch.completed_at === undefined) {
        patch.completed_at =
          patch.status === "done" ? new Date().toISOString() : null;
      }
      const { data, error } = await supabase
        .from("hr_onboarding_tasks")
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: onboardingRoot });
    },
  });
}

/** Deletes an onboarding/offboarding task by id (HR admins only via RLS). */
export function useDeleteOnboardingTask() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("hr_onboarding_tasks")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: onboardingRoot });
    },
  });
}

/**
 * Seeds a default onboarding/offboarding checklist for an employee via the
 * `seed_onboarding_checklist(p_employee_id, p_kind)` RPC. Returns the number of
 * tasks created. Invalidates onboarding lists.
 */
export function useSeedChecklist() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SeedChecklistInput): Promise<number> => {
      const { data, error } = await supabase.rpc("seed_onboarding_checklist", {
        p_employee_id: input.employeeId,
        p_kind: input.kind,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: onboardingRoot });
    },
  });
}
