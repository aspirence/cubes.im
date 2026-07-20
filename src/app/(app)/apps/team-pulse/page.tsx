"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { App as AntdApp, Avatar, Button, Popover, Switch, Tag, Tooltip, theme } from "antd";
import {
  useInstalledApp,
  useInstallApp,
  useIsTeamAdmin,
} from "@/features/apps-platform/use-installed-apps";
import {
  useTeamPulse,
  useSetTeamPulseConfig,
  readTeamPulseConfig,
  formatTracked,
  type PulseRow,
} from "@/features/app-team-pulse/use-team-pulse";

/** Material Symbols Rounded glyph. */
function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

const TINTS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#3b82f6",
];
function tintFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter((c) => c && /[\p{L}\p{N}]/u.test(c))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function elapsedLabel(startedAt: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const MEMBER_TAG: Record<string, { label: string; color: string }> = {
  owner: { label: "Owner", color: "purple" },
  admin: { label: "Admin", color: "geekblue" },
  member: { label: "Member", color: "blue" },
  limited: { label: "Limited", color: "orange" },
  guest: { label: "Guest", color: "default" },
};

/** One member's live card. */
function PulseCard({ row, now }: { row: PulseRow; now: number }) {
  const { token } = theme.useToken();
  const working = Boolean(row.running_task_id);
  const active = !working && row.active_count > 0;
  const idle = !working && !active;
  const noQueue = row.todo_count === 0 && !working && !active;
  const tag = MEMBER_TAG[row.member_type ?? "member"];

  return (
    <div
      className="wl-upcoming-card"
      style={{
        borderRadius: 14,
        border: `1px solid ${working ? "#b7e0c4" : token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: working ? "0 6px 18px -8px rgba(47, 143, 95, 0.25)" : undefined,
      }}
    >
      {/* Who */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
          <Avatar
            size={36}
            src={row.avatar_url ?? undefined}
            style={{
              background: row.avatar_url ? undefined : tintFor(row.user_id),
              color: "#fff",
              fontSize: 13,
            }}
          >
            {initials(row.name)}
          </Avatar>
          <span
            aria-hidden
            style={{
              position: "absolute",
              right: -1,
              bottom: -1,
              width: 11,
              height: 11,
              borderRadius: "50%",
              border: `2px solid ${token.colorBgContainer}`,
              background: working ? "#2f8f5f" : active ? "#3d7de0" : "#c1c4cf",
            }}
          />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 650,
              color: token.colorText,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.name}
          </div>
          <Tag color={tag?.color} style={{ marginTop: 2, fontSize: 10.5, lineHeight: "16px" }}>
            {tag?.label ?? row.member_type}
          </Tag>
        </div>
        {working && row.running_started_at ? (
          <span
            className="tabular"
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#2f8f5f",
              letterSpacing: 0.3,
            }}
          >
            {elapsedLabel(row.running_started_at, now)}
          </span>
        ) : null}
      </div>

      {/* Now */}
      <div
        style={{
          borderRadius: 10,
          padding: "9px 11px",
          background: working
            ? "rgba(47, 143, 95, 0.07)"
            : active
              ? "rgba(61, 125, 224, 0.07)"
              : token.colorFillQuaternary,
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 40,
        }}
      >
        {working ? (
          <>
            <span className="wl-pulse-dot" aria-hidden />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: token.colorText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.running_task_name}
              </div>
              <div style={{ fontSize: 11, color: token.colorTextTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.running_project_name} · timer running
              </div>
            </div>
          </>
        ) : active ? (
          <>
            <MIcon name="autorenew" size={16} color="#3d7de0" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: token.colorText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.active_task_name}
              </div>
              <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
                {row.active_status_name} · no timer
              </div>
            </div>
          </>
        ) : (
          <>
            <MIcon name="bedtime" size={16} color={token.colorTextQuaternary} />
            <span style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
              Not working on anything
            </span>
          </>
        )}
      </div>

      {/* Next + today */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            minWidth: 0,
            flex: 1,
            color: row.next_task_id ? token.colorTextSecondary : "#b97f14",
          }}
        >
          <MIcon name={row.next_task_id ? "skip_next" : "report"} size={14} color={row.next_task_id ? undefined : "#d97706"} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.next_task_id ? (
              <>Next: {row.next_task_name}</>
            ) : idle && noQueue ? (
              "Nothing queued — assign something!"
            ) : (
              "Nothing queued next"
            )}
          </span>
        </span>
        <Tooltip title="Time tracked today">
          <span
            className="tabular"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, color: token.colorTextTertiary, flex: "none", fontWeight: 600 }}
          >
            <MIcon name="timer" size={13} /> {formatTracked(row.today_seconds)}
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

export default function TeamPulsePage() {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const { record, installed, enabled } = useInstalledApp("team_pulse");
  const { data: isAdmin } = useIsTeamAdmin();
  const installApp = useInstallApp();
  const setConfig = useSetTeamPulseConfig();
  const live = installed && enabled;
  const { data: rows, isLoading } = useTeamPulse(Boolean(live));
  const config = readTeamPulseConfig(record?.config);

  // Presence filter — the summary stat cards double as filter chips.
  const [filter, setFilter] = useState<
    "all" | "working" | "active" | "idle" | "unqueued"
  >("all");
  const [query, setQuery] = useState("");

  // One shared ticking clock for every card's elapsed label.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);

  const bucketOf = (r: PulseRow): "working" | "active" | "idle" =>
    r.running_task_id ? "working" : r.active_count > 0 ? "active" : "idle";
  const working = (rows ?? []).filter((r) => bucketOf(r) === "working");
  const inProgress = (rows ?? []).filter((r) => bucketOf(r) === "active");
  const idle = (rows ?? []).filter((r) => bucketOf(r) === "idle");
  const unqueued = (rows ?? []).filter((r) => r.todo_count === 0 && bucketOf(r) === "idle");
  const todaySecs = (rows ?? []).reduce((sum, r) => sum + (r.today_seconds ?? 0), 0);

  const q = query.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (filter === "working") return bucketOf(r) === "working";
    if (filter === "active") return bucketOf(r) === "active";
    if (filter === "idle") return bucketOf(r) === "idle";
    if (filter === "unqueued") return r.todo_count === 0 && bucketOf(r) === "idle";
    return true;
  });

  if (!live) {
    return (
      <div style={{ maxWidth: 560, margin: "60px auto", textAlign: "center" }}>
        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            background: "linear-gradient(135deg, #d97706, #f59e0b)",
            boxShadow: "0 12px 28px rgba(217, 119, 6, 0.28)",
          }}
        >
          <MIcon name="monitor_heart" size={32} />
        </span>
        <h2 style={{ margin: "18px 0 6px", fontSize: 24, fontWeight: 700, color: token.colorText }}>
          Team Pulse
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.65, color: token.colorTextSecondary }}>
          A live view of who&apos;s working on what — with focus rules: one task
          In Progress at a time for limited members, and timers that follow the
          Active stage automatically.
        </p>
        {isAdmin ? (
          <Button
            type="primary"
            size="large"
            loading={installApp.isPending}
            onClick={() =>
              installApp
                .mutateAsync("team_pulse")
                .then(() => message.success("Team Pulse activated!"))
                .catch(() => message.error("Couldn't install the app."))
            }
          >
            {installed ? "Enable in App Center" : "Activate Team Pulse"}
          </Button>
        ) : (
          <Tag>Ask a workspace admin to activate it from the App Center</Tag>
        )}
      </div>
    );
  }

  const stat = (
    icon: string,
    label: string,
    value: string | number,
    color: string,
    key?: "working" | "active" | "idle" | "unqueued",
  ) => (
    <div
      role={key ? "button" : undefined}
      tabIndex={key ? 0 : undefined}
      aria-pressed={key ? filter === key : undefined}
      onClick={key ? () => setFilter(filter === key ? "all" : key) : undefined}
      onKeyDown={
        key
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFilter(filter === key ? "all" : key);
              }
            }
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 12,
        border:
          key && filter === key
            ? `1.5px solid ${color}`
            : `1px solid ${token.colorBorderSecondary}`,
        background: key && filter === key ? `${color}0d` : token.colorBgContainer,
        cursor: key ? "pointer" : undefined,
        transition: "border-color .15s ease, background .15s ease",
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          flex: "none",
          borderRadius: 9,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color,
          background: `${color}1f`,
        }}
      >
        <MIcon name={icon} size={17} />
      </span>
      <div>
        <div className="tabular" style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.1, color: token.colorText }}>
          {value}
        </div>
        <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{label}</div>
      </div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`
        .wl-pulse-dot {
          width: 9px; height: 9px; border-radius: 50%; flex: none;
          background: #2f8f5f;
          animation: wl-pulse-ring 1.6s ease-out infinite;
        }
        @keyframes wl-pulse-ring {
          0% { box-shadow: 0 0 0 0 rgba(47, 143, 95, .45); }
          70% { box-shadow: 0 0 0 7px rgba(47, 143, 95, 0); }
          100% { box-shadow: 0 0 0 0 rgba(47, 143, 95, 0); }
        }
        @media (prefers-reduced-motion: reduce) { .wl-pulse-dot { animation: none; } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: token.colorText }}>
              Team Pulse
            </h1>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 0.5,
                color: "#2f8f5f",
                background: "rgba(47, 143, 95, 0.1)",
                borderRadius: 999,
                padding: "3px 9px",
              }}
            >
              <span className="wl-pulse-dot" aria-hidden /> LIVE
            </span>
          </div>
          <span style={{ fontSize: 13, color: token.colorTextTertiary }}>
            Who&apos;s working on what, right now — refreshes automatically.
          </span>
        </div>
        {isAdmin ? (
          <Popover
            trigger={["click"]}
            placement="bottomRight"
            arrow={false}
            content={
              <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 14, padding: 4 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <Switch
                    size="small"
                    checked={config.singleActive}
                    loading={setConfig.isPending}
                    onChange={(v) =>
                      setConfig.mutateAsync({ singleActive: v }).catch(() => message.error("Couldn't save."))
                    }
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>One task at a time</div>
                    <div style={{ fontSize: 11.5, color: token.colorTextTertiary, lineHeight: 1.5 }}>
                      Limited members can keep only one assigned task In Progress; a second one is blocked.
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <Switch
                    size="small"
                    checked={config.autoTimer}
                    loading={setConfig.isPending}
                    onChange={(v) =>
                      setConfig.mutateAsync({ autoTimer: v }).catch(() => message.error("Couldn't save."))
                    }
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Auto timer</div>
                    <div style={{ fontSize: 11.5, color: token.colorTextTertiary, lineHeight: 1.5 }}>
                      Moving a task into the Active stage starts the assignee&apos;s timer; moving it out stops and logs it.
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <Switch
                    size="small"
                    checked={config.showTimerWidget}
                    loading={setConfig.isPending}
                    onChange={(v) =>
                      setConfig
                        .mutateAsync({ showTimerWidget: v })
                        .catch(() => message.error("Couldn't save."))
                    }
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Timer widget in the sidebar</div>
                    <div style={{ fontSize: 11.5, color: token.colorTextTertiary, lineHeight: 1.5 }}>
                      Shows everyone their running timer at the bottom of the sidebar.
                      Turning it off only hides the widget — tracking still runs, and
                      the play/pause buttons on tasks stay.
                    </div>
                  </div>
                </div>
              </div>
            }
          >
            <Button icon={<MIcon name="tune" size={16} />}>Rules</Button>
          </Popover>
        ) : null}
      </div>

      {/* Summary strip — click a card to filter the grid by it. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        {stat("play_circle", "Working now", working.length, "#2f8f5f", "working")}
        {stat("autorenew", "In progress, no timer", inProgress.length, "#3d7de0", "active")}
        {stat("bedtime", "Idle", idle.length, "#8a8d98", "idle")}
        {stat("report", "Nothing queued", unqueued.length, "#d97706", "unqueued")}
        {stat("timer", "Tracked today", formatTracked(todaySecs), "#7c3aed")}
      </div>

      {/* Search + active-filter pill */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 32,
            padding: "0 10px",
            borderRadius: 9,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            minWidth: 220,
          }}
        >
          <MIcon name="search" size={15} color={token.colorTextTertiary} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members…"
            aria-label="Search members"
            style={{
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 13,
              color: token.colorText,
              flex: 1,
              minWidth: 0,
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              style={{ border: "none", background: "none", padding: 0, cursor: "pointer", display: "inline-flex", color: token.colorTextTertiary }}
            >
              <MIcon name="close" size={14} />
            </button>
          ) : null}
        </span>
        {filter !== "all" ? (
          <Tag
            closable
            onClose={() => setFilter("all")}
            style={{ borderRadius: 999, paddingInline: 10 }}
          >
            {filter === "working"
              ? "Working now"
              : filter === "active"
                ? "In progress, no timer"
                : filter === "idle"
                  ? "Idle"
                  : "Nothing queued"}
          </Tag>
        ) : null}
        <span style={{ marginLeft: "auto", fontSize: 12, color: token.colorTextTertiary }}>
          {visible.length} of {(rows ?? []).length} member{(rows ?? []).length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Member grid */}
      {isLoading ? (
        <div style={{ fontSize: 13, color: token.colorTextTertiary, padding: 20 }}>Loading the room…</div>
      ) : (rows ?? []).length === 0 ? (
        <div style={{ fontSize: 13, color: token.colorTextTertiary, padding: 20 }}>
          No members yet — <Link href="/people">invite your team</Link>.
        </div>
      ) : visible.length === 0 ? (
        <div style={{ fontSize: 13, color: token.colorTextTertiary, padding: 20 }}>
          No members match this filter.{" "}
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => { setFilter("all"); setQuery(""); }}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))",
            gap: 12,
          }}
        >
          {visible.map((r) => (
            <PulseCard key={r.team_member_id} row={r} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
