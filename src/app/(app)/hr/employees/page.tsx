"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, SearchOutlined, UserOutlined } from "@ant-design/icons";
import {
  useHrAccess,
  useHrEmployees,
  useDepartments,
  useDesignations,
  useCreateEmployee,
} from "@/features/hr/use-hr";
import type { HrEmployeeWithRelations } from "../_lib/types";
import {
  employmentTypeLabel,
  initials,
  statusColor,
  statusLabel,
} from "../_lib/labels";
import {
  toEmployeePayload,
  type EmployeeFormValues,
} from "../_lib/form";
import { EmployeeFormFields } from "./_components/employee-form-fields";

function errorMessage(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : "";
  if (/forbidden|permission|not allowed|policy|rls/i.test(msg)) {
    return "HR admins only.";
  }
  return msg || fallback;
}

export default function HREmployeesPage() {
  const router = useRouter();
  const { message } = App.useApp();

  const { isHrAdmin, orgId, isLoading: accessLoading } = useHrAccess();
  const {
    data: employees,
    isLoading,
    isError,
    error,
  } = useHrEmployees();
  const { data: departments } = useDepartments();
  const { data: designations } = useDesignations();
  const createEmployee = useCreateEmployee();

  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm<EmployeeFormValues>();

  const filtered = useMemo(() => {
    const list = employees ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) =>
      [e.full_name, e.work_email, e.employee_code]
        .filter((v): v is string => typeof v === "string")
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [employees, search]);

  // manager is another employee in the same org; resolve name from the list
  // (PostgREST self-referential embeds are unreliable to-one).
  const managerById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees ?? []) m.set(e.id, e.full_name);
    return m;
  }, [employees]);

  const openCreate = () => {
    form.resetFields();
    setDrawerOpen(true);
  };

  const handleCreate = async () => {
    const values = await form.validateFields();
    try {
      await createEmployee.mutateAsync(toEmployeePayload(values));
      message.success("Employee added.");
      setDrawerOpen(false);
      form.resetFields();
    } catch (err) {
      message.error(errorMessage(err, "Failed to add employee."));
    }
  };

  const columns: ColumnsType<HrEmployeeWithRelations> = [
    {
      title: "Employee",
      key: "employee",
      render: (_, e) => (
        <Space>
          <Avatar icon={<UserOutlined />}>{initials(e.full_name)}</Avatar>
          <div>
            <div style={{ fontWeight: 500 }}>{e.full_name}</div>
            {e.work_email ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {e.work_email}
              </Typography.Text>
            ) : null}
          </div>
        </Space>
      ),
      sorter: (a, b) => a.full_name.localeCompare(b.full_name),
    },
    {
      title: "Department",
      key: "department",
      render: (_, e) => e.department?.name ?? "—",
    },
    {
      title: "Designation",
      key: "designation",
      render: (_, e) => e.designation?.title ?? "—",
    },
    {
      title: "Manager",
      key: "manager",
      render: (_, e) =>
        (e.manager_id ? managerById.get(e.manager_id) : null) ?? "—",
    },
    {
      title: "Type",
      key: "employment_type",
      render: (_, e) => employmentTypeLabel(e.employment_type),
    },
    {
      title: "Status",
      key: "status",
      render: (_, e) => (
        <Tag color={statusColor(e.status)}>{statusLabel(e.status)}</Tag>
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
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Employees
          </Typography.Title>
          <Typography.Text type="secondary">
            Your organization&apos;s people directory.
          </Typography.Text>
        </div>
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search name, email, code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 240 }}
          />
          {isHrAdmin ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Add employee
            </Button>
          ) : null}
        </Space>
      </div>

      {!orgId && !accessLoading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No team selected. Choose a team from the top bar to manage employees."
        />
      ) : isError ? (
        <Alert
          type="error"
          showIcon
          message="Failed to load employees"
          description={errorMessage(error, "Please try again.")}
        />
      ) : (
        <Table<HrEmployeeWithRelations>
          rowKey="id"
          loading={isLoading || accessLoading}
          columns={columns}
          dataSource={filtered}
          scroll={{ x: "max-content" }}
          pagination={{ pageSize: 12, hideOnSinglePage: true }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  isHrAdmin ? "No employees yet" : "No employees to show"
                }
              >
                {isHrAdmin ? (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={openCreate}
                  >
                    Add employee
                  </Button>
                ) : null}
              </Empty>
            ),
          }}
          onRow={(record) => ({
            onClick: () => router.push(`/hr/employees/${record.id}`),
            style: { cursor: "pointer" },
          })}
        />
      )}

      <Drawer
        title="Add employee"
        width={680}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              loading={createEmployee.isPending}
              onClick={handleCreate}
            >
              Create
            </Button>
          </Space>
        }
      >
        <Form<EmployeeFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
        >
          <EmployeeFormFields
            departments={departments ?? []}
            designations={designations ?? []}
            managers={employees ?? []}
          />
        </Form>
      </Drawer>
    </Card>
  );
}
