"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  App as AntdApp,
  Avatar,
  Button,
  Input,
  Popover,
  Skeleton,
  Tooltip,
  theme,
} from "antd";
import dayjs from "dayjs";
import { useAuth } from "@/features/auth/use-auth";
import {
  useChatChannel,
  useChatMessages,
  useChatRealtime,
  useMarkChannelRead,
  useSendMessage,
  type ChatMessage,
} from "@/features/chat/use-chat";

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

/** Group consecutive same-author messages within 5 minutes. */
function isGrouped(prev: ChatMessage | undefined, m: ChatMessage): boolean {
  return Boolean(
    prev &&
      prev.user_id === m.user_id &&
      dayjs(m.created_at).diff(dayjs(prev.created_at), "minute") < 5 &&
      dayjs(m.created_at).isSame(prev.created_at, "day"),
  );
}

export default function ChatThreadPage() {
  const { token } = theme.useToken();
  const params = useParams<{ id: string }>();
  const channelId = params.id;
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { user } = useAuth();

  const { data: info, isLoading: infoLoading } = useChatChannel(channelId);
  const { data: messages, isLoading: msgsLoading } = useChatMessages(channelId);
  const send = useSendMessage(channelId);
  const markRead = useMarkChannelRead();
  useChatRealtime(channelId);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Mark read on open and whenever new messages arrive while the thread is open.
  const lastCount = useRef(0);
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (channelId && count !== lastCount.current) {
      lastCount.current = count;
      markRead.mutate(channelId);
    }
    // markRead is a stable mutation object from useMutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, messages?.length]);

  // Stick to the bottom as messages arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  const channel = info?.channel;
  const members = useMemo(() => info?.members ?? [], [info?.members]);
  const partner = useMemo(
    () => members.find((m) => m.user_id !== user?.id)?.user ?? null,
    [members, user?.id],
  );
  const title =
    channel?.kind === "dm" ? (partner?.name ?? "Direct message") : (channel?.name ?? "Channel");

  const submit = () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft("");
    send.mutate(text, {
      onError: (err) => {
        setDraft(text);
        message.error(err instanceof Error ? err.message : "Couldn't send the message.");
      },
    });
  };

  const rows = messages ?? [];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        // Fill the shell content area: viewport minus topbar and main padding.
        height: "calc(100vh - 58px - 70px)",
        minHeight: 380,
        maxWidth: 980,
        margin: "0 auto",
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderBottom: `1px solid ${token.colorSplit}`,
          flex: "none",
        }}
      >
        <Tooltip title="All conversations">
          <Button
            type="text"
            size="small"
            aria-label="Back to chat"
            icon={<MIcon name="arrow_back" size={17} color={token.colorTextSecondary} />}
            onClick={() => router.push("/chat")}
          />
        </Tooltip>
        {channel?.kind === "dm" ? (
          <Avatar size={30} src={partner?.avatar_url ?? undefined} style={{ fontSize: 12, flex: "none" }}>
            {initials(title)}
          </Avatar>
        ) : (
          <span
            style={{
              width: 30,
              height: 30,
              flex: "none",
              borderRadius: 9,
              background: token.colorPrimaryBg,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MIcon name={channel?.is_private ? "lock" : "tag"} size={16} color="#4a4ad0" />
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 650, color: token.colorText, lineHeight: 1.2 }}>
            {infoLoading ? "…" : title}
          </div>
          {channel?.topic ? (
            <div
              style={{
                fontSize: 12,
                color: token.colorTextTertiary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {channel.topic}
            </div>
          ) : null}
        </div>
        {channel?.kind === "channel" ? (
          <Popover
            trigger="click"
            placement="bottomRight"
            content={
              <div style={{ minWidth: 200, maxHeight: 280, overflowY: "auto" }}>
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    letterSpacing: ".5px",
                    textTransform: "uppercase",
                    color: token.colorTextTertiary,
                    marginBottom: 8,
                  }}
                >
                  Members · {members.length}
                </div>
                {members.map((m) => (
                  <div
                    key={m.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}
                  >
                    <Avatar size={22} src={m.user?.avatar_url ?? undefined} style={{ fontSize: 10 }}>
                      {initials(m.user?.name ?? "?")}
                    </Avatar>
                    <span style={{ fontSize: 13, color: token.colorText }}>
                      {m.user?.name ?? "Member"}
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: 11.5, color: token.colorTextQuaternary, marginTop: 8 }}>
                  Anyone on the team can join by opening the channel.
                </div>
              </div>
            }
          >
            <Button
              type="text"
              size="small"
              aria-label="Channel members"
              icon={<MIcon name="group" size={17} color={token.colorTextSecondary} />}
            />
          </Popover>
        ) : null}
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        {msgsLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : rows.length === 0 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: token.colorTextTertiary,
              gap: 8,
            }}
          >
            <MIcon name="waving_hand" size={28} color={token.colorTextQuaternary} />
            <div style={{ fontSize: 13.5 }}>
              {channel?.kind === "dm"
                ? `This is the start of your conversation with ${title}.`
                : `Welcome to #${title} — say hello.`}
            </div>
          </div>
        ) : (
          rows.map((m, i) => {
            const prev = rows[i - 1];
            const grouped = isGrouped(prev, m);
            const newDay = !prev || !dayjs(m.created_at).isSame(prev.created_at, "day");
            const mine = m.user_id === user?.id;
            return (
              <div key={m.id}>
                {newDay ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      margin: "16px 0 10px",
                    }}
                  >
                    <div style={{ flex: 1, height: 1, background: token.colorSplit }} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: token.colorTextTertiary }}>
                      {dayjs(m.created_at).isSame(dayjs(), "day")
                        ? "Today"
                        : dayjs(m.created_at).format("ddd, MMM D")}
                    </span>
                    <div style={{ flex: 1, height: 1, background: token.colorSplit }} />
                  </div>
                ) : null}
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: grouped ? "1px 0" : "6px 0 1px",
                  }}
                >
                  <div style={{ width: 30, flex: "none" }}>
                    {!grouped ? (
                      <Avatar size={30} src={m.author?.avatar_url ?? undefined} style={{ fontSize: 12 }}>
                        {initials(m.author?.name ?? "?")}
                      </Avatar>
                    ) : null}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {!grouped ? (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: token.colorText }}>
                          {mine ? "You" : (m.author?.name ?? "Member")}
                        </span>
                        <span style={{ fontSize: 11.5, color: token.colorTextQuaternary }}>
                          {dayjs(m.created_at).format("h:mm A")}
                        </span>
                      </div>
                    ) : null}
                    <div
                      style={{
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        color: token.colorText,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "break-word",
                      }}
                    >
                      {m.body}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
          padding: "10px 12px",
          borderTop: `1px solid ${token.colorSplit}`,
          flex: "none",
        }}
      >
        <Input.TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={`Message ${channel?.kind === "dm" ? title : `#${title}`}`}
          autoSize={{ minRows: 1, maxRows: 6 }}
          maxLength={4000}
          variant="borderless"
          style={{ flex: 1, fontSize: 13.5, padding: "6px 8px" }}
        />
        <Tooltip title="Send (Enter)">
          <Button
            type="primary"
            shape="circle"
            aria-label="Send message"
            disabled={!draft.trim()}
            loading={send.isPending}
            onClick={submit}
            icon={<MIcon name="send" size={16} />}
          />
        </Tooltip>
      </div>
    </div>
  );
}
