"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  App as AntdApp,
  Avatar,
  Button,
  Input,
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
import { useUploadChatFile } from "@/features/storage/use-storage";
import {
  LinkifiedText,
  MessageAttachments,
  MessageLinkPreview,
  PendingAttachmentStrip,
} from "@/features/chat/message-content";
import type { ChatAttachment } from "@/features/chat/use-chat";
import {
  useChatReactions,
  useToggleReaction,
  useEditMessage,
  useDeleteMessage,
} from "@/features/chat/use-chat";
import {
  MessageHoverActions,
  MessageReactions,
  ComposerEmojiButton,
} from "@/features/chat/message-actions";

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
  const { message, modal } = AntdApp.useApp();
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

  // Pending uploads live here until the message is sent.
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFile = useUploadChatFile();
  const editMessage = useEditMessage(channelId);
  const deleteMessage = useDeleteMessage(channelId);
  const toggleReaction = useToggleReaction(channelId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const addFiles = async (files: File[]) => {
    const room = 10 - attachments.length;
    const batch = files.filter((f) => f.size > 0).slice(0, Math.max(0, room));
    if (batch.length === 0) return;
    if (files.length > batch.length)
      message.warning("Up to 10 files per message.");
    setUploading((n) => n + batch.length);
    await Promise.all(
      batch.map(async (file) => {
        try {
          const url = await uploadFile.mutateAsync(file);
          setAttachments((prev) => [
            ...prev,
            { url, name: file.name, type: file.type, size: file.size },
          ]);
        } catch (err) {
          message.error(
            err instanceof Error ? err.message : `Couldn't upload ${file.name}.`,
          );
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }),
    );
  };

  const submit = () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || send.isPending || uploading > 0) return;
    const sentAttachments = attachments;
    setDraft("");
    setAttachments([]);
    send.mutate({ body: text, attachments: sentAttachments }, {
      onError: (err) => {
        setDraft(text);
        setAttachments(sentAttachments);
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
  const { data: reactionsByMessage } = useChatReactions(
    channelId,
    rows.map((m) => m.id),
  );

  const onToggleReaction = (messageId: string, emoji: string, existingId?: string) =>
    toggleReaction
      .mutateAsync({ messageId, emoji, existingId })
      .catch(() => message.error("Couldn't update the reaction."));

  const onDeleteMessage = (id: string) =>
    modal.confirm({
      title: "Delete this message?",
      content: "It disappears for everyone in the conversation.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: () =>
        deleteMessage
          .mutateAsync(id)
          .catch(() => message.error("Couldn't delete the message.")),
    });

  const commitEdit = async (id: string) => {
    const next = editDraft.trim();
    setEditingId(null);
    if (!next) return;
    try {
      await editMessage.mutateAsync({ id, body: next });
    } catch {
      message.error("Couldn't save the edit.");
    }
  };

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
        {/* Mobile only: on desktop /chat bounces straight back into the latest
            conversation (the rail is the list), so a back arrow does nothing. */}
        <Tooltip title="All conversations">
          <Button
            className="wl-chat-back"
            type="text"
            size="small"
            aria-label="Back to conversations"
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
            <div style={{ fontSize: 12.5, color: token.colorTextTertiary, textAlign: "center" }}>
              Say hello — you can drop in images and files, paste a screenshot,
              or @mention someone.
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
                  className="wl-chat-msg"
                  style={{
                    position: "relative",
                    display: "flex",
                    gap: 10,
                    padding: grouped ? "1px 0" : "6px 0 1px",
                  }}
                >
                  <MessageHoverActions
                    mine={mine}
                    onReact={(e) => void onToggleReaction(m.id, e,
                      (reactionsByMessage?.get(m.id) ?? []).find(
                        (r) => r.user_id === user?.id && r.emoji === e,
                      )?.id,
                    )}
                    onEdit={() => {
                      setEditDraft(m.body);
                      setEditingId(m.id);
                    }}
                    onDelete={() => onDeleteMessage(m.id)}
                    onCopy={() => {
                      void navigator.clipboard?.writeText(m.body);
                      message.success("Copied");
                    }}
                  />
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
                    {editingId === m.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <Input.TextArea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          autoSize={{ minRows: 1, maxRows: 8 }}
                          maxLength={4000}
                          autoFocus
                          onPressEnter={(e) => {
                            if (!e.shiftKey) {
                              e.preventDefault();
                              void commitEdit(m.id);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
                          Enter to save · Esc to cancel
                        </span>
                      </div>
                    ) : (
                      <>
                        {m.body ? (
                          <div
                            style={{
                              fontSize: 13.5,
                              lineHeight: 1.55,
                              color: token.colorText,
                              whiteSpace: "pre-wrap",
                              overflowWrap: "break-word",
                            }}
                          >
                            <LinkifiedText text={m.body} />
                            {m.edited_at ? (
                              <span
                                style={{
                                  fontSize: 11,
                                  color: token.colorTextQuaternary,
                                  marginLeft: 6,
                                }}
                              >
                                (edited)
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        <MessageAttachments items={m.attachments ?? []} />
                        {m.body ? <MessageLinkPreview text={m.body} /> : null}
                        <MessageReactions
                          reactions={reactionsByMessage?.get(m.id) ?? []}
                          myUserId={user?.id}
                          onToggle={(emoji, existingId) =>
                            void onToggleReaction(m.id, emoji, existingId)
                          }
                        />
                      </>
                    )}
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
          onPaste={(e) => {
            // Screenshots pasted into the composer upload inline.
            const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length) void addFiles(files);
          }}
          style={{
            border: `1px solid ${dragOver ? "#4a4ad0" : token.colorBorder}`,
            borderRadius: 10,
            background: dragOver ? token.colorPrimaryBg : token.colorBgContainer,
            transition: "background .15s ease, border-color .15s ease",
          }}
        >
          <PendingAttachmentStrip
            items={attachments}
            uploading={uploading}
            onRemove={(url) =>
              setAttachments((prev) => prev.filter((a) => a.url !== url))
            }
          />
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 6,
              padding: "4px 6px 4px 4px",
            }}
          >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void addFiles(files);
              e.target.value = "";
            }}
          />
          <ComposerEmojiButton
            onPick={(e) => setDraft((d) => (d ? `${d} ${e}` : e))}
          />
          <Tooltip title="Attach files or images">
            <Button
              type="text"
              size="small"
              aria-label="Attach images"
              onClick={() => fileInputRef.current?.click()}
              style={{ height: 30, width: 32, marginBottom: 3, flex: "none" }}
              icon={<MIcon name="attach_file" size={17} />}
            />
          </Tooltip>
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
              disabled={(!draft.trim() && attachments.length === 0) || uploading > 0}
              loading={send.isPending}
              onClick={submit}
              style={{ borderRadius: 8, height: 30, width: 34, marginBottom: 3 }}
              icon={<MIcon name="send" size={15} />}
            />
          </Tooltip>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "6px 4px 0",
            fontSize: 11.5,
            color: token.colorTextQuaternary,
          }}
        >
          <span>Enter to send · Shift+Enter for a new line</span>
          <span style={{ marginLeft: "auto" }}>
            Paste or drop images and files to share them
          </span>
        </div>
      </div>
      <style>{`
        .wl-chat-back{display:none;}
        @media (max-width: 899px){ .wl-chat-back{display:inline-flex;} }
        .wl-chat-thread{margin:-22px -24px -48px;}
        @media (max-width: 899px){ .wl-chat-thread{margin:-16px -14px -40px;} }
        .wl-chat-composer:focus-within{border-color:#4a4ad0;box-shadow:0 0 0 2px rgba(74,74,208,.12);}
        .wl-chat-msg{border-radius:8px;margin:0 -8px;padding-left:8px;padding-right:8px;}
        .wl-chat-msg:hover{background:${token.colorFillQuaternary};}
        .wl-msg-actions{opacity:0;transition:opacity .12s ease;pointer-events:none;}
        .wl-chat-msg:hover .wl-msg-actions,
        .wl-msg-actions:focus-within{opacity:1;pointer-events:auto;}
        @keyframes wl-spin{to{transform:rotate(360deg);}}
        .wl-spin{animation:wl-spin 1s linear infinite;}
      `}</style>
    </div>
  );
}
