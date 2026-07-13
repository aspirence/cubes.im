"use client";

import { useState } from "react";
import { App as AntdApp, theme } from "antd";
import { AGENT_TEMPLATES, type AgentTemplate } from "@/features/workflows/agent-templates";
import { useInstallTemplate } from "@/features/workflows/use-install-template";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  gap: 18,
  alignItems: "stretch",
};

/**
 * The agent marketplace — an app-store style grid. The first card is always
 * "New agent" (build a custom agent from scratch); the rest are one-click,
 * pre-built templates that install into the active workspace.
 */
export function AgentMarketplace({
  onNewCustom,
  onInstalled,
}: {
  onNewCustom: () => void;
  onInstalled: (agentId: string) => void;
}) {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const installer = useInstallTemplate();
  const [installing, setInstalling] = useState<string | null>(null);

  const handleInstall = async (tpl: AgentTemplate) => {
    if (installing) return;
    setInstalling(tpl.key);
    try {
      const id = await installer.install(tpl);
      message.success(`${tpl.name} added to your workspace.`);
      onInstalled(id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't add this agent.");
    } finally {
      setInstalling(null);
    }
  };

  const cardBase: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    borderRadius: 18,
    border: `1px solid ${token.colorBorderSecondary}`,
    background: token.colorBgContainer,
    overflow: "hidden",
    minHeight: 300,
    transition: "box-shadow .16s ease, transform .16s ease, border-color .16s ease",
  };

  const btn = (opts?: { loading?: boolean; ghost?: boolean }): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 40,
    borderRadius: 10,
    border: "none",
    background: opts?.ghost ? token.colorFillSecondary : "#3f5bd9",
    color: opts?.ghost ? token.colorText : "#fff",
    fontSize: 13.5,
    fontWeight: 700,
    cursor: opts?.loading ? "default" : "pointer",
    opacity: opts?.loading ? 0.8 : 1,
    width: "100%",
  });

  const lift = (e: React.MouseEvent<HTMLDivElement>, on: boolean) => {
    e.currentTarget.style.boxShadow = on ? token.boxShadowTertiary : "none";
    e.currentTarget.style.transform = on ? "translateY(-2px)" : "translateY(0)";
    e.currentTarget.style.borderColor = on ? token.colorPrimaryBorder : token.colorBorderSecondary;
  };

  return (
    <div style={grid}>
      {/* New agent (custom) — always first */}
      <div
        style={cardBase}
        onMouseEnter={(e) => lift(e, true)}
        onMouseLeave={(e) => lift(e, false)}
      >
        <div
          style={{
            position: "relative",
            height: 116,
            background: "linear-gradient(135deg,#14171f 0%,#2a2f45 100%)",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              fontSize: 11,
              fontWeight: 700,
              color: "#fff",
              padding: "3px 10px",
              borderRadius: 999,
              background: "rgba(255,255,255,.16)",
            }}
          >
            Custom
          </span>
          <span
            style={{
              position: "absolute",
              left: 18,
              bottom: -22,
              width: 56,
              height: 56,
              borderRadius: 999,
              background: "#4a4ad0",
              border: "3px solid " + token.colorBgContainer,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              boxShadow: "0 6px 16px rgba(74,74,208,.4)",
            }}
          >
            <MIcon name="add" size={28} />
          </span>
        </div>
        <div style={{ padding: "30px 18px 18px", display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: token.colorText }}>New agent</div>
          <div
            style={{
              marginTop: 6,
              fontSize: 13,
              lineHeight: 1.5,
              color: token.colorTextSecondary,
              flex: 1,
            }}
          >
            Build a custom agent from scratch — choose the @contexts it can see and
            write exactly how it should work.
          </div>
          <button type="button" onClick={onNewCustom} style={{ ...btn(), marginTop: 14 }}>
            <MIcon name="auto_awesome" size={16} /> Create custom agent
          </button>
        </div>
      </div>

      {/* Template cards */}
      {AGENT_TEMPLATES.map((tpl) => {
        const busy = installing === tpl.key;
        return (
          <div
            key={tpl.key}
            style={cardBase}
            onMouseEnter={(e) => lift(e, true)}
            onMouseLeave={(e) => lift(e, false)}
          >
            <div style={{ position: "relative", height: 116, background: tpl.gradient }}>
              {tpl.badge ? (
                <span
                  style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    color: token.colorText,
                    padding: "3px 10px 3px 8px",
                    borderRadius: 999,
                    background: token.colorBgContainer,
                    boxShadow: "0 2px 8px rgba(0,0,0,.12)",
                  }}
                >
                  <MIcon name="bolt" size={13} color="#4a4ad0" />
                  {tpl.badge}
                </span>
              ) : null}
              <span
                style={{
                  position: "absolute",
                  left: 18,
                  bottom: -22,
                  width: 56,
                  height: 56,
                  borderRadius: 999,
                  background: "#0e0f17",
                  border: "3px solid " + token.colorBgContainer,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                }}
              >
                {tpl.emoji}
              </span>
            </div>
            <div style={{ padding: "30px 18px 18px", display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: token.colorText }}>{tpl.name}</div>
              <div style={{ fontSize: 12.5, color: tpl.accent, fontWeight: 600, marginTop: 1 }}>
                {tpl.tagline}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: token.colorTextSecondary,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  flex: 1,
                }}
              >
                {tpl.description}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  margin: "12px 0",
                  fontSize: 12,
                  color: token.colorTextTertiary,
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    background: "#4a4ad0",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 800,
                  }}
                >
                  C
                </span>
                by {tpl.author ?? "Cubes"}
                <span style={{ margin: "0 2px" }}>·</span>
                <span style={{ color: "#1a7f52", fontWeight: 700 }}>Free</span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleInstall(tpl)}
                style={btn({ loading: busy })}
              >
                {busy ? (
                  <>
                    <MIcon name="progress_activity" size={16} /> Adding…
                  </>
                ) : (
                  <>
                    <MIcon name="add" size={16} /> Add to workspace
                  </>
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default AgentMarketplace;
