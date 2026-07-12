"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  RocketOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  useHrAccess,
  useHrEmployees,
  useDepartments,
  useDesignations,
  useCreateEmployee,
} from "@/features/hr/use-hr";
import {
  useOnboardingTasks,
  useCreateOnboardingTask,
  useUpdateOnboardingTask,
  useDeleteOnboardingTask,
  useSeedChecklist,
} from "@/features/hr/use-analytics";
import {
  toEmployeePayload,
  type EmployeeFormValues,
} from "../_lib/form";
import { EmployeeFormFields } from "../employees/_components/employee-form-fields";
import { HrDocumentsWorkspace } from "../_components/documents-workspace";

const { Title, Text } = Typography;

/* -------------------------------------------------------------------------- */
/* Loosely-typed view of the contract row so this page stays TS-sound          */
/* regardless of the exact shape Agent A's hooks return.                       */
/* -------------------------------------------------------------------------- */

type OnboardingKind = "onboarding" | "offboarding";
type TaskStatus = "pending" | "in_progress" | "done";

interface OnboardingTaskRow {
  id: string;
  employee_id: string;
  kind: string;
  title: string;
  status: string;
  due_date: string | null;
  sort_order: number;
  completed_at: string | null;
}

const STATUS_OPTIONS: { label: string; value: TaskStatus }[] = [
  { label: "Pending", value: "pending" },
  { label: "In progress", value: "in_progress" },
  { label: "Done", value: "done" },
];

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: "default",
  in_progress: "blue",
  done: "green",
};

function statusTag(status: string) {
  const color = STATUS_COLOR[status as TaskStatus] ?? "default";
  const label =
    STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
  return <Tag color={color}>{label}</Tag>;
}

function friendlyError(err: unknown, fallback: string): string {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/forbidden|permission|policy|not\s*authoriz|row-level/i.test(msg)) {
    return "You do not have permission to perform this action.";
  }
  return msg || fallback;
}

/* ========================================================================== */
/* One checklist section (Onboarding or Offboarding)                           */
/* ========================================================================== */

function ChecklistSection({
  employeeId,
  kind,
  title,
  icon,
  tasks,
  loading,
  canEdit,
}: {
  employeeId: string;
  kind: OnboardingKind;
  title: string;
  icon: React.ReactNode;
  tasks: OnboardingTaskRow[];
  loading: boolean;
  canEdit: boolean;
}) {
  const { message } = App.useApp();
  const [newTitle, setNewTitle] = useState("");

  const createTask = useCreateOnboardingTask();
  const updateTask = useUpdateOnboardingTask();
  const deleteTask = useDeleteOnboardingTask();
  const seed = useSeedChecklist();

  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const handleAdd = async () => {
    const value = newTitle.trim();
    if (!value) return;
    try {
      await createTask.mutateAsync({ employeeId, kind, title: value });
      setNewTitle("");
    } catch (err) {
      message.error(friendlyError(err, "Failed to add task."));
    }
  };

  const handleStatus = async (id: string, status: TaskStatus) => {
    try {
      await updateTask.mutateAsync({ id, patch: { status } });
    } catch (err) {
      message.error(friendlyError(err, "Failed to update task."));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTask.mutateAsync(id);
    } catch (err) {
      message.error(friendlyError(err, "Failed to delete task."));
    }
  };

  const handleSeed = async () => {
    try {
      await seed.mutateAsync({ employeeId, kind });
      message.success("Default checklist generated.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to generate checklist."));
    }
  };

  return (
    <Card
      title={
        <Space>
          {icon}
          {title}
        </Space>
      }
      extra={
        total > 0 ? (
          <Text type="secondary">
            {done}/{total} done
          </Text>
        ) : null
      }
    >
      {total > 0 ? (
        <Progress
          percent={pct}
          size="small"
          status={pct === 100 ? "success" : "active"}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : total === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`No ${title.toLowerCase()} tasks yet`}
        >
          {canEdit ? (
            <Button
              icon={<PlusOutlined />}
              onClick={handleSeed}
              loading={seed.isPending}
            >
              Generate default checklist
            </Button>
          ) : null}
        </Empty>
      ) : (
        <List<OnboardingTaskRow>
          dataSource={tasks}
          renderItem={(t) => (
            <List.Item
              actions={
                canEdit
                  ? [
                      <Segmented<TaskStatus>
                        key="status"
                        size="small"
                        value={t.status as TaskStatus}
                        options={STATUS_OPTIONS}
                        onChange={(value) => handleStatus(t.id, value)}
                      />,
                      <Popconfirm
                        key="delete"
                        title="Delete this task?"
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        cancelText="Keep"
                        onConfirm={() => handleDelete(t.id)}
                      >
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                        />
                      </Popconfirm>,
                    ]
                  : [statusTag(t.status)]
              }
            >
              <List.Item.Meta
                title={
                  <Text
                    delete={t.status === "done"}
                    type={t.status === "done" ? "secondary" : undefined}
                  >
                    {t.title}
                  </Text>
                }
                description={
                  t.due_date
                    ? `Due ${dayjs(t.due_date).format("MMM D, YYYY")}`
                    : null
                }
              />
            </List.Item>
          )}
        />
      )}

      {canEdit && total > 0 ? (
        <Space.Compact style={{ width: "100%", marginTop: 12 }}>
          <Input
            placeholder="Add a task…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onPressEnter={handleAdd}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            loading={createTask.isPending}
          >
            Add
          </Button>
        </Space.Compact>
      ) : null}
    </Card>
  );
}

/* ========================================================================== */
/* Page                                                                        */
/* ========================================================================== */

export default function HrOnboardingPage() {
  const { message } = App.useApp();
  const { isHrAdmin } = useHrAccess();
  const {
    data: employeesData,
    isLoading: employeesLoading,
    isError,
    error,
  } = useHrEmployees();
  const { data: departments } = useDepartments();
  const { data: designations } = useDesignations();
  const createEmployee = useCreateEmployee();
  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm<EmployeeFormValues>();

  const employees = useMemo(() => employeesData ?? [], [employeesData]);

  const employeeOptions = useMemo(
    () =>
      employees.map((e) => ({
        value: e.id,
        label: e.full_name,
      })),
    [employees],
  );

  const { data: tasksData, isLoading: tasksLoading } =
    useOnboardingTasks(employeeId);
  const tasks = (tasksData ?? []) as unknown as OnboardingTaskRow[];

  const onboarding = useMemo(
    () =>
      tasks
        .filter((t) => t.kind === "onboarding")
        .sort((a, b) => a.sort_order - b.sort_order),
    [tasks],
  );
  const offboarding = useMemo(
    () =>
      tasks
        .filter((t) => t.kind === "offboarding")
        .sort((a, b) => a.sort_order - b.sort_order),
    [tasks],
  );

  const openCreateEmployee = () => {
    form.resetFields();
    setDrawerOpen(true);
  };

  const handleCreateEmployee = async () => {
    try {
      const values = await form.validateFields();
      const employee = await createEmployee.mutateAsync(toEmployeePayload(values));
      message.success("Employee added.");
      setDrawerOpen(false);
      form.resetFields();
      setEmployeeId(employee.id);
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "errorFields" in err
      ) {
        return;
      }
      message.error(friendlyError(err, "Failed to add employee."));
    }
  };

  return (
    <>
      <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Onboarding, offboarding &amp; documents
          </Title>
          <Text type="secondary">
            Manage employee checklists, offer letters, contracts, and generated documents from one workspace.
          </Text>
        </div>
        <Space wrap>
          <Select
            showSearch
            allowClear
            placeholder="Select an employee"
            style={{ minWidth: 260 }}
            loading={employeesLoading}
            value={employeeId}
            onChange={(value) => setEmployeeId(value)}
            options={employeeOptions}
            optionFilterProp="label"
          />
          {isHrAdmin ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreateEmployee}
            >
              Add employee
            </Button>
          ) : null}
        </Space>
      </div>

      {!isHrAdmin ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Read-only"
          description="You can view checklists, but only HR admins can edit them."
        />
      ) : null}

      {isError ? (
        <Alert
          type="error"
          showIcon
          message="Failed to load employees"
          description={
            error instanceof Error ? error.message : "Please try again."
          }
        />
      ) : !employeeId ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Select an employee to view their checklists"
        />
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <ChecklistSection
                employeeId={employeeId}
                kind="onboarding"
                title="Onboarding"
                icon={<RocketOutlined />}
                tasks={onboarding}
                loading={tasksLoading}
                canEdit={isHrAdmin}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChecklistSection
                employeeId={employeeId}
                kind="offboarding"
                title="Offboarding"
                icon={<LogoutOutlined />}
                tasks={offboarding}
                loading={tasksLoading}
                canEdit={isHrAdmin}
              />
            </Col>
          </Row>
        </div>
      )}
      </Card>

      {isHrAdmin ? (
        <div style={{ marginTop: 16 }}>
          <HrDocumentsWorkspace
            title="Letters, contracts & onboarding documents"
            description="The same employee context powers onboarding checklists and document generation here."
            selectedEmployeeId={employeeId}
            hideEmployeeSelector
            defaultDocumentType="offer_letter"
          />
        </div>
      ) : null}

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
              onClick={handleCreateEmployee}
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
            managers={employees}
          />
        </Form>
      </Drawer>
    </>
  );
}
