"use client";

import { Fragment } from "react";
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

/** One accent per pipeline stage — reused by the chain and the feature grid so
 *  the page reads as a single system, not four random cards. */
const STAGES = [
  {
    icon: "bolt",
    label: "Trigger",
    title: "Triggers",
    desc: "Kick off on a schedule, an event, or on demand.",
    fg: "#d97706",
    bg: "rgba(245, 158, 11, 0.14)",
  },
  {
    icon: "call_split",
    label: "Condition",
    title: "Conditions",
    desc: "Branch on task status, priority, assignee and more.",
    fg: "#0284c7",
    bg: "rgba(14, 165, 233, 0.14)",
  },
  {
    icon: "smart_toy",
    label: "Agent",
    title: "Agent actions",
    desc: "Let your agents do the work at each step.",
    fg: "#4a4ad0",
    bg: "rgba(74, 74, 208, 0.12)",
  },
  {
    icon: "forum",
    label: "Notify",
    title: "Notify & post",
    desc: "Ping owners in chat and post updates automatically.",
    fg: "#059669",
    bg: "rgba(16, 185, 129, 0.14)",
  },
];

/**
 * Workflows — temporarily a "coming soon" placeholder while the builder is being
 * reworked. The full implementation lives in git history; Agents remain live at
 * /workflows/agents.
 */
export default function WorkflowsComingSoon() {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        position: "relative",
        minHeight: "calc(100vh - 120px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        overflow: "hidden",
      }}
    >
      {/* Soft ambient glow behind the hero — decoration only. */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            top: -120,
            left: "50%",
            transform: "translateX(-50%)",
            width: 640,
            height: 420,
            background: "radial-gradient(closest-side, rgba(124, 108, 255, 0.13), transparent)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -160,
            left: "50%",
            transform: "translateX(-30%)",
            width: 520,
            height: 380,
            background: "radial-gradient(closest-side, rgba(16, 185, 129, 0.07), transparent)",
          }}
        />
      </div>

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 680,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <h1
          style={{
            margin: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            fontSize: 34,
            fontWeight: 700,
            letterSpacing: "-0.8px",
            color: token.colorText,
          }}
        >
          Workflows
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: "#4a4ad0",
              background: token.colorPrimaryBg,
              padding: "4px 9px",
              borderRadius: 999,
              transform: "translateY(2px)",
            }}
          >
            Coming soon
          </span>
        </h1>
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 15,
            lineHeight: 1.65,
            color: token.colorTextSecondary,
            maxWidth: 500,
          }}
        >
          Automate the busywork — chain triggers, conditions and agent actions
          across your projects. We&apos;re rebuilding the builder to make it
          genuinely easy, even for non-technical teams. It&apos;ll land here soon.
        </p>

        {/* A workflow, drawn: trigger → condition → agent → notify. */}
        <div
          style={{
            marginTop: 34,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            flexWrap: "wrap",
            rowGap: 18,
          }}
        >
          {STAGES.map((s, i) => (
            <Fragment key={s.label}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 7,
                  width: 74,
                }}
              >
                <span
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: s.fg,
                    background: s.bg,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: "0 4px 12px rgba(16, 24, 40, 0.05)",
                  }}
                >
                  <MIcon name={s.icon} size={22} />
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: token.colorTextSecondary,
                    letterSpacing: 0.2,
                  }}
                >
                  {s.label}
                </span>
              </div>
              {i < STAGES.length - 1 ? (
                <span
                  aria-hidden
                  className="wl-flow-connector"
                  style={{
                    width: 34,
                    height: 2,
                    marginTop: 22,
                    flex: "none",
                    borderRadius: 2,
                    backgroundImage: `repeating-linear-gradient(90deg, ${token.colorBorder} 0 5px, transparent 5px 11px)`,
                  }}
                />
              ) : null}
            </Fragment>
          ))}
        </div>

        {/* What's coming */}
        <div
          style={{
            marginTop: 32,
            width: "100%",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: 12,
            textAlign: "left",
          }}
        >
          {STAGES.map((u) => (
            <div
              key={u.title}
              className="wl-upcoming-card"
              style={{
                display: "flex",
                gap: 12,
                padding: 15,
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
                  color: u.fg,
                  background: u.bg,
                }}
              >
                <MIcon name={u.icon} size={20} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>
                  {u.title}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    color: token.colorTextTertiary,
                    marginTop: 2,
                  }}
                >
                  {u.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Meanwhile, Agents are live */}
        <Link
          href="/workflows/agents"
          className="wl-cta"
          style={{
            marginTop: 30,
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
            boxShadow: "0 10px 24px rgba(74, 74, 208, 0.24)",
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
