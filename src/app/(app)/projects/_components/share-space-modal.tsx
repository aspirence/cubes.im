"use client";

import { useMemo, useState } from "react";
import {
  App as AntdApp,
  AutoComplete,
  Avatar,
  Button,
  Modal,
  Switch,
  theme,
  Tooltip,
} from "antd";
import {
  useSpaceMembers,
  useSetSpaceVisibility,
  useAddSpaceMember,
  useRemoveSpaceMember,
  type ProjectFolder,
} from "@/features/projects/use-project-folders";
import { useTeamMembers } from "@/features/team-members/use-team-members";

/**
 * Maps a Supabase/PostgREST error into a human-readable sharing message. RLS
 * rejections and the RPC's own guard both mean "not allowed here".
 */
function sharingErrorMessage(err: unknown, fallback: string): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  if (code === "42501" || code === "PGRST116") {
    return "You don't have permission to change sharing for this space.";
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

function MIcon({
  name,
  size = 18,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
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

export interface ShareSpaceModalProps {
  folder: ProjectFolder | null;
  open: boolean;
  /** Whether the current user may manage this space (team admin / space admin). */
  canManage: boolean;
  onClose: () => void;
}

/**
 * Share dialog for a Space: toggle it between team-wide (shared) and private,
 * and manage the explicit member roster of a private Space. Projects inside a
 * private Space inherit the restriction (a member who can't see the Space can't
 * see its projects), so this is the top-level access gate for everything in it.
 */
export function ShareSpaceModal({
  folder,
  open,
  canManage,
  onClose,
}: ShareSpaceModalProps) {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const C = useMemo(
    () => ({
      accent: "#4a4ad0",
      hairline: token.colorBorderSecondary,
      inner: token.colorSplit,
      textPrimary: token.colorText,
      textSecondary: token.colorTextSecondary,
      textTertiary: token.colorTextTertiary,
    }),
    [token],
  );

  const setVisibility = useSetSpaceVisibility();
  const addMember = useAddSpaceMember();
  const removeMember = useRemoveSpaceMember();
  const membersQuery = useSpaceMembers(folder?.id);
  const teamMembersQuery = useTeamMembers();

  const [inviteValue, setInviteValue] = useState("");
  const [peopleOpen, setPeopleOpen] = useState(true);

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);

  const inviteOptions = useMemo(() => {
    const memberTmIds = new Set(members.map((m) => m.team_member_id));
    return (teamMembersQuery.data ?? [])
      .filter((tm) => tm.user && !memberTmIds.has(tm.id))
      .map((tm) => ({
        value: tm.id,
        label: `${tm.user!.name} (${tm.user!.email})`,
        searchText: `${tm.user!.name} ${tm.user!.email}`.toLowerCase(),
      }));
  }, [teamMembersQuery.data, members]);

  if (!folder) return null;

  const isPrivate = (folder.visibility ?? "team") === "private";

  const handleSetVisibility = async (next: "team" | "private") => {
    try {
      await setVisibility.mutateAsync({ folderId: folder.id, visibility: next });
      message.success(
        next === "private"
          ? "Space is now private to its members."
          : "Space is now visible to the whole team.",
      );
    } catch (err) {
      message.error(sharingErrorMessage(err, "Failed to update sharing."));
    }
  };

  const handleInvite = async (teamMemberId: string) => {
    setInviteValue("");
    try {
      await addMember.mutateAsync({ folderId: folder.id, teamMemberId });
      message.success("Member added to space.");
    } catch (err) {
      message.error(sharingErrorMessage(err, "Failed to add member."));
    }
  };

  const handleRemoveMember = async (teamMemberId: string) => {
    try {
      await removeMember.mutateAsync({ folderId: folder.id, teamMemberId });
      message.success("Member removed from space.");
    } catch (err) {
      message.error(sharingErrorMessage(err, "Failed to remove member."));
    }
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={540}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 19, fontWeight: 700, color: C.textPrimary }}>
          Share this space
        </span>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: C.textSecondary,
            fontSize: 14,
            marginBottom: 10,
          }}
        >
          <MIcon name="folder" size={17} color={folder.color_code || C.accent} />
          <span
            style={{
              color: C.textPrimary,
              fontWeight: 600,
            }}
          >
            {folder.name}
          </span>
          {isPrivate ? (
            <MIcon name="lock" size={15} color={C.textTertiary} />
          ) : null}
        </div>

        {/* Team (shared) toggle */}
        <div
          style={{
            ...rowStyle,
            padding: "10px 12px",
            borderRadius: 8,
            background: C.inner,
          }}
        >
          <MIcon
            name={isPrivate ? "lock" : "groups"}
            size={20}
            color={C.textPrimary}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: C.textPrimary, fontWeight: 600 }}>
              {isPrivate ? "Private space" : "Shared with the team"}
            </div>
            <div style={{ fontSize: 12.5, color: C.textTertiary }}>
              {isPrivate
                ? "Only the people below, the creator, and admins can see it."
                : "Everyone in the workspace can see this space and its shared projects."}
            </div>
          </div>
          <Tooltip
            title={
              !canManage
                ? "Only the space owner and workspace admins can change this."
                : isPrivate
                  ? "Turn on to share this space with the whole team."
                  : "Turn off to restrict this space to its members only."
            }
          >
            <Switch
              checked={!isPrivate}
              disabled={!canManage || setVisibility.isPending}
              onChange={(checked) =>
                void handleSetVisibility(checked ? "team" : "private")
              }
            />
          </Tooltip>
        </div>

        {/* Invite (only meaningful for private spaces) */}
        {isPrivate ? (
          <>
            <AutoComplete
              value={inviteValue}
              onChange={setInviteValue}
              onSelect={(v) => void handleInvite(v as string)}
              options={inviteOptions.map(({ value, label }) => ({
                value,
                label,
              }))}
              filterOption={(input, option) => {
                const opt = inviteOptions.find((o) => o.value === option?.value);
                return Boolean(opt?.searchText.includes(input.toLowerCase()));
              }}
              placeholder="Add a member by name or email"
              allowClear
              disabled={!canManage}
              style={{ width: "100%", marginTop: 8 }}
              size="large"
            />

            {!canManage ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 6,
                  fontSize: 12.5,
                  color: C.textTertiary,
                }}
              >
                <MIcon name="info" size={14} color={C.textTertiary} />
                Only the space owner and workspace admins can manage members.
              </div>
            ) : null}

            {/* People */}
            <div style={{ ...rowStyle, marginTop: 4, cursor: "pointer" }}>
              <button
                type="button"
                onClick={() => setPeopleOpen((o) => !o)}
                aria-label={peopleOpen ? "Collapse people" : "Expand people"}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <MIcon
                  name={peopleOpen ? "expand_more" : "chevron_right"}
                  size={18}
                  color={C.textTertiary}
                />
                <MIcon name="group" size={20} color={C.textPrimary} />
                <span
                  style={{ fontSize: 14, color: C.textPrimary, fontWeight: 500 }}
                >
                  People with access
                </span>
              </button>
              <Avatar.Group max={{ count: 4 }} size={28}>
                {members.map((m) => (
                  <Avatar
                    key={m.id}
                    src={m.team_member?.user?.avatar_url ?? undefined}
                    style={{ fontSize: 12 }}
                  >
                    {initials(m.team_member?.user?.name ?? "?")}
                  </Avatar>
                ))}
              </Avatar.Group>
            </div>

            {peopleOpen ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  borderTop: `1px solid ${C.hairline}`,
                }}
              >
                {members.length === 0 ? (
                  <span
                    style={{
                      fontSize: 13,
                      color: C.textTertiary,
                      padding: "10px 0 4px 28px",
                    }}
                  >
                    No members yet — add someone above.
                  </span>
                ) : (
                  members.map((m) => (
                    <div key={m.id} style={{ ...rowStyle, paddingLeft: 28 }}>
                      <Avatar
                        size={26}
                        src={m.team_member?.user?.avatar_url ?? undefined}
                        style={{ fontSize: 12, flex: "none" }}
                      >
                        {initials(m.team_member?.user?.name ?? "?")}
                      </Avatar>
                      <span
                        style={{
                          fontSize: 13.5,
                          color: C.textPrimary,
                          fontWeight: 500,
                        }}
                      >
                        {m.team_member?.user?.name ?? "Unknown"}
                      </span>
                      {m.role === "admin" ? (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: C.accent,
                            background: token.colorPrimaryBg,
                            padding: "1px 7px",
                            borderRadius: 999,
                          }}
                        >
                          Owner
                        </span>
                      ) : null}
                      <span style={{ fontSize: 12.5, color: C.textTertiary }}>
                        {m.team_member?.user?.email}
                      </span>
                      <span style={{ flex: 1 }} />
                      {canManage && m.role !== "admin" ? (
                        <Button
                          type="text"
                          size="small"
                          aria-label="Remove member"
                          onClick={() =>
                            void handleRemoveMember(m.team_member_id)
                          }
                          icon={
                            <MIcon
                              name="close"
                              size={15}
                              color={C.textTertiary}
                            />
                          }
                        />
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

export default ShareSpaceModal;
