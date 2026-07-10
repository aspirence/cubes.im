"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type TeamDetailsRow = Database["public"]["Tables"]["team_details"]["Row"];

/** The company profile a workspace owner fills in (all fields optional). */
export interface TeamDetailsInput {
  companyName?: string;
  industry?: string;
  companySize?: string;
  website?: string;
  contactEmail?: string;
  contactNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  taxId?: string;
}

const detailsKey = (teamId: string | undefined) => ["team-details", teamId];

/** The workspace's company profile (null when none saved yet). */
export function useTeamDetails(teamId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: detailsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TeamDetailsRow | null> => {
      const { data, error } = await supabase
        .from("team_details")
        .select("*")
        .eq("team_id", teamId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

const trimmed = (v?: string) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/** Upserts the workspace company profile (admins/owners only via RLS). */
export function useSaveTeamDetails() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teamId,
      details,
    }: {
      teamId: string;
      details: TeamDetailsInput;
    }): Promise<void> => {
      const { error } = await supabase.from("team_details").upsert(
        {
          team_id: teamId,
          company_name: trimmed(details.companyName),
          industry: trimmed(details.industry),
          company_size: trimmed(details.companySize),
          website: trimmed(details.website),
          contact_email: trimmed(details.contactEmail),
          contact_number: trimmed(details.contactNumber),
          address_line_1: trimmed(details.addressLine1),
          address_line_2: trimmed(details.addressLine2),
          city: trimmed(details.city),
          state: trimmed(details.state),
          country: trimmed(details.country),
          postal_code: trimmed(details.postalCode),
          tax_id: trimmed(details.taxId),
        },
        { onConflict: "team_id" },
      );
      if (error) throw error;
    },
    onSuccess: (_void, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: detailsKey(teamId) });
    },
  });
}
