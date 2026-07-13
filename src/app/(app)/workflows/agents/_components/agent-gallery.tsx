"use client";

import { useMemo } from "react";
import { App as AntdApp, Avatar, Skeleton, Switch, theme, Tooltip } from "antd";
import {
  readAgentConfig,
  AGENT_CONTEXTS,
  type AgentContextKey,
} from "@/features/workflows/agent-config";
import {
  useToggleAgentActive,
  type Agent,
} from "@/features/workflows/use-agents";

type GalleryAgent = Agent & { kind?: string | null; is_active?: boolean | null };

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

function initials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface Cap {
  label: string;
  accent: string;
}

function capsFor(agent: GalleryAgent): Cap[] {
  if (agent.kind === "ops_manager") {
    return [
      { label: "Delivery scans", accent: "#4a4ad0" },
      { label: "Chat nudges", accent: "#e0559b" },
    ];
  }
  const config = readAgentConfig(agent.data_scope);
  const keys = Array.from(
    new Set(config.trainingTasks.flatMap((t) => t.mentions)),
  ).slice(0, 3) as AgentContextKey[];
  const caps = keys
    .map((k) => AGENT_CONTEXTS.find((c) => c.key === k))
    .filter(Boolean)
    .map((c) => ({ label: c!.title, accent: c!.accent }));
  return caps.length ? caps : [{ label: "General assistant", accent: "#6a6d78" }];
}

/**
 * The agent gallery: a responsive card grid with a "New agent" tile first, then
 * a rich card per agent (mascot, description, capability chips, and an
 * active/paused badge with a quick toggle).
 */
export function AgentGallery({
  agents,
  isLoading,
  onSelect,
  onCreate,
}: {
  agents: Agent[];
  isLoading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const toggleActive = useToggleAgentActive();

  const grid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: 16,
    alignItems: "stretch",
  };

  const sorted = useMemo(
    () =>
      // is_active / kind are runtime columns (select *), newer than generated types.
      [...(agents as GalleryAgent[])].sort((a, b) => {
        // Active first, then alphabetical.
        const av = a.is_active === false ? 1 : 0;
        const bv = b.is_active === false ? 1 : 0;
        if (av !== bv) return av - bv;
        return (a.name ?? "").localeCompare(b.name ?? "");
      }),
    [agents],
  );

  const handleToggle = async (agent: GalleryAgent, next: boolean) => {
    try {
      await toggleActive.mutateAsync({ id: agent.id, active: next });
      message.success(next ? "Agent activated." : "Agent paused.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't update.");
    }
  };

  if (isLoading) {
    return (
      <div style={grid}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 16, padding: 18 }}
          >
            <Skeleton active avatar paragraph={{ rows: 3 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={grid}>
      {/* New agent tile — always first */}
      <button
        type="button"
        onClick={onCreate}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          minHeight: 210,
          textAlign: "center",
          border: `1.5px dashed ${token.colorBorder}`,
          borderRadius: 16,
          background: token.colorFillQuaternary,
          cursor: "pointer",
          padding: 20,
          transition: "border-color .15s ease, background .15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#4a4ad0";
          e.currentTarget.style.background = token.colorPrimaryBg;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = token.colorBorder;
          e.currentTarget.style.background = token.colorFillQuaternary;
        }}
      >
        <span
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: "#4a4ad0",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 8px 20px rgba(74,74,208,.28)",
          }}
        >
          <MIcon name="add" size={26} />
        </span>
        <span style={{ fontSize: 15.5, fontWeight: 700, color: token.colorText }}>
          New agent
        </span>
        <span style={{ fontSize: 12.5, color: token.colorTextTertiary, maxWidth: 220 }}>
          Start from scratch or pick a template like the Operations Manager.
        </span>
      </button>

      {sorted.map((agent) => {
        const config = readAgentConfig(agent.data_scope);
        const active = agent.is_active !== false;
        const caps = capsFor(agent);
        return (
          <div
            key={agent.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(agent.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(agent.id);
              }
            }}
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              minHeight: 210,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 16,
              background: token.colorBgContainer,
              cursor: "pointer",
              padding: 18,
              opacity: active ? 1 : 0.72,
              transition: "box-shadow .16s ease, transform .16s ease, border-color .16s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = token.boxShadowTertiary;
              e.currentTarget.style.borderColor = token.colorPrimaryBorder;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "none";
              e.currentTarget.style.borderColor = token.colorBorderSecondary;
            }}
          >
            {/* Active badge */}
            <span
              style={{
                position: "absolute",
                top: 14,
                right: 14,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 9px",
                borderRadius: 999,
                color: active ? "#1a7f52" : token.colorTextTertiary,
                background: active ? "rgba(43,179,110,.14)" : token.colorFillTertiary,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: active ? "#2bb36e" : token.colorTextQuaternary,
                }}
              />
              {active ? "Active" : "Paused"}
            </span>

            {/* Mascot + identity */}
            <div style={{ display: "flex", alignItems: "center", gap: 13, paddingRight: 74 }}>
              {config.mascotUrl ? (
                <Avatar size={52} src={config.mascotUrl} shape="square" style={{ borderRadius: 13, flex: "none" }} />
              ) : (
                <span
                  style={{
                    width: 52,
                    height: 52,
                    flex: "none",
                    borderRadius: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    background: "linear-gradient(135deg,#4a4ad0 0%,#7c6cff 100%)",
                    color: "#fff",
                  }}
                >
                  {agent.emoji || initials(agent.name)}
                </span>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: token.colorText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {agent.name}
                </div>
                {agent.kind === "ops_manager" ? (
                  <div style={{ fontSize: 12, color: "#4a4ad0", fontWeight: 600 }}>
                    Operations Manager
                  </div>
                ) : null}
              </div>
            </div>

            {/* Description */}
            <div
              style={{
                marginTop: 12,
                fontSize: 13,
                lineHeight: 1.5,
                color: token.colorTextSecondary,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {agent.description?.trim() || "No description yet."}
            </div>

            {/* Capability chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 }}>
              {caps.map((c) => (
                <span
                  key={c.label}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: token.colorTextSecondary,
                    padding: "3px 9px 3px 7px",
                    borderRadius: 999,
                    background: token.colorFillQuaternary,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: c.accent }} />
                  {c.label}
                </span>
              ))}
            </div>

            {/* Footer: open hint + active toggle */}
            <div
              style={{
                marginTop: "auto",
                paddingTop: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "#4a4ad0", display: "inline-flex", alignItems: "center", gap: 3 }}>
                Configure <MIcon name="arrow_forward" size={14} />
              </span>
              <Tooltip title={active ? "Pause this agent" : "Activate this agent"}>
                {/* Stop the card's onClick when toggling. */}
                <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
                  <Switch
                    size="small"
                    checked={active}
                    loading={toggleActive.isPending}
                    onChange={(v) => void handleToggle(agent, v)}
                  />
                </span>
              </Tooltip>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default AgentGallery;
