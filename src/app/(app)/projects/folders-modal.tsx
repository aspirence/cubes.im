"use client";

import { useState } from "react";
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Space,
  Typography,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import {
  useProjectFolders,
  useCreateFolder,
  useUpdateFolder,
  useDeleteFolder,
} from "@/features/projects/use-project-folders";
import type { ProjectFolder } from "./types";

export interface FoldersModalProps {
  open: boolean;
  onClose: () => void;
}

/** Create / rename / delete the active team's project folders. */
export function FoldersModal({ open, onClose }: FoldersModalProps) {
  const { message } = App.useApp();
  const { data: folders, isLoading } = useProjectFolders();
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const deleteFolder = useDeleteFolder();

  // `destroyOnHidden` on the Modal unmounts this content on close, so local
  // state resets naturally — no reset-on-close effect needed.
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createFolder.mutateAsync({ name });
      setNewName("");
      message.success("Folder created.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to create folder.",
      );
    }
  };

  const startEdit = (folder: ProjectFolder) => {
    setEditingId(folder.id);
    setEditingName(folder.name);
  };

  const handleRename = async () => {
    if (!editingId) return;
    const name = editingName.trim();
    if (!name) return;
    try {
      await updateFolder.mutateAsync({ id: editingId, name });
      setEditingId(null);
      setEditingName("");
      message.success("Folder renamed.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to rename folder.",
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFolder.mutateAsync(id);
      message.success("Folder deleted.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to delete folder.",
      );
    }
  };

  return (
    <Modal
      title="Manage folders"
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
      destroyOnHidden
    >
      <Form layout="inline" style={{ marginBottom: 16 }} onFinish={handleCreate}>
        <Form.Item style={{ flex: 1, marginRight: 8 }}>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New folder name"
            onPressEnter={handleCreate}
            maxLength={100}
          />
        </Form.Item>
        <Form.Item style={{ marginRight: 0 }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreate}
            loading={createFolder.isPending}
            disabled={!newName.trim()}
          >
            Add
          </Button>
        </Form.Item>
      </Form>

      <List<ProjectFolder>
        loading={isLoading}
        dataSource={folders ?? []}
        locale={{
          emptyText: <Empty description="No folders yet" />,
        }}
        renderItem={(folder) => {
          const isEditingRow = editingId === folder.id;
          return (
            <List.Item
              actions={
                isEditingRow
                  ? [
                      <Button
                        key="save"
                        type="text"
                        icon={<CheckOutlined />}
                        onClick={handleRename}
                        loading={updateFolder.isPending}
                        aria-label="Save folder name"
                      />,
                      <Button
                        key="cancel"
                        type="text"
                        icon={<CloseOutlined />}
                        onClick={() => {
                          setEditingId(null);
                          setEditingName("");
                        }}
                        aria-label="Cancel rename"
                      />,
                    ]
                  : [
                      <Button
                        key="edit"
                        type="text"
                        icon={<EditOutlined />}
                        onClick={() => startEdit(folder)}
                        aria-label="Rename folder"
                      />,
                      <Popconfirm
                        key="delete"
                        title="Delete this folder?"
                        description="Projects in it will be left without a folder."
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => handleDelete(folder.id)}
                      >
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          aria-label="Delete folder"
                        />
                      </Popconfirm>,
                    ]
              }
            >
              {isEditingRow ? (
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onPressEnter={handleRename}
                    maxLength={100}
                    autoFocus
                  />
                </Space.Compact>
              ) : (
                <Typography.Text>{folder.name}</Typography.Text>
              )}
            </List.Item>
          );
        }}
      />
    </Modal>
  );
}
