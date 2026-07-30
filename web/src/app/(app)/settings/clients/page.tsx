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
  useClients,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  type Client,
} from "@/features/settings/use-clients";

interface ClientFormValues {
  name: string;
}

export default function ClientsSettingsPage() {
  const { message } = App.useApp();
  const { data: clients, isLoading } = useClients();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form] = Form.useForm<ClientFormValues>();

  useEffect(() => {
    if (modalOpen) {
      form.setFieldsValue({ name: editing?.name ?? "" });
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: Client) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await updateClient.mutateAsync({ id: editing.id, name: values.name.trim() });
        message.success("Client updated.");
      } else {
        await createClient.mutateAsync({ name: values.name.trim() });
        message.success("Client created.");
      }
      setModalOpen(false);
      form.resetFields();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to save client.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteClient.mutateAsync(id);
      message.success("Client deleted.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to delete client.");
    }
  };

  const columns: ColumnsType<Client> = [
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
            aria-label="Edit client"
          />
          <Popconfirm
            title="Delete this client?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="Delete client"
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
            Clients
          </Typography.Title>
          <Typography.Text type="secondary">
            Organizations you do work for.
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add client
        </Button>
      </div>

      <Table<Client>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={clients ?? []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      <Modal
        title={editing ? "Edit client" : "Add client"}
        open={modalOpen}
        onOk={handleSubmit}
        confirmLoading={createClient.isPending || updateClient.isPending}
        okText={editing ? "Save" : "Create"}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form<ClientFormValues> form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="Name"
            name="name"
            rules={[
              { required: true, message: "Please enter a name." },
              { max: 60, message: "Name must be 60 characters or fewer." },
            ]}
          >
            <Input placeholder="Client name" autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
