"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Segmented, Skeleton, Space, Tooltip, theme } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  useNotifications,
  useNotificationsRealtime,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
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

export interface InboxPaneProps {
  title: string;
  description: string;
  /** When set, only notifications of these types are shown (e.g. ['mention']).
   *  Omit for the full inbox. */
  types?: string[];
}

/**
 * Full-page notification list backing the Home sidebar's Inbox and Assigned
 * Comments views. Same data as the header bell, filtered by type;
 * clicking an item marks it read and jumps to its task/project.
 */
export function InboxPane({ title, description, types }: InboxPaneProps) {
  const { token } = theme.useToken();
  const router = useRouter();
  useNotificationsRealtime();
  const { data, isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const items = useMemo(() => {
    let list = data?.items ?? [];
    if (types && types.length > 0) {
      list = list.filter((n) => types.includes(n.type));
    }
    if (filter === "unread") list = list.filter((n) => !n.read);
    return list;
  }, [data?.items, types, filter]);

  const unreadHere = useMemo(
    () =>
      (data?.items ?? []).filter(
        (n) => !n.read && (!types || types.includes(n.type)),
      ).length,
    [data?.items, types],
  );

  // The list arrives newest-first, so consecutive runs of the same day label
  // are already contiguous — a single pass groups without re-sorting.
  const groups = useMemo(() => {
    const out: { label: string; items: Notification[] }[] = [];
    for (const n of items) {
      const label = dayLabel(n.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [items]);

  const handleClick = (n: Notification) => {
    if (!n.read) markRead.mutate(n.id);
    const href = notificationHref(n);
    if (href) router.push(href);
  };

  const renderRow = (n: Notification) => {
    const meta = TYPE_META[n.type] ?? { label: n.type, icon: "notifications" };
    const href = notificationHref(n);
    return (
      <div
        key={n.id}
        className={`ib-row${n.read ? "" : " unread"}`}
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
          <MIcon name={meta.icon} size={17} color={BRAND} />
          {!n.read ? <span className="ib-dot" aria-label="Unread" /> : null}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ib-msg" title={n.message}>
            {n.message}
          </div>
          <div className="ib-meta">
            <span className="ib-type">{meta.label}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <MIcon name="schedule" size={12} color={token.colorTextQuaternary} />
              {dayjs(n.created_at).fromNow()}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 2, alignSelf: "center", flex: "none" }}>
          {!n.read ? (
            <Tooltip title="Mark as read">
              <button
                type="button"
                className="ib-act"
                aria-label="Mark as read"
                onClick={(e) => {
                  e.stopPropagation();
                  markRead.mutate(n.id);
                }}
              >
                <MIcon name="check" size={16} />
              </button>
            </Tooltip>
          ) : null}
          {href ? (
            <Tooltip title="Open">
              <span className="ib-act" aria-hidden>
                <MIcon name="arrow_forward" size={16} />
              </span>
            </Tooltip>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{IB_CSS(token)}</style>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 21,
                fontWeight: 600,
                letterSpacing: "-.4px",
                color: token.colorText,
              }}
            >
              {title}
            </h1>
            {unreadHere > 0 ? (
              <span className="ib-count">{unreadHere > 99 ? "99+" : unreadHere}</span>
            ) : null}
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: token.colorTextSecondary }}>
            {description}
          </p>
        </div>
        <Space>
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as "all" | "unread")}
            options={[
              { label: "All", value: "all" },
              { label: "Unread", value: "unread" },
            ]}
          />
          <Button
            size="small"
            icon={<MIcon name="done_all" size={15} />}
            disabled={unreadHere === 0}
            loading={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Mark all read
          </Button>
        </Space>
      </div>

      <div className="ib-card">
        {isLoading ? (
          <div style={{ padding: 16 }}>
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px 52px" }}>
            <span
              style={{
                width: 54,
                height: 54,
                borderRadius: 16,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: token.colorPrimaryBg,
              }}
            >
              <MIcon
                name={filter === "unread" ? "mark_email_read" : "inbox"}
                size={26}
                color={BRAND}
              />
            </span>
            <div style={{ marginTop: 12, fontSize: 14.5, fontWeight: 600, color: token.colorText }}>
              {filter === "unread" ? "You're all caught up" : "Nothing here yet"}
            </div>
            <p
              style={{
                margin: "4px auto 0",
                fontSize: 12.5,
                color: token.colorTextTertiary,
                maxWidth: 300,
              }}
            >
              {filter === "unread"
                ? "No unread notifications — new ones will surface here."
                : "Comments, mentions and assignments will land here."}
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="ib-group">
              <div className="ib-day">
                {g.label}
                <span className="ib-day-n">{g.items.length}</span>
              </div>
              {g.items.map(renderRow)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Row / chip / day-header chrome; single brand accent, tokens only for surfaces. */
function IB_CSS(token: ReturnType<typeof theme.useToken>["token"]): string {
  return `
  .ib-count{display:inline-flex;align-items:center;font-size:11px;font-weight:700;color:${token.colorError};background:${token.colorErrorBg};border-radius:999px;padding:2px 9px;line-height:1.4;}

  .ib-card{background:${token.colorBgContainer};border:1px solid ${token.colorBorderSecondary};border-radius:12px;padding:6px;box-shadow:0 1px 2px rgba(16,24,40,0.03);}

  .ib-group + .ib-group .ib-day{margin-top:6px;border-top:1px solid ${token.colorSplit};padding-top:12px;}
  .ib-day{display:flex;align-items:center;gap:8px;padding:8px 10px 4px;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${token.colorTextQuaternary};}
  .ib-day-n{font-size:10.5px;font-weight:600;color:${token.colorTextTertiary};background:${token.colorFillTertiary};border-radius:999px;padding:0 7px;line-height:16px;letter-spacing:0;}

  .ib-row{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:background .12s;}
  .ib-row:hover{background:${token.colorFillQuaternary};}
  .ib-row + .ib-row{margin-top:1px;}
  .ib-row.unread{background:color-mix(in srgb, ${BRAND} 4%, transparent);}
  .ib-row.unread:hover{background:color-mix(in srgb, ${BRAND} 8%, transparent);}

  .ib-chip{position:relative;width:32px;height:32px;border-radius:9px;flex:none;display:inline-flex;align-items:center;justify-content:center;background:${token.colorPrimaryBg};margin-top:1px;}
  .ib-dot{position:absolute;top:-3px;right:-3px;width:6px;height:6px;border-radius:999px;background:${BRAND};box-shadow:0 0 0 2px ${token.colorBgContainer};}

  .ib-msg{font-size:13px;font-weight:500;color:${token.colorTextSecondary};line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
  .ib-row.unread .ib-msg{font-weight:600;color:${token.colorText};}
  .ib-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:3px;font-size:11.5px;color:${token.colorTextTertiary};}
  .ib-type{display:inline-flex;align-items:center;font-size:10.5px;font-weight:600;color:${token.colorTextSecondary};background:${token.colorFillQuaternary};border:1px solid ${token.colorBorderSecondary};border-radius:999px;padding:1px 8px;white-space:nowrap;}

  .ib-act{display:inline-flex;align-items:center;justify-content:center;border:none;background:transparent;padding:5px;border-radius:7px;cursor:pointer;color:${token.colorTextQuaternary};opacity:0;transition:opacity .12s,background .12s,color .12s;}
  .ib-row:hover .ib-act,.ib-row:focus-visible .ib-act{opacity:1;}
  .ib-act:hover{background:${token.colorFillSecondary};color:${token.colorText};}
  `;
}
