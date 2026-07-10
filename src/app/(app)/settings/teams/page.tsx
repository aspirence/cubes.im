"use client";

import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  List,
  Modal,
  Segmented,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  CheckCircleFilled,
  PlusOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  useTeams,
  useActiveTeam,
  useCreateTeam,
  useSetActiveTeam,
} from "@/features/teams/use-teams";
import { useCompleteSetup } from "@/features/onboarding/use-setup";
import {
  useTeamDetails,
  useSaveTeamDetails,
  type TeamDetailsInput,
} from "@/features/teams/use-team-details";
import { WorkspaceDetailsFields } from "@/features/teams/workspace-details-form";
import { seedSampleWorkspace } from "@/features/onboarding/sample-workspace";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";

interface RenameValues {
  teamName: string;
}

type CreateValues = TeamDetailsInput & {
  name: string;
  start: "blank" | "sample";
};

export default function WorkspacesSettingsPage() {
  const { message } = App.useApp();
  const supabase = useMemo(() => createClient(), []);
  const { profile } = useAuth();
  const { data: teams, isLoading } = useTeams();
  const { data: activeTeam } = useActiveTeam();
  const setActiveTeam = useSetActiveTeam();
  const createTeam = useCreateTeam();
  const completeSetup = useCompleteSetup();
  const saveDetails = useSaveTeamDetails();
  const { data: activeDetails } = useTeamDetails(activeTeam?.id);

  const [form] = Form.useForm<RenameValues>();
  const [createForm] = Form.useForm<CreateValues>();
  const [detailsForm] = Form.useForm<TeamDetailsInput>();

  useEffect(() => {
    if (activeTeam) {
      form.setFieldsValue({ teamName: activeTeam.name });
    }
  }, [activeTeam, form]);

  // Load the active workspace's company profile into the editor.
  useEffect(() => {
    detailsForm.setFieldsValue({
      companyName: activeDetails?.company_name ?? undefined,
      industry: activeDetails?.industry ?? undefined,
      companySize: activeDetails?.company_size ?? undefined,
      website: activeDetails?.website ?? undefined,
      contactEmail: activeDetails?.contact_email ?? undefined,
      contactNumber: activeDetails?.contact_number ?? undefined,
      addressLine1: activeDetails?.address_line_1 ?? undefined,
      addressLine2: activeDetails?.address_line_2 ?? undefined,
      city: activeDetails?.city ?? undefined,
      state: activeDetails?.state ?? undefined,
      country: activeDetails?.country ?? undefined,
      postalCode: activeDetails?.postal_code ?? undefined,
      taxId: activeDetails?.tax_id ?? undefined,
    });
  }, [activeDetails, detailsForm]);

  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    setCreating(true);
    try {
      const { name, start, ...details } = values;
      const newId = await createTeam.mutateAsync(name.trim());

      // Company profile is best-effort — the workspace exists either way.
      try {
        await saveDetails.mutateAsync({
          teamId: newId,
          details: { companyName: name.trim(), ...details },
        });
      } catch (err) {
        console.error("Failed to save workspace details", err);
      }

      if (start === "sample") {
        message.open({
          key: "ws-seed",
          type: "loading",
          content: "Adding sample projects…",
          duration: 0,
        });
        try {
          await seedSampleWorkspace(supabase, newId, profile?.id);
          message.open({
            key: "ws-seed",
            type: "success",
            content: "Sample projects added.",
            duration: 2,
          });
        } catch (err) {
          console.error("Failed to seed the sample workspace", err);
          message.open({
            key: "ws-seed",
            type: "warning",
            content: "Couldn't add sample data — the workspace starts blank.",
            duration: 3,
          });
        }
      }

      // Activate the new workspace so members can be added right away.
      setActiveTeam.mutate(newId);
      message.success(
        "Workspace created and activated. Add members from Settings → Members.",
      );
      setCreateOpen(false);
      createForm.resetFields();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to create workspace.",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleSwitch = (teamId: string) => {
    setSwitchingId(teamId);
    setActiveTeam.mutate(teamId, {
      onSuccess: () => message.success("Active workspace switched."),
      onError: () => message.error("Failed to switch workspace."),
      onSettled: () => setSwitchingId(null),
    });
  };

  const handleRename = async (values: RenameValues) => {
    try {
      await completeSetup.mutateAsync({ teamName: values.teamName.trim() });
      message.success("Workspace renamed.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to rename workspace.",
      );
    }
  };

  const handleSaveDetails = async () => {
    if (!activeTeam?.id) return;
    try {
      const values = await detailsForm.validateFields();
      await saveDetails.mutateAsync({ teamId: activeTeam.id, details: values });
      message.success("Workspace details saved.");
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <Typography.Title level={4} style={{ marginTop: 0 }}>
              Workspaces
            </Typography.Title>
            <Typography.Paragraph type="secondary">
              Switch between your workspaces — one per company, brand, or
              department. The active workspace scopes your projects, members,
              and settings.
            </Typography.Paragraph>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              createForm.resetFields();
              setCreateOpen(true);
            }}
          >
            New workspace
          </Button>
        </div>

        <List
          loading={isLoading}
          dataSource={teams ?? []}
          renderItem={(team) => {
            const isActive = team.id === activeTeam?.id;
            return (
              <List.Item
                actions={[
                  isActive ? (
                    <Tag key="active" color="success" icon={<CheckCircleFilled />}>
                      Active
                    </Tag>
                  ) : (
                    <Button
                      key="switch"
                      onClick={() => handleSwitch(team.id)}
                      loading={
                        setActiveTeam.isPending && switchingId === team.id
                      }
                    >
                      Make active
                    </Button>
                  ),
                ]}
              >
                <List.Item.Meta
                  avatar={<TeamOutlined style={{ fontSize: 20 }} />}
                  title={team.name}
                />
              </List.Item>
            );
          }}
        />
      </Card>

      <Card>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Rename active workspace
        </Typography.Title>
        <Form<RenameValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handleRename}
          style={{ maxWidth: 480 }}
        >
          <Form.Item
            label="Workspace name"
            name="teamName"
            rules={[
              { required: true, message: "Please enter a workspace name." },
              { max: 55, message: "Name must be 55 characters or fewer." },
            ]}
          >
            <Input placeholder="Workspace name" disabled={!activeTeam} />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={completeSetup.isPending}
              disabled={!activeTeam}
            >
              Save
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Workspace details
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          The company profile for <b>{activeTeam?.name ?? "this workspace"}</b> —
          used on invoices, client portals, and HR documents.
        </Typography.Paragraph>
        <Form<TeamDetailsInput>
          form={detailsForm}
          layout="vertical"
          requiredMark={false}
          style={{ maxWidth: 640 }}
        >
          <Form.Item label="Company name" name="companyName">
            <Input placeholder="Acme Inc." />
          </Form.Item>
          <WorkspaceDetailsFields />
          <Form.Item>
            <Button
              type="primary"
              onClick={handleSaveDetails}
              loading={saveDetails.isPending}
              disabled={!activeTeam}
            >
              Save details
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Modal
        title="Create a workspace"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        okText="Create workspace"
        confirmLoading={creating || createTeam.isPending || setActiveTeam.isPending}
        destroyOnHidden
        width={620}
      >
        <Form<CreateValues>
          form={createForm}
          layout="vertical"
          requiredMark={false}
          initialValues={{ start: "sample" }}
          onFinish={handleCreate}
        >
          <Form.Item
            label="Workspace name"
            name="name"
            rules={[
              { required: true, message: "Please enter a workspace name." },
              { max: 55, message: "Name must be 55 characters or fewer." },
            ]}
          >
            <Input placeholder="e.g. Studio North" autoFocus />
          </Form.Item>

          <Form.Item
            label="Start with"
            name="start"
            style={{ marginBottom: 12 }}
          >
            <Segmented
              options={[
                { label: "Sample projects", value: "sample" },
                { label: "Blank workspace", value: "blank" },
              ]}
            />
          </Form.Item>

          <Collapse
            ghost
            items={[
              {
                key: "details",
                label: "Company details (optional)",
                children: <WorkspaceDetailsFields />,
              },
            ]}
            style={{ marginBottom: 8 }}
          />

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            You&apos;ll become the workspace owner. After creating, invite
            people from Settings → Members.
          </Typography.Text>
        </Form>
      </Modal>
    </Space>
  );
}
