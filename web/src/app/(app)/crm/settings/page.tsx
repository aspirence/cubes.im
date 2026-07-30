"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Input,
  Popconfirm,
  Popover,
  Select,
  Spin,
  Tooltip,
  Typography,
  theme,
} from "antd";
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
import { CrmListRow } from "../_components/list-row";
import {
  CrmPageHeader,
  EmptyState,
  ErrorState,
  EntityAvatar,
  Panel,
  RowActions,
  SectionLabel,
  SoftChip,
  crmDate,
  crmPageStyle,
  useCrmStyles,
} from "../_lib/ui";

/** The stage's colour, as data — a solid dot in front of its name. */
function ColorDot({ color, size = 12 }: { color: string; size?: number }) {
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

/** Quiet inline explanation strip (replaces a loud Alert). */
function InfoStrip({
  icon = "info",
  children,
}: {
  icon?: string;
  children: React.ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        marginTop: 12,
        padding: "8px 10px",
        borderRadius: 8,
        background: token.colorFillQuaternary,
        color: token.colorTextSecondary,
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <MIcon
        name={icon}
        size={16}
        color={token.colorTextTertiary}
        style={{ marginTop: 1, flex: "none" }}
      />
      <span>{children}</span>
    </div>
  );
}

function RowsLoading() {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        padding: "28px 0",
        textAlign: "center",
        borderTop: `1px solid ${token.colorSplit}`,
      }}
    >
      <Spin size="small" />
    </div>
  );
}

/** Grantable team member, carrying the bits the option row renders. */
type GrantOption = {
  value: string;
  label: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  memberType: string;
};

export default function CrmSettingsPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  useCrmStyles();
  const myType = useMyMemberType();
  const isOwner = myType === "owner";
  const { data: members } = useTeamMembers();
  const {
    data: admins,
    isLoading: adminsLoading,
    isError: adminsError,
    refetch: refetchAdmins,
  } = useCrmAdmins();
  const grantAdmin = useGrantCrmAdmin();
  const revokeAdmin = useRevokeCrmAdmin();
  const {
    data: stages,
    isLoading: stagesLoading,
    isError: stagesError,
    refetch: refetchStages,
  } = useCrmStages();
  const { data: deals } = useCrmDeals();
  const createStage = useCreateCrmStage();
  const updateStage = useUpdateCrmStage();
  const deleteStage = useDeleteCrmStage();

  const [grantUserId, setGrantUserId] = useState<string | undefined>();
  const [newStageName, setNewStageName] = useState("");
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const grantableOptions = useMemo<GrantOption[]>(() => {
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
        name: m.user!.name,
        email: m.user!.email,
        avatarUrl: m.user!.avatar_url,
        memberType: m.member_type,
      }));
  }, [members, admins]);

  /** The workspace owner — pinned above the grants, never revocable. */
  const owner = useMemo(
    () => (members ?? []).find((m) => m.member_type === "owner" && m.user) ?? null,
    [members],
  );

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

  const grants = admins ?? [];
  const stageList = stages ?? [];
  const accessCount = grants.length + (owner ? 1 : 0);

  const ellipsis: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="CRM settings"
        subtitle="Decide who can work the CRM, and shape the stages the deal board runs on."
      />

      <Panel
        title="Access"
        extra={
          adminsLoading || adminsError ? null : (
            <SoftChip icon="group">
              {accessCount} {accessCount === 1 ? "person" : "people"}
            </SoftChip>
          )
        }
        padding={0}
        style={{ marginBottom: 16 }}
      >
        <div style={{ padding: 16 }}>
          <SectionLabel>Who can work the CRM</SectionLabel>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: token.colorTextSecondary,
            }}
          >
            The workspace owner always has CRM access. Everyone else — including
            workspace admins — needs a grant below before they can see or work
            the CRM.
          </p>

          {isOwner ? (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Pick a team member to grant CRM access…"
                value={grantUserId}
                onChange={setGrantUserId}
                options={grantableOptions}
                listItemHeight={44}
                listHeight={288}
                optionRender={(option) => {
                  const d = option.data as GrantOption;
                  return (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <EntityAvatar
                        name={d.name}
                        kind="person"
                        src={d.avatarUrl}
                        size={24}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 500, ...ellipsis }}>
                          {d.name}
                        </div>
                        <div
                          style={{
                            fontSize: 11.5,
                            color: token.colorTextTertiary,
                            ...ellipsis,
                          }}
                        >
                          {d.email}
                        </div>
                      </div>
                      <SoftChip style={{ flex: "none" }}>
                        {d.memberType}
                      </SoftChip>
                    </div>
                  );
                }}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button
                type="primary"
                onClick={handleGrant}
                loading={grantAdmin.isPending}
                disabled={!grantUserId}
              >
                Grant access
              </Button>
            </div>
          ) : (
            <InfoStrip icon="lock">
              Only the workspace owner can grant or revoke CRM access.
            </InfoStrip>
          )}
        </div>

        {owner ? (
          <CrmListRow style={{ gap: 12 }}>
            <EntityAvatar
              name={owner.user!.name}
              kind="person"
              src={owner.user!.avatar_url}
              size={32}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{ fontWeight: 500, color: token.colorText, ...ellipsis }}
              >
                {owner.user!.name}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: token.colorTextTertiary,
                  ...ellipsis,
                }}
              >
                {owner.user!.email}
              </div>
            </div>
            <SoftChip tone="accent" icon="verified_user" style={{ flex: "none" }}>
              Owner — always has access
            </SoftChip>
          </CrmListRow>
        ) : null}

        {adminsLoading ? (
          <RowsLoading />
        ) : adminsError ? (
          <div style={{ borderTop: `1px solid ${token.colorSplit}` }}>
            <ErrorState
              compact
              title="Couldn't load who has access"
              onRetry={() => void refetchAdmins()}
            />
          </div>
        ) : grants.length === 0 ? (
          <div style={{ borderTop: `1px solid ${token.colorSplit}` }}>
            <EmptyState
              compact
              icon="person_add"
              title="No one else has CRM access"
              description={
                isOwner
                  ? "Pick a team member above to bring them into the CRM. They'll see people, companies, deals, tasks and notes for this workspace."
                  : "The workspace owner hasn't granted CRM access to anyone else yet."
              }
            />
          </div>
        ) : (
          grants.map((a) => {
            const name = a.user?.name ?? "Unknown user";
            return (
              <CrmListRow key={a.id} style={{ gap: 12 }}>
                <EntityAvatar
                  name={name}
                  kind="person"
                  src={a.user?.avatar_url}
                  size={32}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      color: token.colorText,
                      ...ellipsis,
                    }}
                  >
                    {name}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: token.colorTextTertiary,
                      ...ellipsis,
                    }}
                  >
                    {a.user?.email || "—"}
                  </div>
                </div>
                <span
                  style={{
                    flex: "none",
                    fontSize: 12,
                    color: token.colorTextTertiary,
                    whiteSpace: "nowrap",
                  }}
                >
                  Granted {crmDate(a.created_at)}
                </span>
                {isOwner ? (
                  <RowActions
                    open={confirmRevokeId === a.id}
                    style={{ flex: "none" }}
                  >
                    <Popconfirm
                      title="Revoke CRM access?"
                      description="They will no longer see the CRM for this workspace."
                      okText="Revoke"
                      okButtonProps={{ danger: true }}
                      onOpenChange={(open) =>
                        setConfirmRevokeId(open ? a.id : null)
                      }
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
                      <Button size="small" type="text" danger>
                        Revoke
                      </Button>
                    </Popconfirm>
                  </RowActions>
                ) : null}
              </CrmListRow>
            );
          })
        )}
      </Panel>

      <Panel
        title="Pipeline stages"
        extra={
          stagesLoading || stagesError ? null : (
            <SoftChip icon="view_week">
              {stageList.length} {stageList.length === 1 ? "stage" : "stages"}
            </SoftChip>
          )
        }
        padding={0}
      >
        <div style={{ padding: 16 }}>
          <SectionLabel>Board columns, in order</SectionLabel>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: token.colorTextSecondary,
            }}
          >
            {`Stages define the deal board's columns, in this order. Deleting a stage keeps its deals — they move to "No stage" on the board.`}
          </p>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Input
              placeholder="Add a stage (e.g. Negotiation)…"
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              onPressEnter={handleAddStage}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Button
              type="primary"
              onClick={handleAddStage}
              loading={createStage.isPending}
              disabled={!newStageName.trim()}
            >
              Add stage
            </Button>
          </div>
        </div>

        {stagesLoading ? (
          <RowsLoading />
        ) : stagesError ? (
          <div style={{ borderTop: `1px solid ${token.colorSplit}` }}>
            <ErrorState
              compact
              title="Couldn't load the pipeline stages"
              onRetry={() => void refetchStages()}
            />
          </div>
        ) : stageList.length === 0 ? (
          <div style={{ borderTop: `1px solid ${token.colorSplit}` }}>
            <EmptyState
              compact
              icon="view_column"
              title="No stages yet"
              description="Stages are the columns of the deal board. Add your first one above — Discovery, Proposal, Negotiation…"
            />
          </div>
        ) : (
          stageList.map((s, index) => {
            const dealCount = dealCountByStage.get(s.id) ?? 0;
            return (
              <CrmListRow key={s.id} style={{ gap: 12 }}>
                <Popover
                  trigger="click"
                  placement="bottomLeft"
                  title="Stage colour"
                  content={
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 20px)",
                        gap: 8,
                        paddingTop: 2,
                      }}
                    >
                      {CRM_STAGE_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={`Set colour ${c}`}
                          title={c}
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
                            width: 20,
                            height: 20,
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
                    </div>
                  }
                >
                  <Tooltip title="Change colour">
                    <button
                      type="button"
                      aria-label={`Change the colour of ${s.name}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 22,
                        height: 22,
                        flex: "none",
                        padding: 0,
                        borderRadius: 999,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <ColorDot color={s.color} />
                    </button>
                  </Tooltip>
                </Popover>
                <div style={{ minWidth: 0, flex: 1 }}>
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
                </div>

                <SoftChip style={{ flex: "none" }}>
                  {dealCount} {dealCount === 1 ? "deal" : "deals"}
                </SoftChip>

                <RowActions
                  open={confirmDeleteId === s.id}
                  style={{ flex: "none" }}
                >
                  <Tooltip title="Move up">
                    <Button
                      type="text"
                      size="small"
                      disabled={index === 0}
                      aria-label="Move stage up"
                      icon={<MIcon name="arrow_upward" size={16} />}
                      onClick={() => moveStage(index, -1)}
                    />
                  </Tooltip>
                  <Tooltip title="Move down">
                    <Button
                      type="text"
                      size="small"
                      disabled={index === stageList.length - 1}
                      aria-label="Move stage down"
                      icon={<MIcon name="arrow_downward" size={16} />}
                      onClick={() => moveStage(index, 1)}
                    />
                  </Tooltip>
                  <Popconfirm
                    title={`Delete "${s.name}"?`}
                    description={
                      dealCount > 0
                        ? `${dealCount} deal(s) will move to "No stage".`
                        : "This stage has no deals."
                    }
                    okText="Delete stage"
                    okButtonProps={{ danger: true }}
                    onOpenChange={(open) =>
                      setConfirmDeleteId(open ? s.id : null)
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
                    <Tooltip title="Delete stage">
                      <Button
                        type="text"
                        size="small"
                        danger
                        aria-label="Delete stage"
                        icon={<MIcon name="delete" size={16} />}
                      />
                    </Tooltip>
                  </Popconfirm>
                </RowActions>
              </CrmListRow>
            );
          })
        )}
      </Panel>
    </div>
  );
}
