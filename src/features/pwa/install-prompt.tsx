"use client";

import { useState } from "react";
import { App, Button, theme } from "antd";
import { useInstallPrompt } from "@/features/pwa/use-pwa";

const DISMISS_KEY = "cubes.install.dismissed";
const DISMISS_DAYS = 14;

function dismissedUntilNow(): boolean {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return t > Date.now();
  } catch {
    return false;
  }
}

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/**
 * A quiet, dismissible "Install Cubes" card pinned to the bottom of the app —
 * the discoverable entry point to install the PWA. One-tap install on Android /
 * desktop; Add-to-Home-Screen guidance on iOS. Dismiss snoozes it for two weeks;
 * Settings → Notifications always has the full control too.
 */
export function InstallPrompt() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { canInstall, installed, isIOS, promptInstall } = useInstallPrompt();
  // Start hidden on the server so there's no flash before the client reads the
  // snooze flag / install state.
  const [dismissed, setDismissed] = useState(
    () => typeof window === "undefined" || dismissedUntilNow(),
  );

  const visible = !installed && !dismissed && (canInstall || isIOS);
  if (!visible) return null;

  const snooze = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 864e5));
    } catch {
      /* private mode — just hide for this session */
    }
    setDismissed(true);
  };

  const install = async () => {
    const r = await promptInstall();
    if (r === "accepted") {
      message.success("Installing Cubes…");
      setDismissed(true);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Install Cubes"
      style={{
        position: "fixed",
        zIndex: 1000,
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "max(16px, env(safe-area-inset-bottom))",
        width: "calc(100vw - 24px)",
        maxWidth: 420,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 14,
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorderSecondary}`,
        boxShadow: "0 16px 40px -12px rgba(16,24,40,0.28)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 40,
          height: 40,
          flex: "none",
          borderRadius: 11,
          background: "linear-gradient(140deg, #34346a 0%, #4a4ad0 100%)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MIcon name="install_mobile" size={22} color="#fff" />
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: token.colorText, lineHeight: 1.25 }}>
          Install Cubes
        </div>
        <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 1, lineHeight: 1.4 }}>
          {isIOS && !canInstall
            ? "Tap the Share button, then “Add to Home Screen”."
            : "Add it to your device for a faster, app-like experience with notifications."}
        </div>
      </div>

      {canInstall ? (
        <Button type="primary" size="small" onClick={install}>
          Install
        </Button>
      ) : null}

      <button
        type="button"
        aria-label="Dismiss"
        onClick={snooze}
        style={{
          flex: "none",
          width: 28,
          height: 28,
          border: "none",
          background: "transparent",
          borderRadius: 8,
          cursor: "pointer",
          color: token.colorTextTertiary,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MIcon name="close" size={18} />
      </button>
    </div>
  );
}
