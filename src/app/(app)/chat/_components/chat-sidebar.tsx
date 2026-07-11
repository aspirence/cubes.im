"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  App as AntdApp,
  Avatar,
  Badge,
  Button,
  Form,
  Input,
  Modal,
  Skeleton,
  Tooltip,
  theme,
} from "antd";
import {
  useChatChannels,
  useCreateChannel,
  useOpenDm,
  useChatRealtime,
  type ChatChannelSummary,
} from "@/features/chat/use-chat";
import { useTeamMembers, useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { MemberSingleSelect } from "@/features/team-members/member-select";
import { useAuth } from "@/features/auth/use-auth";

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

/** One conversation row (channel or DM) in the rail. */
function ConversationRow({
  c,
  active,
  onOpen,
}: {
  c: ChatChannelSummary;
  active: boolean;
  onOpen: () => void;
}) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);
  const label = c.kind === "dm" ? (c.other_user_name ?? "Direct message") : (c.name ?? "Channel");
  const unread = c.unread_count > 0;
  return (
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
          : hover
            ? token.colorFillQuaternary
            : "transparent",
      }}
    >
      {c.kind === "dm" ? (
        <Avatar size={22} src={c.other_avatar ?? undefined} style={{ fontSize: 10, flex: "none" }}>
          {initials(label)}
        </Avatar>
      ) : (
        <MIcon
          name={c.is_private ? "lock" : "tag"}
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
        }}
      >
        {label}
      </span>
      {unread ? (
        <Badge
          count={c.unread_count}
          size="small"
          style={{ backgroundColor: "#4a4ad0", boxShadow: "none" }}
        />
      ) : null}
    </a>
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
  const { message } = AntdApp.useApp();
  const createChannel = useCreateChannel();
  const [form] = Form.useForm<{ name: string; topic?: string }>();

  const submit = async () => {
    let values: { name: string; topic?: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      const id = await createChannel.mutateAsync(values);
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
      </Form>
    </Modal>
  );
}

/** "New message" modal — anyone can start a DM. */
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
  const [dmUser, setDmUser] = useState<string>();

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.user && m.user.id !== user?.id)
        .map((m) => ({
          value: m.user!.id,
          label: m.user!.name,
          avatarUrl: m.user!.avatar_url,
          email: m.user!.email,
        })),
    [members, user?.id],
  );

  const close = () => {
    setDmUser(undefined);
    onClose();
  };

  const submit = async () => {
    if (!dmUser) return;
    try {
      const id = await openDm.mutateAsync(dmUser);
      close();
      router.push(`/chat/${id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't open the conversation.");
    }
  };

  return (
    <Modal
      title="New message"
      open={open}
      onCancel={close}
      onOk={() => void submit()}
      okText="Start chat"
      okButtonProps={{ disabled: !dmUser }}
      confirmLoading={openDm.isPending}
      destroyOnHidden
    >
      <div style={{ fontSize: 13, marginBottom: 6, color: token.colorTextSecondary }}>
        Who do you want to message?
      </div>
      <MemberSingleSelect
        style={{ width: "100%" }}
        value={dmUser}
        options={memberOptions}
        onChange={setDmUser}
        placeholder="Pick a teammate"
      />
      {memberOptions.length === 0 ? (
        <div style={{ marginTop: 10, fontSize: 12.5, color: token.colorTextTertiary }}>
          No other members in this workspace yet — invite someone from Settings → Members.
        </div>
      ) : null}
      <Button style={{ display: "none" }} />
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

  const { data: channels, isLoading } = useChatChannels();
  const isAdmin = useIsTeamAdmin();
  // Team-wide message stream keeps the rail's unread counts live.
  useChatRealtime();

  const [channelModal, setChannelModal] = useState(false);
  const [dmModal, setDmModal] = useState(false);

  const activeId = pathname.startsWith("/chat/") ? pathname.split("/")[2] : null;
  const list = channels ?? [];
  const channelRows = list.filter((c) => c.kind === "channel");
  const dmRows = list.filter((c) => c.kind === "dm");

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
            {sectionHeader(
              "Channels",
              isAdmin ? { title: "New channel", onClick: () => setChannelModal(true) } : undefined,
            )}
            {channelRows.length === 0 ? (
              <div style={{ padding: "4px 10px", fontSize: 12.5, color: token.colorTextTertiary }}>
                {isAdmin
                  ? "No channels yet — create the first one."
                  : "No channels yet — an admin can create one."}
              </div>
            ) : (
              channelRows.map((c) => (
                <ConversationRow
                  key={c.id}
                  c={c}
                  active={c.id === activeId}
                  onOpen={() => router.push(`/chat/${c.id}`)}
                />
              ))
            )}

            {sectionHeader("Direct messages", {
              title: "New message",
              onClick: () => setDmModal(true),
            })}
            {dmRows.length === 0 ? (
              <div style={{ padding: "4px 10px", fontSize: 12.5, color: token.colorTextTertiary }}>
                Message a teammate one-to-one.
              </div>
            ) : (
              dmRows.map((c) => (
                <ConversationRow
                  key={c.id}
                  c={c}
                  active={c.id === activeId}
                  onOpen={() => router.push(`/chat/${c.id}`)}
                />
              ))
            )}
          </>
        )}
      </div>

      <NewChannelModal open={channelModal} onClose={() => setChannelModal(false)} />
      <NewDmModal open={dmModal} onClose={() => setDmModal(false)} />
    </>
  );
}

/** Secondary-sidebar rail for the /chat section: header + the nav sections. */
export function ChatSidebar() {
  const { token } = theme.useToken();
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
        <span style={{ fontSize: 15, fontWeight: 600, color: token.colorText }}>Chat</span>
      </div>
      <nav style={{ flex: 1, overflowY: "auto", padding: "2px 8px 14px" }}>
        <ChatNavSections />
      </nav>
    </div>
  );
}
