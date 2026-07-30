"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useNotificationSettings } from "@/features/settings/use-notification-settings";
import { useCelebrationStore, type CelebrationSignal } from "@/store/celebration-store";
import {
  useCelebrationRules,
  fetchMyCubeStats,
  fetchTaskAward,
  CUBE_MILESTONES,
  type CelebrationTemplate,
} from "./use-celebrations";
import { ConfettiCanvas } from "./confetti-canvas";
import { BurstCard, GlowCard, StatsCard, type CelebrationScreen } from "./templates";

/** How long a screen stays up before auto-advancing. */
const AUTO_DISMISS_MS = 6000;

interface ResolvedScreen extends CelebrationScreen {
  template: CelebrationTemplate;
}

/**
 * The single, globally mounted celebration surface (see app-shell). Call sites
 * only enqueue raw "task went done" signals; this controller applies EVERY
 * gate — team rules (enabled/template), the member's personal mute, the
 * fresh-award ledger lookup, and milestone derivation — then shows the
 * resolved screens sequentially (completing a task that also crosses a
 * milestone shows two screens back-to-back).
 *
 * Celebrations are cosmetic only: nothing here writes the ledger, and the
 * "+N cubes" copy renders ONLY when a fresh ledger row proves an award landed
 * (re-completions and non-assignee completers get confetti, not points).
 */
export function CelebrationOverlay() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  const queue = useCelebrationStore((s) => s.queue);
  const shift = useCelebrationStore((s) => s.shift);
  const signal = queue[0];

  const { data: rules } = useCelebrationRules();
  // isPending matters: while the settings query is in flight, `settings` is
  // undefined and a falsy read of celebrations_muted would BYPASS the mute.
  const { data: settings, isPending: settingsPending } = useNotificationSettings();

  const [screens, setScreens] = useState<ResolvedScreen[] | null>(null);
  const [index, setIndex] = useState(0);
  // Guards the async resolution against re-entry and against a signal being
  // shifted while its lookup is still in flight.
  const resolvingFor = useRef<CelebrationSignal | null>(null);

  const ruleFor = (key: string) => rules?.find((r) => r.event_key === key);

  /* ------------------------------------------------ resolve queue[0] */
  useEffect(() => {
    if (!signal || screens !== null || resolvingFor.current === signal) return;
    // Config AND the mute preference must be loaded before a real signal can
    // be judged (cached after first load, so this only defers the first one).
    if (!signal.preview && (!rules || !teamId || !user || settingsPending)) return;

    resolvingFor.current = signal;
    // Narrowed copies: TS can't carry the sync guard's narrowing into the
    // async closure.
    const tid = teamId;
    const uid = user?.id;
    // All state updates happen in the async continuation — a synchronous
    // setState inside an effect body cascades renders (react-hooks rule).
    (async () => {
      // Settings preview bypasses every gate — it must render even when muted.
      if (signal.preview) {
        if (resolvingFor.current !== signal) return;
        resolvingFor.current = null;
        setScreens([
          {
            eventKey: "task_completed",
            eventLabel: "Task completed",
            taskName: signal.taskName ?? "Design the launch banner",
            points: 10,
            balance: 50,
            eventsToday: 3,
            template: signal.preview!,
          },
        ]);
        setIndex(0);
        return;
      }

      const taskRule = ruleFor("task_completed");
      const milestoneRule = ruleFor("cube_milestone");
      // Muted / nothing enabled → swallow the signal.
      if (
        settings?.celebrations_muted ||
        (!taskRule?.enabled && !milestoneRule?.enabled)
      ) {
        resolvingFor.current = null;
        shift(signal);
        return;
      }
      const next: ResolvedScreen[] = [];
      let award = { points: 0, fresh: false };
      let stats: { balance: number; eventsToday: number } | null = null;
      try {
        if (!tid || !uid) return;
        // Both reads happen AFTER the award committed (same transaction as the
        // task PATCH), so `stats.balance` already includes this signal's award
        // — deriving prev by subtraction is race-free even for queued signals.
        award = await fetchTaskAward(supabase, tid, signal.taskId, uid, signal.at);
        stats = await fetchMyCubeStats(supabase, tid, uid);
      } catch {
        // Ledger reads failing must never block the celebration itself.
      }

      const balanceNow = stats?.balance ?? null;
      const prevBalance =
        balanceNow != null ? balanceNow - (award.fresh ? award.points : 0) : null;

      if (taskRule?.enabled) {
        next.push({
          eventKey: "task_completed",
          eventLabel: taskRule.label || "Task completed",
          taskName: signal.taskName,
          points: award.fresh ? award.points : null,
          balance: balanceNow,
          eventsToday: stats?.eventsToday,
          template: taskRule.template,
        });
      }

      // Milestone: crossed when THIS award moved the balance over a line.
      // prev-by-subtraction means a later queued signal can't re-claim a line
      // an earlier one already crossed.
      if (
        milestoneRule?.enabled &&
        award.fresh &&
        balanceNow != null &&
        prevBalance != null
      ) {
        const crossed = [...CUBE_MILESTONES]
          .filter((m) => prevBalance < m && m <= balanceNow)
          .pop();
        if (crossed) {
          next.push({
            eventKey: "cube_milestone",
            eventLabel: milestoneRule.label || "Cube milestone reached",
            points: null,
            balance: balanceNow,
            eventsToday: stats?.eventsToday,
            milestone: crossed,
            template: milestoneRule.template,
          });
        }
      }

      if (award.fresh) {
        queryClient.invalidateQueries({ queryKey: ["my-cube-balance", teamId] });
        queryClient.invalidateQueries({ queryKey: ["cube-leaderboard", teamId] });
      }

      if (resolvingFor.current !== signal) return; // signal superseded
      resolvingFor.current = null;
      if (next.length === 0) {
        shift(signal);
      } else {
        setScreens(next);
        setIndex(0);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal, screens, rules, settings, settingsPending, teamId, user]);

  /* --------------------------------------------------- advance/dismiss */
  const advance = () => {
    if (!screens) return;
    if (index + 1 < screens.length) {
      setIndex(index + 1);
    } else {
      setScreens(null);
      setIndex(0);
      // Conditional: timer/Escape/click can race on the last screen; only the
      // first consumes the queue head (see celebration-store).
      shift(signal);
    }
  };

  const current = screens?.[index] ?? null;

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(advance, AUTO_DISMISS_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") advance();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
    // advance identity changes with screens/index by design; re-arm per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-label={current.eventLabel}
      onClick={advance}
      style={{
        position: "fixed",
        inset: 0,
        // Above AntD drawers/modals (default z ~1000) — completing from the
        // task drawer is the most common path.
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(10, 11, 20, 0.45)",
        backdropFilter: "blur(3px)",
        animation: "cele-fade .25s ease both",
        cursor: "pointer",
      }}
    >
      <style>{`
        @keyframes cele-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cele-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes cele-pop { 0% { opacity: 0; transform: scale(.92); } 60% { transform: scale(1.02); } 100% { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) {
          .cele-card { animation: cele-fade .2s ease both !important; }
        }
      `}</style>
      <ConfettiCanvas key={`${index}-${current.eventKey}`} />
      <div
        className="cele-card"
        style={{
          animation: `${current.template === "burst" ? "cele-pop .35s" : "cele-rise .4s"} ease both`,
          cursor: "default",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {current.template === "glow" ? (
          <GlowCard screen={current} />
        ) : current.template === "stats" ? (
          <StatsCard screen={current} />
        ) : (
          <BurstCard screen={current} />
        )}
      </div>
    </div>
  );
}
