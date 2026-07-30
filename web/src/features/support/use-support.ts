"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type SupportRequest =
  Database["public"]["Tables"]["support_requests"]["Row"];

/** Input for creating a support request. */
export type CreateSupportRequestInput = {
  subject: string;
  message: string;
};

const supportRequestsKey = ["support", "requests"] as const;

/**
 * Lists the current user's support requests, newest first. RLS keeps these
 * private to the requesting user.
 */
export function useSupportRequests() {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: supportRequestsKey,
    queryFn: async (): Promise<SupportRequest[]> => {
      const { data, error } = await supabase
        .from("support_requests")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Creates a support request for the current user, stamped with the active team.
 * `user_id` is the authenticated user; `team_id` is the active team (or null).
 */
export function useCreateSupportRequest() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useMutation({
    mutationFn: async (
      input: CreateSupportRequestInput,
    ): Promise<SupportRequest> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("support_requests")
        .insert({
          subject: input.subject,
          message: input.message,
          user_id: user.id,
          team_id: teamId ?? null,
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supportRequestsKey });
    },
  });
}
