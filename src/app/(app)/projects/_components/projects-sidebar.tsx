"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  App as AntdApp,
  Button,
  Divider,
  Dropdown,
  Input,
  Modal,
  Select,
  Switch,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import {
  BgColorsOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  FolderAddOutlined,
  FolderOutlined,
  InboxOutlined,
  LinkOutlined,
  PlusOutlined,
  ShareAltOutlined,
  SnippetsOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useToggleArchive,
  useToggleFavorite,
  useUpdateProject,
  type ProjectWithRelations,
} from "@/features/projects/use-projects";
import {
  useSaveProjectAsTemplate,
  useProjectTemplates,
  useCreateProjectFromTemplate,
} from "@/features/templates/use-templates";
import { ProjectTemplateBuilderModal } from "@/features/templates/project-template-builder-modal";
import {
  useTeamMembers,
  useIsTeamAdmin,
} from "@/features/team-members/use-team-members";
import { MemberSelect } from "@/features/team-members/member-select";
import { useAddProjectMember } from "@/features/projects/use-project-members";
import { useApplyTemplateViews } from "@/features/projects/use-project-views";
import {
  useProjectFolders,
  useCreateSpace,
  useUpdateFolder,
  useDeleteFolder,
  type ProjectFolder,
} from "@/features/projects/use-project-folders";
import { ShareProjectModal } from "./share-project-modal";
import { ShareSpaceModal } from "./share-space-modal";
import { useNotifications } from "@/features/notifications/use-notifications";
import { useMyTasks } from "@/features/home/use-home";
import { ChatNavSections } from "@/app/(app)/chat/_components/chat-sidebar";

/* -------------------------------------------------------------------------- */
/* Design tokens (canonical handoff).                                         */
/* -------------------------------------------------------------------------- */

function useSidebarTokens() {
  const { token } = theme.useToken();
  return useMemo(
    () => ({
      accent: "#4a4ad0",
      soft: token.colorPrimaryBg,
      panel: token.colorBgContainer,
      sidebar: token.colorBgLayout,
      hairline: token.colorBorderSecondary,
      inner: token.colorSplit,
      textPrimary: token.colorText,
      textSecondary: token.colorTextSecondary,
      textTertiary: token.colorTextTertiary,
      textFaint: token.colorTextQuaternary,
      rowText: token.colorTextSecondary,
      rowHover: token.colorFillTertiary,
      dotFallback: "#8a8d98",
    }),
    [token],
  );
}

const MAX_DEPTH = 6;

/** Material Symbols Rounded glyph. */
function MIcon({
  name,
  size = 18,
  color,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color, ...style }}
    >
      {name}
    </span>
  );
}

/** A small rounded colour swatch (project dot / folder swatch). */
function Swatch({
  color,
  size = 7,
  radius = 999,
}: {
  color: string | null | undefined;
  size?: number;
  radius?: number;
}) {
  const T = useSidebarTokens();
  return (
    <span
      aria-hidden
      style={{
        flex: "none",
        width: size,
        height: size,
        borderRadius: radius,
        background: color || T.dotFallback,
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* A single interactive row (project / all-tasks / folder).                   */
/* -------------------------------------------------------------------------- */

function Row({
  active,
  indent = 0,
  header = false,
  onClick,
  leading,
  label,
  trailing,
  suffix,
  hoverActions,
  forceShowActions = false,
  title,
}: {
  active: boolean;
  indent?: number;
  /** Container rows (spaces) read as headers: heavier weight, darker ink. */
  header?: boolean;
  onClick: () => void;
  leading: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  /** Inline mark right after the label (e.g. the private-project lock). */
  suffix?: React.ReactNode;
  /** Revealed in the trailing slot on hover (e.g. the 3-dot menu). */
  hoverActions?: React.ReactNode;
  /** Keep hoverActions visible (e.g. while their dropdown is open). */
  forceShowActions?: boolean;
  title?: string;
}) {
  const T = useSidebarTokens();
  const [hover, setHover] = useState(false);
  const showActions = hoverActions != null && (hover || forceShowActions);
  const bg = active ? T.soft : hover ? T.rowHover : "transparent";
  const color = active ? T.accent : header ? T.textPrimary : T.rowText;
  return (
    <div
      role="button"
      tabIndex={0}
      title={title ?? label}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 33,
        paddingLeft: 8 + indent * 16,
        paddingRight: 8,
        borderRadius: 7,
        cursor: "pointer",
        background: bg,
        color,
        transition: "background 120ms ease",
      }}
    >
      <span
        style={{ flex: "none", display: "inline-flex", alignItems: "center" }}
      >
        {leading}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            minWidth: 0,
            fontSize: 13,
            fontWeight: header || active ? 600 : 400,
            letterSpacing: header ? 0.1 : undefined,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {suffix != null ? (
          <span style={{ flex: "none", display: "inline-flex" }}>{suffix}</span>
        ) : null}
      </span>
      {showActions ? (
        <span style={{ flex: "none", display: "inline-flex" }}>
          {hoverActions}
        </span>
      ) : trailing != null ? (
        <span style={{ flex: "none", display: "inline-flex" }}>{trailing}</span>
      ) : null}
    </div>
  );
}

/** Uppercase group label (Favorites / Spaces). */
function GroupLabel({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const T = useSidebarTokens();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 10px 4px",
      }}
    >
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: 0.7,
          textTransform: "uppercase",
          color: T.textFaint,
        }}
      >
        {children}
      </span>
      {action}
    </div>
  );
}

/** A muted mono count. */
function Count({ n }: { n: number }) {
  const T = useSidebarTokens();
  return (
    <span
      className="font-mono"
      style={{ fontSize: 11.5, color: T.textFaint }}
    >
      {n}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Project row with hover 3-dot + right-click context menu.                   */
/* -------------------------------------------------------------------------- */

function SidebarProjectRow({
  project,
  indent = 0,
  withGutter = false,
  active,
  onOpen,
  menuItems,
}: {
  project: ProjectWithRelations;
  indent?: number;
  /** Reserve the 18px chevron gutter so labels align with sibling spaces. */
  withGutter?: boolean;
  active: boolean;
  onOpen: () => void;
  menuItems: MenuProps["items"];
}) {
  const T = useSidebarTokens();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={["contextMenu"]}
      onOpenChange={(open, info) => {
        if (info.source === "trigger") setMenuOpen(open);
      }}
    >
      <div>
        <Row
          active={active}
          indent={indent}
          onClick={onOpen}
          label={project.name}
          leading={
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {withGutter ? (
                <span aria-hidden style={{ width: 18, flex: "none" }} />
              ) : null}
              <span
                style={{
                  width: 16,
                  flex: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Swatch color={project.color_code} />
              </span>
            </span>
          }
          suffix={
            project.visibility === "private" ? (
              <MIcon name="lock" size={13} color={T.textFaint} />
            ) : undefined
          }
          forceShowActions={menuOpen}
          hoverActions={
            <Dropdown
              menu={{ items: menuItems }}
              trigger={["click"]}
              placement="bottomLeft"
              onOpenChange={setMenuOpen}
            >
              <button
                type="button"
                aria-label={`Actions for ${project.name}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 22,
                  height: 22,
                  border: "none",
                  background: "transparent",
                  borderRadius: 5,
                  color: T.textSecondary,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <MIcon name="more_horiz" size={16} />
              </button>
            </Dropdown>
          }
        />
      </div>
    </Dropdown>
  );
}

/* -------------------------------------------------------------------------- */
/* Recursive folder (space) node.                                             */
/* -------------------------------------------------------------------------- */

interface FolderNode {
  folder: ProjectFolder;
  children: FolderNode[];
}

function SpaceNode({
  node,
  depth,
  expanded,
  onToggle,
  forceExpanded = false,
  projectsByFolder,
  renderProject,
  spaceMenu,
}: {
  node: FolderNode;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  /** Search mode: show every (pruned) space open, ignoring the accordion. */
  forceExpanded?: boolean;
  projectsByFolder: Map<string, ProjectWithRelations[]>;
  renderProject: (p: ProjectWithRelations, indent: number) => React.ReactNode;
  spaceMenu: (folder: ProjectFolder, depth: number) => MenuProps["items"];
}) {
  const T = useSidebarTokens();
  // Accordion among this node's children: at most one expanded at a time.
  const [expandedChildId, setExpandedChildId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const projects = projectsByFolder.get(node.folder.id) ?? [];
  const childFolders = node.children;
  const count = projects.length;
  const isOpen = forceExpanded || expanded;
  const menuItems = spaceMenu(node.folder, depth);

  return (
    <div>
      <Dropdown
        menu={{ items: menuItems }}
        trigger={["contextMenu"]}
        onOpenChange={(open, info) => {
          if (!open || info.source === "trigger") setMenuOpen(open);
        }}
      >
        <div>
          <Row
            header
            active={false}
            indent={depth}
            onClick={() => {
              // While searching every space is force-expanded; toggling would
              // silently mutate the accordion with no visible effect.
              if (!forceExpanded) onToggle();
            }}
            title={node.folder.name}
            label={node.folder.name}
            suffix={
              node.folder.visibility === "private" ? (
                <MIcon name="lock" size={13} color={T.textFaint} />
              ) : undefined
            }
            leading={
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <MIcon
                  name={isOpen ? "expand_more" : "chevron_right"}
                  size={18}
                  color={T.textTertiary}
                />
                <span
                  style={{
                    width: 16,
                    flex: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MIcon
                    name={isOpen ? "folder_open" : "folder"}
                    size={17}
                    color={node.folder.color_code || T.dotFallback}
                  />
                </span>
              </span>
            }
            trailing={<Count n={count} />}
            forceShowActions={menuOpen}
            hoverActions={
              <Dropdown
                menu={{ items: menuItems }}
                trigger={["click"]}
                placement="bottomLeft"
                onOpenChange={setMenuOpen}
              >
                <button
                  type="button"
                  aria-label={`Actions for ${node.folder.name}`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 22,
                    height: 22,
                    border: "none",
                    background: "transparent",
                    borderRadius: 5,
                    color: T.textSecondary,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MIcon name="more_horiz" size={16} />
                </button>
              </Dropdown>
            }
          />
        </div>
      </Dropdown>
      {isOpen ? (
        <div>
          {childFolders.map((child) =>
            depth + 1 < MAX_DEPTH ? (
              <SpaceNode
                key={child.folder.id}
                node={child}
                depth={depth + 1}
                expanded={expandedChildId === child.folder.id}
                onToggle={() =>
                  setExpandedChildId((id) =>
                    id === child.folder.id ? null : child.folder.id,
                  )
                }
                forceExpanded={forceExpanded}
                projectsByFolder={projectsByFolder}
                renderProject={renderProject}
                spaceMenu={spaceMenu}
              />
            ) : null,
          )}
          {projects.map((p) => renderProject(p, depth + 1))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Search pruning.                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Prunes the space tree to nodes whose own name matches, or that contain a
 * matching descendant space/project. When a space (or an ancestor) matches by
 * name, all of its projects stay visible; otherwise only matching projects do.
 */
function pruneTree(
  roots: FolderNode[],
  projectsByFolder: Map<string, ProjectWithRelations[]>,
  q: string,
): { roots: FolderNode[]; byFolder: Map<string, ProjectWithRelations[]> } {
  const byFolder = new Map<string, ProjectWithRelations[]>();

  const prune = (node: FolderNode, ancestorHit: boolean): FolderNode | null => {
    const hit =
      ancestorHit || node.folder.name.toLowerCase().includes(q);
    const children = node.children
      .map((c) => prune(c, hit))
      .filter((c): c is FolderNode => c !== null);
    const all = projectsByFolder.get(node.folder.id) ?? [];
    const projects = hit
      ? all
      : all.filter((p) => p.name.toLowerCase().includes(q));
    if (!hit && children.length === 0 && projects.length === 0) return null;
    byFolder.set(node.folder.id, projects);
    return { folder: node.folder, children };
  };

  return {
    roots: roots
      .map((r) => prune(r, false))
      .filter((r): r is FolderNode => r !== null),
    byFolder,
  };
}

/* -------------------------------------------------------------------------- */
/* New-space modal.                                                            */
/* -------------------------------------------------------------------------- */

function NewSpaceModal({
  open,
  parent = null,
  onClose,
}: {
  open: boolean;
  /** When set, the new space is created nested inside this space. */
  parent?: ProjectFolder | null;
  onClose: () => void;
}) {
  const T = useSidebarTokens();
  const { message } = AntdApp.useApp();
  const createSpace = useCreateSpace();
  const { data: teamMembers } = useTeamMembers();
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [shareWith, setShareWith] = useState<string[]>([]);
  const [wasOpen, setWasOpen] = useState(false);

  // Reset the form each time the modal opens.
  if (open && !wasOpen) {
    setWasOpen(true);
    setName("");
    setIsPrivate(false);
    setShareWith([]);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || createSpace.isPending) return;
    try {
      await createSpace.mutateAsync({
        name: trimmed,
        visibility: isPrivate ? "private" : "team",
        ...(parent ? { parentFolderId: parent.id } : {}),
        ...(isPrivate && shareWith.length ? { memberIds: shareWith } : {}),
      });
      onClose();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to create space.",
      );
    }
  };

  return (
    <Modal
      title={parent ? `New sub-space in “${parent.name}”` : "New space"}
      open={open}
      onOk={submit}
      okText="Create"
      confirmLoading={createSpace.isPending}
      okButtonProps={{ disabled: !name.trim() }}
      onCancel={onClose}
      destroyOnHidden
      width={480}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Input
          autoFocus
          placeholder="Space name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={submit}
          maxLength={100}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Make private</div>
            <div style={{ fontSize: 12, color: T.textTertiary }}>
              Only its members, the creator, and admins can access it. Shared
              spaces are visible to the whole workspace.
            </div>
          </div>
          <Switch checked={isPrivate} onChange={setIsPrivate} />
        </div>

        {isPrivate ? (
          <div>
            <div
              style={{ fontSize: 12.5, color: T.textSecondary, marginBottom: 6 }}
            >
              Share with{" "}
              <span style={{ color: T.textTertiary }}>
                (you always have access)
              </span>
            </div>
            <MemberSelect
              value={shareWith}
              onChange={setShareWith}
              placeholder="Add team members…"
              options={(teamMembers ?? [])
                .filter((m) => m.user)
                .map((m) => ({
                  value: m.id,
                  label: m.user!.name,
                  avatarUrl: m.user!.avatar_url,
                  email: m.user!.email,
                }))}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Color picker (shared by the edit-space / edit-project modals).             */
/* -------------------------------------------------------------------------- */

/** Curated swatches; every value is a 6-digit hex, valid for `color_code`. */
const COLOR_SWATCHES = [
  "#4a4ad0",
  "#7c6cf0",
  "#b46ff0",
  "#e0559b",
  "#e0556a",
  "#f0883e",
  "#e0a93e",
  "#3fb95a",
  "#2bb3a3",
  "#3f8ff0",
  "#6a6d78",
  "#8a5a44",
] as const;

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const T = useSidebarTokens();
  const current = value.toLowerCase();
  const isPreset = COLOR_SWATCHES.some((c) => c === current);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      {COLOR_SWATCHES.map((c) => {
        const selected = c === current;
        return (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            aria-pressed={selected}
            onClick={() => onChange(c)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              background: c,
              border: "none",
              cursor: "pointer",
              padding: 0,
              boxShadow: selected
                ? `0 0 0 2px ${T.panel}, 0 0 0 4px ${c}`
                : "none",
            }}
          />
        );
      })}
      {/* Custom color (native picker); ringed when the value is off-palette. */}
      <label
        title="Custom color"
        aria-label="Custom color"
        style={{
          position: "relative",
          width: 24,
          height: 24,
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          background: isPreset ? T.inner : current,
          border: `1px solid ${T.hairline}`,
          boxShadow: isPreset
            ? "none"
            : `0 0 0 2px ${T.panel}, 0 0 0 4px ${current}`,
        }}
      >
        {isPreset ? (
          <MIcon name="colorize" size={14} color={T.textSecondary} />
        ) : null}
        <input
          type="color"
          value={HEX6_RE.test(value) ? value : "#4a4ad0"}
          onChange={(e) => onChange(e.target.value)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            cursor: "pointer",
            border: "none",
            padding: 0,
          }}
        />
      </label>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Edit-space modal (name + color).                                           */
/* -------------------------------------------------------------------------- */

function EditSpaceModal({
  folder,
  onClose,
}: {
  folder: ProjectFolder | null;
  onClose: () => void;
}) {
  const T = useSidebarTokens();
  const { message } = AntdApp.useApp();
  const updateFolder = useUpdateFolder();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(T.accent);
  const [seededId, setSeededId] = useState<string | null>(null);

  // Seed inputs from the folder on open (render-time derived-state reset).
  if (folder && folder.id !== seededId) {
    setSeededId(folder.id);
    setName(folder.name);
    setColor(folder.color_code || T.accent);
  }

  const submit = async () => {
    const trimmed = name.trim();
    if (!folder || !trimmed || updateFolder.isPending) return;
    try {
      await updateFolder.mutateAsync({
        id: folder.id,
        name: trimmed,
        colorCode: color,
      });
      setSeededId(null);
      onClose();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update space.",
      );
    }
  };

  return (
    <Modal
      title="Edit space"
      open={folder !== null}
      onOk={submit}
      okText="Save"
      confirmLoading={updateFolder.isPending}
      okButtonProps={{ disabled: !name.trim() }}
      onCancel={() => {
        setSeededId(null);
        onClose();
      }}
      destroyOnHidden
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <MIcon name="folder" size={20} color={color || T.dotFallback} />
          <Input
            autoFocus
            placeholder="Space name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={submit}
            maxLength={100}
          />
        </div>
        <div>
          <div
            style={{ fontSize: 12.5, color: T.textSecondary, marginBottom: 10 }}
          >
            Color
          </div>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* New-project-in-space modal.                                                */
/* -------------------------------------------------------------------------- */

function NewProjectInSpaceModal({
  folder,
  onClose,
  onCreated,
}: {
  folder: ProjectFolder | null;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const T = useSidebarTokens();
  const { message } = AntdApp.useApp();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const createFromTemplate = useCreateProjectFromTemplate();
  const applyTemplateViews = useApplyTemplateViews();
  const addMember = useAddProjectMember();
  const { data: projectTemplates } = useProjectTemplates();
  const { data: teamMembers } = useTeamMembers();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(T.accent);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [isPrivate, setIsPrivate] = useState(false);
  const [shareWith, setShareWith] = useState<string[]>([]);
  const [templateBuilderOpen, setTemplateBuilderOpen] = useState(false);
  const [seededId, setSeededId] = useState<string | null>(null);
  const pending =
    createProject.isPending ||
    updateProject.isPending ||
    createFromTemplate.isPending;

  // Reset the form each time a new target space opens.
  if (folder && folder.id !== seededId) {
    setSeededId(folder.id);
    setName("");
    setDescription("");
    setColor(T.accent);
    setTemplateId(undefined);
    setIsPrivate(false);
    setShareWith([]);
  }

  const submit = async () => {
    const trimmed = name.trim();
    if (!folder || !trimmed || pending) return;
    try {
      const id = templateId
        ? await createFromTemplate.mutateAsync({ templateId, name: trimmed })
        : await createProject.mutateAsync({ name: trimmed, colorCode: color });
      // Apply the space, color, description, and visibility in one update.
      await updateProject.mutateAsync({
        id,
        folder_id: folder.id,
        color_code: color,
        notes: description.trim() || null,
        visibility: isPrivate ? "private" : "team",
      });
      // Apply the template's default views (if it specifies any).
      if (templateId) {
        const tpl = (projectTemplates ?? []).find((t) => t.id === templateId);
        const views = (tpl?.template as { views?: string[] } | null)?.views;
        if (Array.isArray(views) && views.length > 0) {
          await applyTemplateViews.mutateAsync({ projectId: id, viewKeys: views });
        }
      }
      // Grant access to the chosen members for a private project.
      if (isPrivate && shareWith.length) {
        for (const teamMemberId of shareWith) {
          try {
            await addMember.mutateAsync({ projectId: id, teamMemberId });
          } catch {
            // Already a member (e.g. the creator) — ignore.
          }
        }
      }
      setSeededId(null);
      onClose();
      onCreated(id);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to create project.",
      );
    }
  };

  return (
    <Modal
      title={folder ? `New project in “${folder.name}”` : "New project"}
      open={folder !== null}
      onOk={submit}
      okText="Create project"
      confirmLoading={pending}
      okButtonProps={{ disabled: !name.trim() }}
      onCancel={() => {
        setSeededId(null);
        onClose();
      }}
      destroyOnHidden
      width={520}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Swatch color={color} size={12} />
          <Input
            autoFocus
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={submit}
            maxLength={100}
          />
        </div>

        <div>
          <div style={{ fontSize: 12.5, color: T.textSecondary, marginBottom: 6 }}>
            Description{" "}
            <span style={{ color: T.textTertiary }}>(optional)</span>
          </div>
          <Input.TextArea
            placeholder="What is this project about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
            maxLength={500}
          />
        </div>

        <div>
          <div style={{ fontSize: 12.5, color: T.textSecondary, marginBottom: 8 }}>
            Color
          </div>
          <ColorPicker value={color} onChange={setColor} />
        </div>

        <div>
          <div style={{ fontSize: 12.5, color: T.textSecondary, marginBottom: 6 }}>
            Start from template{" "}
            <span style={{ color: T.textTertiary }}>(optional)</span>
          </div>
          <Select
            style={{ width: "100%" }}
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Blank project"
            value={templateId}
            onChange={setTemplateId}
            options={(projectTemplates ?? []).map((t) => ({
              value: t.id,
              label: t.name,
            }))}
            popupRender={(menu) => (
              <>
                {menu}
                <Divider style={{ margin: "4px 0" }} />
                <Button
                  type="text"
                  icon={<PlusOutlined />}
                  block
                  style={{ textAlign: "left" }}
                  // Keep the Select from stealing focus/selecting on mousedown
                  // so the click opens the builder cleanly.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setTemplateBuilderOpen(true)}
                >
                  Create new template…
                </Button>
              </>
            )}
          />
        </div>

        <ProjectTemplateBuilderModal
          open={templateBuilderOpen}
          onClose={() => setTemplateBuilderOpen(false)}
          onCreated={(tpl) => {
            // Auto-select the freshly created template. The templates query is
            // invalidated on create, so the option list refreshes to include it.
            setTemplateId(tpl.id);
            setTemplateBuilderOpen(false);
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Make private</div>
            <div style={{ fontSize: 12, color: T.textTertiary }}>
              Only its members, the owner, and admins can access it.
            </div>
          </div>
          <Switch checked={isPrivate} onChange={setIsPrivate} />
        </div>

        {isPrivate ? (
          <div>
            <div
              style={{ fontSize: 12.5, color: T.textSecondary, marginBottom: 6 }}
            >
              Share with{" "}
              <span style={{ color: T.textTertiary }}>
                (you always have access)
              </span>
            </div>
            <MemberSelect
              value={shareWith}
              onChange={setShareWith}
              placeholder="Add team members…"
              options={(teamMembers ?? [])
                .filter((m) => m.user)
                .map((m) => ({
                  value: m.id,
                  label: m.user!.name,
                  avatarUrl: m.user!.avatar_url,
                  email: m.user!.email,
                }))}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Edit-project modal (name + color).                                         */
/* -------------------------------------------------------------------------- */

function EditProjectModal({
  project,
  onClose,
}: {
  project: ProjectWithRelations | null;
  onClose: () => void;
}) {
  const T = useSidebarTokens();
  const { message } = AntdApp.useApp();
  const updateProject = useUpdateProject();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(T.accent);
  const [seededId, setSeededId] = useState<string | null>(null);

  // Seed inputs from the project on open (render-time derived-state reset).
  if (project && project.id !== seededId) {
    setSeededId(project.id);
    setName(project.name);
    setColor(project.color_code || T.accent);
  }

  const submit = async () => {
    const trimmed = name.trim();
    if (!project || !trimmed || updateProject.isPending) return;
    try {
      await updateProject.mutateAsync({
        id: project.id,
        name: trimmed,
        color_code: color,
      });
      setSeededId(null);
      onClose();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update project.",
      );
    }
  };

  return (
    <Modal
      title="Edit project"
      open={project !== null}
      onOk={submit}
      okText="Save"
      confirmLoading={updateProject.isPending}
      okButtonProps={{ disabled: !name.trim() }}
      onCancel={() => {
        setSeededId(null);
        onClose();
      }}
      destroyOnHidden
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Swatch color={color} size={12} />
          <Input
            autoFocus
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={submit}
            maxLength={100}
          />
        </div>
        <div>
          <div
            style={{ fontSize: 12.5, color: T.textSecondary, marginBottom: 10 }}
          >
            Color
          </div>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Rename modals (quick name-only edit; the Customize modals also change color) */
/* -------------------------------------------------------------------------- */

function SaveProjectTemplateModal({
  project,
  onClose,
}: {
  project: ProjectWithRelations | null;
  onClose: () => void;
}) {
  const T = useSidebarTokens();
  const { message } = AntdApp.useApp();
  const saveAsTemplate = useSaveProjectAsTemplate();
  const [name, setName] = useState("");
  const [seededId, setSeededId] = useState<string | null>(null);

  if (project && project.id !== seededId) {
    setSeededId(project.id);
    setName(`${project.name} template`);
  }

  const submit = async () => {
    const trimmed = name.trim();
    if (!project || !trimmed || saveAsTemplate.isPending) return;
    try {
      await saveAsTemplate.mutateAsync({ projectId: project.id, name: trimmed });
      setSeededId(null);
      message.success(
        "Saved as a project template — find it in Settings → Templates.",
      );
      onClose();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to save template.",
      );
    }
  };

  return (
    <Modal
      title="Save project as template"
      open={project !== null}
      onOk={submit}
      okText="Save template"
      confirmLoading={saveAsTemplate.isPending}
      okButtonProps={{ disabled: !name.trim() }}
      onCancel={() => {
        setSeededId(null);
        onClose();
      }}
      destroyOnHidden
    >
      <div style={{ fontSize: 12.5, color: T.textSecondary, marginBottom: 10 }}>
        Captures this project&apos;s phases, statuses, and top-level tasks into a
        reusable project template you can start new projects from.
      </div>
      <Input
        autoFocus
        placeholder="Template name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={submit}
        maxLength={200}
      />
    </Modal>
  );
}

function RenameProjectModal({
  project,
  onClose,
}: {
  project: ProjectWithRelations | null;
  onClose: () => void;
}) {
  const { message } = AntdApp.useApp();
  const updateProject = useUpdateProject();
  const [name, setName] = useState("");
  const [seededId, setSeededId] = useState<string | null>(null);

  if (project && project.id !== seededId) {
    setSeededId(project.id);
    setName(project.name);
  }

  const submit = async () => {
    const trimmed = name.trim();
    if (!project || !trimmed || updateProject.isPending) return;
    try {
      await updateProject.mutateAsync({ id: project.id, name: trimmed });
      setSeededId(null);
      onClose();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to rename project.",
      );
    }
  };

  return (
    <Modal
      title="Rename project"
      open={project !== null}
      onOk={submit}
      okText="Rename"
      confirmLoading={updateProject.isPending}
      okButtonProps={{ disabled: !name.trim() }}
      onCancel={() => {
        setSeededId(null);
        onClose();
      }}
      destroyOnHidden
    >
      <Input
        autoFocus
        placeholder="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={submit}
        maxLength={100}
      />
    </Modal>
  );
}

function RenameSpaceModal({
  folder,
  onClose,
}: {
  folder: ProjectFolder | null;
  onClose: () => void;
}) {
  const { message } = AntdApp.useApp();
  const updateFolder = useUpdateFolder();
  const [name, setName] = useState("");
  const [seededId, setSeededId] = useState<string | null>(null);

  if (folder && folder.id !== seededId) {
    setSeededId(folder.id);
    setName(folder.name);
  }

  const submit = async () => {
    const trimmed = name.trim();
    if (!folder || !trimmed || updateFolder.isPending) return;
    try {
      await updateFolder.mutateAsync({ id: folder.id, name: trimmed });
      setSeededId(null);
      onClose();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to rename space.",
      );
    }
  };

  return (
    <Modal
      title="Rename space"
      open={folder !== null}
      onOk={submit}
      okText="Rename"
      confirmLoading={updateFolder.isPending}
      okButtonProps={{ disabled: !name.trim() }}
      onCancel={() => {
        setSeededId(null);
        onClose();
      }}
      destroyOnHidden
    >
      <Input
        autoFocus
        placeholder="Space name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={submit}
        maxLength={100}
      />
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton rows.                                                             */
/* -------------------------------------------------------------------------- */

function SkeletonRows() {
  const T = useSidebarTokens();
  return (
    <div style={{ padding: "4px 2px" }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 33,
            paddingInline: 8,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 3,
              background: T.inner,
              flex: "none",
            }}
          />
          <span
            style={{
              flex: 1,
              height: 9,
              borderRadius: 5,
              background: T.inner,
              maxWidth: 40 + ((i * 37) % 110),
            }}
          />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The sidebar.                                                               */
/* -------------------------------------------------------------------------- */

/** Small count pill for the Home nav (red = attention, grey = plain count). */
function CountPill({ count, tone }: { count: number; tone: "red" | "grey" }) {
  const T = useSidebarTokens();
  if (count <= 0) return null;
  return (
    <span
      style={{
        minWidth: 18,
        height: 16,
        padding: "0 5px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
        fontSize: 10.5,
        fontWeight: 600,
        color: tone === "red" ? "#fff" : T.textSecondary,
        background: tone === "red" ? "#e5484d" : T.soft,
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Home shortcuts (Inbox / Assigned Comments / My Tasks)
 * shown under the Home row. Badges: unread notifications (split by type) and
 * the open-task count.
 */
function HomeNavItems({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
}) {
  const T = useSidebarTokens();
  const { data: notif } = useNotifications();
  const { data: myTasks } = useMyTasks();

  const unread = notif?.items.filter((n) => !n.read) ?? [];
  const unreadMentions = unread.filter((n) => n.type === "mention").length;

  const items = [
    {
      path: "/home/inbox",
      label: "Inbox",
      icon: "inbox",
      badge: <CountPill count={notif?.unreadCount ?? 0} tone="red" />,
    },
    {
      path: "/home/assigned",
      label: "Assigned Comments",
      icon: "alternate_email",
      badge: <CountPill count={unreadMentions} tone="grey" />,
    },
    {
      path: "/home/my-tasks",
      label: "My Tasks",
      icon: "task_alt",
      badge: <CountPill count={(myTasks ?? []).length} tone="grey" />,
    },
  ];

  return (
    <>
      {items.map((item) => {
        const active = pathname === item.path;
        return (
          <Row
            key={item.path}
            active={active}
            indent={1}
            onClick={() => onNavigate(item.path)}
            label={item.label}
            leading={
              <MIcon
                name={item.icon}
                size={17}
                color={active ? T.accent : T.textSecondary}
              />
            }
            trailing={item.badge}
          />
        );
      })}
    </>
  );
}

export function ProjectsSidebar() {
  const T = useSidebarTokens();
  const router = useRouter();
  const pathname = usePathname();
  const { message, modal } = AntdApp.useApp();

  const isTeamAdmin = useIsTeamAdmin();
  const projectsQuery = useProjects();
  const foldersQuery = useProjectFolders();
  const toggleFavorite = useToggleFavorite();
  const toggleArchive = useToggleArchive();
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();
  const deleteFolder = useDeleteFolder();

  // null = closed; parentId = null creates a top-level space.
  const [spaceModal, setSpaceModal] = useState<{
    parentId: string | null;
  } | null>(null);
  // Accordion among top-level spaces: at most one expanded at a time.
  const [expandedSpaceId, setExpandedSpaceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [shareTargetId, setShareTargetId] = useState<string | null>(null);
  const [saveTemplateId, setSaveTemplateId] = useState<string | null>(null);
  const [renameSpaceId, setRenameSpaceId] = useState<string | null>(null);
  const [editSpaceId, setEditSpaceId] = useState<string | null>(null);
  const [shareSpaceId, setShareSpaceId] = useState<string | null>(null);
  const [newProjectSpaceId, setNewProjectSpaceId] = useState<string | null>(
    null,
  );

  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);

  const activeProjectId = useMemo(() => {
    const m = pathname.match(/^\/projects\/([^/]+)/);
    if (!m) return null;
    const seg = m[1];
    return seg === "all-tasks" ? null : seg;
  }, [pathname]);

  const allTasksActive = pathname.startsWith("/projects/all-tasks");

  const favorites = useMemo(
    () => projects.filter((p) => p.is_favorite),
    [projects],
  );

  // Projects grouped by folder_id (folder_id === null => "No space").
  const { projectsByFolder, noSpaceProjects } = useMemo(() => {
    const byFolder = new Map<string, ProjectWithRelations[]>();
    const noSpace: ProjectWithRelations[] = [];
    for (const p of projects) {
      if (p.folder_id) {
        const arr = byFolder.get(p.folder_id) ?? [];
        arr.push(p);
        byFolder.set(p.folder_id, arr);
      } else {
        noSpace.push(p);
      }
    }
    return { projectsByFolder: byFolder, noSpaceProjects: noSpace };
  }, [projects]);

  // Folder tree: top-level = parent_folder_id null; children nested recursively.
  const roots = useMemo(() => {
    const nodeById = new Map<string, FolderNode>();
    for (const f of folders) {
      nodeById.set(f.id, { folder: f, children: [] });
    }
    const topLevel: FolderNode[] = [];
    for (const f of folders) {
      const node = nodeById.get(f.id)!;
      const parentId = f.parent_folder_id;
      if (parentId && nodeById.has(parentId)) {
        nodeById.get(parentId)!.children.push(node);
      } else {
        topLevel.push(node);
      }
    }
    return topLevel;
  }, [folders]);

  // Search: prune the tree and flat lists to matches.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const { visibleRoots, visibleByFolder } = useMemo(() => {
    if (!searching) {
      return { visibleRoots: roots, visibleByFolder: projectsByFolder };
    }
    const pruned = pruneTree(roots, projectsByFolder, q);
    return { visibleRoots: pruned.roots, visibleByFolder: pruned.byFolder };
  }, [searching, roots, projectsByFolder, q]);

  const visibleFavorites = useMemo(
    () =>
      searching
        ? favorites.filter((p) => p.name.toLowerCase().includes(q))
        : favorites,
    [searching, favorites, q],
  );
  const visibleNoSpace = useMemo(
    () =>
      searching
        ? noSpaceProjects.filter((p) => p.name.toLowerCase().includes(q))
        : noSpaceProjects,
    [searching, noSpaceProjects, q],
  );

  const noSearchResults =
    searching &&
    visibleRoots.length === 0 &&
    visibleFavorites.length === 0 &&
    visibleNoSpace.length === 0;

  const openProject = (id: string) => router.push(`/projects/${id}`);

  const renameProject = useMemo(
    () => projects.find((p) => p.id === renameProjectId) ?? null,
    [projects, renameProjectId],
  );
  const editProject = useMemo(
    () => projects.find((p) => p.id === editProjectId) ?? null,
    [projects, editProjectId],
  );
  const shareTarget = useMemo(
    () => projects.find((p) => p.id === shareTargetId) ?? null,
    [projects, shareTargetId],
  );
  const saveTemplateTarget = useMemo(
    () => projects.find((p) => p.id === saveTemplateId) ?? null,
    [projects, saveTemplateId],
  );
  const spaceModalParent = useMemo(
    () =>
      spaceModal?.parentId
        ? (folders.find((f) => f.id === spaceModal.parentId) ?? null)
        : null,
    [folders, spaceModal],
  );
  const renameSpace = useMemo(
    () => folders.find((f) => f.id === renameSpaceId) ?? null,
    [folders, renameSpaceId],
  );
  const editSpace = useMemo(
    () => folders.find((f) => f.id === editSpaceId) ?? null,
    [folders, editSpaceId],
  );
  const shareSpace = useMemo(
    () => folders.find((f) => f.id === shareSpaceId) ?? null,
    [folders, shareSpaceId],
  );
  const newProjectSpace = useMemo(
    () => folders.find((f) => f.id === newProjectSpaceId) ?? null,
    [folders, newProjectSpaceId],
  );

  const copyProjectLink = async (p: ProjectWithRelations) => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/projects/${p.id}`,
      );
      message.success("Link copied.");
    } catch {
      message.error("Could not copy to clipboard.");
    }
  };

  const handleToggleFavorite = async (p: ProjectWithRelations) => {
    try {
      await toggleFavorite.mutateAsync({
        projectId: p.id,
        favorite: !p.is_favorite,
      });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update favorite.",
      );
    }
  };

  const handleToggleArchive = async (p: ProjectWithRelations) => {
    try {
      await toggleArchive.mutateAsync({
        projectId: p.id,
        archived: !p.is_archived,
      });
      message.success(p.is_archived ? "Project unarchived." : "Project archived.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update project.",
      );
    }
  };

  const handleMove = async (p: ProjectWithRelations, folderId: string | null) => {
    try {
      await updateProject.mutateAsync({ id: p.id, folder_id: folderId });
      message.success(folderId ? "Project moved." : "Project moved out of spaces.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to move project.",
      );
    }
  };

  const handleDelete = (p: ProjectWithRelations) => {
    modal.confirm({
      title: `Delete "${p.name}"?`,
      content: "This permanently deletes the project and its data.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProject.mutateAsync(p.id);
          message.success("Project deleted.");
          // Don't leave the app parked on the now-dead detail route.
          if (activeProjectId === p.id) router.push("/projects");
        } catch (err) {
          message.error(
            err instanceof Error ? err.message : "Failed to delete project.",
          );
        }
      },
    });
  };

  const handleDeleteSpace = (folder: ProjectFolder) => {
    modal.confirm({
      title: `Delete space "${folder.name}"?`,
      content:
        "Projects inside move to “No space” and sub-spaces move to the top level. The projects themselves are not deleted.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteFolder.mutateAsync(folder.id);
          message.success("Space deleted.");
        } catch (err) {
          message.error(
            err instanceof Error ? err.message : "Failed to delete space.",
          );
        }
      },
    });
  };

  const buildSpaceMenu = (
    folder: ProjectFolder,
    depth: number,
  ): MenuProps["items"] => [
    {
      key: "new-project",
      icon: <PlusOutlined />,
      label: "New project…",
      onClick: () => setNewProjectSpaceId(folder.id),
    },
    // Space structure & privacy is admin-managed (create_space / RLS gate it);
    // members only get the project affordance above.
    ...(isTeamAdmin
      ? ([
          ...(depth + 1 < MAX_DEPTH
            ? [
                {
                  key: "new-subspace",
                  icon: <FolderAddOutlined />,
                  label: "New sub-space…",
                  onClick: () => setSpaceModal({ parentId: folder.id }),
                },
              ]
            : []),
          {
            key: "share-space",
            icon: <ShareAltOutlined />,
            label: "Share & privacy…",
            onClick: () => setShareSpaceId(folder.id),
          },
          {
            key: "rename-space",
            icon: <EditOutlined />,
            label: "Rename…",
            onClick: () => setRenameSpaceId(folder.id),
          },
          {
            key: "customize-space",
            icon: <BgColorsOutlined />,
            label: "Customize…",
            onClick: () => setEditSpaceId(folder.id),
          },
          { type: "divider" as const },
          {
            key: "delete-space",
            icon: <DeleteOutlined />,
            label: "Delete",
            danger: true,
            onClick: () => handleDeleteSpace(folder),
          },
        ] satisfies MenuProps["items"])
      : []),
  ];

  // Flattened folder list (with depth) for the "Move to space" submenu.
  const flatFolders = useMemo(() => {
    const out: Array<{ folder: ProjectFolder; depth: number }> = [];
    const walk = (nodes: FolderNode[], depth: number) => {
      for (const n of nodes) {
        out.push({ folder: n.folder, depth });
        walk(n.children, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [roots]);

  const buildProjectMenu = (p: ProjectWithRelations): MenuProps["items"] => [
    {
      key: "open",
      icon: <ExportOutlined />,
      label: "Open",
      onClick: () => openProject(p.id),
    },
    {
      key: "favorite",
      icon: p.is_favorite ? <StarFilled /> : <StarOutlined />,
      label: p.is_favorite ? "Remove from favorites" : "Add to favorites",
      onClick: () => void handleToggleFavorite(p),
    },
    {
      key: "rename",
      icon: <EditOutlined />,
      label: "Rename…",
      onClick: () => setRenameProjectId(p.id),
    },
    {
      key: "customize",
      icon: <BgColorsOutlined />,
      label: "Customize…",
      onClick: () => setEditProjectId(p.id),
    },
    {
      key: "move",
      icon: <FolderOutlined />,
      label: "Move to space",
      children: [
        ...flatFolders.map(({ folder, depth }) => ({
          key: `mv:${folder.id}`,
          label: `${" ".repeat(depth)}${folder.name}`,
          disabled: p.folder_id === folder.id,
          onClick: () => void handleMove(p, folder.id),
        })),
        { type: "divider" as const },
        {
          key: "mv:none",
          label: "No space",
          disabled: !p.folder_id,
          onClick: () => void handleMove(p, null),
        },
      ],
    },
    { type: "divider" },
    {
      key: "share",
      icon: <ShareAltOutlined />,
      label: "Share…",
      onClick: () => setShareTargetId(p.id),
    },
    {
      key: "copy-link",
      icon: <LinkOutlined />,
      label: "Copy link",
      onClick: () => void copyProjectLink(p),
    },
    {
      key: "save-template",
      icon: <SnippetsOutlined />,
      label: "Save as template…",
      onClick: () => setSaveTemplateId(p.id),
    },
    { type: "divider" },
    {
      key: "archive",
      icon: p.is_archived ? <ExportOutlined /> : <InboxOutlined />,
      label: p.is_archived ? "Unarchive" : "Archive",
      onClick: () => void handleToggleArchive(p),
    },
    {
      key: "delete",
      icon: <DeleteOutlined />,
      label: "Delete",
      danger: true,
      onClick: () => handleDelete(p),
    },
  ];

  const renderProject = (
    p: ProjectWithRelations,
    indent: number,
    withGutter = true,
  ) => (
    <SidebarProjectRow
      key={p.id}
      project={p}
      indent={indent}
      withGutter={withGutter}
      active={activeProjectId === p.id}
      onOpen={() => openProject(p.id)}
      menuItems={buildProjectMenu(p)}
    />
  );

  const addMenu: MenuProps["items"] = [
    {
      key: "new-project",
      label: "New project",
      icon: <MIcon name="add_box" size={16} />,
      onClick: () => router.push("/projects"),
    },
    // Spaces are the workspace's top-level structure — admin-managed.
    ...(isTeamAdmin
      ? [
          {
            key: "new-space",
            label: "New space",
            icon: <MIcon name="create_new_folder" size={16} />,
            onClick: () => setSpaceModal({ parentId: null }),
          },
        ]
      : []),
  ];

  const isLoading = projectsQuery.isLoading || foldersQuery.isLoading;
  const isEmpty =
    !isLoading && projects.length === 0 && folders.length === 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: T.sidebar,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 52,
          padding: "0 12px 0 16px",
          borderBottom: `1px solid ${T.hairline}`,
          flex: "none",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: T.textSecondary, display: "flex" }}>
            <MIcon name="home" size={20} />
          </span>
          <span
            style={{ fontSize: 15, fontWeight: 600, color: T.textPrimary }}
          >
            Home
          </span>
        </span>
        <Dropdown
          menu={{ items: addMenu }}
          trigger={["click"]}
          placement="bottomRight"
        >
          <button
            type="button"
            aria-label="Add project or space"
            style={{
              width: 28,
              height: 28,
              border: "none",
              background: "transparent",
              borderRadius: 7,
              color: T.textSecondary,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = T.rowHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <MIcon name="add" size={20} />
          </button>
        </Dropdown>
      </div>

      {/* Scrollable tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px 16px" }}>
        {/* Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 8px",
            borderRadius: 7,
            background: T.inner,
            margin: "2px 0 8px",
          }}
        >
          <MIcon name="search" size={16} color={T.textTertiary} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects and spaces"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 13,
              color: T.textPrimary,
            }}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <MIcon name="close" size={14} color={T.textTertiary} />
            </button>
          ) : null}
        </div>

        {/* Home (workspace dashboard) — always visible */}
        <Row
          active={pathname === "/home"}
          onClick={() => router.push("/home")}
          label="Home"
          leading={
            <MIcon
              name="home"
              size={18}
              color={pathname === "/home" ? T.accent : T.textSecondary}
            />
          }
        />
        <HomeNavItems pathname={pathname} onNavigate={(p) => router.push(p)} />
        <div style={{ height: 6 }} />
        {isLoading ? (
          <SkeletonRows />
        ) : isEmpty ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              padding: "40px 16px",
              color: T.textTertiary,
              textAlign: "center",
            }}
          >
            <MIcon name="layers" size={26} color={T.textFaint} />
            <span style={{ fontSize: 13 }}>No projects yet</span>
          </div>
        ) : noSearchResults ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              padding: "40px 16px",
              color: T.textTertiary,
              textAlign: "center",
            }}
          >
            <MIcon name="search_off" size={26} color={T.textFaint} />
            <span style={{ fontSize: 13 }}>No matches for “{query.trim()}”</span>
          </div>
        ) : (
          <>
            {/* Favorites */}
            {visibleFavorites.length > 0 ? (
              <div>
                <GroupLabel>Favorites</GroupLabel>
                {visibleFavorites.map((p) => renderProject(p, 0, false))}
              </div>
            ) : null}

            {/* All Tasks */}
            <div style={{ marginTop: visibleFavorites.length > 0 ? 8 : 2 }}>
              <Row
                active={allTasksActive}
                onClick={() => router.push("/projects/all-tasks")}
                label="All Tasks"
                leading={
                  <MIcon
                    name="checklist"
                    size={18}
                    color={allTasksActive ? T.accent : T.textSecondary}
                  />
                }
              />
            </div>

            {/* Spaces */}
            {visibleRoots.length > 0 || !searching ? (
              <GroupLabel
                action={
                  isTeamAdmin ? (
                    <button
                      type="button"
                      aria-label="New space"
                      onClick={() => setSpaceModal({ parentId: null })}
                      style={{
                        width: 20,
                        height: 20,
                        border: "none",
                        background: "transparent",
                        borderRadius: 5,
                        color: T.textFaint,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = T.rowHover;
                        e.currentTarget.style.color = T.textSecondary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = T.textFaint;
                      }}
                    >
                      <MIcon name="add" size={16} />
                    </button>
                  ) : undefined
                }
              >
                Spaces
              </GroupLabel>
            ) : null}

            {visibleRoots.map((node) => (
              <SpaceNode
                key={node.folder.id}
                node={node}
                depth={0}
                expanded={expandedSpaceId === node.folder.id}
                onToggle={() =>
                  setExpandedSpaceId((id) =>
                    id === node.folder.id ? null : node.folder.id,
                  )
                }
                forceExpanded={searching}
                projectsByFolder={visibleByFolder}
                renderProject={renderProject}
                spaceMenu={buildSpaceMenu}
              />
            ))}

            {/* No space */}
            {visibleNoSpace.length > 0 ? (
              <div>
                <GroupLabel>No space</GroupLabel>
                {visibleNoSpace.map((p) => renderProject(p, 0, true))}
              </div>
            ) : null}
          </>
        )}

        {/* Chat — channels + DMs inline below Spaces (ClickUp-style). */}
        {!searching ? <ChatNavSections /> : null}
      </div>

      <NewSpaceModal
        open={spaceModal !== null}
        parent={spaceModalParent}
        onClose={() => setSpaceModal(null)}
      />
      <RenameProjectModal
        project={renameProject}
        onClose={() => setRenameProjectId(null)}
      />
      <EditProjectModal
        project={editProject}
        onClose={() => setEditProjectId(null)}
      />
      <RenameSpaceModal
        folder={renameSpace}
        onClose={() => setRenameSpaceId(null)}
      />
      <EditSpaceModal
        folder={editSpace}
        onClose={() => setEditSpaceId(null)}
      />
      <ShareSpaceModal
        key={`space:${shareSpaceId ?? "none"}`}
        folder={shareSpace}
        open={shareSpaceId !== null}
        canManage={isTeamAdmin}
        onClose={() => setShareSpaceId(null)}
      />
      <NewProjectInSpaceModal
        folder={newProjectSpace}
        onClose={() => setNewProjectSpaceId(null)}
        onCreated={openProject}
      />
      <ShareProjectModal
        key={`project:${shareTargetId ?? "none"}`}
        project={shareTarget}
        open={shareTargetId !== null}
        onClose={() => setShareTargetId(null)}
      />
      <SaveProjectTemplateModal
        project={saveTemplateTarget}
        onClose={() => setSaveTemplateId(null)}
      />
    </div>
  );
}

export default ProjectsSidebar;
