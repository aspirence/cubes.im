"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";
import type { Database } from "@/types/database";

// The v2 columns (template / logo / section toggles) are newer than the
// generated types, so intersect them in until types are regenerated.
export type PortalRow =
  Database["public"]["Tables"]["app_client_portal_portals"]["Row"] & {
    template: "dashboard" | "sheet" | "board" | "timeline" | "minimal";
    logo_url: string | null;
    show_reviews: boolean;
    show_billing: boolean;
    allow_requests: boolean;
  };

export type PortalTemplate = PortalRow["template"];
export type PortalProjectRow =
  Database["public"]["Tables"]["app_client_portal_projects"]["Row"];
export type PortalUpdateRow =
  Database["public"]["Tables"]["app_client_portal_updates"]["Row"];

export type PortalStatus = "draft" | "live";

/** A portal row annotated with its client's name and its exposed-project count. */
export type PortalWithMeta = PortalRow & {
  client: { id: string; name: string } | null;
  project_count: number;
};

/** An exposed project, with the project's display fields for the manager UI. */
export type PortalProjectWithProject = PortalProjectRow & {
  project: {
    id: string;
    name: string;
    color_code: string | null;
  } | null;
};

const portalsKey = (teamId: string | undefined) =>
  ["client-portal", "portals", teamId] as const;
const portalKey = (id: string | undefined) =>
  ["client-portal", "portal", id] as const;
const portalProjectsKey = (portalId: string | undefined) =>
  ["client-portal", "projects", portalId] as const;
const portalUpdatesKey = (portalId: string | undefined) =>
  ["client-portal", "updates", portalId] as const;

/* --------------------------------------------------------------- portals */

/** Lists the active team's client portals (with client name + project count). */
export function usePortals() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useQuery({
    queryKey: portalsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<PortalWithMeta[]> => {
      const { data, error } = await supabase
        .from("app_client_portal_portals")
        .select(
          "*, client:clients!app_client_portal_portals_client_fk ( id, name ), projects:app_client_portal_projects ( id )",
        )
        .eq("team_id", teamId as string)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const { projects, ...rest } = row as PortalRow & {
          client: { id: string; name: string } | null;
          projects: { id: string }[] | null;
        };
        return {
          ...rest,
          project_count: projects?.length ?? 0,
        } as PortalWithMeta;
      });
    },
  });
}

/** A single portal (with its client's name). */
export function usePortal(id: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: portalKey(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<PortalWithMeta | null> => {
      const { data, error } = await supabase
        .from("app_client_portal_portals")
        .select(
          "*, client:clients!app_client_portal_portals_client_fk ( id, name )",
        )
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { ...(data as PortalRow & { client: { id: string; name: string } | null }), project_count: 0 };
    },
  });
}

export interface CreatePortalInput {
  clientId: string;
  title: string;
  intro?: string | null;
  accent?: string;
}

/** Creates a draft portal for a client (one per client, enforced by a unique). */
export function useCreatePortal() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: CreatePortalInput): Promise<PortalRow> => {
      if (!teamId) throw new Error("No active team");
      const { data, error } = await supabase
        .from("app_client_portal_portals")
        .insert({
          team_id: teamId,
          client_id: input.clientId,
          title: input.title,
          intro: input.intro ?? null,
          accent: input.accent ?? "#4a4ad0",
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as PortalRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portalsKey(teamId) });
    },
  });
}

/** Patches a portal's branding / visibility toggles / live status. */
export function useUpdatePortal() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (input: {
      id: string;
      title?: string;
      intro?: string | null;
      accent?: string;
      status?: PortalStatus;
      show_tasks?: boolean;
      show_progress?: boolean;
      template?: PortalTemplate;
      logo_url?: string | null;
      show_reviews?: boolean;
      show_billing?: boolean;
      allow_requests?: boolean;
    }): Promise<void> => {
      const { id, ...patch } = input;
      const { data, error } = await supabase
        .from("app_client_portal_portals")
        .update({ ...patch, updated_at: new Date().toISOString() } as never)
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: portalsKey(teamId) });
      queryClient.invalidateQueries({ queryKey: portalKey(input.id) });
    },
  });
}

/** Deletes a portal; its exposed projects + updates cascade on their FKs. */
export function useDeletePortal() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { data, error } = await supabase
        .from("app_client_portal_portals")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portalsKey(teamId) });
    },
  });
}

/* ------------------------------------------------------ exposed projects */

/** The projects exposed in a portal (with each project's display fields). */
export function usePortalProjects(portalId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: portalProjectsKey(portalId),
    enabled: Boolean(portalId),
    queryFn: async (): Promise<PortalProjectWithProject[]> => {
      const { data, error } = await supabase
        .from("app_client_portal_projects")
        .select(
          "*, project:projects!app_client_portal_projects_project_fk ( id, name, color_code )",
        )
        .eq("portal_id", portalId as string)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PortalProjectWithProject[];
    },
  });
}

/**
 * Reconciles the exposed-project set to `projectIds` (idempotent add/remove
 * diff against `existing`). New rows are appended after the current max sort.
 */
export function useSetPortalProjects() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      portalId: string;
      projectIds: string[];
      existing: string[];
    }): Promise<void> => {
      const desired = new Set(input.projectIds);
      const current = new Set(input.existing);
      const toAdd = input.projectIds.filter((id) => !current.has(id));
      const toRemove = input.existing.filter((id) => !desired.has(id));
      if (toAdd.length > 0) {
        const base = input.existing.length;
        const { error } = await supabase
          .from("app_client_portal_projects")
          .insert(
            toAdd.map((project_id, i) => ({
              portal_id: input.portalId,
              project_id,
              sort_order: base + i,
            })),
          );
        if (error && error.code !== "23505") throw error;
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from("app_client_portal_projects")
          .delete()
          .eq("portal_id", input.portalId)
          .in("project_id", toRemove);
        if (error) throw error;
      }
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({
        queryKey: portalProjectsKey(input.portalId),
      });
      queryClient.invalidateQueries({ queryKey: ["client-portal", "portals"] });
    },
  });
}

/* --------------------------------------------------------------- updates */

/** The shared updates posted to a portal, newest first. */
export function usePortalUpdates(portalId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: portalUpdatesKey(portalId),
    enabled: Boolean(portalId),
    queryFn: async (): Promise<PortalUpdateRow[]> => {
      const { data, error } = await supabase
        .from("app_client_portal_updates")
        .select("*")
        .eq("portal_id", portalId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Posts a shared update (announcement) to a portal. */
export function useAddPortalUpdate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      portalId: string;
      title: string;
      body?: string | null;
    }): Promise<void> => {
      const { error } = await supabase
        .from("app_client_portal_updates")
        .insert({
          portal_id: input.portalId,
          title: input.title,
          body: input.body ?? null,
          created_by: user?.id ?? null,
        });
      if (error) throw error;
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({
        queryKey: portalUpdatesKey(input.portalId),
      });
    },
  });
}

/** Deletes a shared update. */
export function useDeletePortalUpdate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      portalId: string;
    }): Promise<void> => {
      const { data, error } = await supabase
        .from("app_client_portal_updates")
        .delete()
        .eq("id", input.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("forbidden");
    },
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({
        queryKey: portalUpdatesKey(input.portalId),
      });
    },
  });
}

/* -------------------------------------------------------- invoices (v2) */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PortalInvoice {
  id: string;
  portal_id: string;
  number: string;
  title: string | null;
  amount_cents: number;
  currency: string;
  status: "draft" | "sent" | "paid" | "overdue";
  issued_on: string | null;
  due_on: string | null;
  note: string | null;
  created_at: string;
}

export interface PortalRequest {
  id: string;
  portal_id: string;
  title: string;
  details: string | null;
  priority: "low" | "normal" | "high";
  status: "new" | "accepted" | "declined" | "done";
  created_at: string;
}

const invoicesKey = (portalId: string | undefined) =>
  ["client-portal", "invoices", portalId] as const;
const requestsKey = (portalId: string | undefined) =>
  ["client-portal", "requests", portalId] as const;

// app_client_portal_invoices / _requests are newer than the generated types.
function loose(supabase: ReturnType<typeof createClient>) {
  return supabase as unknown as SupabaseClient;
}

export function usePortalInvoices(portalId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: invoicesKey(portalId),
    enabled: Boolean(portalId),
    queryFn: async (): Promise<PortalInvoice[]> => {
      const { data, error } = await loose(supabase)
        .from("app_client_portal_invoices")
        .select("*")
        .eq("portal_id", portalId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PortalInvoice[];
    },
  });
}

export function useSaveInvoice() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      portalId: string;
      number: string;
      title?: string | null;
      amount_cents: number;
      currency?: string;
      status?: PortalInvoice["status"];
      issued_on?: string | null;
      due_on?: string | null;
      note?: string | null;
    }): Promise<void> => {
      const row = {
        portal_id: input.portalId,
        number: input.number,
        title: input.title ?? null,
        amount_cents: input.amount_cents,
        currency: input.currency ?? "USD",
        status: input.status ?? "draft",
        issued_on: input.issued_on ?? null,
        due_on: input.due_on ?? null,
        note: input.note ?? null,
        created_by: user?.id ?? null,
      };
      const q = loose(supabase);
      const { error } = input.id
        ? await q.from("app_client_portal_invoices").update(row).eq("id", input.id)
        : await q.from("app_client_portal_invoices").insert(row);
      if (error) throw error;
    },
    onSuccess: (_d, input) =>
      queryClient.invalidateQueries({ queryKey: invoicesKey(input.portalId) }),
  });
}

export function useDeleteInvoice() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; portalId: string }): Promise<void> => {
      const { error } = await loose(supabase)
        .from("app_client_portal_invoices")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) =>
      queryClient.invalidateQueries({ queryKey: invoicesKey(input.portalId) }),
  });
}

/* -------------------------------------------------------- requests (v2) */

export function usePortalRequests(portalId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: requestsKey(portalId),
    enabled: Boolean(portalId),
    queryFn: async (): Promise<PortalRequest[]> => {
      const { data, error } = await loose(supabase)
        .from("app_client_portal_requests")
        .select("*")
        .eq("portal_id", portalId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PortalRequest[];
    },
  });
}

export function useUpdateRequestStatus() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      portalId: string;
      status: PortalRequest["status"];
    }): Promise<void> => {
      const { error } = await loose(supabase)
        .from("app_client_portal_requests")
        .update({ status: input.status })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, input) =>
      queryClient.invalidateQueries({ queryKey: requestsKey(input.portalId) }),
  });
}
