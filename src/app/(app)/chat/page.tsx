"use client";

import { useRouter } from "next/navigation";
import { Avatar, Badge, Skeleton, theme } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  useChatChannels,
  useChatRealtime,
  type ChatChannelSummary,
} from "@/features/chat/use-chat";

dayjs.extend(relativeTime);

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color }}
    >
      {name}
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Chat home: the conversation list as page content. On desktop the rail shows
 * the same list; here it doubles as the landing view and the only entry point
 * on mobile (where custom section rails are hidden).
 */
export default function ChatIndexPage() {
  const { token } = theme.useToken();
  const router = useRouter();
  const { data: channels, isLoading } = useChatChannels();
  useChatRealtime();

  const list = channels ?? [];

  const row = (c: ChatChannelSummary) => {
    const label =
      c.kind === "dm" ? (c.other_user_name ?? "Direct message") : (c.name ?? "Channel");
    const unread = c.unread_count > 0;
    return (
      <a
        key={c.id}
        onClick={() => router.push(`/chat/${c.id}`)}
        className="wl-chat-row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          cursor: "pointer",
          borderTop: `1px solid ${token.colorSplit}`,
          color: "inherit",
        }}
      >
        {c.kind === "dm" ? (
          <Avatar size={36} src={c.other_avatar ?? undefined} style={{ fontSize: 13, flex: "none" }}>
            {initials(label)}
          </Avatar>
        ) : (
          <span
            style={{
              width: 36,
              height: 36,
              flex: "none",
              borderRadius: 10,
              background: token.colorPrimaryBg,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MIcon name="tag" size={18} color="#4a4ad0" />
          </span>
        )}
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 14,
                fontWeight: unread ? 700 : 600,
                color: token.colorText,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
            {c.last_at ? (
              <span style={{ fontSize: 11.5, color: token.colorTextQuaternary, flex: "none" }}>
                {dayjs(c.last_at).fromNow()}
              </span>
            ) : null}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 12.5,
              color: unread ? token.colorTextSecondary : token.colorTextTertiary,
              fontWeight: unread ? 550 : 400,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 1,
            }}
          >
            {c.last_body
              ? `${c.last_author ? `${c.last_author}: ` : ""}${c.last_body}`
              : c.topic || "No messages yet — say hello."}
          </span>
        </span>
        {unread ? (
          <Badge
            count={c.unread_count}
            size="small"
            style={{ backgroundColor: "#4a4ad0", boxShadow: "none", flex: "none" }}
          />
        ) : null}
      </a>
    );
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: "-.4px",
            color: token.colorText,
          }}
        >
          Chat
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: token.colorTextSecondary }}>
          Channels and one-to-one messages with your team.
        </p>
      </div>

      <div
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {isLoading ? (
          <div style={{ padding: 18 }}>
            <Skeleton active paragraph={{ rows: 5 }} />
          </div>
        ) : list.length === 0 ? (
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              color: token.colorTextTertiary,
            }}
          >
            <MIcon name="forum" size={30} color={token.colorTextQuaternary} />
            <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText, marginTop: 10 }}>
              No conversations yet
            </div>
            <div style={{ fontSize: 12.5, marginTop: 4 }}>
              Start a direct message from the sidebar — or ask an admin to create a channel.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: -1 }}>{list.map(row)}</div>
        )}
      </div>
      <style>{`.wl-chat-row:hover{background:${token.colorFillQuaternary};}`}</style>
    </div>
  );
}
