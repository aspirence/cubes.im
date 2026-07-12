"use client";

import { useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  UserOutlined,
  DeleteOutlined,
  MailOutlined,
} from "@ant-design/icons";
import {
  useTeamMembers,
  useRemoveMember,
  useIsTeamAdmin,
} from "@/features/team-members/use-team-members";
import {
  useSetMemberType,
  useTransferOwnership,
  MEMBER_TYPES,
  memberTypeMeta,
  type MemberType,
} from "@/features/permissions/use-permissions";
import { useAuth } from "@/features/auth/use-auth";
import { useActiveTeam } from "@/features/teams/use-teams";
import {
  useInvitations,
  useInviteMember,
} from "@/features/invitations/use-invitations";

import type { TeamMember } from "@/features/team-members/use-team-members";
import type { EmailInvitation } from "@/features/invitations/use-invitations";

interface InviteFormValues {
  email: string;
  name: string;
  member_type?: string;
}

function memberName(m: TeamMember): string {
  return m.user?.name ?? m.user?.email ?? "Unknown";
}
function memberEmail(m: TeamMember): string {
  return m.user?.email ?? "";
}
function memberAvatar(m: TeamMember): string | undefined {
  return m.user?.avatar_url ?? undefined;
}

export default function MembersSettingsPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();

  const { data: membersData, isLoading: membersLoading } = useTeamMembers();
  const { data: invitationsData, isLoading: invitationsLoading } =
    useInvitations();
  const removeMember = useRemoveMember();
  const inviteMember = useInviteMember();
  const setMemberType = useSetMemberType();
  const transferOwnership = useTransferOwnership();
  const isAdmin = useIsTeamAdmin();
  const { user } = useAuth();
  const { data: activeTeam } = useActiveTeam();

  // The current user is the workspace owner if their own membership row is 'owner'.
  const iAmOwner = useMemo(
    () => (membersData ?? []).some((m) => m.user_id === user?.id && m.member_type === "owner"),
    [membersData, user?.id],
  );

  const handleTransfer = (toUserId: string) => {
    if (!activeTeam?.id) return;
    transferOwnership.mutate(
      { teamId: activeTeam.id, toUserId },
      {
        onSuccess: () => message.success("Ownership transferred."),
        onError: (e) => message.error(e instanceof Error ? e.message : "Couldn't transfer ownership."),
      },
    );
  };

  // Owner is assigned only via "Transfer ownership" (keeps exactly one owner).
  const tierOptions = useMemo(
    () =>
      MEMBER_TYPES.filter((t) => t.value !== "owner").map((t) => ({
        value: t.value,
        label: (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 16, color: t.tone }}>
              {t.icon}
            </span>
            {t.label}
          </span>
        ),
      })),
    [],
  );

  const handleTierChange = (teamMemberId: string, memberType: MemberType) => {
    setMemberType.mutate(
      { teamMemberId, memberType },
      {
        onSuccess: () => message.success("Role updated."),
        onError: (e) => message.error(e instanceof Error ? e.message : "Couldn't update the role."),
      },
    );
  };

  const members: TeamMember[] = membersData ?? [];
  const invitations: EmailInvitation[] = invitationsData ?? [];

  const [inviteOpen, setInviteOpen] = useState(false);
  const [form] = Form.useForm<InviteFormValues>();

  const handleRemove = async (memberId: string) => {
    try {
      await removeMember.mutateAsync(memberId);
      message.success("Member removed.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to remove member.",
      );
    }
  };

  const handleInvite = async () => {
    const values = await form.validateFields();
    try {
      await inviteMember.mutateAsync({
        email: values.email.trim(),
        name: values.name.trim(),
        memberType: values.member_type ?? "member",
      });
      message.success("Invitation sent.");
      setInviteOpen(false);
      form.resetFields();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to send invitation.",
      );
    }
  };

  const memberColumns: ColumnsType<TeamMember> = [
    {
      title: "Member",
      key: "member",
      render: (_, record) => (
        <Space>
          <Avatar src={memberAvatar(record)} icon={<UserOutlined />} />
          <div>
            <Typography.Text strong>{memberName(record)}</Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {memberEmail(record)}
            </Typography.Text>
          </div>
        </Space>
      ),
    },
    {
      title: "Role",
      key: "role",
      width: 210,
      render: (_, record) => {
        const meta = memberTypeMeta(record.member_type);
        // Owner rows are read-only; ownership changes go through Transfer.
        if (!isAdmin || record.member_type === "owner") {
          return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 16, color: meta.tone }}>
                {meta.icon}
              </span>
              <Typography.Text>{meta.label}</Typography.Text>
            </span>
          );
        }
        return (
          <Select
            style={{ width: 180 }}
            value={record.member_type}
            options={tierOptions}
            loading={setMemberType.isPending}
            optionLabelProp="label"
            onChange={(t) => handleTierChange(record.id, t as MemberType)}
          />
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 130,
      align: "right",
      render: (_, record) => (
        <Space size={2}>
          {iAmOwner && record.user_id && record.member_type !== "owner" ? (
            <Popconfirm
              title="Transfer ownership?"
              description={`Make ${memberName(record)} the workspace owner. You'll become an admin.`}
              okText="Transfer"
              onConfirm={() => handleTransfer(record.user_id as string)}
            >
              <Tooltip title="Transfer ownership">
                <Button
                  type="text"
                  icon={<span className="material-symbols-rounded" style={{ fontSize: 18 }}>workspace_premium</span>}
                  aria-label="Transfer ownership"
                />
              </Tooltip>
            </Popconfirm>
          ) : null}
          <Popconfirm
            title="Remove this member?"
            okText="Remove"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleRemove(record.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="Remove member"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const invitationColumns: ColumnsType<EmailInvitation> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
    },
    {
      title: "Email",
      dataIndex: "email",
      key: "email",
      render: (email: string) => (
        <Space size={6}>
          <MailOutlined />
          {email}
        </Space>
      ),
    },
    {
      title: "Status",
      key: "status",
      width: 120,
      render: () => <Tag color="gold">Pending</Tag>,
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 21,
                fontWeight: 600,
                letterSpacing: "-.4px",
                color: token.colorText,
                lineHeight: 1.2,
              }}
            >
              Members
            </h1>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: token.colorTextSecondary,
              }}
            >
              People in your active team.
            </p>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setInviteOpen(true)}
          >
            Invite
          </Button>
        </div>

        <Table<TeamMember>
          rowKey="id"
          loading={membersLoading}
          columns={memberColumns}
          dataSource={members}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: "max-content" }}
        />
      </Card>

      <Card>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Pending invitations
        </Typography.Title>
        <Table<EmailInvitation>
          rowKey="id"
          loading={invitationsLoading}
          columns={invitationColumns}
          dataSource={invitations}
          pagination={false}
          locale={{ emptyText: "No pending invitations" }}
          scroll={{ x: "max-content" }}
        />
      </Card>

      <Modal
        title="Invite member"
        open={inviteOpen}
        onOk={handleInvite}
        confirmLoading={inviteMember.isPending}
        okText="Send invitation"
        onCancel={() => {
          setInviteOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form<InviteFormValues> form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: "Please enter a name." }]}
          >
            <Input placeholder="Full name" autoFocus />
          </Form.Item>
          <Form.Item
            label="Email"
            name="email"
            rules={[
              { required: true, message: "Please enter an email." },
              { type: "email", message: "Please enter a valid email." },
            ]}
          >
            <Input placeholder="person@example.com" type="email" />
          </Form.Item>
          <Form.Item label="Role" name="member_type" initialValue="member">
            <Select
              options={MEMBER_TYPES.filter((t) => t.value !== "owner").map((t) => ({
                value: t.value,
                label: t.label,
                desc: t.hint,
                icon: t.icon,
                tone: t.tone,
              }))}
              optionRender={(opt) => (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "3px 0" }}>
                  <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 18, color: opt.data.tone, marginTop: 1 }}>
                    {opt.data.icon}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>{opt.data.label}</div>
                    <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{opt.data.desc}</div>
                  </div>
                </div>
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
