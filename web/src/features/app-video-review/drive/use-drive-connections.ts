"use client";

/**
 * The team's Google connections, as Video Review needs them.
 *
 * A near-copy of the Sheets hook rather than an import from
 * @/features/app-sheets: the apps are installed independently, and a Video
 * Review page that pulls in the Sheets data layer to ask one question would
 * couple two apps that have nothing else in common. The query is four columns
 * and a boolean; the duplication is cheaper than the coupling.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";

export interface DriveConnection {
  id: string;
  email: string | null;
  /** False when Google revoked the grant, or an admin disabled the row. */
  usable: boolean;
  lastTestError: string | null;
}

/** The Google tables are newer than the generated database types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

export function useDriveConnections() {
  const supabase = useMemo(() => loose(createClient()), []);
  const { data: team } = useActiveTeam();
  const teamId = team?.id;
  return useQuery({
    queryKey: ["video-review-google-connections", teamId],
    enabled: Boolean(teamId),
    queryFn: async (): Promise<DriveConnection[]> => {
      const { data, error } = await supabase
        .from("app_google_connections")
        .select(
          "id, google_account_email, revoked_at, enabled, has_refresh_token, last_test_error, created_at",
        )
        .eq("team_id", teamId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        email: typeof r.google_account_email === "string" ? r.google_account_email : null,
        usable: !r.revoked_at && r.enabled !== false && r.has_refresh_token !== false,
        lastTestError: typeof r.last_test_error === "string" ? r.last_test_error : null,
      }));
    },
    // Consent finishes in another tab and returns here by redirect, so the
    // answer goes stale quickly and a cached "not connected" would strand the
    // user on the Connect button they just used.
    staleTime: 15_000,
  });
}

/** The chosen connection, else the newest usable one, else null. */
export function pickDriveConnection(
  connections: DriveConnection[] | undefined,
  connectionId: string | null,
): DriveConnection | null {
  const usable = (connections ?? []).filter((c) => c.usable);
  return usable.find((c) => c.id === connectionId) ?? usable[0] ?? null;
}

/**
 * Where the Google consent flow sends the user back to. The Drive picker lives
 * inside a modal, so the return URL carries a marker the modal reads on mount
 * to reopen itself — connecting Google must not cost the user the half-filled
 * form they were in.
 */
export function connectDriveHref(teamId: string, returnTo: string): string {
  return `/api/integrations/google/start?teamId=${encodeURIComponent(teamId)}&returnTo=${encodeURIComponent(returnTo)}`;
}
