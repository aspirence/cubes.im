"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dropdown, Empty, Skeleton, Tooltip, theme } from "antd";
import type { MenuProps } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  useInboxNotifications,
  useNotificationsRealtime,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useSnoozeNotification,
  useMarkNotificationsReadByTypes,
  isActionNotification,
  ACTION_NOTIFICATION_TYPES,
  type Notification,
} from "@/features/notifications/use-notifications";

dayjs.extend(relativeTime);

const BRAND = "#4a4ad0";

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
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

/** One brand-tinted chip style for every type — identity is the glyph, never a colour. */
const TYPE_META: Record<string, { label: string; icon: string }> = {
  mention: { label: "Mention", icon: "alternate_email" },
  comment: { label: "Comment", icon: "chat_bubble" },
  assignment: { label: "Assigned", icon: "assignment_ind" },
  join_request: { label: "Join request", icon: "person_add" },
  member_joined: { label: "Member joined", icon: "group_add" },
  project_shared: { label: "Project shared", icon: "folder_shared" },
  invitation: { label: "Invitation", icon: "mail" },
  role_changed: { label: "Role changed", icon: "shield_person" },
  info: { label: "Info", icon: "info" },
};

/** Today / Yesterday / date — cheap client-side day bucketing for section headers. */
function dayLabel(iso: string): string {
  const d = dayjs(iso).startOf("day");
  const today = dayjs().startOf("day");
  const diff = today.diff(d, "day");
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.format(d.year() === today.year() ? "MMM D" : "MMM D, YYYY");
}

/** Compact right-edge timestamp: clock time today, date otherwise. */
function stamp(iso: string): string {
  const d = dayjs(iso);
  return d.isSame(dayjs(), "day") ? d.format("h:mm A") : d.format("MMM D");
}

const SNOOZE_CHOICES: { key: string; label: string; hours: number }[] = [
  { key: "1h", label: "1 hour", hours: 1 },
  { key: "3h", label: "3 hours", hours: 3 },
  { key: "tomorrow", label: "Tomorrow", hours: 24 },
  { key: "week", label: "Next week", hours: 24 * 7 },
];

type InboxTab = "primary" | "other" | "later" | "cleared";

/** True while the row is snoozed into the future — the "Later" bucket. */
function isSnoozed(n: Notification): boolean {
  return Boolean(n.remind_at && dayjs(n.remind_at).isAfter(dayjs()));
}

export interface InboxPaneProps {
  title: string;
  description: string;
  /** When set, only notifications of these types are shown (e.g. ['mention']).
   *  Omit for the full inbox. */
  types?: string[];
}

/**
 * ClickUp-style inbox: Primary (needs a response) / Other (updates) / Later
 * (snoozed) / Cleared (read) tabs, day-grouped rows, and hover-revealed
 * actions (snooze, mark unread, a prominent Clear). Backs the Home sidebar's
 * Inbox and Assigned Comments views; `types` narrows the universe (Assigned
 * Comments passes ['mention'], which also hides the Other tab).
 */
export function InboxPane({ title, description, types }: InboxPaneProps) {
  const { token } = theme.useToken();
  const router = useRouter();
  useNotificationsRealtime();
  const { data, isLoading } = useInboxNotifications();
  const markRead = useMarkNotificationRead();
  const markUnread = useMarkNotificationUnread();
  const snooze = useSnoozeNotification();
  const markByTypes = useMarkNotificationsReadByTypes();
  const [tab, setTab] = useState<InboxTab>("primary");

  // The universe this pane sees (Assigned Comments narrows to mentions).
  const universe = useMemo(() => {
    const list = data ?? [];
    return types && types.length > 0 ? list.filter((n) => types.includes(n.type)) : list;
  }, [data, types]);

  const buckets = useMemo(() => {
    const primary: Notification[] = [];
    const other: Notification[] = [];
    const later: Notification[] = [];
    const cleared: Notification[] = [];
    for (const n of universe) {
      if (isSnoozed(n)) later.push(n);
      else if (n.read) cleared.push(n);
      else if (isActionNotification(n.type)) primary.push(n);
      else other.push(n);
    }
    return { primary, other, later, cleared };
  }, [universe]);

  // With a type filter every item is one family — a lone "Other" tab is noise.
  const showOther = !types || types.length === 0
    ? true
    : types.some((t) => !isActionNotification(t));

  const TABS: { key: InboxTab; label: string; icon: string; count?: number }[] = [
    { key: "primary", label: "Primary", icon: "inbox", count: buckets.primary.length },
    ...(showOther
      ? [{ key: "other" as const, label: "Other", icon: "notifications", count: buckets.other.length }]
      : []),
    { key: "later", label: "Later", icon: "schedule", count: buckets.later.length },
    { key: "cleared", label: "Cleared", icon: "done_all" },
  ];

  const activeList = buckets[showOther || tab !== "other" ? tab : "primary"];

  const groups = useMemo(() => {
    const out: { label: string; items: Notification[] }[] = [];
    for (const n of activeList) {
      const label = dayLabel(n.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [activeList]);

  const clearAll = () => {
    if (tab === "primary") {
      markByTypes.mutate({
        types: types?.length
          ? types.filter((t) => isActionNotification(t))
          : [...ACTION_NOTIFICATION_TYPES],
      });
    } else if (tab === "other") {
      markByTypes.mutate({ types: [...ACTION_NOTIFICATION_TYPES], invert: true });
    }
  };

  const handleClick = (n: Notification) => {
    if (!n.read) markRead.mutate(n.id);
    const href = notificationHref(n);
    if (href) router.push(href);
  };

  const renderRow = (n: Notification) => {
    const meta = TYPE_META[n.type] ?? { label: n.type, icon: "notifications" };
    const unread = !n.read;
    const snoozed = isSnoozed(n);

    const snoozeMenu: MenuProps = {
      items: SNOOZE_CHOICES.map((c) => ({ key: c.key, label: c.label })),
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation();
        const c = SNOOZE_CHOICES.find((x) => x.key === key);
        if (c) snooze.mutate({ id: n.id, until: dayjs().add(c.hours, "hour").toISOString() });
      },
    };

    return (
      <div
        key={n.id}
        className={`ib-row${unread ? " unread" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => handleClick(n)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick(n);
          }
        }}
      >
        <span className="ib-chip">
          <MIcon name={meta.icon} size={16} color={BRAND} />
        </span>
        {unread ? <span className="ib-dot" aria-label="Unread" /> : <span className="ib-dot ib-dot-off" />}

        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="ib-msg" title={n.message}>
            {n.message}
          </span>
          <span className="ib-type">{meta.label}</span>
          {snoozed ? (
            <span className="ib-snoozed">
              <MIcon name="schedule" size={11} />
              until {dayjs(n.remind_at as string).format("MMM D, h:mm A")}
            </span>
          ) : null}
        </div>

        {/* Hover actions — ClickUp-style: quiet icons + a prominent Clear. */}
        <div className="ib-actions" onClick={(e) => e.stopPropagation()}>
          {tab === "cleared" ? (
            <Tooltip title="Mark as unread">
              <button type="button" className="ib-act" aria-label="Mark as unread" onClick={() => markUnread.mutate(n.id)}>
                <MIcon name="mark_email_unread" size={15} />
              </button>
            </Tooltip>
          ) : null}
          {tab === "later" ? (
            <Tooltip title="Remind now">
              <button
                type="button"
                className="ib-act"
                aria-label="Remind now"
                onClick={() => snooze.mutate({ id: n.id, until: dayjs().toISOString() })}
              >
                <MIcon name="notifications_active" size={15} />
              </button>
            </Tooltip>
          ) : null}
          {tab === "primary" || tab === "other" ? (
            <Dropdown menu={snoozeMenu} trigger={["click"]}>
              <Tooltip title="Snooze">
                <button type="button" className="ib-act" aria-label="Snooze">
                  <MIcon name="schedule" size={15} />
                </button>
              </Tooltip>
            </Dropdown>
          ) : null}
          {tab !== "cleared" ? (
            <button
              type="button"
              className="ib-clear"
              onClick={() => markRead.mutate(n.id)}
            >
              <MIcon name="check" size={14} color="#fff" />
              Clear
            </button>
          ) : null}
        </div>

        <span className="ib-stamp">{stamp(n.created_at)}</span>
      </div>
    );
  };

  const emptyText: Record<InboxTab, string> = {
    primary: "Nothing needs your response — you're all caught up 🎉",
    other: "No new updates",
    later: "Nothing snoozed",
    cleared: "Nothing cleared yet",
  };

  return (
    <div>
      <style>{IB_CSS}</style>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{title}</h1>
      <p style={{ color: token.colorTextSecondary, margin: "4px 0 16px", fontSize: 13 }}>
        {description}
      </p>

      {/* Tab bar + Clear all */}
      <div className="ib-tabs">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              className={`ib-tab${active ? " on" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <MIcon name={t.icon} size={16} color={active ? token.colorText : token.colorTextTertiary} />
              {t.label}
              {t.count ? <span className="ib-tab-count">{t.count > 99 ? "99+" : t.count}</span> : null}
            </button>
          );
        })}
        <div style={{ marginLeft: "auto" }}>
          {(tab === "primary" || tab === "other") && activeList.length > 0 ? (
            <Button
              size="small"
              icon={<MIcon name="done_all" size={14} />}
              loading={markByTypes.isPending}
              onClick={clearAll}
            >
              Clear all
            </Button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} style={{ marginTop: 16 }} />
      ) : activeList.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={emptyText[tab]}
          style={{ margin: "48px 0" }}
        />
      ) : (
        groups.map((g) => (
          <div key={g.label}>
            <div className="ib-day">{g.label}</div>
            <div className="ib-list">{g.items.map(renderRow)}</div>
          </div>
        ))
      )}
    </div>
  );
}

/* ClickUp-flavoured styling: dense borderless rows inside a hairline card,
   hover reveals actions, unread rows carry a dot + heavier text. Uses CSS
   variables set from antd tokens at runtime via color-scheme-safe literals. */
const IB_CSS = `
.ib-tabs { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid rgba(128,131,145,.18); padding-bottom: 0; }
.ib-tab { display: inline-flex; align-items: center; gap: 7px; padding: 9px 13px; border: 0; background: none; cursor: pointer;
  font: 600 13px/1 inherit; color: rgba(110,114,128,.95); border-bottom: 2px solid transparent; margin-bottom: -1px; border-radius: 6px 6px 0 0; }
.ib-tab:hover { background: rgba(128,131,145,.08); }
.ib-tab.on { color: inherit; border-bottom-color: currentColor; }
.ib-tab-count { min-width: 17px; height: 17px; padding: 0 5px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px; font-size: 10px; font-weight: 700; color: #fff; background: ${BRAND}; font-variant-numeric: tabular-nums; }
.ib-day { font-size: 12px; font-weight: 700; color: rgba(110,114,128,.9); margin: 18px 2px 8px; }
.ib-list { border: 1px solid rgba(128,131,145,.16); border-radius: 12px; overflow: hidden; }
.ib-row { display: flex; align-items: center; gap: 10px; padding: 11px 14px; cursor: pointer; position: relative;
  border-top: 1px solid rgba(128,131,145,.10); }
.ib-row:first-child { border-top: 0; }
.ib-row:hover { background: rgba(128,131,145,.07); }
.ib-row.unread { background: rgba(74,74,208,.035); }
.ib-row.unread:hover { background: rgba(74,74,208,.07); }
.ib-chip { width: 30px; height: 30px; border-radius: 999px; background: rgba(74,74,208,.10); display: inline-flex;
  align-items: center; justify-content: center; flex: none; }
.ib-dot { width: 7px; height: 7px; border-radius: 999px; background: ${BRAND}; flex: none; }
.ib-dot-off { background: transparent; }
.ib-msg { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ib-row.unread .ib-msg { font-weight: 600; }
.ib-type { font-size: 11px; font-weight: 600; color: rgba(110,114,128,.85); flex: none; }
.ib-snoozed { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: rgba(110,114,128,.85); flex: none; }
.ib-stamp { font-size: 12px; color: rgba(110,114,128,.9); flex: none; min-width: 56px; text-align: right; font-variant-numeric: tabular-nums; }
.ib-actions { display: none; align-items: center; gap: 4px; flex: none; }
.ib-row:hover .ib-actions { display: inline-flex; }
.ib-row:hover .ib-stamp { display: none; }
.ib-act { width: 26px; height: 26px; border: 0; border-radius: 7px; background: none; cursor: pointer; display: inline-flex;
  align-items: center; justify-content: center; color: rgba(110,114,128,.95); }
.ib-act:hover { background: rgba(128,131,145,.14); }
.ib-clear { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border: 0; border-radius: 7px;
  background: ${BRAND}; color: #fff; font: 600 12px/1 inherit; cursor: pointer; }
.ib-clear:hover { filter: brightness(1.08); }
`;
