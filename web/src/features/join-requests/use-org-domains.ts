"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

export type OrgDomain = {
  id: string;
  organization_id: string;
  domain: string;
  verified: boolean;
  verification_method: string;
  verified_at: string | null;
  created_at: string;
};

/** An org's claimed domains (members only, via RLS). */
export function useOrgDomains(orgId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: ["org-domains", orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<OrgDomain[]> => {
      const { data, error } = await loose(supabase)
        .from("organization_domains")
        .select("*")
        .eq("organization_id", orgId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OrgDomain[];
    },
  });
}

/**
 * Claims + verifies a domain for the org. v1 verification requires the caller's
 * own email host to equal the domain (enforced server-side in claim_org_domain).
 */
export function useClaimOrgDomain() {
  const supabase = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { orgId: string; domain: string }): Promise<string> => {
      const { data, error } = await loose(supabase).rpc("claim_org_domain", {
        p_org_id: input.orgId,
        p_domain: input.domain,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ["org-domains", vars.orgId] }),
  });
}
