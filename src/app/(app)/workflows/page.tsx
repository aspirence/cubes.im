"use client";

import Link from "next/link";
import { theme } from "antd";

/** Material Symbols Rounded glyph. */
function MIcon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/**
 * Workflows — temporarily a "coming soon" placeholder while the builder is being
 * reworked. The full implementation lives in git history; Agents remain live at
 * /workflows/agents.
 */
export default function WorkflowsComingSoon() {
  const { token } = theme.useToken();

  const upcoming = [
    { icon: "bolt", title: "Triggers", desc: "Kick off on a schedule, an event, or on demand." },
    { icon: "call_split", title: "Conditions", desc: "Branch on task status, priority, assignee and more." },
    { icon: "smart_toy", title: "Agent actions", desc: "Let your agents do the work at each step." },
    { icon: "forum", title: "Notify & post", desc: "Ping owners in chat and post updates automatically." },
  ];

  return (
    <div
      style={{
        minHeight: "calc(100vh - 120px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 620,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            background: "linear-gradient(135deg,#4a4ad0 0%,#7c6cff 60%,#b46ff0 100%)",
            boxShadow: "0 14px 34px rgba(74,74,208,.32)",
          }}
        >
          <MIcon name="account_tree" size={38} />
        </div>

        <span
          style={{
            marginTop: 20,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: "#4a4ad0",
            background: token.colorPrimaryBg,
            border: `1px solid ${token.colorPrimaryBorder}`,
            padding: "4px 12px",
            borderRadius: 999,
          }}
        >
          <MIcon name="schedule" size={14} /> Coming soon
        </span>

        <h1
          style={{
            margin: "16px 0 0",
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-0.6px",
            color: token.colorText,
          }}
        >
          Workflows
        </h1>
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 15,
            lineHeight: 1.6,
            color: token.colorTextSecondary,
            maxWidth: 480,
          }}
        >
          Automate the busywork — chain triggers, conditions and agent actions
          across your projects. We&apos;re rebuilding the builder to make it
          genuinely easy, even for non-technical teams. It&apos;ll land here soon.
        </p>

        {/* What's coming */}
        <div
          style={{
            marginTop: 28,
            width: "100%",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
            textAlign: "left",
          }}
        >
          {upcoming.map((u) => (
            <div
              key={u.title}
              style={{
                display: "flex",
                gap: 12,
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
              }}
            >
              <span
                style={{
                  width: 36,
                  height: 36,
                  flex: "none",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#4a4ad0",
                  background: token.colorPrimaryBg,
                }}
              >
                <MIcon name={u.icon} size={20} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>
                  {u.title}
                </div>
                <div style={{ fontSize: 12.5, color: token.colorTextTertiary, marginTop: 1 }}>
                  {u.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Meanwhile, Agents are live */}
        <Link
          href="/workflows/agents"
          style={{
            marginTop: 26,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: 44,
            padding: "0 22px",
            borderRadius: 12,
            background: "#4a4ad0",
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            boxShadow: "0 10px 24px rgba(74,74,208,.24)",
          }}
        >
          <MIcon name="smart_toy" size={18} />
          Meanwhile, explore Agents
          <MIcon name="arrow_forward" size={18} />
        </Link>
      </div>
    </div>
  );
}
