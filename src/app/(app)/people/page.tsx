"use client";

import { useMemo, useState } from "react";
import {
  App as AntdApp,
  Avatar,
  Button,
  Dropdown,
  Input,
  Modal,
  Segmented,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import {
  useTeamMembers,
  useIsTeamAdmin,
  useRemoveMember,
  type TeamMember,
} from "@/features/team-members/use-team-members";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";
import {
  useInvitations,
  useInviteMember,
  useCancelInvitation,
  type EmailInvitation,
} from "@/features/invitations/use-invitations";
import {
  useSetMemberType,
  useTransferOwnership,
  memberTypeMeta,
  MEMBER_TYPES,
  type MemberType,
} from "@/features/permissions/use-permissions";

const { Title, Text } = Typography;

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

function initials(n: string): string {
  return n.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}
function name(m: TeamMember): string {
  return m.user?.name ?? m.user?.email ?? "Unknown";
}

export default function PeoplePage() {
  const { token } = theme.useToken();
  const { message, modal } = AntdApp.useApp();
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const { data: membersData, isLoading } = useTeamMembers();
  const { data: invitationsData } = useInvitations();
  const isAdmin = useIsTeamAdmin();

  const setMemberType = useSetMemberType();
  const removeMember = useRemoveMember();
  const transferOwnership = useTransferOwnership();
  const inviteMember = useInviteMember();
  const cancelInvitation = useCancelInvitation();

  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<string>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTier, setInviteTier] = useState<string>("member");

  const members = useMemo(
    () => (membersData ?? []).filter((m) => m.user && m.active !== false),
    [membersData],
  );
  const invitations = invitationsData ?? [];
  const iAmOwner = useMemo(
    () => members.some((m) => m.user_id === user?.id && m.member_type === "owner"),
    [members, user?.id],
  );

  const tierFilters = useMemo(() => {
    const present = new Set(members.map((m) => m.member_type));
    return [
      { label: `All · ${members.length}`, value: "all" },
      ...MEMBER_TYPES.filter((t) => present.has(t.value)).map((t) => ({
        label: `${t.label} · ${members.filter((m) => m.member_type === t.value).length}`,
        value: t.value,
      })),
    ];
  }, [members]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => tier === "all" || m.member_type === tier)
      .filter(
        (m) =>
          !q ||
          name(m).toLowerCase().includes(q) ||
          (m.user?.email ?? "").toLowerCase().includes(q) ||
          (m.job_title?.name ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => name(a).localeCompare(name(b)));
  }, [members, tier, query]);

  const changeTier = (m: TeamMember, t: MemberType) =>
    setMemberType.mutate(
      { teamMemberId: m.id, memberType: t },
      {
        onSuccess: () => message.success("Role updated."),
        onError: (e) => message.error(e instanceof Error ? e.message : "Couldn't update the role."),
      },
    );

  const removeOne = (m: TeamMember) =>
    modal.confirm({
      title: `Remove ${name(m)}?`,
      okText: "Remove",
      okButtonProps: { danger: true },
      onOk: () =>
        removeMember
          .mutateAsync(m.id)
          .then(() => message.success("Member removed."))
          .catch((e) => message.error(e instanceof Error ? e.message : "Couldn't remove.")),
    });

  const transfer = (m: TeamMember) =>
    modal.confirm({
      title: "Transfer ownership?",
      content: `Make ${name(m)} the workspace owner. You'll become an admin.`,
      okText: "Transfer",
      onOk: () => {
        if (!activeTeam?.id || !m.user_id) return;
        return transferOwnership
          .mutateAsync({ teamId: activeTeam.id, toUserId: m.user_id })
          .then(() => message.success("Ownership transferred."))
          .catch((e) => message.error(e instanceof Error ? e.message : "Couldn't transfer."));
      },
    });

  const memberMenu = (m: TeamMember): MenuProps => ({
    items: [
      {
        key: "role",
        type: "group",
        label: "Set role",
        children: MEMBER_TYPES.filter((t) => t.value !== "owner").map((t) => ({
          key: t.value,
          label: t.label,
          disabled: m.member_type === t.value,
          onClick: () => changeTier(m, t.value),
        })),
      },
      ...(iAmOwner && m.user_id ? [{ type: "divider" as const }, { key: "transfer", label: "Transfer ownership", onClick: () => transfer(m) }] : []),
      { type: "divider" as const },
      { key: "remove", label: "Remove from workspace", danger: true, onClick: () => removeOne(m) },
    ],
  });

  const submitInvite = async () => {
    const email = inviteEmail.trim();
    const nm = inviteName.trim();
    if (!email || !nm) {
      message.warning("Add a name and email.");
      return;
    }
    try {
      await inviteMember.mutateAsync({ email, name: nm, memberType: inviteTier });
      message.success(`Invitation sent to ${email}.`);
      setInviteOpen(false);
      setInviteName("");
      setInviteEmail("");
      setInviteTier("member");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Couldn't send the invitation.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Teams</Title>
          <Text type="secondary">
            {activeTeam?.name ? `Everyone in ${activeTeam.name}` : "Everyone in this workspace"}
            {members.length ? ` · ${members.length}` : ""}
          </Text>
        </div>
        {isAdmin ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setInviteOpen(true)}>
            Invite
          </Button>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Input
          allowClear
          prefix={<MIcon name="search" size={16} color={token.colorTextTertiary} />}
          placeholder="Search people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <Segmented value={tier} onChange={(v) => setTier(String(v))} options={tierFilters} />
      </div>

      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 12, padding: 16 }}>
              <Skeleton active avatar paragraph={{ rows: 1 }} />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 12, padding: 48, textAlign: "center", color: token.colorTextTertiary }}>
          <MIcon name="group" size={30} color={token.colorTextQuaternary} />
          <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText, marginTop: 10 }}>No people match</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>Try a different search or tier.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {visible.map((m) => {
            const meta = memberTypeMeta(m.member_type);
            const canManage = isAdmin && m.member_type !== "owner";
            return (
              <div
                key={m.id}
                style={{
                  background: token.colorBgContainer,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 12,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <Avatar size={44} src={m.user?.avatar_url ?? undefined} style={{ flex: "none", fontSize: 16 }}>
                  {initials(name(m))}
                </Avatar>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: token.colorText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name(m)}
                    {m.user_id === user?.id ? <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}> · You</Text> : null}
                  </div>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.job_title?.name ? `${m.job_title.name} · ` : ""}{m.user?.email}
                  </div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      marginTop: 6,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: meta.tone,
                      background: token.colorFillTertiary,
                      borderRadius: 999,
                      padding: "2px 9px",
                    }}
                  >
                    <MIcon name={meta.icon} size={13} color={meta.tone} />
                    {meta.label}
                  </span>
                </div>
                {canManage ? (
                  <Dropdown menu={memberMenu(m)} trigger={["click"]} placement="bottomRight">
                    <Button type="text" size="small" aria-label="Manage member" icon={<MIcon name="more_vert" size={18} color={token.colorTextTertiary} />} />
                  </Dropdown>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Pending invitations (admins) */}
      {isAdmin && invitations.length > 0 ? (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: token.colorTextTertiary, margin: "6px 2px 8px" }}>
            Pending invitations · {invitations.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {invitations.map((inv: EmailInvitation) => {
              const meta = memberTypeMeta(inv.member_type ?? "member");
              return (
                <div
                  key={inv.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: token.colorBgContainer,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 10,
                    padding: "10px 14px",
                  }}
                >
                  <Avatar size={32} style={{ flex: "none", fontSize: 12, background: token.colorFillTertiary, color: token.colorTextTertiary }}>
                    {initials(inv.name ?? inv.email)}
                  </Avatar>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>{inv.name || inv.email}</div>
                    <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{inv.email}</div>
                  </div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: meta.tone }}>
                    <MIcon name={meta.icon} size={13} color={meta.tone} />
                    {meta.label}
                  </span>
                  <Tag color="gold" style={{ margin: 0 }}>Pending</Tag>
                  <Tooltip title="Cancel invitation">
                    <Button
                      type="text"
                      size="small"
                      danger
                      loading={cancelInvitation.isPending}
                      aria-label="Cancel invitation"
                      icon={<MIcon name="close" size={16} />}
                      onClick={() => cancelInvitation.mutate(inv.id)}
                    />
                  </Tooltip>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Invite modal — tier picker with descriptions */}
      <Modal
        title="Invite to workspace"
        open={inviteOpen}
        onCancel={() => setInviteOpen(false)}
        onOk={() => void submitInvite()}
        okText="Send invitation"
        confirmLoading={inviteMember.isPending}
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Name</div>
            <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Full name" autoFocus />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Email</div>
            <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="person@example.com" type="email" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Role</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {MEMBER_TYPES.filter((t) => t.value !== "owner").map((t) => {
                const on = inviteTier === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setInviteTier(t.value)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      textAlign: "left",
                      padding: "9px 11px",
                      borderRadius: 10,
                      cursor: "pointer",
                      background: on ? token.colorPrimaryBg : "transparent",
                      border: `1px solid ${on ? "#4a4ad0" : token.colorBorderSecondary}`,
                    }}
                  >
                    <MIcon name={t.icon} size={18} color={t.tone} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: token.colorText }}>{t.label}</span>
                      <span style={{ display: "block", fontSize: 12, color: token.colorTextTertiary }}>{t.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
