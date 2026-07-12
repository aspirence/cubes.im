"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, List, Segmented, Skeleton, Space, Tag, Typography, theme } from "antd";
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

const { Text } = Typography;

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

const TYPE_TAG: Record<string, { label: string; color?: string }> = {
  mention: { label: "Mention", color: "gold" },
  comment: { label: "Comment", color: "blue" },
  assignment: { label: "Assigned", color: "purple" },
  info: { label: "Info" },
};

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

  const handleClick = (n: Notification) => {
    if (!n.read) markRead.mutate(n.id);
    const href = notificationHref(n);
    if (href) router.push(href);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              <Tag color="red" style={{ marginInlineEnd: 0, borderRadius: 10 }}>
                {unreadHere > 99 ? "99+" : unreadHere}
              </Tag>
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
            disabled={unreadHere === 0}
            loading={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Mark all read
          </Button>
        </Space>
      </div>

      <Card>
        {isLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : (
          <List<Notification>
            dataSource={items}
            locale={{
              emptyText: (
                <div style={{ textAlign: "center", padding: "48px 24px" }}>
                  <span
                    className="material-symbols-rounded"
                    style={{ fontSize: 30, color: token.colorTextQuaternary }}
                  >
                    {filter === "unread" ? "mark_email_read" : "notifications"}
                  </span>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: token.colorText,
                    }}
                  >
                    {filter === "unread" ? "All caught up" : "Nothing here yet"}
                  </div>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: 12.5,
                      color: token.colorTextTertiary,
                    }}
                  >
                    Comments, mentions and assignments will land here.
                  </p>
                </div>
              ),
            }}
            renderItem={(n) => {
              const tag = TYPE_TAG[n.type] ?? { label: n.type };
              return (
                <List.Item
                  onClick={() => handleClick(n)}
                  style={{
                    cursor: "pointer",
                    paddingInline: 12,
                    borderRadius: 8,
                    background: n.read ? undefined : "rgba(64,108,255,0.06)",
                  }}
                >
                  <List.Item.Meta
                    title={
                      <Space size={8} wrap>
                        {!n.read ? (
                          <span
                            aria-label="Unread"
                            style={{
                              display: "inline-block",
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: "#4c6fff",
                            }}
                          />
                        ) : null}
                        <Text strong={!n.read}>{n.message}</Text>
                      </Space>
                    }
                    description={
                      <Space size={8}>
                        <Tag color={tag.color} style={{ marginInlineEnd: 0 }}>
                          {tag.label}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {dayjs(n.created_at).fromNow()}
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Card>
    </div>
  );
}
