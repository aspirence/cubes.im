"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Completes onboarding via the complete_account_setup RPC: renames the caller's
 * active team + owning organization and flips users.setup_completed to true.
 * Returns the (active) team id.
 *
 * After success we refresh the session so the <AuthProvider>'s
 * onAuthStateChange fires and reloads the public.users profile (whose
 * setup_completed gate decides whether onboarding is shown). We also invalidate
 * the "profile" and "active-team" query keys for any React-Query consumers.
 */
export function useCompleteSetup() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      teamName: string;
      organizationName?: string;
    }): Promise<string> => {
      const { data, error } = await supabase.rpc("complete_account_setup", {
        p_team_name: input.teamName,
        p_organization_name: input.organizationName,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async () => {
      // Force the auth provider to re-read the (now setup_completed) profile.
      await supabase.auth.refreshSession();
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["active-team"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    },
  });
}
