"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";

export interface PlatformPricing {
  /** Optional flat platform fee (default 0 under per-user pricing). */
  base_price_cents: number;
  /** Per-seat monthly price. */
  price_per_user_cents: number;
  base_storage_gb: number;
  price_per_gb_cents: number;
  currency: string;
  benefits: string[];
}

export const DEFAULT_PRICING: PlatformPricing = {
  base_price_cents: 0,
  price_per_user_cents: 100, // $1 / user / month
  base_storage_gb: 100,
  price_per_gb_cents: 20,
  currency: "USD",
  benefits: [],
};

// platform_pricing / team_subscriptions are newer than the generated types.
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** Cost in cents for storage above the included allotment. */
export function storageOverageCents(p: PlatformPricing, storageGb: number): number {
  return Math.max(0, storageGb - p.base_storage_gb) * p.price_per_gb_cents;
}

/**
 * Effective monthly price in cents: an optional flat base + per-seat charge for
 * every member + extra-storage overage.
 */
export function computeMonthlyCents(
  p: PlatformPricing,
  storageGb: number,
  members: number,
): number {
  return (
    p.base_price_cents +
    Math.max(0, members) * p.price_per_user_cents +
    storageOverageCents(p, storageGb)
  );
}

export function money(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

/** Is the signed-in user a platform super-admin? */
export function useIsPlatformAdmin() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  return useQuery({
    queryKey: ["platform-admin", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await loose(supabase).rpc("is_platform_admin");
      if (error) return false;
      return Boolean(data);
    },
  });
}

/** The global pricing config (public read). */
export function usePlatformPricing() {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: ["platform-pricing"],
    queryFn: async (): Promise<PlatformPricing> => {
      const { data, error } = await loose(supabase)
        .from("platform_pricing")
        .select("*")
        .eq("id", true)
        .maybeSingle();
      if (error || !data) return DEFAULT_PRICING;
      return {
        base_price_cents: Number(data.base_price_cents),
        price_per_user_cents: Number(data.price_per_user_cents ?? 100),
        base_storage_gb: Number(data.base_storage_gb),
        price_per_gb_cents: Number(data.price_per_gb_cents),
        currency: data.currency ?? "USD",
        benefits: Array.isArray(data.benefits) ? (data.benefits as string[]) : [],
      };
    },
  });
}

/** Super-admin: save the global pricing config. */
export function useUpdatePlatformPricing() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (p: PlatformPricing): Promise<void> => {
      const { error } = await loose(supabase).from("platform_pricing").upsert(
        {
          id: true,
          base_price_cents: p.base_price_cents,
          price_per_user_cents: p.price_per_user_cents,
          base_storage_gb: p.base_storage_gb,
          price_per_gb_cents: p.price_per_gb_cents,
          currency: p.currency,
          benefits: p.benefits,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        },
        { onConflict: "id" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform-pricing"] }),
  });
}

export interface TeamSubscription {
  storage_gb: number;
  status: string;
  plan: string;
  seats: number | null;
  dodo_customer_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

/** The active team's subscription: chosen storage + Dodo status/period. */
export function useTeamSubscription() {
  const supabase = useMemo(() => createClient(), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useQuery({
    queryKey: ["team-subscription", teamId],
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TeamSubscription> => {
      const { data, error } = await loose(supabase)
        .from("team_subscriptions")
        .select("storage_gb, status, plan, seats, dodo_customer_id, current_period_end, cancel_at_period_end")
        .eq("team_id", teamId as string)
        .maybeSingle();
      if (error || !data)
        return {
          storage_gb: 100,
          status: "active",
          plan: "free",
          seats: null,
          dodo_customer_id: null,
          current_period_end: null,
          cancel_at_period_end: false,
        };
      return {
        storage_gb: Number(data.storage_gb),
        status: data.status ?? "active",
        plan: data.plan ?? "free",
        seats: data.seats == null ? null : Number(data.seats),
        dodo_customer_id: data.dodo_customer_id ?? null,
        current_period_end: data.current_period_end ?? null,
        cancel_at_period_end: Boolean(data.cancel_at_period_end),
      };
    },
  });
}

export interface PaymentRecord {
  id: string;
  created_at: string;
  amount: number; // tax-inclusive total charged
  currency: string;
  status: string;
  invoice_id: string | null;
  invoice_url: string | null; // Dodo's downloadable invoice/receipt PDF
}

export interface SubscriptionDetails {
  configured: boolean;
  subscribed: boolean;
  status?: string;
  /** Recurring charge in cents, PRE-TAX (label accordingly in the UI). */
  amount_cents?: number;
  tax_inclusive?: boolean | null;
  currency?: string;
  next_billing_date?: string;
  previous_billing_date?: string;
  created_at?: string;
  trial_period_days?: number;
  cancel_at_period_end?: boolean;
  payments?: PaymentRecord[];
  /** True when Dodo's payment list couldn't be fetched (vs genuinely empty). */
  payments_error?: boolean;
}

/**
 * Live subscription + payment history from Dodo (via our server route).
 *
 * IMPORTANT: this THROWS on a non-OK response instead of returning a
 * "not subscribed" sentinel. A transient failure (Dodo outage, 503) must surface
 * as isError so react-query retries and KEEPS the last good data — never silently
 * flip a paying customer to the free/checkout state (which risked double-billing).
 */
export function useSubscriptionDetails(teamId: string | undefined) {
  return useQuery({
    queryKey: ["subscription-details", teamId],
    enabled: Boolean(teamId),
    queryFn: async (): Promise<SubscriptionDetails> => {
      const res = await fetch(`/api/billing/subscription?teamId=${teamId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Subscription lookup failed (${res.status})`);
      }
      return res.json();
    },
    retry: 2,
  });
}

async function billingPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json?.error as string) || "Request failed");
  return json;
}

/** Refetches subscription state after cancel / resume / reconcile. */
function useBillingRefresh(teamId: string | undefined) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] });
    queryClient.invalidateQueries({ queryKey: ["subscription-details", teamId] });
  };
}

export function useReconcileSubscription(teamId: string | undefined) {
  const refresh = useBillingRefresh(teamId);
  return useMutation({
    mutationFn: (subscriptionId: string) =>
      billingPost("/api/billing/reconcile", { teamId, subscriptionId }),
    onSuccess: refresh,
  });
}

export function useCancelSubscription(teamId: string | undefined) {
  const refresh = useBillingRefresh(teamId);
  return useMutation({
    mutationFn: (resume: boolean) => billingPost("/api/billing/cancel", { teamId, resume }),
    onSuccess: refresh,
  });
}

export function useUpdateTeamStorage() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useMutation({
    mutationFn: async (storageGb: number): Promise<void> => {
      if (!teamId) throw new Error("No active team");
      const { error } = await loose(supabase).from("team_subscriptions").upsert(
        { team_id: teamId, storage_gb: storageGb, updated_at: new Date().toISOString() },
        { onConflict: "team_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] }),
  });
}
