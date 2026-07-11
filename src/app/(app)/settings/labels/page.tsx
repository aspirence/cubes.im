"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  ColorPicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Color } from "antd/es/color-picker";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import {
  useTeamLabels,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
} from "@/features/settings/use-labels";
import type { Database } from "@/types/database";

type TeamLabel = Database["public"]["Tables"]["team_labels"]["Row"];

interface LabelFormValues {
  name: string;
  color_code: string | Color;
}

const DEFAULT_COLOR = "#3b7ddd";

function toHex(value: string | Color | undefined): string {
  if (!value) return DEFAULT_COLOR;
  if (typeof value === "string") return value;
  return value.toHexString();
}

export default function LabelsSettingsPage() {
  const { message } = App.useApp();
  const { data: labels, isLoading } = useTeamLabels();
  const createLabel = useCreateLabel();
  const updateLabel = useUpdateLabel();
  const deleteLabel = useDeleteLabel();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TeamLabel | null>(null);
  const [form] = Form.useForm<LabelFormValues>();

  useEffect(() => {
    if (modalOpen) {
      form.setFieldsValue({
        name: editing?.name ?? "",
        color_code: editing?.color_code ?? DEFAULT_COLOR,
      });
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: TeamLabel) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload = {
      name: values.name.trim(),
      color_code: toHex(values.color_code),
    };
    try {
      if (editing) {
        await updateLabel.mutateAsync({ id: editing.id, ...payload });
        message.success("Label updated.");
      } else {
        await createLabel.mutateAsync(payload);
        message.success("Label created.");
      }
      setModalOpen(false);
      form.resetFields();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save label.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteLabel.mutateAsync(id);
      message.success("Label deleted.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to delete label.",
      );
    }
  };

  const columns: ColumnsType<TeamLabel> = [
    {
      title: "Label",
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_, record) => (
        <Tag color={record.color_code} style={{ marginInlineEnd: 0 }}>
          {record.name}
        </Tag>
      ),
    },
    {
      title: "Color",
      dataIndex: "color_code",
      key: "color_code",
      width: 140,
      render: (color: string) => (
        <Space size={6}>
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 14,
              borderRadius: 3,
              background: color,
              border: "1px solid rgba(0,0,0,0.1)",
            }}
          />
          <Typography.Text type="secondary">{color}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 140,
      align: "right",
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
            aria-label="Edit label"
          />
          <Popconfirm
            title="Delete this label?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="Delete label"
            />
          </Popconfirm>
        </Space>
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
          <Typography.Title level={4} style={{ margin: 0 }}>
            Labels
          </Typography.Title>
          <Typography.Text type="secondary">
            Colored tags for organizing tasks.
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add label
        </Button>
      </div>

      <Table<TeamLabel>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={labels ?? []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: "max-content" }}
      />

      <Modal
        title={editing ? "Edit label" : "Add label"}
        open={modalOpen}
        onOk={handleSubmit}
        confirmLoading={createLabel.isPending || updateLabel.isPending}
        okText={editing ? "Save" : "Create"}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form<LabelFormValues> form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: "Please enter a name." }]}
          >
            <Input placeholder="Label name" autoFocus />
          </Form.Item>
          <Form.Item
            label="Color"
            name="color_code"
            rules={[{ required: true, message: "Please pick a color." }]}
          >
            <ColorPicker format="hex" disabledAlpha showText />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
