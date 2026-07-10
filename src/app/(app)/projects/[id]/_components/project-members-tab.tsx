"use client";

import { useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  UserOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import {
  useProjectMembers,
  useAddProjectMember,
  useRemoveProjectMember,
  type ProjectMember,
} from "@/features/projects/use-project-members";
import { MemberSingleSelect } from "@/features/team-members/member-select";

/** A team member candidate (team_members row joined to its user). */
interface TeamMemberOption {
  teamMemberId: string;
  userId: string | null;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/**
 * Lists the active team's members (team_members joined to users), for the
 * "add member" picker. Scoped to `useActiveTeam()`; RLS additionally restricts
 * rows to teams the caller belongs to.
 */
function useTeamMemberCandidates() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: ["team-member-candidates", teamId],
    enabled: Boolean(teamId),
    queryFn: async (): Promise<TeamMemberOption[]> => {
      const { data, error } = await supabase
        .from("team_members")
        .select("id, user_id, active, users:user_id(name, email, avatar_url)")
        .eq("team_id", teamId as string)
        .eq("active", true);

      if (error) throw error;

      return (data ?? []).map((row) => {
        const user = row.users as
          | { name: string; email: string; avatar_url: string | null }
          | null;
        return {
          teamMemberId: row.id,
          userId: row.user_id,
          name: user?.name ?? user?.email ?? "Unknown",
          email: user?.email ?? "",
          avatarUrl: user?.avatar_url ?? null,
        };
      });
    },
  });
}

export function ProjectMembersTab({ projectId }: { projectId: string }) {
  const { message } = App.useApp();

  const { data: members, isLoading } = useProjectMembers(projectId);
  const { data: candidates } = useTeamMemberCandidates();
  const addMember = useAddProjectMember();
  const removeMember = useRemoveProjectMember();

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTeamMemberId, setSelectedTeamMemberId] = useState<
    string | undefined
  >(undefined);

  // team_member_ids already on the project, to exclude them from the picker.
  const existingTeamMemberIds = useMemo(
    () => new Set((members ?? []).map((m) => m.team_member_id)),
    [members],
  );

  const availableCandidates = useMemo(
    () =>
      (candidates ?? []).filter(
        (c) => !existingTeamMemberIds.has(c.teamMemberId),
      ),
    [candidates, existingTeamMemberIds],
  );

  const handleAdd = async () => {
    if (!selectedTeamMemberId) return;
    try {
      await addMember.mutateAsync({
        projectId,
        teamMemberId: selectedTeamMemberId,
      });
      message.success("Member added.");
      setModalOpen(false);
      setSelectedTeamMemberId(undefined);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to add member.",
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

  const columns: ColumnsType<ProjectMember> = [
    {
      title: "Member",
      key: "member",
      render: (_, record) => {
        const user = record.team_member?.user;
        const name = user?.name ?? user?.email ?? "Unknown member";
        return (
          <Space>
            <Avatar
              src={user?.avatar_url ?? undefined}
              icon={<UserOutlined />}
            />
            <div>
              <div>{name}</div>
              {user?.email ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {user.email}
                </Typography.Text>
              ) : null}
            </div>
          </Space>
        );
      },
    },
    {
      title: "Default view",
      dataIndex: "default_view",
      key: "default_view",
      width: 160,
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      align: "right",
      render: (_, record) => (
        <Popconfirm
          title="Remove this member from the project?"
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

  return (
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
          <Typography.Title level={5} style={{ margin: 0 }}>
            Members
          </Typography.Title>
          <Typography.Text type="secondary">
            People with access to this project.
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
          disabled={availableCandidates.length === 0}
        >
          Add member
        </Button>
      </div>

      <Table<ProjectMember>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={members ?? []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      <Modal
        title="Add member"
        open={modalOpen}
        onOk={handleAdd}
        okText="Add"
        confirmLoading={addMember.isPending}
        okButtonProps={{ disabled: !selectedTeamMemberId }}
        onCancel={() => {
          setModalOpen(false);
          setSelectedTeamMemberId(undefined);
        }}
        destroyOnHidden
      >
        <MemberSingleSelect
          style={{ width: "100%" }}
          placeholder="Select a team member"
          value={selectedTeamMemberId}
          onChange={setSelectedTeamMemberId}
          options={availableCandidates.map((c) => ({
            value: c.teamMemberId,
            label: c.name,
            email: c.email,
          }))}
          notFoundContent="Everyone on the team is already a member."
        />
      </Modal>
    </Card>
  );
}
