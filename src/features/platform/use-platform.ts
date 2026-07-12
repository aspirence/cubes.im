"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

export interface PlatformOrg {
  name: string;
  owner_email: string;
  status: string;
  created_at: string;
  workspaces: number;
  members: number;
}

export interface PlatformOverview {
  orgs: number;
  users: number;
  workspaces: number;
  projects: number;
  tasks: number;
  members: number;
  guests: number;
  signups_7d: number;
  signups_30d: number;
  plan_free: number;
  plan_cloud: number;
  superadmins: number;
  recent_orgs: PlatformOrg[];
}

/** Global platform analytics (superadmin only; the RPC enforces). */
export function usePlatformOverview(enabled: boolean) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: ["platform-overview"],
    enabled,
    queryFn: async (): Promise<PlatformOverview> => {
      const { data, error } = await loose(supabase).rpc("platform_overview");
      if (error) throw error;
      return data as PlatformOverview;
    },
  });
}
