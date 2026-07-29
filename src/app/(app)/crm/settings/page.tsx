"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Input,
  List,
  Popconfirm,
  Select,
  Space,
  Typography,
  theme,
} from "antd";
import dayjs from "dayjs";
import {
  useMyMemberType,
  useTeamMembers,
} from "@/features/team-members/use-team-members";
import {
  useCrmAdmins,
  useGrantCrmAdmin,
  useRevokeCrmAdmin,
} from "@/features/app-crm/use-crm-access";
import {
  useCreateCrmStage,
  useCrmStages,
  useDeleteCrmStage,
  useUpdateCrmStage,
} from "@/features/app-crm/use-crm-stages";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { CRM_STAGE_COLORS } from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";

function ColorDot({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

export default function CrmSettingsPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const myType = useMyMemberType();
  const isOwner = myType === "owner";
  const { data: members } = useTeamMembers();
  const { data: admins, isLoading: adminsLoading } = useCrmAdmins();
  const grantAdmin = useGrantCrmAdmin();
  const revokeAdmin = useRevokeCrmAdmin();
  const { data: stages, isLoading: stagesLoading } = useCrmStages();
  const { data: deals } = useCrmDeals();
  const createStage = useCreateCrmStage();
  const updateStage = useUpdateCrmStage();
  const deleteStage = useDeleteCrmStage();

  const [grantUserId, setGrantUserId] = useState<string | undefined>();
  const [newStageName, setNewStageName] = useState("");

  const grantableOptions = useMemo(() => {
    const granted = new Set((admins ?? []).map((a) => a.user_id));
    return (members ?? [])
      .filter(
        (m) =>
          m.active &&
          m.user &&
          m.member_type !== "owner" &&
          !granted.has(m.user.id),
      )
      .map((m) => ({
        value: m.user!.id,
        label: `${m.user!.name} (${m.member_type})`,
      }));
  }, [members, admins]);

  const dealCountByStage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of deals ?? []) {
      if (d.stage_id && !d.deleted_at) {
        counts.set(d.stage_id, (counts.get(d.stage_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [deals]);

  const handleGrant = async () => {
    if (!grantUserId) return;
    try {
      await grantAdmin.mutateAsync(grantUserId);
      setGrantUserId(undefined);
      message.success("CRM access granted.");
    } catch (err) {
      message.error(errMsg(err, "Failed to grant access."));
    }
  };

  const handleAddStage = async () => {
    const name = newStageName.trim();
    if (!name) return;
    try {
      await createStage.mutateAsync({
        name,
        color:
          CRM_STAGE_COLORS[(stages?.length ?? 0) % CRM_STAGE_COLORS.length],
        position:
          Math.max(0, ...(stages ?? []).map((s) => s.position)) + 1,
      });
      setNewStageName("");
      message.success("Stage added.");
    } catch (err) {
      message.error(errMsg(err, "Failed to add stage."));
    }
  };

  const moveStage = async (index: number, direction: -1 | 1) => {
    const list = stages ?? [];
    const other = list[index + direction];
    const current = list[index];
    if (!current || !other) return;
    try {
      await Promise.all([
        updateStage.mutateAsync({
          id: current.id,
          patch: { position: other.position },
        }),
        updateStage.mutateAsync({
          id: other.id,
          patch: { position: current.position },
        }),
      ]);
    } catch (err) {
      message.error(errMsg(err, "Failed to reorder stages."));
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: "0 auto" }}>
      <Typography.Title level={3} style={{ marginBottom: 16 }}>
        CRM Settings
      </Typography.Title>

      <Card
        size="small"
        title={
          <Space>
            <MIcon name="shield_person" size={18} />
            <span>Access</span>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          The workspace owner always has CRM access. Everyone else — including
          workspace admins — needs a grant below before they can see or work
          the CRM.
        </Typography.Paragraph>

        {isOwner ? (
          <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Pick a team member to grant CRM access…"
              value={grantUserId}
              onChange={setGrantUserId}
              options={grantableOptions}
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              onClick={handleGrant}
              loading={grantAdmin.isPending}
              disabled={!grantUserId}
            >
              Grant access
            </Button>
          </Space.Compact>
        ) : (
          <Alert
            type="info"
            showIcon
            message="Only the workspace owner can grant or revoke CRM access."
            style={{ marginBottom: 12 }}
          />
        )}

        <List
          loading={adminsLoading}
          dataSource={admins ?? []}
          locale={{
            emptyText: "No one has been granted CRM access yet.",
          }}
          renderItem={(a) => (
            <List.Item
              style={{ paddingInline: 0 }}
              actions={
                isOwner
                  ? [
                      <Popconfirm
                        key="revoke"
                        title="Revoke CRM access?"
                        description="They will no longer see the CRM for this workspace."
                        onConfirm={async () => {
                          try {
                            await revokeAdmin.mutateAsync(a.id);
                            message.success("Access revoked.");
                          } catch (err) {
                            message.error(
                              errMsg(err, "Failed to revoke access."),
                            );
                          }
                        }}
                      >
                        <Button size="small" danger>
                          Revoke
                        </Button>
                      </Popconfirm>,
                    ]
                  : []
              }
            >
              <List.Item.Meta
                avatar={
                  <Avatar src={a.user?.avatar_url ?? undefined}>
                    {(a.user?.name ?? "?").charAt(0).toUpperCase()}
                  </Avatar>
                }
                title={a.user?.name ?? "Unknown user"}
                description={`${a.user?.email ?? ""} · granted ${dayjs(a.created_at).format("DD MMM YYYY")}`}
              />
            </List.Item>
          )}
        />
      </Card>

      <Card
        size="small"
        title={
          <Space>
            <MIcon name="view_column" size={18} />
            <span>Pipeline stages</span>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {`Stages define the deal board's columns, in this order. Deleting a stage keeps its deals — they move to "No stage" on the board.`}
        </Typography.Paragraph>

        <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
          <Input
            placeholder="Add a stage (e.g. Negotiation)…"
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            onPressEnter={handleAddStage}
          />
          <Button
            type="primary"
            onClick={handleAddStage}
            loading={createStage.isPending}
            disabled={!newStageName.trim()}
          >
            Add stage
          </Button>
        </Space.Compact>

        <List
          loading={stagesLoading}
          dataSource={stages ?? []}
          locale={{ emptyText: "No stages yet — add the first one above." }}
          renderItem={(s, index) => (
            <List.Item
              style={{ paddingInline: 0 }}
              actions={[
                <Button
                  key="up"
                  type="text"
                  size="small"
                  disabled={index === 0}
                  icon={<MIcon name="arrow_upward" size={16} />}
                  onClick={() => moveStage(index, -1)}
                />,
                <Button
                  key="down"
                  type="text"
                  size="small"
                  disabled={index === (stages?.length ?? 0) - 1}
                  icon={<MIcon name="arrow_downward" size={16} />}
                  onClick={() => moveStage(index, 1)}
                />,
                <Popconfirm
                  key="delete"
                  title={`Delete "${s.name}"?`}
                  description={
                    (dealCountByStage.get(s.id) ?? 0) > 0
                      ? `${dealCountByStage.get(s.id)} deal(s) will move to "No stage".`
                      : "This stage has no deals."
                  }
                  onConfirm={async () => {
                    try {
                      await deleteStage.mutateAsync(s.id);
                      message.success("Stage deleted.");
                    } catch (err) {
                      message.error(errMsg(err, "Failed to delete stage."));
                    }
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<MIcon name="delete" size={16} />}
                  />
                </Popconfirm>,
              ]}
            >
              <Space style={{ flex: 1 }} align="center">
                <ColorDot color={s.color} />
                <Typography.Text
                  editable={{
                    onChange: async (name) => {
                      const trimmed = name.trim();
                      if (!trimmed || trimmed === s.name) return;
                      try {
                        await updateStage.mutateAsync({
                          id: s.id,
                          patch: { name: trimmed },
                        });
                      } catch (err) {
                        message.error(errMsg(err, "Failed to rename stage."));
                      }
                    },
                  }}
                  style={{ fontWeight: 500 }}
                >
                  {s.name}
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 12 }}
                >
                  {dealCountByStage.get(s.id) ?? 0} deals
                </Typography.Text>
                <Space size={4} style={{ marginLeft: 8 }}>
                  {CRM_STAGE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Set color ${c}`}
                      onClick={async () => {
                        if (c === s.color) return;
                        try {
                          await updateStage.mutateAsync({
                            id: s.id,
                            patch: { color: c },
                          });
                        } catch (err) {
                          message.error(
                            errMsg(err, "Failed to recolor stage."),
                          );
                        }
                      }}
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 999,
                        background: c,
                        cursor: "pointer",
                        border:
                          c === s.color
                            ? `2px solid ${token.colorText}`
                            : "2px solid transparent",
                        padding: 0,
                      }}
                    />
                  ))}
                </Space>
              </Space>
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
