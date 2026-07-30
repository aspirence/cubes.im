"use client";

import { theme } from "antd";
import { CUBE_MILESTONES } from "./use-celebrations";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/**
 * One resolved celebration screen. `points` is null unless a FRESH cube award
 * landed for this event (re-completing a task or completing one you're not
 * assigned to earns nothing — the copy must not pretend otherwise).
 */
export interface CelebrationScreen {
  eventKey: "task_completed" | "cube_milestone";
  eventLabel: string;
  taskName?: string;
  points: number | null;
  balance: number | null;
  eventsToday?: number;
  milestone?: number;
}

function PointsPill({ points }: { points: number | null }) {
  if (points == null || points === 0) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 14px",
        borderRadius: 999,
        fontSize: 15,
        fontWeight: 700,
        color: "#fff",
        background: "#4a4ad0",
        boxShadow: "0 6px 16px -6px rgba(74,74,208,.55)",
      }}
    >
      <MIcon name="deployed_code" size={17} color="#fff" />
      {points > 0 ? `+${points}` : points} cubes
    </span>
  );
}

/** Compact card + confetti — the default, quietest template. */
export function BurstCard({ screen }: { screen: CelebrationScreen }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        width: "min(400px, calc(100vw - 48px))",
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 16,
        padding: "30px 28px 26px",
        textAlign: "center",
        boxShadow: "0 24px 60px -18px rgba(0,0,0,.28)",
      }}
    >
      <span
        style={{
          width: 58,
          height: 58,
          borderRadius: 18,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: token.colorPrimaryBg,
        }}
      >
        <MIcon name="check_circle" size={30} color="#4a4ad0" />
      </span>
      <div style={{ marginTop: 14, fontSize: 20, fontWeight: 700, letterSpacing: "-.4px", color: token.colorText }}>
        {screen.eventLabel}
      </div>
      {screen.taskName ? (
        <div
          style={{
            marginTop: 5,
            fontSize: 13.5,
            color: token.colorTextSecondary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {screen.taskName}
        </div>
      ) : null}
      <div style={{ marginTop: 16 }}>
        <PointsPill points={screen.points} />
      </div>
      <div style={{ marginTop: 14, fontSize: 11.5, color: token.colorTextQuaternary }}>
        Click anywhere to continue
      </div>
    </div>
  );
}

/** Full-gradient hero — the "sunrise" look. */
export function GlowCard({ screen }: { screen: CelebrationScreen }) {
  return (
    <div
      style={{
        width: "min(460px, calc(100vw - 48px))",
        borderRadius: 20,
        padding: "38px 32px 32px",
        textAlign: "center",
        color: "#fff",
        background: "linear-gradient(135deg, #4a4ad0 0%, #7b5cf0 48%, #f0883e 100%)",
        boxShadow: "0 30px 80px -20px rgba(74,74,208,.55)",
      }}
    >
      <MIcon name="auto_awesome" size={34} color="rgba(255,255,255,.92)" />
      <div style={{ marginTop: 12, fontSize: 26, fontWeight: 800, letterSpacing: "-.6px", lineHeight: 1.15 }}>
        {screen.eventKey === "cube_milestone" && screen.milestone
          ? `${screen.milestone} cubes!`
          : screen.eventLabel}
      </div>
      {screen.taskName ? (
        <div
          style={{
            marginTop: 7,
            fontSize: 14,
            color: "rgba(255,255,255,.85)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {screen.taskName}
        </div>
      ) : null}
      {screen.points != null && screen.points !== 0 ? (
        <div
          style={{
            marginTop: 18,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 16px",
            borderRadius: 999,
            fontSize: 15,
            fontWeight: 700,
            background: "rgba(255,255,255,.18)",
            border: "1px solid rgba(255,255,255,.35)",
          }}
        >
          <MIcon name="deployed_code" size={17} color="#fff" />
          {screen.points > 0 ? `+${screen.points}` : screen.points} cubes
        </div>
      ) : null}
      <div style={{ marginTop: 16, fontSize: 11.5, color: "rgba(255,255,255,.6)" }}>
        Click anywhere to continue
      </div>
    </div>
  );
}

/** Duolingo-style stats card: hero number + 2×2 tiles of real ledger facts. */
export function StatsCard({ screen }: { screen: CelebrationScreen }) {
  const { token } = theme.useToken();
  const hero =
    screen.eventKey === "cube_milestone" && screen.milestone != null
      ? screen.milestone
      : screen.points ?? 0;
  const nextMilestone = CUBE_MILESTONES.find((m) => m > (screen.balance ?? 0));
  const tiles: { icon: string; value: string; label: string }[] = [
    {
      icon: "deployed_code",
      value: screen.points != null && screen.points !== 0 ? `+${screen.points}` : "—",
      label: "cubes earned",
    },
    {
      icon: "account_balance_wallet",
      value: screen.balance != null ? `${screen.balance}` : "—",
      label: "total balance",
    },
    {
      icon: "local_fire_department",
      value: screen.eventsToday != null ? `${screen.eventsToday}` : "—",
      label: "wins today",
    },
    {
      icon: "flag",
      value: nextMilestone ? `${nextMilestone}` : "maxed!",
      label: "next milestone",
    },
  ];
  return (
    <div
      style={{
        width: "min(430px, calc(100vw - 48px))",
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 20,
        padding: "30px 26px 24px",
        textAlign: "center",
        boxShadow: "0 24px 60px -18px rgba(0,0,0,.28)",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: "#4a4ad0" }}>
        {screen.eventLabel}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 54,
          fontWeight: 800,
          letterSpacing: "-2px",
          lineHeight: 1,
          color: token.colorText,
        }}
      >
        {screen.eventKey === "cube_milestone" ? hero : `+${hero}`}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, color: token.colorTextTertiary }}>
        {screen.eventKey === "cube_milestone" ? "cubes milestone reached" : screen.taskName ?? "nice work"}
      </div>
      <div
        style={{
          marginTop: 20,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        {tiles.map((t, i) => (
          <div
            key={t.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "11px 13px",
              borderRadius: 12,
              background: token.colorFillQuaternary,
              border: `1px solid ${token.colorSplit}`,
              textAlign: "left",
              animation: `cele-rise .45s ${0.08 * i + 0.15}s both`,
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                flex: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: token.colorPrimaryBg,
              }}
            >
              <MIcon name={t.icon} size={16} color="#4a4ad0" />
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 16, fontWeight: 700, color: token.colorText, lineHeight: 1.15 }}>
                {t.value}
              </span>
              <span style={{ display: "block", fontSize: 11, color: token.colorTextTertiary }}>{t.label}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, fontSize: 11.5, color: token.colorTextQuaternary }}>
        Click anywhere to continue
      </div>
    </div>
  );
}
