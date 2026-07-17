"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";
import type { Json } from "@/types/database";
import {
  type DashboardCard,
  type CardKind,
  DEFAULT_FILTER,
  defaultDashboardCards,
} from "./dashboard-types";

const dashboardKey = (userId: string | undefined) =>
  ["user-dashboard", userId] as const;
const SAVE_MUTATION_KEY = ["user-dashboard-save"] as const;

const VALID_KINDS: CardKind[] = [
  "chart",
  "metric",
  "tasks",
  "activity",
  "todo",
];

/** Coerce a stored JSON entry into a valid DashboardCard, or null if unusable. */
function parseCard(raw: unknown): DashboardCard | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  if (typeof r.kind !== "string" || !VALID_KINDS.includes(r.kind as CardKind)) {
    return null;
  }
  const filterRaw = (r.filter ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    kind: r.kind as CardKind,
    title: typeof r.title === "string" ? r.title : "Card",
    span: r.span === "full" ? "full" : "half",
    w: typeof r.w === "number" ? Math.max(1, Math.min(4, Math.round(r.w))) : undefined,
    h: typeof r.h === "number" ? r.h : undefined,
    chart: r.chart as DashboardCard["chart"],
    groupBy: r.groupBy as DashboardCard["groupBy"],
    metric: r.metric as DashboardCard["metric"],
    limit: typeof r.limit === "number" ? r.limit : undefined,
    filter: {
      ...DEFAULT_FILTER,
      ...filterRaw,
      projectIds: Array.isArray(filterRaw.projectIds)
        ? (filterRaw.projectIds as string[])
        : [],
      assigneeIds: Array.isArray(filterRaw.assigneeIds)
        ? (filterRaw.assigneeIds as string[])
        : [],
      priorities: Array.isArray(filterRaw.priorities)
        ? (filterRaw.priorities as string[])
        : [],
      statuses: Array.isArray(filterRaw.statuses)
        ? (filterRaw.statuses as string[])
        : [],
      completedWithin:
        filterRaw.completedWithin === "today" ||
        filterRaw.completedWithin === "week" ||
        filterRaw.completedWithin === "month"
          ? filterRaw.completedWithin
          : "any",
    },
  };
}

/**
 * The signed-in user's Home layout as an ordered list of configurable cards.
 * Legacy layouts (arrays of widget-key strings) and empty rows fall back to the
 * default card set, so older stored data never breaks.
 */
export function useDashboardCards() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: dashboardKey(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<DashboardCard[]> => {
      const { data, error } = await supabase
        .from("user_dashboards")
        .select("layout")
        .eq("user_id", userId as string)
        .maybeSingle();
      if (error) throw error;
      const layout = data?.layout;
      if (Array.isArray(layout)) {
        const cards = layout
          .map(parseCard)
          .filter((c): c is DashboardCard => c !== null);
        // A genuinely-empty saved array means the user cleared the dashboard —
        // honor it. Only fall back to defaults when the row is absent or the
        // stored array is a legacy/non-parseable form (non-empty → 0 cards).
        if (cards.length > 0 || layout.length === 0) return cards;
      }
      return defaultDashboardCards();
    },
  });
}

/** Saves the user's dashboard cards (upsert on the single per-user row). */
export function useSaveDashboardCards() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  return useMutation({
    // Serialize saves to the single per-user row so rapid edits (remove, drag,
    // resize, template) can't race into out-of-order upserts.
    mutationKey: SAVE_MUTATION_KEY,
    scope: { id: "user-dashboard-save" },
    mutationFn: async (cards: DashboardCard[]): Promise<void> => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("user_dashboards").upsert({
        user_id: userId,
        layout: cards as unknown as Json,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onMutate: async (cards) => {
      // Optimistic: reflect the new layout immediately (edit mode feels live).
      await queryClient.cancelQueries({ queryKey: dashboardKey(userId) });
      const prev = queryClient.getQueryData<DashboardCard[]>(dashboardKey(userId));
      queryClient.setQueryData(dashboardKey(userId), cards);
      return { prev };
    },
    onError: (_err, _cards, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(dashboardKey(userId), ctx.prev);
    },
    onSettled: () => {
      // Only refetch once no saves remain in flight, so an earlier save's
      // settle doesn't clobber a later optimistic layout mid-chain.
      if (queryClient.isMutating({ mutationKey: SAVE_MUTATION_KEY }) === 1) {
        queryClient.invalidateQueries({ queryKey: dashboardKey(userId) });
      }
    },
  });
}
