"use client";

import { App, Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
  MoreOutlined,
  EditOutlined,
  InboxOutlined,
  DeleteOutlined,
  ExportOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import {
  useToggleArchive,
  useToggleFavorite,
  useDeleteProject,
} from "@/features/projects/use-projects";
import type { ProjectRow } from "./types";

export interface ProjectActionsProps {
  project: ProjectRow;
  archived: boolean;
  onEdit: (project: ProjectRow) => void;
}

/** The per-project actions menu: Edit, Archive/Unarchive, Delete. */
export function ProjectActions({
  project,
  archived,
  onEdit,
}: ProjectActionsProps) {
  const { message, modal } = App.useApp();
  const toggleArchive = useToggleArchive();
  const deleteProject = useDeleteProject();

  const handleArchive = async () => {
    try {
      await toggleArchive.mutateAsync({
        projectId: project.id,
        archived: !archived,
      });
      message.success(archived ? "Project unarchived." : "Project archived.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update project.",
      );
    }
  };

  const handleDelete = () => {
    modal.confirm({
      title: `Delete "${project.name}"?`,
      content: "This permanently deletes the project and its data.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProject.mutateAsync(project.id);
          message.success("Project deleted.");
        } catch (err) {
          message.error(
            err instanceof Error ? err.message : "Failed to delete project.",
          );
        }
      },
    });
  };

  const items: MenuProps["items"] = [
    {
      key: "edit",
      icon: <EditOutlined />,
      label: "Edit",
      onClick: () => onEdit(project),
    },
    {
      key: "archive",
      icon: archived ? <ExportOutlined /> : <InboxOutlined />,
      label: archived ? "Unarchive" : "Archive",
      onClick: handleArchive,
    },
    { type: "divider" },
    {
      key: "delete",
      icon: <DeleteOutlined />,
      label: "Delete",
      danger: true,
      onClick: handleDelete,
    },
  ];

  return (
    <Dropdown menu={{ items }} trigger={["click"]} placement="bottomRight">
      <Button
        type="text"
        icon={<MoreOutlined />}
        aria-label="Project actions"
        onClick={(e) => e.stopPropagation()}
      />
    </Dropdown>
  );
}

/** A favorite star toggle used in both the table and the grid. */
export function FavoriteStar({
  project,
  isFavorite,
}: {
  project: ProjectRow;
  isFavorite: boolean;
}) {
  const { message } = App.useApp();
  const toggleFavorite = useToggleFavorite();

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await toggleFavorite.mutateAsync({
        projectId: project.id,
        favorite: !isFavorite,
      });
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update favorite.",
      );
    }
  };

  return (
    <Button
      type="text"
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      icon={
        isFavorite ? (
          <StarFilled style={{ color: "#eab308" }} />
        ) : (
          <StarOutlined />
        )
      }
      onClick={handleClick}
      loading={toggleFavorite.isPending}
    />
  );
}
