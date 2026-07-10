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
  useProjectCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "@/features/settings/use-categories";
import type { Database } from "@/types/database";

type ProjectCategory = Database["public"]["Tables"]["project_categories"]["Row"];

interface CategoryFormValues {
  name: string;
  color_code: string | Color;
}

const DEFAULT_COLOR = "#70a6f3";

function toHex(value: string | Color | undefined): string {
  if (!value) return DEFAULT_COLOR;
  if (typeof value === "string") return value;
  return value.toHexString();
}

export default function CategoriesSettingsPage() {
  const { message } = App.useApp();
  const { data: categories, isLoading } = useProjectCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectCategory | null>(null);
  const [form] = Form.useForm<CategoryFormValues>();

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

  const openEdit = (record: ProjectCategory) => {
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
        await updateCategory.mutateAsync({ id: editing.id, ...payload });
        message.success("Category updated.");
      } else {
        await createCategory.mutateAsync(payload);
        message.success("Category created.");
      }
      setModalOpen(false);
      form.resetFields();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to save category.",
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCategory.mutateAsync(id);
      message.success("Category deleted.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to delete category.",
      );
    }
  };

  const columns: ColumnsType<ProjectCategory> = [
    {
      title: "Category",
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
            aria-label="Edit category"
          />
          <Popconfirm
            title="Delete this category?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="Delete category"
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
            Categories
          </Typography.Title>
          <Typography.Text type="secondary">
            Group projects with colored categories.
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add category
        </Button>
      </div>

      <Table<ProjectCategory>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={categories ?? []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      <Modal
        title={editing ? "Edit category" : "Add category"}
        open={modalOpen}
        onOk={handleSubmit}
        confirmLoading={createCategory.isPending || updateCategory.isPending}
        okText={editing ? "Save" : "Create"}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form<CategoryFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: "Please enter a name." }]}
          >
            <Input placeholder="Category name" autoFocus />
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
