"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Space,
  Spin,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import {
  BellOutlined,
  CheckOutlined,
  MailOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  useNotifications,
  useNotificationsRealtime,
  useUnreadNotificationCounts,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useSnoozeNotification,
  useMarkNotificationsReadByTypes,
  isActionNotification,
  ACTION_NOTIFICATION_TYPES,
  type Notification,
} from "@/features/notifications/use-notifications";
import { useUIStore } from "@/store/ui-store";

dayjs.extend(relativeTime);

const { Text } = Typography;

/** Palette for the action-card UI — swaps light/dark so the cards read in both
 *  themes (they use inline styles, not antd tokens). */
interface CardTheme {
  well: string;
  card: string;
  cardBorder: string;
  title: string;
  meta: string;
  circleBg: string;
  circleBorder: string;
  circleFg: string;
  circleHover: string;
  pillBg: string;
  pillBorder: string;
  pillFg: string;
  tail1: string;
  tail2: string;
  cardShadowStrong: string;
  cardShadowSoft: string;
}

function cardTheme(dark: boolean): CardTheme {
  return dark
    ? {
        well: "#0f1218",
        card: "#191d27",
        cardBorder: "#272c38",
        title: "#e6e9ef",
        meta: "#8b909e",
        circleBg: "#20242e",
        circleBorder: "#2c313d",
        circleFg: "#8b909e",
        circleHover: "#cdd2dd",
        pillBg: "linear-gradient(180deg,#252a35 0%,#1d212b 100%)",
        pillBorder: "#2c313d",
        pillFg: "#aeb3c0",
        tail1: "#161a22",
        tail2: "#12151c",
        cardShadowStrong: "0 18px 40px -18px rgba(0,0,0,.6)",
        cardShadowSoft: "0 10px 24px -16px rgba(0,0,0,.5)",
      }
    : {
        well: "#f3f4f8",
        card: "#ffffff",
        cardBorder: "#eef0f5",
        title: "#17171c",
        meta: "#9aa0ab",
        circleBg: "#ffffff",
        circleBorder: "#eef0f5",
        circleFg: "#b3b7c2",
        circleHover: "#6a6d78",
        pillBg: "linear-gradient(180deg,#ffffff 0%,#f3f4f7 100%)",
        pillBorder: "#eceef2",
        pillFg: "#9aa0ab",
        tail1: "#fcfcfe",
        tail2: "#f8f9fc",
        cardShadowStrong:
          "0 18px 40px -18px rgba(16,24,40,.28), 0 4px 10px -6px rgba(16,24,40,.08)",
        cardShadowSoft: "0 10px 24px -16px rgba(16,24,40,.18)",
      };
}

/** Derive a navigation target for a notification, preferring an explicit url. */
function notificationHref(n: Notification): string | null {
  if (n.url) return n.url;
  if (n.project_id) {
    return n.task_id
      ? `/projects/${n.project_id}?task=${n.task_id}`
      : `/projects/${n.project_id}`;
  }
  return null;
}

/** Icon + tint per notification type — the little left avatar. */
const TYPE_ICON: Record<
  string,
  { icon: string; bg: string; fg: string; label: string; tag: string; verb: string }
> = {
  assignment: {
    icon: "assignment_ind",
    bg: "#efeafd",
    fg: "#7a5af5",
    label: "Assigned",
    tag: "New Task",
    verb: "Assigned to You",
  },
  mention: {
    icon: "alternate_email",
    bg: "#fdf3e0",
    fg: "#c98a20",
    label: "Mention",
    tag: "Mention",
    verb: "Tagged You",
  },
  comment: {
    icon: "chat_bubble",
    bg: "#e6f0fb",
    fg: "#2f7bd6",
    label: "Comment",
    tag: "Comment",
    verb: "New Reply",
  },
  info: {
    icon: "info",
    bg: "#eef0f4",
    fg: "#8a8d98",
    label: "Info",
    tag: "Update",
    verb: "For You",
  },
};

function typeMeta(type: string) {
  return TYPE_ICON[type] ?? TYPE_ICON.info;
}

function TimeText({ createdAt }: { createdAt: string | null }) {
  if (!createdAt) return null;
  const d = dayjs(createdAt);
  if (!d.isValid()) return null;
  const label = d.isSame(dayjs(), "day") ? d.format("h:mm A") : d.fromNow();
  return (
    <Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap", flex: "none" }}>
      {label}
    </Text>
  );
}

const SNOOZE_CHOICES: { key: string; label: string; hours: number }[] = [
  { key: "1h", label: "1 hour", hours: 1 },
  { key: "3h", label: "3 hours", hours: 3 },
  { key: "tomorrow", label: "Tomorrow", hours: 24 },
  { key: "week", label: "Next week", hours: 24 * 7 },
];

/**
 * A rich notification row: a type avatar, the actor-phrased
 * message, a timestamp, and — revealed on hover — mark-unread, snooze, and a
 * prominent Clear. `compact` drops snooze/unread for the General tab.
 */
function NotificationRow({
  n,
  onOpen,
  onClear,
  onUnread,
  onSnooze,
  showActions,
}: {
  n: Notification;
  onOpen: (n: Notification) => void;
  onClear: (n: Notification) => void;
  onUnread: (n: Notification) => void;
  onSnooze: (n: Notification, until: string) => void;
  showActions: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const meta = typeMeta(n.type);
  const unread = !n.read;
  const href = notificationHref(n);

  const snoozeMenu: MenuProps = {
    items: SNOOZE_CHOICES.map((c) => ({ key: c.key, label: c.label })),
    onClick: ({ key }) => {
      const c = SNOOZE_CHOICES.find((x) => x.key === key);
      if (c) onSnooze(n, dayjs().add(c.hours, "hour").toISOString());
    },
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => (href ? onOpen(n) : undefined)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 8,
        cursor: href ? "pointer" : "default",
        background: hover ? "#f7f7fa" : unread ? "rgba(76,76,214,0.045)" : "transparent",
      }}
    >
      <Avatar
        size={30}
        shape="square"
        style={{ background: meta.bg, color: meta.fg, flex: "none", borderRadius: 8 }}
        icon={<span className="material-symbols-rounded" style={{ fontSize: 17 }}>{meta.icon}</span>}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: unread ? 600 : 400,
            color: "#17171c",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {n.message ?? "Notification"}
        </div>
        <div style={{ fontSize: 11.5, color: "#9a9da8" }}>{meta.label}</div>
      </div>

      {/* Right side: actions on hover (or while the snooze menu is open), else
          timestamp + unread dot */}
      {(hover || snoozeOpen) && showActions ? (
        <div
          style={{ display: "flex", alignItems: "center", gap: 2, flex: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          <Tooltip title={unread ? "Mark as read" : "Mark as unread"}>
            <Button
              type="text"
              size="small"
              icon={unread ? <CheckOutlined /> : <MailOutlined />}
              onClick={() => (unread ? onClear(n) : onUnread(n))}
              aria-label={unread ? "Mark as read" : "Mark as unread"}
            />
          </Tooltip>
          <Dropdown
            menu={snoozeMenu}
            trigger={["click"]}
            placement="bottomRight"
            open={snoozeOpen}
            onOpenChange={setSnoozeOpen}
          >
            <Tooltip title="Snooze">
              <Button type="text" size="small" icon={<ClockCircleOutlined />} aria-label="Snooze" />
            </Tooltip>
          </Dropdown>
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            onClick={() => onClear(n)}
          >
            Clear
          </Button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
          <TimeText createdAt={n.created_at} />
          {unread ? (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4c6fff" }} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Compact "3m ago" style relative time for the card meta line. */
function shortAgo(createdAt: string | null): string {
  if (!createdAt) return "";
  const d = dayjs(createdAt);
  if (!d.isValid()) return "";
  const mins = dayjs().diff(d, "minute");
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = dayjs().diff(d, "hour");
  if (hours < 24) return `${hours}h ago`;
  const days = dayjs().diff(d, "day");
  if (days < 7) return `${days}d ago`;
  return d.format("MMM D");
}

/** A floating circular control (the ×/… buttons hugging the card corner). */
function CircleButton({
  label,
  icon,
  t,
  onClick,
}: {
  label: string;
  icon: string;
  t: CardTheme;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        border: `1px solid ${t.circleBorder}`,
        background: t.circleBg,
        color: t.circleFg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 6px 14px -6px rgba(16,24,40,.22)",
        padding: 0,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = t.circleHover)}
      onMouseLeave={(e) => (e.currentTarget.style.color = t.circleFg)}
    >
      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
        {icon}
      </span>
    </button>
  );
}

/** A pill action button (the "Remind Me Later" / "Mark as Done" style). */
function Pill({
  kind,
  icon,
  children,
  t,
  onClick,
}: {
  kind: "light" | "green";
  icon: string;
  children: React.ReactNode;
  t: CardTheme;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const green = kind === "green";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "9px 16px",
        borderRadius: 999,
        fontSize: 13.5,
        fontWeight: 700,
        cursor: "pointer",
        border: green ? "1px solid rgba(255,255,255,.25)" : `1px solid ${t.pillBorder}`,
        background: green
          ? "linear-gradient(180deg,#5ec26a 0%,#3fae53 100%)"
          : t.pillBg,
        color: green ? "#ffffff" : t.pillFg,
        boxShadow: green
          ? "0 12px 22px -10px rgba(63,174,83,.55), inset 0 1px 0 rgba(255,255,255,.35)"
          : "0 8px 16px -10px rgba(16,24,40,.2)",
        transition: "transform .14s ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-1px)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
    >
      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>
        {icon}
      </span>
      {children}
    </button>
  );
}

/**
 * The big notification card (Action Needed tab): muted meta line, bold title,
 * "Remind Me Later" (snooze) + green "Mark as Done" pills, and floating ×/…
 * controls hugging the top-right corner. `stackTail` draws the peeking
 * stacked-cards layers under the last card.
 */
function ActionNotificationCard({
  n,
  stackTail,
  t,
  onOpen,
  onClear,
  onUnread,
  onSnooze,
}: {
  n: Notification;
  stackTail: boolean;
  t: CardTheme;
  onOpen: (n: Notification) => void;
  onClear: (n: Notification) => void;
  onUnread: (n: Notification) => void;
  onSnooze: (n: Notification, until: string) => void;
}) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const meta = typeMeta(n.type);
  const unread = !n.read;
  const href = notificationHref(n);

  const snoozeMenu: MenuProps = {
    items: SNOOZE_CHOICES.map((c) => ({ key: c.key, label: c.label })),
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      const c = SNOOZE_CHOICES.find((x) => x.key === key);
      if (c) onSnooze(n, dayjs().add(c.hours, "hour").toISOString());
    },
  };

  const moreMenu: MenuProps = {
    items: [
      ...(href ? [{ key: "open", label: "Open" }] : []),
      unread
        ? { key: "read", label: "Mark as read" }
        : { key: "unread", label: "Mark as unread" },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === "open") onOpen(n);
      if (key === "read") onClear(n);
      if (key === "unread") onUnread(n);
    },
  };

  return (
    <div style={{ position: "relative", paddingTop: 12 }}>
      {/* Floating corner controls */}
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 2,
          display: "flex",
          gap: 6,
          zIndex: 3,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Dropdown menu={moreMenu} trigger={["click"]} placement="bottomRight">
          <span>
            <CircleButton label="More actions" icon="more_horiz" t={t} />
          </span>
        </Dropdown>
        <CircleButton label="Dismiss" icon="close" t={t} onClick={() => onClear(n)} />
      </div>

      {/* The card */}
      <div
        onClick={() => (href ? onOpen(n) : undefined)}
        style={{
          position: "relative",
          zIndex: 1,
          background: t.card,
          borderRadius: 22,
          padding: "18px 18px 16px",
          border: `1px solid ${t.cardBorder}`,
          cursor: href ? "pointer" : "default",
          opacity: unread ? 1 : 0.62,
          boxShadow: unread ? t.cardShadowStrong : t.cardShadowSoft,
        }}
      >
        {/* Meta line */}
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              width: 28,
              height: 28,
              flex: "none",
              borderRadius: 8,
              background: meta.bg,
              color: meta.fg,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 17, lineHeight: 1 }}>
              {meta.icon}
            </span>
          </span>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: t.meta,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {meta.tag} • {meta.verb} {shortAgo(n.created_at)}
          </span>
        </div>

        {/* Title */}
        <div
          style={{
            margin: "8px 0 14px",
            fontSize: 17,
            fontWeight: 750,
            letterSpacing: "-.3px",
            lineHeight: 1.25,
            color: t.title,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {n.message ?? "Notification"}
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {unread ? (
            <>
              <Dropdown
                menu={snoozeMenu}
                trigger={["click"]}
                placement="bottomLeft"
                open={snoozeOpen}
                onOpenChange={setSnoozeOpen}
              >
                <span>
                  <Pill kind="light" icon="notifications" t={t}>
                    Remind Me Later
                  </Pill>
                </span>
              </Dropdown>
              <Pill kind="green" icon="verified" t={t} onClick={() => onClear(n)}>
                Mark as Done
              </Pill>
            </>
          ) : (
            <>
              <Pill kind="light" icon="undo" t={t} onClick={() => onUnread(n)}>
                Mark Unread
              </Pill>
              {href ? (
                <Pill kind="light" icon="arrow_forward" t={t} onClick={() => onOpen(n)}>
                  Open
                </Pill>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Stacked-cards tail under the last card */}
      {stackTail ? (
        <>
          <div
            aria-hidden
            style={{
              height: 12,
              margin: "-5px 14px 0",
              borderRadius: "0 0 18px 18px",
              background: t.tail1,
              border: `1px solid ${t.cardBorder}`,
              borderTop: "none",
              boxShadow: "0 10px 18px -14px rgba(16,24,40,.25)",
            }}
          />
          <div
            aria-hidden
            style={{
              height: 10,
              margin: "-4px 28px 0",
              borderRadius: "0 0 16px 16px",
              background: t.tail2,
              border: `1px solid ${t.cardBorder}`,
              borderTop: "none",
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Notifications in a right sidebar with two tabs:
 * - **Action Needed** — mentions, comments, assignments handled one by one
 *   (Clear / mark-unread / snooze per row; no bulk mark-all).
 * - **General** — informational, with a scoped "Mark all read".
 * Closed, the bell shows red = action items awaiting a response + grey = general
 * unread.
 */
export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"action" | "general">("action");
  const dark = useUIStore((s) => s.themeMode === "dark");
  const t = useMemo(() => cardTheme(dark), [dark]);

  useNotificationsRealtime();
  const { data, isLoading } = useNotifications();
  const { data: counts } = useUnreadNotificationCounts();
  const markRead = useMarkNotificationRead();
  const markUnread = useMarkNotificationUnread();
  const snooze = useSnoozeNotification();
  const markByTypes = useMarkNotificationsReadByTypes();

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const actionItems = useMemo(() => items.filter((n) => isActionNotification(n.type)), [items]);
  const generalItems = useMemo(() => items.filter((n) => !isActionNotification(n.type)), [items]);
  const actionUnread = counts?.action ?? 0;
  const generalUnread = counts?.general ?? 0;

  const openNotification = (n: Notification) => {
    if (!n.read) markRead.mutate(n.id);
    const href = notificationHref(n);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  };
  const clear = (n: Notification) => markRead.mutate(n.id);
  const unread = (n: Notification) => markUnread.mutate(n.id);
  const doSnooze = (n: Notification, until: string) => snooze.mutate({ id: n.id, until });
  const markAllGeneral = () =>
    markByTypes.mutate({ types: [...ACTION_NOTIFICATION_TYPES], invert: true });

  const renderActionCards = (list: Notification[], emptyText: string) => {
    if (isLoading) {
      return (
        <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
          <Spin size="small" />
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={emptyText}
          style={{ margin: "28px 0" }}
        />
      );
    }
    return (
      <div
        style={{
          background: t.well,
          borderRadius: 18,
          padding: "12px 12px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {list.map((n, i) => (
          <ActionNotificationCard
            key={n.id}
            n={n}
            stackTail={i === list.length - 1 && list.length > 1}
            t={t}
            onOpen={openNotification}
            onClear={clear}
            onUnread={unread}
            onSnooze={doSnooze}
          />
        ))}
      </div>
    );
  };

  const renderList = (list: Notification[], showActions: boolean, emptyText: string) => {
    if (isLoading) {
      return (
        <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
          <Spin size="small" />
        </div>
      );
    }
    if (list.length === 0) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} style={{ margin: "28px 0" }} />;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {list.map((n) => (
          <NotificationRow
            key={n.id}
            n={n}
            onOpen={openNotification}
            onClear={clear}
            onUnread={unread}
            onSnooze={doSnooze}
            showActions={showActions}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <Tooltip title="Notifications">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <Badge count={actionUnread} size="small" overflowCount={99}>
            <Button
              type="text"
              aria-label={`Notifications — ${actionUnread} need a response, ${generalUnread} unread`}
              icon={<BellOutlined />}
              onClick={() => {
                setTab(actionUnread > 0 ? "action" : "general");
                setOpen(true);
              }}
            />
          </Badge>
          {generalUnread > 0 ? (
            <span
              role="button"
              aria-label={`${generalUnread} unread general notifications`}
              onClick={() => {
                setTab("general");
                setOpen(true);
              }}
              style={{
                minWidth: 18,
                height: 16,
                padding: "0 5px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 9,
                fontSize: 10.5,
                fontWeight: 600,
                color: "#6a6d78",
                background: "rgba(128,128,140,0.14)",
                cursor: "pointer",
              }}
            >
              {generalUnread > 99 ? "99+" : generalUnread}
            </span>
          ) : null}
        </span>
      </Tooltip>

      <Drawer
        title="Notifications"
        placement="right"
        width="min(440px, 100vw)"
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { paddingTop: 4, paddingInline: 10 } }}
      >
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as "action" | "general")}
          items={[
            {
              key: "action",
              label: (
                <Space size={6}>
                  Action Needed
                  {actionUnread > 0 ? <Badge count={actionUnread} size="small" overflowCount={99} /> : null}
                </Space>
              ),
              children: (
                <>
                  <Text type="secondary" style={{ fontSize: 12.5, paddingInline: 4 }}>
                    Mentions, comments and assignments — done or snooze each.
                  </Text>
                  <div style={{ marginTop: 10 }}>
                    {renderActionCards(actionItems, "Nothing needs your response")}
                  </div>
                </>
              ),
            },
            {
              key: "general",
              label: (
                <Space size={6}>
                  General
                  {generalUnread > 0 ? (
                    <Badge count={generalUnread} size="small" color="#8a8d98" overflowCount={99} />
                  ) : null}
                </Space>
              ),
              children: (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingInline: 4,
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 12.5 }}>
                      Updates and announcements.
                    </Text>
                    <Button
                      type="link"
                      size="small"
                      icon={<CheckOutlined />}
                      onClick={markAllGeneral}
                      loading={markByTypes.isPending}
                      disabled={generalUnread === 0}
                      style={{ paddingInline: 0 }}
                    >
                      Mark all read
                    </Button>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {renderList(generalItems, true, "No general notifications")}
                  </div>
                </>
              ),
            },
          ]}
        />
      </Drawer>
    </>
  );
}
