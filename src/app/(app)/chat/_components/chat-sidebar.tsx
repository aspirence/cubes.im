"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  App as AntdApp,
  Avatar,
  Badge,
  Button,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  Tooltip,
  theme,
} from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  useChatChannels,
  useCreateChannel,
  useOpenDm,
  useCreateGroupDm,
  useChatRealtime,
  useSearchChatMessages,
  useOnlinePresence,
  useSavedMessages,
  useToggleSaved,
  useToggleMute,
  useMarkChannelRead,
  type ChatChannelSummary,
  type ChatSearchResult,
  type SavedChatMessage,
} from "@/features/chat/use-chat";
import { useTeamMembers, useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { useAuth } from "@/features/auth/use-auth";
import { useChatDraftsStore } from "@/store/chat-drafts-store";
import { errMsg } from "@/lib/err";

dayjs.extend(relativeTime);

const ONLINE_GREEN = "#22c55e";

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

/** One conversation row (channel, DM or group) in the rail. */
function ConversationRow({
  c,
  active,
  onOpen,
  online,
  hasDraft,
  onToggleMute,
}: {
  c: ChatChannelSummary;
  active: boolean;
  onOpen: () => void;
  /** DM rows only: whether the other person is online right now. */
  online?: boolean;
  /** A non-empty composer draft is parked in this conversation. */
  hasDraft?: boolean;
  onToggleMute?: () => void;
}) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const label =
    c.kind === "dm"
      ? (c.other_user_name ?? "Direct message")
      : c.kind === "group"
        ? (c.member_names ?? "Group")
        : (c.name ?? "Channel");
  // Muted rows never show the badge or bold styling — quiet by design.
  const unread = c.unread_count > 0 && !c.muted;
  const muteMenu = {
    items: [
      {
        key: "mute",
        label: c.muted ? "Unmute" : "Mute",
        icon: <MIcon name={c.muted ? "notifications" : "notifications_off"} size={15} />,
      },
    ],
    onClick: (info: { domEvent: { stopPropagation: () => void } }) => {
      info.domEvent.stopPropagation();
      setMenuOpen(false);
      onToggleMute?.();
    },
  };
  return (
    <Dropdown trigger={["contextMenu"]} menu={muteMenu} disabled={!onToggleMute}>
    <a
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        height: 36,
        padding: "0 10px",
        borderRadius: 7,
        cursor: "pointer",
        marginBottom: 1,
        color: active ? "#4a4ad0" : token.colorText,
        background: active
          ? token.colorPrimaryBg
          : hover || menuOpen
            ? token.colorFillQuaternary
            : "transparent",
      }}
    >
      {c.kind === "dm" ? (
        <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
          <Avatar size={22} src={c.other_avatar ?? undefined} style={{ fontSize: 10 }}>
            {initials(label)}
          </Avatar>
          {online !== undefined ? (
            <span
              style={{
                position: "absolute",
                right: -2,
                bottom: -2,
                width: 9,
                height: 9,
                borderRadius: "50%",
                border: `2px solid ${token.colorBgContainer}`,
                background: online ? ONLINE_GREEN : token.colorTextQuaternary,
              }}
            />
          ) : null}
        </span>
      ) : (
        <MIcon
          name={
            c.archived
              ? "archive"
              : c.kind === "group"
                ? "group"
                : c.is_private
                  ? "lock"
                  : "tag"
          }
          size={17}
          color={active ? "#4a4ad0" : token.colorTextTertiary}
        />
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 13.5,
          fontWeight: unread ? 650 : 500,
          opacity: c.muted || c.archived ? 0.55 : 1,
        }}
      >
        {label}
      </span>
      {/* A parked draft (and no badge competing for the slot) → pencil. */}
      {hasDraft && !unread ? (
        <Tooltip title="Draft">
          <span style={{ display: "inline-flex" }}>
            <MIcon name="edit" size={14} color={token.colorTextTertiary} />
          </span>
        </Tooltip>
      ) : null}
      {c.muted ? (
        <MIcon name="notifications_off" size={14} color={token.colorTextQuaternary} />
      ) : unread ? (
        <Badge
          count={c.unread_count}
          size="small"
          style={{ backgroundColor: "#4a4ad0", boxShadow: "none" }}
        />
      ) : null}
      {onToggleMute && (hover || menuOpen) ? (
        <Dropdown
          trigger={["click"]}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          menu={muteMenu}
          placement="bottomRight"
        >
          <button
            type="button"
            aria-label="Conversation options"
            onClick={(e) => e.stopPropagation()}
            style={{
              border: "none",
              background: "transparent",
              color: token.colorTextTertiary,
              cursor: "pointer",
              display: "inline-flex",
              padding: 0,
              flex: "none",
            }}
          >
            <MIcon name="more_horiz" size={16} />
          </button>
        </Dropdown>
      ) : null}
    </a>
    </Dropdown>
  );
}

/** "New channel" modal — admins/owners only (the RPC enforces server-side). */
export function NewChannelModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const createChannel = useCreateChannel();
  const { user } = useAuth();
  const { data: teamMembers } = useTeamMembers();
  const [form] = Form.useForm<{
    name: string;
    topic?: string;
    isPrivate?: boolean;
    memberIds?: string[];
  }>();
  const isPrivate = Form.useWatch("isPrivate", form) ?? false;

  // Team members (by users.id) other than the creator, for the "add people" picker.
  const memberOptions = useMemo(
    () =>
      (teamMembers ?? [])
        .filter((m) => m.user && m.user.id !== user?.id)
        .map((m) => ({
          value: m.user!.id,
          label: m.user!.name,
          email: m.user!.email,
          avatarUrl: m.user!.avatar_url,
        })),
    [teamMembers, user?.id],
  );

  const submit = async () => {
    let values: {
      name: string;
      topic?: string;
      isPrivate?: boolean;
      memberIds?: string[];
    };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      const id = await createChannel.mutateAsync({
        name: values.name,
        topic: values.topic,
        isPrivate: values.isPrivate ?? false,
        memberIds: values.memberIds ?? [],
      });
      onClose();
      form.resetFields();
      router.push(`/chat/${id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't create the channel.");
    }
  };

  return (
    <Modal
      title="New channel"
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="Create channel"
      confirmLoading={createChannel.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, message: "Give the channel a name." }]}
        >
          <Input prefix={<MIcon name="tag" size={15} />} placeholder="e.g. general" maxLength={60} autoFocus />
        </Form.Item>
        <Form.Item name="topic" label="Topic (optional)">
          <Input placeholder="What is this channel about?" maxLength={240} />
        </Form.Item>

        {/* Private toggle */}
        <Form.Item
          name="isPrivate"
          valuePropName="checked"
          style={{ marginBottom: 8 }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <Switch
              checked={isPrivate}
              onChange={(v) => form.setFieldValue("isPrivate", v)}
            />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                {isPrivate ? "Private channel" : "Public channel"}
              </div>
              <div style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
                {isPrivate
                  ? "Only the people you add can find and join it."
                  : "Everyone in the workspace can find and join it."}
              </div>
            </div>
          </div>
        </Form.Item>

        {/* Who joins */}
        <Form.Item
          name="memberIds"
          label={isPrivate ? "Add people" : "Add people (optional)"}
          extra={
            isPrivate
              ? "You're added automatically. Add anyone who should have access."
              : "Optionally pre-add people so it shows in their sidebar."
          }
        >
          <Select
            mode="multiple"
            placeholder="Search teammates…"
            optionFilterProp="label"
            options={memberOptions.map((o) => ({ value: o.value, label: o.label }))}
            maxTagCount="responsive"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** "New message" modal — one person opens a DM, several start a group DM. */
export function NewDmModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { user } = useAuth();
  const { data: members } = useTeamMembers();
  const openDm = useOpenDm();
  const createGroupDm = useCreateGroupDm();
  const [picks, setPicks] = useState<string[]>([]);

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.user && m.user.id !== user?.id)
        .map((m) => ({
          value: m.user!.id,
          label: m.user!.name,
        })),
    [members, user?.id],
  );

  const close = () => {
    setPicks([]);
    onClose();
  };

  const submit = async () => {
    if (picks.length === 0) return;
    try {
      const id =
        picks.length === 1
          ? await openDm.mutateAsync(picks[0])
          : await createGroupDm.mutateAsync(picks);
      close();
      router.push(`/chat/${id}`);
    } catch (err) {
      message.error(errMsg(err, "Couldn't open the conversation."));
    }
  };

  return (
    <Modal
      title="New message"
      open={open}
      onCancel={close}
      onOk={() => void submit()}
      okText={picks.length > 1 ? "Start group chat" : "Start chat"}
      okButtonProps={{ disabled: picks.length === 0 }}
      confirmLoading={openDm.isPending || createGroupDm.isPending}
      destroyOnHidden
    >
      <div style={{ fontSize: 13, marginBottom: 6, color: token.colorTextSecondary }}>
        Who do you want to message?
      </div>
      <Select
        mode="multiple"
        style={{ width: "100%" }}
        value={picks}
        onChange={setPicks}
        options={memberOptions}
        optionFilterProp="label"
        placeholder="Pick one teammate, or several for a group"
        maxTagCount="responsive"
        autoFocus
      />
      <div style={{ marginTop: 8, fontSize: 12, color: token.colorTextTertiary }}>
        {memberOptions.length === 0
          ? "No other members in this workspace yet — invite someone from Settings → Members."
          : "One person starts a direct message; two or more start a group conversation."}
      </div>
    </Modal>
  );
}

/**
 * Search across every conversation the caller can read. Debounced input →
 * search_chat_messages RPC; clicking a result jumps into that conversation.
 */
export function ChatSearchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  // Debounce: the RPC only fires 300ms after the last keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data: results, isFetching } = useSearchChatMessages(query);

  const close = () => {
    setInput("");
    setQuery("");
    onClose();
  };

  const openResult = (r: ChatSearchResult) => {
    close();
    // Deep link: thread replies open their thread panel; ?m= highlights the hit.
    router.push(
      r.parent_id
        ? `/chat/${r.channel_id}?thread=${r.parent_id}&m=${r.message_id}`
        : `/chat/${r.channel_id}?m=${r.message_id}`,
    );
  };

  const rows = results ?? [];
  return (
    <Modal title="Search messages" open={open} onCancel={close} footer={null} destroyOnHidden>
      <Input
        autoFocus
        allowClear
        prefix={<MIcon name="search" size={16} color={token.colorTextTertiary} />}
        placeholder="Search all conversations…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <div style={{ marginTop: 10, maxHeight: 380, overflowY: "auto" }}>
        {query.length < 2 ? (
          <div style={{ fontSize: 12.5, color: token.colorTextTertiary, padding: "8px 2px" }}>
            Type at least 2 characters to search.
          </div>
        ) : isFetching && rows.length === 0 ? (
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: token.colorTextTertiary, padding: "8px 2px" }}>
            No messages match “{query}”.
          </div>
        ) : (
          rows.map((r) => {
            const where =
              r.channel_kind === "dm"
                ? "Direct message"
                : r.channel_kind === "group"
                  ? "Group message"
                  : `#${r.channel_name ?? "channel"}`;
            return (
              <a
                key={r.message_id}
                className="wl-chat-search-row"
                onClick={() => openResult(r)}
                style={{ display: "block", padding: "8px 10px", borderRadius: 8, cursor: "pointer" }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#4a4ad0", whiteSpace: "nowrap" }}>
                    {where}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: token.colorTextSecondary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.author_name}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: token.colorTextQuaternary, whiteSpace: "nowrap" }}>
                    {dayjs(r.created_at).fromNow()}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: token.colorText,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  <SearchSnippet body={r.body} query={query} />
                </div>
              </a>
            );
          })
        )}
      </div>
      <style>{`.wl-chat-search-row:hover{background:${token.colorFillQuaternary};}`}</style>
    </Modal>
  );
}

/** The matched part of a result's body, highlighted, with local context. */
function SearchSnippet({ body, query }: { body: string; query: string }) {
  const flat = body.replace(/\s+/g, " ").trim();
  const idx = flat.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{flat.slice(0, 140)}</>;
  const start = Math.max(0, idx - 40);
  return (
    <>
      {(start > 0 ? "…" : "") + flat.slice(start, idx)}
      <mark style={{ background: "transparent", color: "#4a4ad0", fontWeight: 700, padding: 0 }}>
        {flat.slice(idx, idx + query.length)}
      </mark>
      {flat.slice(idx + query.length, idx + query.length + 90)}
    </>
  );
}

/**
 * "Saved" modal — the caller's bookmarked messages, newest first. Clicking a
 * row deep-links into its conversation (same format as search results);
 * the bookmark button on the row unsaves it.
 */
export function ChatSavedModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data: saved, isLoading } = useSavedMessages();
  const { data: channels } = useChatChannels();
  const toggleSaved = useToggleSaved();

  const whereLabel = (channelId: string): string => {
    const c = (channels ?? []).find((x) => x.id === channelId);
    if (!c) return "Conversation";
    if (c.kind === "dm") return c.other_user_name ?? "Direct message";
    if (c.kind === "group") return c.member_names ?? "Group message";
    return `#${c.name ?? "channel"}`;
  };

  const openSaved = (m: NonNullable<SavedChatMessage["message"]>) => {
    onClose();
    router.push(
      m.parent_id
        ? `/chat/${m.channel_id}?thread=${m.parent_id}&m=${m.id}`
        : `/chat/${m.channel_id}?m=${m.id}`,
    );
  };

  const unsave = (messageId: string) =>
    toggleSaved
      .mutateAsync({ messageId, save: false })
      .catch((err) => message.error(errMsg(err, "Couldn't remove from saved.")));

  // A saved row whose message was deleted has nothing to show or open.
  const rows = (saved ?? []).filter((s) => s.message);

  return (
    <Modal title="Saved" open={open} onCancel={onClose} footer={null} destroyOnHidden>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {isLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: token.colorTextTertiary, padding: "8px 2px" }}>
            Nothing saved yet — hover a message and hit the bookmark.
          </div>
        ) : (
          rows.map((s) => {
            const m = s.message!;
            return (
              <div
                key={s.id}
                className="wl-chat-saved-row"
                style={{
                  display: "flex",
                  gap: 4,
                  alignItems: "flex-start",
                  padding: "8px 6px 8px 10px",
                  borderRadius: 8,
                }}
              >
                <a
                  onClick={() => openSaved(m)}
                  style={{ display: "block", flex: 1, minWidth: 0, cursor: "pointer", color: "inherit" }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#4a4ad0", whiteSpace: "nowrap" }}>
                      {whereLabel(m.channel_id)}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: token.colorTextSecondary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.author?.name ?? "Member"}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: token.colorTextQuaternary, whiteSpace: "nowrap" }}>
                      {dayjs(m.created_at).fromNow()}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: token.colorText,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {m.body?.trim() || "📎 Attachment"}
                  </div>
                </a>
                <Tooltip title="Remove from saved">
                  <Button
                    type="text"
                    size="small"
                    aria-label="Remove from saved"
                    loading={toggleSaved.isPending && toggleSaved.variables?.messageId === s.message_id}
                    onClick={() => void unsave(s.message_id)}
                    icon={<MIcon name="bookmark_remove" size={15} color={token.colorTextTertiary} />}
                  />
                </Tooltip>
              </div>
            );
          })
        )}
      </div>
      <style>{`.wl-chat-saved-row:hover{background:${token.colorFillQuaternary};}`}</style>
    </Modal>
  );
}

/**
 * "Browse channels" — every public, non-archived channel in the workspace,
 * with a client-side name/topic filter. Joining is the same self-join upsert
 * as opening a channel (mark-read), then a navigate; already-joined rows just
 * open.
 */
export function BrowseChannelsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data: channels } = useChatChannels();
  const markRead = useMarkChannelRead();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (channels ?? [])
      .filter((c) => c.kind === "channel" && !c.is_private && !c.archived)
      .filter(
        (c) =>
          !needle ||
          (c.name ?? "").toLowerCase().includes(needle) ||
          (c.topic ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [channels, q]);

  const close = () => {
    setQ("");
    onClose();
  };

  const openChannel = async (c: ChatChannelSummary) => {
    try {
      // Join = the same membership upsert the channel page does on open.
      if (!c.joined) await markRead.mutateAsync(c.id);
      close();
      router.push(`/chat/${c.id}`);
    } catch (err) {
      message.error(errMsg(err, "Couldn't join the channel."));
    }
  };

  return (
    <Modal title="Browse channels" open={open} onCancel={close} footer={null} destroyOnHidden>
      <Input
        autoFocus
        allowClear
        prefix={<MIcon name="search" size={16} color={token.colorTextTertiary} />}
        placeholder="Search channels…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div style={{ marginTop: 10, maxHeight: 380, overflowY: "auto" }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: token.colorTextTertiary, padding: "8px 2px" }}>
            {q.trim()
              ? `No channels match “${q.trim()}”.`
              : "No public channels yet."}
          </div>
        ) : (
          rows.map((c) => (
            <div
              key={c.id}
              className="wl-chat-browse-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 8,
              }}
            >
              <MIcon name="tag" size={16} color={token.colorTextTertiary} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 650,
                      color: token.colorText,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name ?? "Channel"}
                  </span>
                  <span style={{ fontSize: 11.5, color: token.colorTextQuaternary, flex: "none" }}>
                    {c.member_count === 1 ? "1 member" : `${c.member_count} members`}
                  </span>
                </div>
                {c.topic ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: token.colorTextTertiary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.topic}
                  </div>
                ) : null}
              </div>
              <Button
                size="small"
                type={c.joined ? "default" : "primary"}
                loading={markRead.isPending && markRead.variables === c.id}
                onClick={() => void openChannel(c)}
              >
                {c.joined ? "Open" : "Join"}
              </Button>
            </div>
          ))
        )}
      </div>
      <style>{`.wl-chat-browse-row:hover{background:${token.colorFillQuaternary};}`}</style>
    </Modal>
  );
}

/**
 * The chat navigation itself — Channels + Direct Messages sections with their
 * "new" modals. Rendered inside the Chat rail AND embedded below Spaces in the
 * Home/Projects sidebar (ClickUp-style).
 */
export function ChatNavSections() {
  const { token } = theme.useToken();
  const router = useRouter();
  const pathname = usePathname();
  const { message } = AntdApp.useApp();

  const { data: channels, isLoading } = useChatChannels();
  const isAdmin = useIsTeamAdmin();
  // Team-wide message stream keeps the rail's unread counts live.
  useChatRealtime();
  const online = useOnlinePresence();
  const toggleMute = useToggleMute();
  // Parked composer drafts → the row's pencil marker. The store keeps raw
  // text (whitespace included), so trim here: the pencil only shows for
  // drafts with something actually typed.
  const drafts = useChatDraftsStore((s) => s.drafts);

  const [channelModal, setChannelModal] = useState(false);
  const [dmModal, setDmModal] = useState(false);
  const [browseModal, setBrowseModal] = useState(false);

  const onToggleMute = (c: ChatChannelSummary) =>
    toggleMute
      .mutateAsync({ channelId: c.id, mute: !c.muted })
      .catch((err) =>
        message.error(errMsg(err, "Couldn't update notifications.")),
      );

  const activeId = pathname.startsWith("/chat/") ? pathname.split("/")[2] : null;
  const list = channels ?? [];
  const channelRows = list.filter((c) => c.kind === "channel");
  // Group DMs live under Direct messages, Slack-style.
  const dmRows = list.filter((c) => c.kind === "dm" || c.kind === "group");

  const sectionHeader = (label: string, action?: { title: string; onClick: () => void }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 10px 6px",
      }}
    >
      <span
        style={{
          font: "600 10.5px var(--font-geist-sans)",
          letterSpacing: ".7px",
          color: token.colorTextTertiary,
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      {action ? (
        <Tooltip title={action.title}>
          <button
            type="button"
            aria-label={action.title}
            onClick={action.onClick}
            style={{
              border: "none",
              background: "transparent",
              color: token.colorTextTertiary,
              cursor: "pointer",
              display: "inline-flex",
              padding: 2,
              borderRadius: 6,
            }}
          >
            <MIcon name="add" size={16} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );

  return (
    <>
      <div>
        {isLoading ? (
          <div style={{ padding: 12 }}>
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          </div>
        ) : (
          <>
            {/* Channels — hidden entirely for non-admins until one exists. */}
            {channelRows.length > 0 || isAdmin ? (
              <>
                {sectionHeader(
                  "Channels",
                  isAdmin
                    ? { title: "New channel", onClick: () => setChannelModal(true) }
                    : undefined,
                )}
                {channelRows.map((c) => (
                  <ConversationRow
                    key={c.id}
                    c={c}
                    active={c.id === activeId}
                    onOpen={() => router.push(`/chat/${c.id}`)}
                    hasDraft={Boolean(drafts[c.id]?.trim())}
                    onToggleMute={() => void onToggleMute(c)}
                  />
                ))}
                {/* Discovery is for everyone; creating stays admin-only. */}
                <a
                  className="wl-chat-ghost"
                  onClick={() => setBrowseModal(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    height: 32,
                    padding: "0 10px",
                    borderRadius: 7,
                    cursor: "pointer",
                    fontSize: 13,
                    color: token.colorTextTertiary,
                  }}
                >
                  <MIcon name="explore" size={16} />
                  Browse channels
                </a>
                {isAdmin ? (
                  <a
                    className="wl-chat-ghost"
                    onClick={() => setChannelModal(true)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      height: 32,
                      padding: "0 10px",
                      borderRadius: 7,
                      cursor: "pointer",
                      fontSize: 13,
                      color: token.colorTextTertiary,
                    }}
                  >
                    <MIcon name="add" size={16} />
                    Add channel
                  </a>
                ) : null}
              </>
            ) : null}

            {sectionHeader("Direct messages", {
              title: "New message",
              onClick: () => setDmModal(true),
            })}
            {dmRows.map((c) => (
              <ConversationRow
                key={c.id}
                c={c}
                active={c.id === activeId}
                onOpen={() => router.push(`/chat/${c.id}`)}
                online={
                  c.kind === "dm" && c.other_user_id
                    ? online.has(c.other_user_id)
                    : undefined
                }
                hasDraft={Boolean(drafts[c.id]?.trim())}
                onToggleMute={() => void onToggleMute(c)}
              />
            ))}
            <a
              className="wl-chat-ghost"
              onClick={() => setDmModal(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                height: 32,
                padding: "0 10px",
                borderRadius: 7,
                cursor: "pointer",
                fontSize: 13,
                color: token.colorTextTertiary,
              }}
            >
              <MIcon name="add" size={16} />
              New message
            </a>
            <style>{`.wl-chat-ghost:hover{background:${token.colorFillQuaternary};color:${token.colorTextSecondary};}`}</style>
          </>
        )}
      </div>

      <NewChannelModal open={channelModal} onClose={() => setChannelModal(false)} />
      <NewDmModal open={dmModal} onClose={() => setDmModal(false)} />
      <BrowseChannelsModal open={browseModal} onClose={() => setBrowseModal(false)} />
    </>
  );
}

/** Secondary-sidebar rail for the /chat section: header + the nav sections. */
export function ChatSidebar() {
  const { token } = theme.useToken();
  const [searchOpen, setSearchOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          height: 58,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 16px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flex: "none",
        }}
      >
        <span style={{ color: token.colorTextTertiary, display: "flex" }}>
          <MIcon name="forum" size={20} />
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: token.colorText, flex: 1 }}>
          Chat
        </span>
        <Tooltip title="Search messages">
          <Button
            type="text"
            size="small"
            aria-label="Search messages"
            onClick={() => setSearchOpen(true)}
            icon={<MIcon name="search" size={17} color={token.colorTextSecondary} />}
          />
        </Tooltip>
        <Tooltip title="Saved messages">
          <Button
            type="text"
            size="small"
            aria-label="Saved messages"
            onClick={() => setSavedOpen(true)}
            icon={<MIcon name="bookmark" size={17} color={token.colorTextSecondary} />}
          />
        </Tooltip>
      </div>
      <nav style={{ flex: 1, overflowY: "auto", padding: "2px 8px 14px" }}>
        <ChatNavSections />
      </nav>
      <ChatSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ChatSavedModal open={savedOpen} onClose={() => setSavedOpen(false)} />
    </div>
  );
}
