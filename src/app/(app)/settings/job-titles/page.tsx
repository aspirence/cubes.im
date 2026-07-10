"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import {
  useJobTitles,
  useCreateJobTitle,
  useUpdateJobTitle,
  useDeleteJobTitle,
  type JobTitle,
} from "@/features/settings/use-job-titles";

interface JobTitleFormValues {
  name: string;
}

export default function JobTitlesSettingsPage() {
  const { message } = App.useApp();
  const { data: jobTitles, isLoading } = useJobTitles();
  const createJobTitle = useCreateJobTitle();
  const updateJobTitle = useUpdateJobTitle();
  const deleteJobTitle = useDeleteJobTitle();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<JobTitle | null>(null);
  const [form] = Form.useForm<JobTitleFormValues>();

  useEffect(() => {
    if (modalOpen) {
      form.setFieldsValue({ name: editing?.name ?? "" });
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: JobTitle) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await updateJobTitle.mutateAsync({
          id: editing.id,
          name: values.name.trim(),
        });
        message.success("Job title updated.");
      } else {
        await createJobTitle.mutateAsync({ name: values.name.trim() });
        message.success("Job title created.");
      }
      setModalOpen(false);
      form.resetFields();
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to save job title.",
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteJobTitle.mutateAsync(id);
      message.success("Job title deleted.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to delete job title.",
      );
    }
  };

  const columns: ColumnsType<JobTitle> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
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
            aria-label="Edit job title"
          />
          <Popconfirm
            title="Delete this job title?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="Delete job title"
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
            Job Titles
          </Typography.Title>
          <Typography.Text type="secondary">
            Roles people hold within your team.
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add job title
        </Button>
      </div>

      <Table<JobTitle>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={jobTitles ?? []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      <Modal
        title={editing ? "Edit job title" : "Add job title"}
        open={modalOpen}
        onOk={handleSubmit}
        confirmLoading={createJobTitle.isPending || updateJobTitle.isPending}
        okText={editing ? "Save" : "Create"}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form<JobTitleFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: "Please enter a name." }]}
          >
            <Input placeholder="e.g. Software Engineer" autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
