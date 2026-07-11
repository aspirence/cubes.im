"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, Badge, Skeleton, theme } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  useChatChannels,
  useChatRealtime,
  type ChatChannelSummary,
} from "@/features/chat/use-chat";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { NewChannelModal, NewDmModal } from "./_components/chat-sidebar";

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

/** < 900px — same breakpoint as the app shell's drawer. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const on = () => setIsMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isMobile;
}

/** Slack-style quick-action card on the welcome screen. */
function ActionCard({
  icon,
  title,
  desc,
  onClick,
  href,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick?: () => void;
  href?: string;
}) {
  const { token } = theme.useToken();
  const body = (
    <span
      className="wl-chat-action"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: 300,
        maxWidth: "100%",
        textAlign: "left",
        padding: "14px 16px",
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        cursor: "pointer",
        color: "inherit",
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          flex: "none",
          borderRadius: 10,
          background: token.colorPrimaryBg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MIcon name={icon} size={19} color="#4a4ad0" />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 650, color: token.colorText }}>
          {title}
        </span>
        <span style={{ display: "block", fontSize: 12, color: token.colorTextTertiary, marginTop: 1 }}>
          {desc}
        </span>
      </span>
    </span>
  );
  if (href) {
    return (
      <Link href={href} style={{ color: "inherit" }}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
    >
      {body}
    </button>
  );
}

/**
 * Chat home. Desktop with conversations → jump straight into the most recent
 * one (Slack behavior; the rail lists the rest). Mobile → the conversation
 * list, since the rail is desktop-only. Fresh workspaces → a welcome pane
 * with quick actions.
 */
export default function ChatIndexPage() {
  const { token } = theme.useToken();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { data: channels, isLoading } = useChatChannels();
  const isAdmin = useIsTeamAdmin();
  useChatRealtime();

  const [channelModal, setChannelModal] = useState(false);
  const [dmModal, setDmModal] = useState(false);

  const list = channels ?? [];

  // Desktop: land in the most recent conversation, like Slack.
  useEffect(() => {
    if (!isLoading && !isMobile && list.length > 0) {
      router.replace(`/chat/${list[0].id}`);
    }
    // list[0]?.id is derived from `channels`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isMobile, list[0]?.id]);

  const shell = (children: React.ReactNode) => (
    <div
      className="wl-chat-home"
      style={{
        background: token.colorBgContainer,
        display: "flex",
        flexDirection: "column",
        minHeight: "calc(100vh - 58px)",
      }}
    >
      {children}
      <style>{`
        .wl-chat-home{margin:-22px -24px -48px;}
        @media (max-width: 899px){ .wl-chat-home{margin:-16px -14px -40px;} }
        .wl-chat-action{transition:border-color .12s ease, box-shadow .12s ease;}
        .wl-chat-action:hover{border-color:#c6c8f0;box-shadow:0 4px 14px -8px rgba(74,74,208,.3);}
        .wl-chat-row:hover{background:${token.colorFillQuaternary};}
      `}</style>
    </div>
  );

  if (isLoading || (!isMobile && list.length > 0)) {
    // Loading, or about to redirect into the latest conversation.
    return shell(
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>,
    );
  }

  /* ------------------------------------------------ mobile: conversations */
  if (isMobile && list.length > 0) {
    return shell(
      <>
        <div
          style={{
            padding: "16px 16px 10px",
            borderBottom: `1px solid ${token.colorSplit}`,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: token.colorText }}>
            Chat
          </h1>
        </div>
        <div>
          {list.map((c: ChatChannelSummary) => {
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
                  borderBottom: `1px solid ${token.colorSplit}`,
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
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
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
          })}
        </div>
      </>,
    );
  }

  /* ----------------------------------------------------- welcome (empty) */
  return shell(
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <span
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          background: token.colorPrimaryBg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 18,
        }}
      >
        <MIcon name="forum" size={30} color="#4a4ad0" />
      </span>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: token.colorText, letterSpacing: "-.4px" }}>
        Welcome to Chat
      </h1>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 13.5,
          color: token.colorTextSecondary,
          maxWidth: 420,
          lineHeight: 1.6,
        }}
      >
        Talk with your team in channels, or one-to-one in direct messages —
        right next to your work.
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "center",
          marginTop: 28,
        }}
      >
        {isAdmin ? (
          <ActionCard
            icon="tag"
            title="Create a channel"
            desc="A shared space, like #general or #design."
            onClick={() => setChannelModal(true)}
          />
        ) : null}
        <ActionCard
          icon="alternate_email"
          title="Start a direct message"
          desc="Message a teammate one-to-one."
          onClick={() => setDmModal(true)}
        />
        <ActionCard
          icon="group_add"
          title="Invite your teammates"
          desc="Chat is better together — add your team."
          href="/settings/members"
        />
      </div>
      {!isAdmin ? (
        <p style={{ marginTop: 18, fontSize: 12.5, color: token.colorTextTertiary }}>
          Channels are created by workspace admins — ask yours to set one up.
        </p>
      ) : null}

      <NewChannelModal open={channelModal} onClose={() => setChannelModal(false)} />
      <NewDmModal open={dmModal} onClose={() => setDmModal(false)} />
    </div>,
  );
}
