"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UserDeleteOutlined,
} from "@ant-design/icons";
import {
  useHrAccess,
  useDepartments,
  useCreateDepartment,
  useUpdateDepartment,
  useDeleteDepartment,
  useDesignations,
  useCreateDesignation,
  useDeleteDesignation,
  useHrAdmins,
  useAddHrAdmin,
  useRemoveHrAdmin,
} from "@/features/hr/use-hr";
import { useTeamMembers } from "@/features/team-members/use-team-members";

/**
 * Turns an RLS/permission error into a friendly message. Writes to the HR
 * tables are gated to HR admins; the database raises a forbidden / permission
 * error which we surface as a clear "HR admins only" notice.
 */
function friendlyError(err: unknown, fallback: string): string {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/forbidden|permission|policy|not\s*authoriz|row-level/i.test(msg)) {
    return "HR admins only — you do not have permission to make this change.";
  }
  return msg || fallback;
}

/* ------------------------------------------------------------------ */
/* Loosely-typed views of the contract rows so this page stays           */
/* TS-sound regardless of the exact generated shape Agent A exports.     */
/* ------------------------------------------------------------------ */

interface DepartmentRow {
  id: string;
  name: string;
  head_user_id: string | null;
}

interface DesignationRow {
  id: string;
  title: string;
  level: number;
}

interface HrAdminRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
}

interface OrgUserOption {
  userId: string;
  name: string;
  email: string;
}

/* ================================================================== */
/* Departments                                                         */
/* ================================================================== */

interface DepartmentFormValues {
  name: string;
  head_user_id?: string | null;
}

function DepartmentsTab({ orgUsers }: { orgUsers: OrgUserOption[] }) {
  const { message } = App.useApp();
  const { data, isLoading } = useDepartments();
  const createDepartment = useCreateDepartment();
  const updateDepartment = useUpdateDepartment();
  const deleteDepartment = useDeleteDepartment();

  const departments = (data ?? []) as unknown as DepartmentRow[];

  const userNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of orgUsers) map.set(u.userId, u.name || u.email);
    return map;
  }, [orgUsers]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [form] = Form.useForm<DepartmentFormValues>();

  useEffect(() => {
    if (modalOpen) {
      form.setFieldsValue({
        name: editing?.name ?? "",
        head_user_id: editing?.head_user_id ?? undefined,
      });
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: DepartmentRow) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload = {
      name: values.name.trim(),
      head_user_id: values.head_user_id ?? null,
    };
    try {
      if (editing) {
        await updateDepartment.mutateAsync({ id: editing.id, patch: payload });
        message.success("Department updated.");
      } else {
        await createDepartment.mutateAsync(payload);
        message.success("Department created.");
      }
      setModalOpen(false);
      form.resetFields();
    } catch (err) {
      message.error(friendlyError(err, "Failed to save department."));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDepartment.mutateAsync(id);
      message.success("Department deleted.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to delete department."));
    }
  };

  const columns: ColumnsType<DepartmentRow> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "Head",
      key: "head",
      render: (_, record) =>
        record.head_user_id ? (
          (userNameById.get(record.head_user_id) ?? "—")
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      align: "right",
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
            aria-label="Edit department"
          />
          <Popconfirm
            title="Delete this department?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label="Delete department"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Departments
          </Typography.Title>
          <Typography.Text type="secondary">
            Organize your people into departments.
          </Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add department
        </Button>
      </div>

      <Table<DepartmentRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={departments}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      <Modal
        title={editing ? "Edit department" : "Add department"}
        open={modalOpen}
        onOk={handleSubmit}
        confirmLoading={
          createDepartment.isPending || updateDepartment.isPending
        }
        okText={editing ? "Save" : "Create"}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form<DepartmentFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: "Please enter a name." }]}
          >
            <Input placeholder="e.g. Engineering" autoFocus />
          </Form.Item>
          <Form.Item label="Department head" name="head_user_id">
            <Select
              allowClear
              showSearch
              placeholder="Select a head (optional)"
              optionFilterProp="label"
              options={orgUsers.map((u) => ({
                value: u.userId,
                label: u.name ? `${u.name} (${u.email})` : u.email,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/* ================================================================== */
/* Designations                                                        */
/* ================================================================== */

interface DesignationFormValues {
  title: string;
  level: number;
}

function DesignationsTab() {
  const { message } = App.useApp();
  const { data, isLoading } = useDesignations();
  const createDesignation = useCreateDesignation();
  const deleteDesignation = useDeleteDesignation();

  const designations = (data ?? []) as unknown as DesignationRow[];

  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<DesignationFormValues>();

  useEffect(() => {
    if (modalOpen) {
      form.setFieldsValue({ title: "", level: 1 });
    }
  }, [modalOpen, form]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      await createDesignation.mutateAsync({
        title: values.title.trim(),
        level: values.level,
      });
      message.success("Designation created.");
      setModalOpen(false);
      form.resetFields();
    } catch (err) {
      message.error(friendlyError(err, "Failed to save designation."));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDesignation.mutateAsync(id);
      message.success("Designation deleted.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to delete designation."));
    }
  };

  const columns: ColumnsType<DesignationRow> = [
    {
      title: "Title",
      dataIndex: "title",
      key: "title",
      sorter: (a, b) => a.title.localeCompare(b.title),
    },
    {
      title: "Level",
      dataIndex: "level",
      key: "level",
      width: 120,
      sorter: (a, b) => a.level - b.level,
      render: (level: number) => <Tag>{level}</Tag>,
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      align: "right",
      render: (_, record) => (
        <Popconfirm
          title="Delete this designation?"
          okText="Delete"
          okButtonProps={{ danger: true }}
          onConfirm={() => handleDelete(record.id)}
        >
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            aria-label="Delete designation"
          />
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Designations
          </Typography.Title>
          <Typography.Text type="secondary">
            Job titles and their seniority levels.
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
        >
          Add designation
        </Button>
      </div>

      <Table<DesignationRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={designations}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      <Modal
        title="Add designation"
        open={modalOpen}
        onOk={handleSubmit}
        confirmLoading={createDesignation.isPending}
        okText="Create"
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form<DesignationFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ level: 1 }}
        >
          <Form.Item
            label="Title"
            name="title"
            rules={[{ required: true, message: "Please enter a title." }]}
          >
            <Input placeholder="e.g. Senior Engineer" autoFocus />
          </Form.Item>
          <Form.Item
            label="Level"
            name="level"
            rules={[{ required: true, message: "Please enter a level." }]}
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/* ================================================================== */
/* HR Admins                                                           */
/* ================================================================== */

function HrAdminsTab({ orgUsers }: { orgUsers: OrgUserOption[] }) {
  const { message } = App.useApp();
  const { data, isLoading } = useHrAdmins();
  const addHrAdmin = useAddHrAdmin();
  const removeHrAdmin = useRemoveHrAdmin();

  // Normalize whatever shape the contract returns (flat name/email, or a
  // nested `user` join) into a flat row for the table.
  const admins = useMemo<HrAdminRow[]>(() => {
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const user = (r.user ?? null) as Record<string, unknown> | null;
      const userId = String(r.user_id ?? user?.id ?? "");
      return {
        id: String(r.id ?? userId),
        user_id: userId,
        name: String(r.name ?? user?.name ?? ""),
        email: String(r.email ?? user?.email ?? ""),
      };
    });
  }, [data]);

  const existingAdminUserIds = useMemo(
    () => new Set(admins.map((a) => a.user_id)),
    [admins],
  );

  const candidates = useMemo(
    () => orgUsers.filter((u) => !existingAdminUserIds.has(u.userId)),
    [orgUsers, existingAdminUserIds],
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>();

  const handleAdd = async () => {
    if (!selectedUserId) {
      message.warning("Select a user first.");
      return;
    }
    try {
      await addHrAdmin.mutateAsync({ userId: selectedUserId });
      message.success("HR admin added.");
      setModalOpen(false);
      setSelectedUserId(undefined);
    } catch (err) {
      message.error(friendlyError(err, "Failed to add HR admin."));
    }
  };

  const handleRemove = async (record: HrAdminRow) => {
    try {
      await removeHrAdmin.mutateAsync(record.id);
      message.success("HR admin removed.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to remove HR admin."));
    }
  };

  const columns: ColumnsType<HrAdminRow> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      render: (name: string, record) =>
        name || (
          <Typography.Text type="secondary">{record.email}</Typography.Text>
        ),
      sorter: (a, b) => (a.name || a.email).localeCompare(b.name || b.email),
    },
    {
      title: "Email",
      dataIndex: "email",
      key: "email",
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      align: "right",
      render: (_, record) => (
        <Popconfirm
          title="Remove this HR admin?"
          okText="Remove"
          okButtonProps={{ danger: true }}
          onConfirm={() => handleRemove(record)}
        >
          <Button
            type="text"
            danger
            icon={<UserDeleteOutlined />}
            aria-label="Remove HR admin"
          />
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            HR Admins
          </Typography.Title>
          <Typography.Text type="secondary">
            People who can manage the HR directory. The organization owner is
            always an HR admin.
          </Typography.Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
        >
          Add HR admin
        </Button>
      </div>

      <Table<HrAdminRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={admins}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      <Modal
        title="Add HR admin"
        open={modalOpen}
        onOk={handleAdd}
        confirmLoading={addHrAdmin.isPending}
        okText="Add"
        okButtonProps={{ disabled: !selectedUserId }}
        onCancel={() => {
          setModalOpen(false);
          setSelectedUserId(undefined);
        }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          Pick an organization member to grant HR admin access.
        </Typography.Paragraph>
        <Select
          showSearch
          allowClear
          style={{ width: "100%" }}
          placeholder="Select a user"
          optionFilterProp="label"
          value={selectedUserId}
          onChange={(value) => setSelectedUserId(value)}
          notFoundContent="No eligible users"
          options={candidates.map((u) => ({
            value: u.userId,
            label: u.name ? `${u.name} (${u.email})` : u.email,
          }))}
        />
      </Modal>
    </>
  );
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

export default function HrSettingsPage() {
  const { isHrAdmin, isLoading } = useHrAccess();
  const { data: teamMembers } = useTeamMembers();

  // Distinct org users (members joined to a user account) for the head /
  // HR-admin pickers.
  const orgUsers = useMemo<OrgUserOption[]>(() => {
    const byId = new Map<string, OrgUserOption>();
    for (const m of teamMembers ?? []) {
      const user = m.user;
      if (!user) continue;
      if (byId.has(user.id)) continue;
      byId.set(user.id, {
        userId: user.id,
        name: user.name,
        email: user.email,
      });
    }
    return Array.from(byId.values()).sort((a, b) =>
      (a.name || a.email).localeCompare(b.name || b.email),
    );
  }, [teamMembers]);

  if (isLoading) {
    return (
      <Card>
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin />
        </div>
      </Card>
    );
  }

  if (!isHrAdmin) {
    return (
      <Card>
        <Result
          status="403"
          title="HR admins only"
          subTitle="HR settings can only be managed by the organization owner or a designated HR admin. Contact your HR team for access."
        />
      </Card>
    );
  }

  const items = [
    {
      key: "departments",
      label: "Departments",
      children: <DepartmentsTab orgUsers={orgUsers} />,
    },
    {
      key: "designations",
      label: "Designations",
      children: <DesignationsTab />,
    },
    {
      key: "admins",
      label: "HR Admins",
      children: <HrAdminsTab orgUsers={orgUsers} />,
    },
  ];

  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        HR Settings
      </Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Changes here apply across your organization's HR directory."
      />
      <Tabs defaultActiveKey="departments" items={items} />
    </Card>
  );
}
