"use client";

import { App, Button, theme } from "antd";
import { useInstallPrompt } from "@/features/pwa/use-pwa";
import { usePushNotifications } from "@/features/pwa/use-push";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/**
 * "Install Cubes as an app" + OS push toggle. Adapts per platform: a one-tap
 * install on Android/desktop (Chromium), Add-to-Home-Screen guidance on iOS,
 * and a push enable/disable control that stores this device's subscription.
 */
export function InstallAppCard() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { canInstall, installed, isIOS, promptInstall } = useInstallPrompt();
  const push = usePushNotifications();

  const card: React.CSSProperties = {
    background: token.colorBgContainer,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: 12,
    boxShadow: "0 1px 2px rgba(16,24,40,.04)",
    overflow: "hidden",
  };
  const chip = (bg: string, tint: string): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    flex: "0 0 auto",
    borderRadius: 8,
    background: bg,
    color: tint,
  });
  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 18px",
    borderTop: `1px solid ${token.colorSplit}`,
  };

  const doInstall = async () => {
    const r = await promptInstall();
    if (r === "accepted") message.success("Installing Cubes…");
  };

  const doEnablePush = async () => {
    const r = await push.enable();
    if (r === "subscribed") message.success("Notifications enabled on this device.");
    else if (r === "denied") message.warning("Notifications are blocked — allow them in your browser settings.");
    else message.info("Push isn't available in this browser.");
  };

  const doDisablePush = async () => {
    await push.disable();
    message.success("Notifications turned off on this device.");
  };

  return (
    <div style={card}>
      <div style={{ padding: "18px 18px 12px" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: token.colorText, lineHeight: 1.2 }}>
          Get the app
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: token.colorTextSecondary }}>
          Install Cubes on your device and get notifications like a native app.
        </p>
      </div>

      {/* Install row */}
      <div style={rowStyle}>
        <span style={chip("#eef0ff", "#4a4ad0")}>
          <MIcon name="install_mobile" size={18} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>
            Install Cubes
          </div>
          <div style={{ fontSize: 12.5, color: token.colorTextSecondary, marginTop: 1 }}>
            {installed
              ? "This device already has Cubes installed."
              : isIOS
                ? "On iPhone/iPad: tap the Share button, then “Add to Home Screen”."
                : canInstall
                  ? "Add Cubes to your home screen / dock in one tap."
                  : "Open your browser menu and choose “Install app” / “Add to Home Screen”."}
          </div>
        </div>
        {installed ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: token.colorSuccess, fontSize: 13, fontWeight: 600 }}>
            <MIcon name="check_circle" size={18} /> Installed
          </span>
        ) : canInstall ? (
          <Button type="primary" onClick={doInstall} icon={<MIcon name="install_mobile" size={16} />}>
            Install app
          </Button>
        ) : null}
      </div>

      {/* Push row */}
      <div style={rowStyle}>
        <span style={chip("#eaf3ee", "#2f8f5f")}>
          <MIcon name="notifications_active" size={18} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>
            Push notifications on this device
          </div>
          <div style={{ fontSize: 12.5, color: token.colorTextSecondary, marginTop: 1 }}>
            {!push.supported
              ? isIOS && !installed
                ? "Add Cubes to your Home Screen first, then enable notifications here."
                : "This browser doesn’t support push notifications."
              : push.permission === "denied"
                ? "Blocked — allow notifications for Cubes in your browser settings."
                : push.subscribed
                  ? "You’ll get notified even when Cubes is closed."
                  : "Turn on to receive notifications when the app is closed."}
          </div>
        </div>
        {push.supported && push.permission !== "denied" ? (
          push.subscribed ? (
            <Button onClick={doDisablePush} loading={push.busy}>
              Turn off
            </Button>
          ) : (
            <Button type="primary" onClick={doEnablePush} loading={push.busy} icon={<MIcon name="notifications" size={16} />}>
              Enable
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
