"use client";

import { useCallback, useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";
import {
  extractMentions,
  type MentionEntity,
  type MentionMember,
} from "@/features/team-members/team-mention-input";

/** RPC/table access newer than (or looser than) the generated types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** Hard ceiling on fan-out per message — a tagged big team must not spray hundreds of rows. */
const MAX_NOTIFICATIONS = 50;

/**
 * Client-side mention fan-out for composers WITHOUT a server trigger (chat;
 * task comments already notify people via notify_task_comment_mentions, so
 * they pass onlyTeams). Tagging a TEAM notifies that team's members: the
 * team_members read is RLS-scoped, so tagging a team the author can't see
 * resolves to nobody rather than leaking. create_notification is SECURITY
 * DEFINER and applies each recipient's own mute prefs server-side.
 */
export function useNotifyMentions() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();

  return useCallback(
    async (input: {
      text: string;
      members: MentionMember[];
      entities?: MentionEntity[];
      /** e.g. "Priya mentioned you in #general" — built by the caller. */
      message: string;
      url: string;
      /** The team the content lives in (per-team mute scoping). */
      teamId?: string;
      /** Skip person-mentions (already handled server-side, e.g. task comments). */
      onlyTeams?: boolean;
    }): Promise<void> => {
      if (!user) return;
      const { userIds, teamIds } = extractMentions(
        input.text,
        input.members,
        input.entities ?? [],
      );

      // recipient -> the team whose mute prefs apply. Direct mentions scope to
      // the content's team; a tagged team's members scope to THAT team (a
      // cross-team recipient has no prefs row in the sender's team, so scoping
      // by the sender's team would make their mute unenforceable). Direct
      // scoping wins when someone is both mentioned and in a tagged team.
      const targets = new Map<string, string | null>();
      for (const teamId of teamIds) {
        const { data } = await loose(supabase)
          .from("team_members")
          .select("user_id")
          .eq("team_id", teamId)
          .eq("active", true);
        for (const row of (data ?? []) as { user_id: string }[]) {
          targets.set(row.user_id, teamId);
        }
      }
      if (!input.onlyTeams) {
        for (const userId of userIds) targets.set(userId, input.teamId ?? null);
      }
      targets.delete(user.id);
      if (targets.size === 0) return;

      const list = [...targets.entries()].slice(0, MAX_NOTIFICATIONS);
      // Best-effort: a failed notification must never surface as a send error.
      await Promise.allSettled(
        list.map(([userId, teamId]) =>
          loose(supabase).rpc("create_notification", {
            p_user_id: userId,
            p_message: input.message,
            p_type: "mention",
            p_url: input.url,
            p_team_id: teamId,
          }),
        ),
      );
    },
    [supabase, user],
  );
}
