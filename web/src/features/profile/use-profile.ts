"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

export type Profile = Database["public"]["Tables"]["users"]["Row"];

/** Query key for the auth profile. Invalidated after profile mutations so any
 * React-Query-backed consumer (and the active-team derived data) re-reads. */
const profileKey = ["profile"] as const;

/**
 * Updates the current user's public.users profile row (name and/or avatar_url).
 * RLS restricts the update to the caller's own row.
 */
export function useUpdateProfile() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name?: string;
      avatar_url?: string | null;
    }): Promise<Profile> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("users")
        .update(input)
        .eq("id", user.id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKey });
    },
  });
}

/**
 * Updates the current user's auth password via supabase.auth.updateUser. The
 * user must have an active session (or be in a recovery flow).
 */
export function useUpdatePassword() {
  const supabase = useMemo(() => createClient(), []);

  return useMutation({
    mutationFn: async (input: { password: string }): Promise<void> => {
      const { error } = await supabase.auth.updateUser({
        password: input.password,
      });
      if (error) throw error;
    },
  });
}

