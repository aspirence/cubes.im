"use client";

import { useMemo, useState } from "react";
import { theme, Typography } from "antd";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAppActivatedProjects } from "@/features/apps-platform/app-scope";
import { useTeamFiles } from "@/features/app-files/use-files";
import { FilesBrowser } from "@/features/app-files/files-browser";

const { Text } = Typography;

function MIcon({ name, size = 17, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/** Files hub — projects live in the app's own secondary rail. */
export default function FilesHubPage() {
  const { token } = theme.useToken();
  const C = useMemo(
    () => ({
      bg: token.colorBgLayout,
      hairline: token.colorBorderSecondary,
      text: token.colorText,
      textSecondary: token.colorTextSecondary,
      textTertiary: token.colorTextTertiary,
      accent: "#2f9c9c",
      accentSoft: "rgba(47,156,156,0.12)",
    }),
    [token],
  );
  const { data: activeTeam } = useActiveTeam();
  const { data: projects } = useAppActivatedProjects("files");
  const { data: files } = useTeamFiles();

  // "all" | "team" (no project) | <projectId>
  const [sel, setSel] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let teamWide = 0;
    for (const f of files ?? []) {
      if (f.project_id) map.set(f.project_id, (map.get(f.project_id) ?? 0) + 1);
      else teamWide += 1;
    }
    return { map, teamWide, total: (files ?? []).length };
  }, [files]);

  const projectRows = useMemo(
    () =>
      (projects ?? [])
        .map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color_code ?? "#8a8d98",
          count: counts.map.get(p.id) ?? 0,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [projects, counts.map],
  );
  const visibleRows = showAll
    ? projectRows
    : projectRows.filter((p) => p.count > 0 || p.id === sel);
  const hidden = projectRows.length - visibleRows.length;

  const row = (
    key: string,
    label: React.ReactNode,
    icon: React.ReactNode,
    count?: number,
  ) => {
    const on = sel === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setSel(key)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "7px 10px",
          borderRadius: 8,
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          background: on ? C.accentSoft : "transparent",
          color: on ? C.accent : C.textSecondary,
          fontSize: 13.5,
          fontWeight: on ? 600 : 500,
        }}
      >
        {icon}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        {typeof count === "number" ? (
          <span style={{ fontSize: 11.5, color: on ? C.accent : C.textTertiary }}>{count}</span>
        ) : null}
      </button>
    );
  };

  const browserScope: string | null | undefined =
    sel === "all" ? undefined : sel === "team" ? null : sel;
  const heading =
    sel === "all"
      ? "All files"
      : sel === "team"
        ? "Team-wide files"
        : projectRows.find((p) => p.id === sel)?.name ?? "Project";

  return (
    <div
      className="wl-files-shell"
      style={{
        display: "flex",
        height: "calc(100vh - 58px)",
        margin: "-22px -24px -48px",
        background: C.bg,
        overflow: "hidden",
      }}
    >
      <style>{`@media (max-width:900px){.wl-files-shell{flex-direction:column;height:auto;overflow:visible;margin-left:0;margin-right:0}.wl-files-shell>aside{width:100%;border-right:none;border-bottom:1px solid ${token.colorBorderSecondary}}}`}</style>
      {/* Files rail — projects as the secondary sidebar */}
      <aside
        style={{
          width: 240,
          flex: "none",
          minHeight: 0,
          borderRight: `1px solid ${C.hairline}`,
          background: token.colorBgContainer,
          padding: "16px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 12px" }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "linear-gradient(135deg,#2f9c9c,#237a7a)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MIcon name="folder_shared" size={18} color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: C.text, fontSize: 14, lineHeight: 1.15 }}>Files</div>
            <div style={{ fontSize: 11, color: C.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeTeam?.name ?? "Workspace"}
            </div>
          </div>
        </div>

        {row("all", "All files", <MIcon name="home_storage" size={17} color={sel === "all" ? C.accent : C.textTertiary} />, counts.total)}
        {row("team", "Team-wide", <MIcon name="groups" size={17} color={sel === "team" ? C.accent : C.textTertiary} />, counts.teamWide)}

        <div
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: 0.8,
            color: C.textTertiary,
            padding: "12px 10px 4px",
          }}
        >
          ALL PROJECTS ({projectRows.length})
        </div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
          {visibleRows.map((p) =>
            row(
              p.id,
              p.name,
              <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color, flex: "none" }} />,
              p.count,
            ),
          )}
          {hidden > 0 || showAll ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              style={{
                border: "none",
                background: "transparent",
                color: C.textTertiary,
                fontSize: 12,
                cursor: "pointer",
                textAlign: "left",
                padding: "6px 10px",
              }}
            >
              {showAll ? "Show fewer projects" : `Show all projects (${hidden} empty)`}
            </button>
          ) : null}
        </div>
      </aside>

      {/* Content — scrolls within itself */}
      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "20px 24px 40px" }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text }}>{heading}</h2>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            Internal sharing — view-only or downloadable, watermarked previews,
            one-click publish. Reachable on your WiFi via the LAN URL.
          </Text>
        </div>
        {/* Key remount on scope change resets folder selection cleanly. */}
        <FilesBrowser key={sel} projectId={browserScope} />
      </main>
    </div>
  );
}
