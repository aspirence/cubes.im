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
  useUpdateProject,
  type ProjectWithRelations,
} from "@/features/projects/use-projects";
import {
  useProjectMembers,
  useAddProjectMember,
  useRemoveProjectMember,
} from "@/features/projects/use-project-members";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useAuth } from "@/features/auth/use-auth";

/**
 * Maps a Supabase/PostgREST error into a human-readable sharing message. RLS
 * rejections surface as code 42501 (write blocked) or PGRST116 (an
 * RLS-filtered `.single()` matched no row); both mean "not allowed here".
 */
function sharingErrorMessage(err: unknown, fallback: string): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  if (code === "42501" || code === "PGRST116") {
    return "You don't have permission to change sharing for this project.";
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

export interface ShareProjectModalProps {
  project: ProjectWithRelations | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Share dialog for a project: invite team members, copy the
 * private (in-app) link, toggle team-wide visibility, and publish a read-only
 * public link (`/share/<token>`) backed by the `get_shared_project` RPC.
 */
export function ShareProjectModal({
  project,
  open,
  onClose,
}: ShareProjectModalProps) {
  const { message, modal } = AntdApp.useApp();
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
  const { data: activeTeam } = useActiveTeam();
  const { user } = useAuth();
  const updateProject = useUpdateProject();
  const membersQuery = useProjectMembers(project?.id);
  const addMember = useAddProjectMember();
  const removeMember = useRemoveProjectMember();
  const teamMembersQuery = useTeamMembers();

  const [inviteValue, setInviteValue] = useState("");
  const [peopleOpen, setPeopleOpen] = useState(false);

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);

  // Only the project owner or a team admin/owner can change sharing — mirrors
  // the RLS on projects UPDATE (owner/admin) and project_members (admin). When
  // false, the write controls render disabled instead of failing on submit.
  const canManageSharing = useMemo(() => {
    if (!project || !user) return false;
    if (project.owner_id === user.id) return true;
    const me = (teamMembersQuery.data ?? []).find(
      (tm) => tm.user_id === user.id,
    );
    return Boolean(me?.role?.admin_role || me?.role?.owner);
  }, [project, user, teamMembersQuery.data]);

  // Team members with a linked user who aren't already project members.
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

  if (!project) return null;

  const visibility = (project.visibility ?? "team") as
    | "team"
    | "private"
    | "public";
  const isPublic = visibility === "public";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const privateLink = `${origin}/projects/${project.id}`;
  const publicLink = `${origin}/share/${project.share_token}`;

  const setVisibility = async (next: "team" | "private" | "public") => {
    try {
      await updateProject.mutateAsync({ id: project.id, visibility: next });
      message.success(
        next === "public"
          ? "Project is now public — anyone with the link can view it."
          : next === "private"
            ? "Project is now private to its members."
            : "Project is now visible to the whole team.",
      );
    } catch (err) {
      message.error(sharingErrorMessage(err, "Failed to update sharing."));
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${what} copied.`);
    } catch {
      message.error("Could not copy to clipboard.");
    }
  };

  const handleInvite = async (teamMemberId: string) => {
    setInviteValue("");
    try {
      await addMember.mutateAsync({ projectId: project.id, teamMemberId });
      message.success("Member added to project.");
    } catch (err) {
      message.error(sharingErrorMessage(err, "Failed to add member."));
    }
  };

  const handleRemoveMember = async (projectMemberId: string) => {
    try {
      await removeMember.mutateAsync(projectMemberId);
      message.success("Member removed from project.");
    } catch (err) {
      message.error(sharingErrorMessage(err, "Failed to remove member."));
    }
  };

  const handleMakePublic = () => {
    modal.confirm({
      title: "Make this project public?",
      content:
        "Anyone on the internet with the public link will be able to view this project read-only: its name, notes, start/end dates, and its task list with statuses and due dates. You can make it private again at any time.",
      okText: "Make Public",
      onOk: () => setVisibility("public"),
    });
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 40,
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={560}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          style={{ fontSize: 19, fontWeight: 700, color: C.textPrimary }}
        >
          Share this project
        </span>

        {/* Context line: what exactly is being shared. */}
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
          <span>Sharing project with all views</span>
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: project.color_code,
              flex: "none",
            }}
          />
          <span
            style={{
              color: C.textPrimary,
              fontWeight: 600,
              textDecoration: "underline",
              textDecorationColor: C.hairline,
              textUnderlineOffset: 4,
            }}
          >
            {project.name}
          </span>
          {visibility === "private" ? (
            <MIcon name="lock" size={15} color={C.textTertiary} />
          ) : null}
        </div>

        {/* Invite */}
        <AutoComplete
          value={inviteValue}
          onChange={setInviteValue}
          onSelect={(v) => void handleInvite(v as string)}
          options={inviteOptions.map(({ value, label }) => ({ value, label }))}
          filterOption={(input, option) => {
            const opt = inviteOptions.find((o) => o.value === option?.value);
            return Boolean(opt?.searchText.includes(input.toLowerCase()));
          }}
          placeholder="Invite by name or email"
          allowClear
          disabled={!canManageSharing}
          style={{ width: "100%" }}
          size="large"
        />

        {!canManageSharing ? (
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
            Only the project owner and team admins can change sharing.
          </div>
        ) : null}

        {/* Private (in-app) link */}
        <div style={{ ...rowStyle, marginTop: 6 }}>
          <MIcon name="link" size={18} color={C.textPrimary} />
          <span style={{ fontWeight: 600, color: C.textPrimary, fontSize: 14 }}>
            Private link
          </span>
          <Tooltip title="Opens the project in the app — only people with access can view it.">
            <span style={{ display: "inline-flex", cursor: "help" }}>
              <MIcon name="info" size={15} color={C.textTertiary} />
            </span>
          </Tooltip>
          <span style={{ flex: 1 }} />
          <Button onClick={() => void copy(privateLink, "Private link")}>
            Copy link
          </Button>
        </div>

        <div
          style={{
            fontSize: 13,
            color: C.textSecondary,
            marginTop: 8,
          }}
        >
          Share with
        </div>

        {/* Team toggle */}
        <div style={rowStyle}>
          <Avatar
            shape="square"
            size={28}
            style={{
              background: "#a1665e",
              fontSize: 13,
              fontWeight: 600,
              flex: "none",
            }}
          >
            {initials(activeTeam?.name ?? "Team")}
          </Avatar>
          <span style={{ fontSize: 14, color: C.textPrimary, fontWeight: 500 }}>
            {activeTeam?.name ?? "Team"}
          </span>
          <span style={{ flex: 1 }} />
          <Tooltip
            title={
              !canManageSharing
                ? "Only the project owner and team admins can change sharing."
                : isPublic
                  ? "Public projects are always visible to the team. Make the project private first."
                  : visibility === "private"
                    ? "Turn on to let everyone in the team see this project."
                    : "Turn off to restrict this project to its members only."
            }
          >
            <Switch
              checked={visibility !== "private"}
              disabled={!canManageSharing || isPublic || updateProject.isPending}
              onChange={(checked) =>
                void setVisibility(checked ? "team" : "private")
              }
            />
          </Tooltip>
        </div>

        {/* People */}
        <div style={{ ...rowStyle, cursor: "pointer" }}>
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
              People
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
                No members yet — invite someone above.
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
                  <span style={{ fontSize: 12.5, color: C.textTertiary }}>
                    {m.team_member?.user?.email}
                  </span>
                  <span style={{ flex: 1 }} />
                  {canManageSharing ? (
                    <Button
                      type="text"
                      size="small"
                      aria-label="Remove member"
                      onClick={() => void handleRemoveMember(m.id)}
                      icon={
                        <MIcon name="close" size={15} color={C.textTertiary} />
                      }
                    />
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}

        {/* Public link / Make Public */}
        {isPublic ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              background: C.inner,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MIcon name="public" size={17} color={C.accent} />
              <span
                style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary }}
              >
                Public link
              </span>
              <span style={{ fontSize: 12.5, color: C.textSecondary }}>
                anyone with this link can view (read-only)
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                readOnly
                value={publicLink}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 32,
                  padding: "0 10px",
                  borderRadius: 6,
                  border: `1px solid ${C.hairline}`,
                  background: token.colorBgContainer,
                  fontSize: 12.5,
                  color: C.textSecondary,
                }}
              />
              <Button onClick={() => void copy(publicLink, "Public link")}>
                Copy
              </Button>
              <Button
                danger
                disabled={!canManageSharing}
                loading={updateProject.isPending}
                onClick={() => void setVisibility("private")}
              >
                Make Private
              </Button>
            </div>
          </div>
        ) : (
          <Button
            block
            size="large"
            disabled={!canManageSharing}
            style={{ marginTop: 12, background: C.inner, border: "none" }}
            loading={updateProject.isPending}
            onClick={handleMakePublic}
            icon={<MIcon name="lock_open" size={17} />}
          >
            Make Public
          </Button>
        )}
      </div>
    </Modal>
  );
}

export default ShareProjectModal;
