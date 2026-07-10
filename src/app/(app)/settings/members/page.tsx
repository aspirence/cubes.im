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
  Typography,
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
  useUpdateMemberRole,
  useRemoveMember,
  useRoles,
} from "@/features/team-members/use-team-members";
import {
  useInvitations,
  useInviteMember,
} from "@/features/invitations/use-invitations";

import type { TeamMember, Role } from "@/features/team-members/use-team-members";
import type { EmailInvitation } from "@/features/invitations/use-invitations";

interface InviteFormValues {
  email: string;
  name: string;
  role_id?: string;
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
  const { message } = App.useApp();

  const { data: membersData, isLoading: membersLoading } = useTeamMembers();
  const { data: rolesData } = useRoles();
  const { data: invitationsData, isLoading: invitationsLoading } =
    useInvitations();
  const updateMemberRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const inviteMember = useInviteMember();

  const members: TeamMember[] = membersData ?? [];
  const roles: Role[] = rolesData ?? [];
  const invitations: EmailInvitation[] = invitationsData ?? [];

  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.id, label: r.name })),
    [roles],
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [form] = Form.useForm<InviteFormValues>();

  const handleRoleChange = async (memberId: string, roleId: string) => {
    try {
      await updateMemberRole.mutateAsync({ memberId, roleId });
      message.success("Role updated.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update role.",
      );
    }
  };

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
        roleId: values.role_id,
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
      width: 200,
      render: (_, record) => (
        <Select
          style={{ width: 160 }}
          value={record.role_id}
          options={roleOptions}
          placeholder={record.role?.name ?? "Role"}
          loading={updateMemberRole.isPending}
          onChange={(roleId) => handleRoleChange(record.id, roleId)}
        />
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      align: "right",
      render: (_, record) => (
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
            <Typography.Title level={4} style={{ margin: 0 }}>
              Members
            </Typography.Title>
            <Typography.Text type="secondary">
              People in your active team.
            </Typography.Text>
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
          <Form.Item label="Role" name="role_id">
            <Select
              options={roleOptions}
              placeholder="Default role (Member)"
              allowClear
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
