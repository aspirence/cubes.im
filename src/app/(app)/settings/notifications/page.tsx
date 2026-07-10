"use client";

import { useMemo } from "react";
import { App, Skeleton } from "antd";
import {
  useNotificationSettings,
  useUpdateNotificationSettings,
} from "@/features/settings/use-notification-settings";
import { IosToggle } from "../_components/ios-toggle";

type ToggleKey =
  | "email_notifications_enabled"
  | "popup_notifications_enabled"
  | "daily_digest_enabled";

/**
 * Server-side defaults for a notification_settings row (see the phase2
 * migration). When the user has never saved settings there is no row, so the
 * page renders these — which is what `create_notification` actually applies
 * (absent row => pop-up on). Rendering absent-as-off would contradict the
 * behavior the user really gets.
 */
const CHANNEL_DEFAULTS: Record<ToggleKey, boolean> = {
  email_notifications_enabled: true,
  popup_notifications_enabled: true,
  daily_digest_enabled: false,
};

const CHANNELS: {
  key: ToggleKey;
  title: string;
  description: string;
  icon: string;
  tint: string;
  bg: string;
}[] = [
  {
    key: "email_notifications_enabled",
    title: "Email notifications",
    description: "Receive notifications about activity by email.",
    icon: "mail",
    tint: "#4a4ad0",
    bg: "#eceefb",
  },
  {
    key: "popup_notifications_enabled",
    title: "Pop-up notifications",
    description: "Show in-app pop-up notifications.",
    icon: "notifications_active",
    tint: "#c07d2e",
    bg: "#fdf2e6",
  },
  {
    key: "daily_digest_enabled",
    title: "Daily digest",
    description: "Receive a once-a-day summary email.",
    icon: "summarize",
    tint: "#2f8f5f",
    bg: "#e9f6ef",
  },
];

/**
 * The notification CATEGORIES a user can turn on/off individually. `type` maps
 * to the `type` value that `create_notification` stamps on each notification,
 * and the icons/tints mirror the notifications bell so the two surfaces read as
 * one system. Turning a category off adds its type to `muted_types`.
 */
const CATEGORIES: {
  type: string;
  title: string;
  description: string;
  icon: string;
  tint: string;
  bg: string;
}[] = [
  {
    type: "assignment",
    title: "Assignments",
    description: "When a task or video is assigned to you.",
    icon: "assignment_ind",
    tint: "#7a5af5",
    bg: "#efeafd",
  },
  {
    type: "mention",
    title: "Mentions",
    description: "When someone @mentions you in a comment.",
    icon: "alternate_email",
    tint: "#c98a20",
    bg: "#fdf3e0",
  },
  {
    type: "comment",
    title: "Comments",
    description: "When someone comments on one of your tasks.",
    icon: "chat_bubble",
    tint: "#2f7bd6",
    bg: "#e6f0fb",
  },
  {
    type: "info",
    title: "Updates & activity",
    description: "Automations, workflow steps, and other activity.",
    icon: "bolt",
    tint: "#6a6d78",
    bg: "#eef0f4",
  },
];

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(16,24,40,.04)",
  overflow: "hidden",
};

const iconChip = (bg: string, tint: string): React.CSSProperties => ({
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

function Row({
  icon,
  bg,
  tint,
  title,
  description,
  checked,
  disabled,
  loading,
  onChange,
  first,
}: {
  icon: string;
  bg: string;
  tint: string;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  loading?: boolean;
  onChange: (checked: boolean) => void;
  first: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 18px",
        borderTop: first ? "1px solid #f0f0f3" : "1px solid #f4f4f6",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span style={iconChip(bg, tint)}>
        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
          {icon}
        </span>
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: "#17171c",
            lineHeight: 1.3,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 12.5, color: "#6a6d78", marginTop: 1 }}>
          {description}
        </div>
      </div>

      <IosToggle
        checked={checked}
        disabled={disabled}
        loading={loading}
        onChange={onChange}
        aria-label={title}
      />
    </div>
  );
}

export default function NotificationsSettingsPage() {
  const { message } = App.useApp();
  const { data: settings, isLoading } = useNotificationSettings();
  const updateSettings = useUpdateNotificationSettings();

  const mutedTypes = useMemo(
    () => new Set(settings?.muted_types ?? []),
    [settings?.muted_types],
  );
  const popupOn =
    settings?.popup_notifications_enabled ??
    CHANNEL_DEFAULTS.popup_notifications_enabled;

  const save = async (input: Parameters<typeof updateSettings.mutateAsync>[0]) => {
    try {
      await updateSettings.mutateAsync(input);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update settings.",
      );
    }
  };

  const handleChannel = (key: ToggleKey, checked: boolean) =>
    save({ [key]: checked });

  const handleCategory = (type: string, on: boolean) => {
    const next = new Set(settings?.muted_types ?? []);
    // Toggling ON delivers the category (remove from the mute list); OFF mutes.
    if (on) next.delete(type);
    else next.add(type);
    return save({ muted_types: [...next] });
  };

  if (isLoading) {
    return (
      <div style={card}>
        <div style={{ padding: 18 }}>
          <Skeleton active />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Channels — how you're notified */}
      <div style={card}>
        <div style={{ padding: "18px 18px 14px" }}>
          <h1
            style={{
              margin: 0,
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: "-.4px",
              color: "#17171c",
              lineHeight: 1.2,
            }}
          >
            Notifications
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6a6d78" }}>
            Choose how you want to be notified.
          </p>
        </div>

        {CHANNELS.map((item, i) => (
          <Row
            key={item.key}
            icon={item.icon}
            bg={item.bg}
            tint={item.tint}
            title={item.title}
            description={item.description}
            checked={settings?.[item.key] ?? CHANNEL_DEFAULTS[item.key]}
            loading={updateSettings.isPending}
            onChange={(checked) => handleChannel(item.key, checked)}
            first={i === 0}
          />
        ))}
      </div>

      {/* Categories — what you're notified about */}
      <div style={card}>
        <div style={{ padding: "18px 18px 12px" }}>
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "#17171c",
              lineHeight: 1.2,
            }}
          >
            Notify me about
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6a6d78" }}>
            {popupOn
              ? "Pick which in-app notifications you want to receive."
              : "Turn on Pop-up notifications above to receive these in-app notifications."}
          </p>
        </div>

        {CATEGORIES.map((item, i) => (
          <Row
            key={item.type}
            icon={item.icon}
            bg={item.bg}
            tint={item.tint}
            title={item.title}
            description={item.description}
            checked={popupOn && !mutedTypes.has(item.type)}
            disabled={!popupOn}
            loading={updateSettings.isPending}
            onChange={(checked) => handleCategory(item.type, checked)}
            first={i === 0}
          />
        ))}
      </div>
    </div>
  );
}
