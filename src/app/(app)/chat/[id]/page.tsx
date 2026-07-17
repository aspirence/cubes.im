"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  App as AntdApp,
  Avatar,
  Button,
  Popover,
  Select,
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
  useAddChannelMembers,
  useRemoveChannelMember,
  type ChatMessage,
} from "@/features/chat/use-chat";
import {
  useTeamMembers,
  useIsTeamAdmin,
} from "@/features/team-members/use-team-members";
import {
  TeamMentionInput,
  type MentionEntity,
  type MentionMember,
} from "@/features/team-members/team-mention-input";
import { useNotifyMentions } from "@/features/notifications/use-mention-notify";
import { useTeams, useActiveTeam } from "@/features/teams/use-teams";
import { useAllTeamTasks } from "@/features/tasks/use-all-tasks";
import { useProjects } from "@/features/projects/use-projects";

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

  // Channel membership management (admin or the channel creator).
  const isTeamAdmin = useIsTeamAdmin();
  const { data: teamMembers } = useTeamMembers();
  const addMembers = useAddChannelMembers(channelId);
  const removeMember = useRemoveChannelMember(channelId);
  const canManageMembers =
    channel?.kind === "channel" &&
    (isTeamAdmin || channel?.created_by === user?.id);
  const [addPick, setAddPick] = useState<string[]>([]);
  const memberUserIds = useMemo(
    () => new Set(members.map((m) => m.user_id)),
    [members],
  );
  const addableOptions = useMemo(
    () =>
      (teamMembers ?? [])
        .filter((m) => m.user && !memberUserIds.has(m.user.id))
        .map((m) => ({ value: m.user!.id, label: m.user!.name })),
    [teamMembers, memberUserIds],
  );
  const handleAddMembers = async () => {
    if (!addPick.length) return;
    try {
      const n = await addMembers.mutateAsync(addPick);
      setAddPick([]);
      message.success(n === 1 ? "Added 1 person." : `Added ${n} people.`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't add people.");
    }
  };
  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMember.mutateAsync(userId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't remove.");
    }
  };
  const title =
    channel?.kind === "dm" ? (partner?.name ?? "Direct message") : (channel?.name ?? "Channel");

  // Everything `@` can tag from the composer: people, teams, tasks, projects.
  const { data: allTeams } = useTeams();
  const { data: activeTeam } = useActiveTeam();
  const { data: teamTasks } = useAllTeamTasks();
  const { data: allProjects } = useProjects();
  const notifyMentions = useNotifyMentions();

  const mentionMembers = useMemo<MentionMember[]>(
    () =>
      (teamMembers ?? [])
        .filter((m) => m.user)
        .map((m) => ({
          id: m.user!.id,
          name: m.user!.name,
          avatarUrl: m.user!.avatar_url,
          email: m.user!.email,
        })),
    [teamMembers],
  );
  const mentionEntities = useMemo<MentionEntity[]>(
    () => [
      ...(allTeams ?? []).map((t) => ({
        id: t.id,
        label: t.name,
        kind: "team" as const,
        meta: "Team — notifies its members",
      })),
      ...(allProjects ?? []).map((pr) => ({
        id: pr.id,
        label: pr.name,
        kind: "project" as const,
      })),
      ...(teamTasks ?? [])
        .filter((t) => !t.done)
        .slice(0, 200)
        .map((t) => ({
          id: t.id,
          label: t.name,
          kind: "task" as const,
          meta: t.project?.name,
        })),
    ],
    [allTeams, allProjects, teamTasks],
  );

  const myName = useMemo(
    () => (teamMembers ?? []).find((m) => m.user?.id === user?.id)?.user?.name ?? "Someone",
    [teamMembers, user?.id],
  );

  const submit = () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft("");
    send.mutate(text, {
      onError: (err) => {
        setDraft(text);
        message.error(err instanceof Error ? err.message : "Couldn't send the message.");
      },
      onSuccess: () => {
        // Fire-and-forget: mentioned people/teams get an inbox notification;
        // failures must never read as a failed send.
        void notifyMentions({
          text,
          members: mentionMembers,
          entities: mentionEntities,
          message: `${myName} mentioned you in ${channel?.kind === "dm" ? "a direct message" : `#${title}`}`,
          url: `/chat/${channelId}`,
          teamId: activeTeam?.id,
        });
      },
    });
  };

  const rows = messages ?? [];

  return (
    <div
      className="wl-chat-thread"
      style={{
        display: "flex",
        flexDirection: "column",
        // Full-bleed Slack-style pane: fill the content area edge to edge.
        height: "calc(100vh - 58px)",
        background: token.colorBgContainer,
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
            {infoLoading ? (
              <Skeleton.Input active size="small" style={{ width: 140, height: 16 }} />
            ) : (
              title
            )}
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
              <div style={{ width: 280, maxHeight: 380, overflowY: "auto" }}>
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
                {members.map((m) => {
                  const isCreator = m.user_id === channel?.created_by;
                  const canRemove =
                    canManageMembers && !isCreator ? true : m.user_id === user?.id && !isCreator;
                  return (
                    <div
                      key={m.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}
                    >
                      <Avatar size={22} src={m.user?.avatar_url ?? undefined} style={{ fontSize: 10 }}>
                        {initials(m.user?.name ?? "?")}
                      </Avatar>
                      <span style={{ fontSize: 13, color: token.colorText, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.user?.name ?? "Member"}
                        {isCreator ? (
                          <span style={{ fontSize: 11, color: token.colorTextTertiary }}> · owner</span>
                        ) : null}
                      </span>
                      {canRemove ? (
                        <Tooltip title={m.user_id === user?.id ? "Leave" : "Remove"}>
                          <Button
                            type="text"
                            size="small"
                            aria-label="Remove member"
                            loading={removeMember.isPending}
                            onClick={() => void handleRemoveMember(m.user_id)}
                            icon={<MIcon name="close" size={14} color={token.colorTextTertiary} />}
                          />
                        </Tooltip>
                      ) : null}
                    </div>
                  );
                })}

                {canManageMembers ? (
                  <div style={{ marginTop: 10, borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 10 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", color: token.colorTextTertiary, marginBottom: 6 }}>
                      Add people
                    </div>
                    <Select
                      mode="multiple"
                      size="small"
                      style={{ width: "100%" }}
                      placeholder="Search teammates…"
                      optionFilterProp="label"
                      value={addPick}
                      onChange={setAddPick}
                      options={addableOptions}
                      maxTagCount="responsive"
                      notFoundContent="Everyone's already in"
                    />
                    <Button
                      type="primary"
                      size="small"
                      block
                      style={{ marginTop: 8 }}
                      disabled={!addPick.length}
                      loading={addMembers.isPending}
                      onClick={() => void handleAddMembers()}
                    >
                      Add {addPick.length ? `(${addPick.length})` : ""}
                    </Button>
                  </div>
                ) : channel?.is_private ? (
                  <div style={{ fontSize: 11.5, color: token.colorTextQuaternary, marginTop: 8 }}>
                    Private channel — only members can see it.
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: token.colorTextQuaternary, marginTop: 8 }}>
                    Anyone on the team can join by opening the channel.
                  </div>
                )}
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
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
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
            <div style={{ fontSize: 13.5, fontWeight: 650, color: token.colorText }}>
              {channel?.kind === "dm"
                ? `This is the start of your conversation with ${title}.`
                : `Welcome to #${title}`}
            </div>
            <div style={{ fontSize: 12.5, color: token.colorTextTertiary }}>Say hello below.</div>
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
                  className="wl-chat-msg"
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

      {/* Composer — Slack-style bordered box with the send action inside. */}
      <div style={{ padding: "4px 16px 14px", flex: "none" }}>
        <div
          className="wl-chat-composer"
          style={{
            border: `1px solid ${token.colorBorder}`,
            borderRadius: 10,
            background: token.colorBgContainer,
            display: "flex",
            alignItems: "flex-end",
            gap: 6,
            padding: "4px 6px 4px 4px",
          }}
        >
          <TeamMentionInput
            value={draft}
            onChange={setDraft}
            members={mentionMembers}
            entities={mentionEntities}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`Message ${channel?.kind === "dm" ? title : `#${title}`}  (@ to tag)`}
            autoSize={{ minRows: 1, maxRows: 8 }}
            maxLength={4000}
            variant="borderless"
            style={{ flex: 1, fontSize: 13.5, padding: "7px 10px" }}
          />
          <Tooltip title="Send (Enter) · Shift+Enter for a new line">
            <Button
              type="primary"
              size="small"
              aria-label="Send message"
              disabled={!draft.trim()}
              loading={send.isPending}
              onClick={submit}
              style={{ borderRadius: 8, height: 30, width: 34, marginBottom: 3 }}
              icon={<MIcon name="send" size={15} />}
            />
          </Tooltip>
        </div>
      </div>
      <style>{`
        .wl-chat-thread{margin:-22px -24px -48px;}
        @media (max-width: 899px){ .wl-chat-thread{margin:-16px -14px -40px;} }
        .wl-chat-composer:focus-within{border-color:#4a4ad0;box-shadow:0 0 0 2px rgba(74,74,208,.12);}
        .wl-chat-msg{border-radius:8px;margin:0 -8px;padding-left:8px;padding-right:8px;}
        .wl-chat-msg:hover{background:${token.colorFillQuaternary};}
      `}</style>
    </div>
  );
}
