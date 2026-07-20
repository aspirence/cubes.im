"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  App,
  Card,
  Dropdown,
  Input,
  Modal,
  Popover,
  Result,
  Skeleton,
  Tabs,
  Tag,
  Typography,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import {
  useProject,
  type ProjectWithRelations,
} from "@/features/projects/use-projects";
import {
  useProjectViews,
  useAddProjectView,
  useRemoveProjectView,
  useRenameProjectView,
  useReorderProjectViews,
  type ProjectView,
} from "@/features/projects/use-project-views";
import {
  ADDABLE_VIEWS,
  UTILITY_VIEWS,
  viewByKey,
} from "@/lib/projects/views";
import {
  useActivateAppForProject,
  appKeyForViewKey,
} from "@/features/apps-platform/app-scope";
import { ViewToolbarSlot } from "./_components/view-toolbar-slot";
import { ProjectWorkspaceHeader } from "./_components/project-workspace-header";
import { ProjectOverviewTab } from "./_components/project-overview-tab";
import { TaskListTab } from "./_components/task-list-tab";
import { BoardTab } from "./_components/board-tab";
import { SerialTab } from "./_components/serial-tab";
import { TrackBar } from "@/features/tracks/track-bar";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { RoadmapTab } from "./_components/roadmap-tab";
import { CalendarTab } from "./_components/calendar-tab";
import { TableTab } from "./_components/table-tab";
import { VideoReviewTab } from "./_components/video-review-tab";
import { FilesTab } from "./_components/files-tab";
import { SocialStudioTab } from "./_components/social-studio-tab";
import { WorkloadTab } from "./_components/workload-tab";
import { DocsTab } from "./_components/docs-tab";
import { UpdatesTab } from "./_components/updates-tab";
import { TaskDrawer } from "./_components/task-drawer";

function MIcon({ name, size = 15 }: { name: string; size?: number }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, verticalAlign: "-2px" }}
    >
      {name}
    </span>
  );
}

/** Maps a view key to its rendered pane. */
function viewComponent(
  key: string,
  projectId: string,
  project: ProjectWithRelations,
): React.ReactNode {
  switch (key) {
    case "list":
      return <TaskListTab projectId={projectId} />;
    case "serial":
      return <SerialTab projectId={projectId} />;
    case "board":
      return <BoardTab projectId={projectId} />;
    case "timeline":
      return <RoadmapTab projectId={projectId} />;
    case "calendar":
      return <CalendarTab projectId={projectId} />;
    case "table":
      return <TableTab projectId={projectId} />;
    case "video-review":
      return <VideoReviewTab projectId={projectId} />;
    case "files":
      return <FilesTab projectId={projectId} />;
    case "social-studio":
      return <SocialStudioTab projectId={projectId} />;
    case "workload":
      return (
        <WorkloadTab
          projectId={projectId}
          hoursPerDay={project.hours_per_day ?? 8}
        />
      );
    case "overview":
      return <ProjectOverviewTab project={project} />;
    case "doc":
      return <DocsTab projectId={projectId} />;
    case "updates":
      return <UpdatesTab projectId={projectId} />;
    default:
      return (
        <Card>
          <Typography.Text type="secondary">
            This view isn&apos;t available.
          </Typography.Text>
        </Card>
      );
  }
}

/** The "+ View" picker — a grid of addable view types. */
function AddViewPicker({
  existingKeys,
  onAdd,
}: {
  existingKeys: Set<string>;
  onAdd: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { token } = theme.useToken();
  const content = (
    <div style={{ width: 300 }}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.7 }}
      >
        Add a view
      </Typography.Text>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
          marginTop: 8,
        }}
      >
        {ADDABLE_VIEWS.map((v) => {
          const added = existingKeys.has(v.key);
          const disabled = added || !v.available;
          return (
            <button
              key={v.key}
              type="button"
              disabled={disabled}
              onClick={() => {
                onAdd(v.key);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 8,
                background: "transparent",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.45 : 1,
                textAlign: "left",
              }}
            >
              <span style={{ color: v.color, display: "inline-flex" }}>
                <MIcon name={v.icon} size={18} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{v.title}</div>
              </span>
              {added ? (
                <Tag style={{ margin: 0, fontSize: 10 }}>Added</Tag>
              ) : !v.available ? (
                <Tag style={{ margin: 0, fontSize: 10 }}>Soon</Tag>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      content={content}
    >
      <button
        type="button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 10px",
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 7,
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        <PlusOutlined style={{ fontSize: 11 }} /> View
      </button>
    </Popover>
  );
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { message } = App.useApp();

  const { data: project, isLoading, isError, error } = useProject(projectId);
  const isTeamAdmin = useIsTeamAdmin();
  const { data: views } = useProjectViews(projectId);
  const addView = useAddProjectView();
  const removeView = useRemoveProjectView();
  const renameView = useRenameProjectView();
  const reorderViews = useReorderProjectViews();
  const activateApp = useActivateAppForProject();
  // Rename-view modal target (null = closed).
  const [renaming, setRenaming] = useState<ProjectView | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const taskViews = useMemo(() => views ?? [], [views]);
  const existingKeys = useMemo(
    () => new Set(taskViews.map((v) => v.view_key)),
    [taskViews],
  );

  const handleAdd = async (viewKey: string) => {
    if (!projectId) return;
    try {
      await addView.mutateAsync({
        projectId,
        viewKey,
        // Append past the current max — using taskViews.length would collide
        // with an existing position after any earlier view was removed.
        position: taskViews.length
          ? Math.max(...taskViews.map((v) => v.position)) + 1
          : 0,
      });
      // Adding an app's view (Video Review / Files / Social Studio) auto-activates
      // that app for this project (adds it to the app's "selected" scope; a no-op
      // when the app covers all projects or isn't installed). Fire-and-forget —
      // the view is already added; activation failing shouldn't block navigation.
      const appKey = appKeyForViewKey(viewKey);
      if (appKey) {
        activateApp.mutate({ projectId, appKey });
      }
      const dest = new URLSearchParams(searchParams.toString());
      dest.set("tab", viewKey);
      router.replace(`?${dest.toString()}`, { scroll: false });
    } catch {
      message.error("Only project admins can change views.");
    }
  };

  const handleRemove = async (view: ProjectView) => {
    if (!projectId) return;
    try {
      await removeView.mutateAsync({ id: view.id, projectId });
      message.success("View removed.");
    } catch {
      message.error("Only project admins can change views.");
    }
  };

  /** Shifts a view left/right (or to the front for "Set as default"). */
  const handleMoveView = async (view: ProjectView, to: number) => {
    if (!projectId) return;
    const ids = taskViews.map((v) => v.id);
    const from = ids.indexOf(view.id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, view.id);
    try {
      await reorderViews.mutateAsync({ projectId, orderedIds: ids });
    } catch {
      message.error("Only project admins can change views.");
    }
  };

  const handleRename = async () => {
    if (!projectId || !renaming) return;
    const name = renameDraft.trim();
    try {
      await renameView.mutateAsync({
        id: renaming.id,
        projectId,
        // Empty input resets to the view type's default title.
        name: name.length > 0 ? name : null,
      });
      setRenaming(null);
    } catch {
      message.error("Only project admins can change views.");
    }
  };

  const handleTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", key);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  if (isLoading) {
    return (
      <Card>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }
  if (isError) {
    return (
      <Card>
        <Result
          status="error"
          title="Couldn't load this project"
          subTitle={
            error instanceof Error
              ? error.message
              : "Something went wrong while loading the project."
          }
        />
      </Card>
    );
  }
  if (!project) {
    return (
      <Card>
        <Result
          status="404"
          title="Project not found"
          subTitle="This project doesn't exist or you don't have access to it."
        />
      </Card>
    );
  }

  const taskTabItems = taskViews.map((v, i) => {
    const desc = viewByKey(v.view_key);
    const title = v.name ?? desc?.title ?? v.view_key;
    // Right-click a tab for its tools (no always-visible ×).
    const menu: MenuProps = {
      items: [
        {
          key: "rename",
          label: "Rename view…",
          icon: <MIcon name="edit" size={15} />,
          onClick: () => {
            setRenaming(v);
            setRenameDraft(v.name ?? "");
          },
        },
        {
          key: "default",
          label: "Set as default (first)",
          icon: <MIcon name="push_pin" size={15} />,
          disabled: i === 0,
          onClick: () => void handleMoveView(v, 0),
        },
        {
          key: "left",
          label: "Move left",
          icon: <MIcon name="chevron_left" size={15} />,
          disabled: i === 0,
          onClick: () => void handleMoveView(v, i - 1),
        },
        {
          key: "right",
          label: "Move right",
          icon: <MIcon name="chevron_right" size={15} />,
          disabled: i === taskViews.length - 1,
          onClick: () => void handleMoveView(v, i + 1),
        },
        { type: "divider" },
        {
          key: "remove",
          label: "Remove view",
          icon: <MIcon name="delete" size={15} />,
          danger: true,
          onClick: () => void handleRemove(v),
        },
      ],
    };
    return {
      key: v.view_key,
      label: (
        <Dropdown menu={menu} trigger={["contextMenu"]}>
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            title={
              i === 0
                ? `${title} — default view · right-click for options`
                : `${title} — right-click for options`
            }
          >
            <MIcon name={desc?.icon ?? "tab"} />
            {title}
            {i === 0 ? (
              <span
                className="material-symbols-rounded"
                aria-label="Default view"
                style={{ fontSize: 12, opacity: 0.55, transform: "rotate(35deg)" }}
              >
                push_pin
              </span>
            ) : null}
          </span>
        </Dropdown>
      ),
      children: viewComponent(v.view_key, project.id, project),
    };
  });

  const utilityTabItems = UTILITY_VIEWS.map((u) => ({
    key: u.key,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <MIcon name={u.icon} />
        {u.title}
      </span>
    ),
    children: viewComponent(u.key, project.id, project),
  }));

  const tabItems = [...taskTabItems, ...utilityTabItems];
  const validKeys = new Set(tabItems.map((t) => t.key));
  const rawTab = searchParams.get("tab");
  const activeTab =
    rawTab && validKeys.has(rawTab)
      ? rawTab
      : (taskTabItems[0]?.key ?? utilityTabItems[0]?.key ?? "overview");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ProjectWorkspaceHeader project={project} />
      <TrackBar projectId={project.id} canManage={isTeamAdmin} />
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={tabItems}
        destroyOnHidden
        // The tab row carries both: "+ View" sits immediately after the last
        // tab, and the active view's own controls (group/filter) sit far right —
        // which keeps a whole toolbar row out of the content area.
        renderTabBar={(tabBarProps, DefaultTabBar) => (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DefaultTabBar {...tabBarProps} style={{ margin: 0, flex: "0 1 auto", minWidth: 0 }} />
            <AddViewPicker existingKeys={existingKeys} onAdd={handleAdd} />
            <div style={{ marginLeft: "auto", flex: "none" }}>
              <ViewToolbarSlot />
            </div>
          </div>
        )}
      />
      <TaskDrawer />

      {/* Rename view (from the tab's right-click menu) */}
      <Modal
        title="Rename view"
        open={Boolean(renaming)}
        okText="Save"
        confirmLoading={renameView.isPending}
        onOk={() => void handleRename()}
        onCancel={() => setRenaming(null)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5 }}>
          Leave empty to reset to the view&apos;s default name.
        </Typography.Paragraph>
        <Input
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          placeholder={
            renaming ? (viewByKey(renaming.view_key)?.title ?? "View name") : "View name"
          }
          maxLength={40}
          autoFocus
          onPressEnter={() => void handleRename()}
        />
      </Modal>
    </div>
  );
}
