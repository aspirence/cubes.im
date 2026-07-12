"use client";

import { useState } from "react";
import Link from "next/link";
import { theme, Typography } from "antd";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useProjects } from "@/features/projects/use-projects";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useInstalledApps } from "@/features/apps-platform/use-installed-apps";

const { Text } = Typography;

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, color, lineHeight: 1 }}
    >
      {name}
    </span>
  );
}

const dismissKey = (teamId: string) => `cubes.getting-started.${teamId}`;

interface Step {
  key: string;
  icon: string;
  title: string;
  desc: string;
  href: string;
  done: boolean;
}

/**
 * First-run checklist shown on Home while a workspace is still fresh (few
 * projects/tasks/members). Steps auto-complete from live data; the card is
 * dismissible per team (localStorage) and disappears on its own once every
 * step is done.
 */
export function GettingStarted({
  tasksCount,
  tasksLoading,
}: {
  tasksCount: number;
  tasksLoading: boolean;
}) {
  const { token } = theme.useToken();
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: members, isLoading: membersLoading } = useTeamMembers();
  const { data: installedApps, isLoading: appsLoading } = useInstalledApps();

  // Re-read the dismiss flag whenever the team changes (state-from-props reset).
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const dismissed =
    typeof window !== "undefined" && teamId
      ? dismissedFor === teamId || window.localStorage.getItem(dismissKey(teamId)) === "1"
      : true;

  if (!teamId || dismissed) return null;
  if (projectsLoading || membersLoading || appsLoading || tasksLoading) return null;

  const steps: Step[] = [
    {
      key: "project",
      icon: "layers",
      title: "Your first project is ready",
      desc: "We created “My First Project” in your Space — open it and make it yours.",
      href: "/projects",
      done: (projects ?? []).length > 0,
    },
    {
      key: "task",
      icon: "check_circle",
      title: "Add your first task",
      desc: "Open a project and add tasks — or hit “+ New” up top.",
      href: "/projects",
      done: tasksCount > 0,
    },
    {
      key: "invite",
      icon: "group_add",
      title: "Invite your teammates",
      desc: "Bring the team in from Settings → Members.",
      href: "/settings/members",
      done: (members ?? []).length > 1,
    },
    {
      key: "apps",
      icon: "apps",
      title: "Explore the App Center",
      desc: "Docs, video review, client portals, HR and more.",
      href: "/apps",
      done: (installedApps ?? []).some((a) => a.enabled),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  // Everything done — the workspace has taken off; retire the card for good.
  if (doneCount === steps.length) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(dismissKey(teamId), "1");
    }
    return null;
  }

  const dismiss = () => {
    window.localStorage.setItem(dismissKey(teamId), "1");
    setDismissedFor(teamId);
  };

  return (
    <section
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 14px",
          borderBottom: `1px solid ${token.colorSplit}`,
        }}
      >
        <MIcon name="rocket_launch" size={17} color="#4a4ad0" />
        <Text strong style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>
          Get started with your workspace
        </Text>
        <Text style={{ fontSize: 12, color: token.colorTextTertiary, flex: "none" }}>
          {doneCount} of {steps.length}
        </Text>
        <button
          type="button"
          aria-label="Dismiss getting started"
          title="Dismiss"
          onClick={dismiss}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: token.colorTextQuaternary,
            display: "inline-flex",
            padding: 3,
            borderRadius: 6,
          }}
        >
          <MIcon name="close" size={16} />
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 0,
        }}
      >
        {steps.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "14px 16px",
              color: "inherit",
              textDecoration: "none",
              opacity: s.done ? 0.62 : 1,
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                flex: "none",
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: s.done ? "rgba(58,157,110,.14)" : token.colorFillTertiary,
                color: s.done ? "#3a9d6e" : token.colorTextSecondary,
              }}
            >
              <MIcon name={s.done ? "check" : s.icon} size={15} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: token.colorText,
                  textDecoration: s.done ? "line-through" : "none",
                }}
              >
                {s.title}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  color: token.colorTextTertiary,
                  marginTop: 2,
                  lineHeight: 1.45,
                }}
              >
                {s.desc}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
