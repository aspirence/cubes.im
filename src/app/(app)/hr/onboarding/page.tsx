"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Progress,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
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
import { initials, statusColor, statusLabel } from "../_lib/labels";

const { Title, Text } = Typography;

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Loosely-typed view of the contract row so this page stays TS-sound          */
/* regardless of the exact shape the hooks return.                             */
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

/** Per-kind identity: glyph + tint drive the card header and progress ring. */
const KIND_META: Record<
  OnboardingKind,
  { title: string; icon: string; tint: string; blurb: string }
> = {
  onboarding: {
    title: "Onboarding",
    icon: "rocket_launch",
    tint: "#4a4ad0",
    blurb: "From offer to productive — everything day one needs.",
  },
  offboarding: {
    title: "Offboarding",
    icon: "waving_hand",
    tint: "#d9480f",
    blurb: "A clean exit — access, assets and handover.",
  },
};

const STATUS_META: Record<TaskStatus, { label: string; dot: string }> = {
  pending: { label: "Pending", dot: "#9aa0ad" },
  in_progress: { label: "In progress", dot: "#3d7de0" },
  done: { label: "Done", dot: "#2f8f5f" },
};

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
  tasks,
  loading,
  canEdit,
}: {
  employeeId: string;
  kind: OnboardingKind;
  tasks: OnboardingTaskRow[];
  loading: boolean;
  canEdit: boolean;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [newTitle, setNewTitle] = useState("");

  const createTask = useCreateOnboardingTask();
  const updateTask = useUpdateOnboardingTask();
  const deleteTask = useDeleteOnboardingTask();
  const seed = useSeedChecklist();

  const meta = KIND_META[kind];
  const done = tasks.filter((t) => t.status === "done").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const statusOptions = (Object.keys(STATUS_META) as TaskStatus[]).map((s) => ({
    value: s,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: STATUS_META[s].dot, flex: "none" }} />
        {STATUS_META[s].label}
      </span>
    ),
  }));

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
    <div
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 14,
        overflow: "hidden",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header — tinted identity + progress ring */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderBottom: `1px solid ${token.colorSplit}`,
          background: `color-mix(in srgb, ${meta.tint} 4%, transparent)`,
        }}
      >
        <span
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: `color-mix(in srgb, ${meta.tint} 12%, transparent)`,
          }}
        >
          <MIcon name={meta.icon} size={20} color={meta.tint} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: token.colorText }}>
            {meta.title}
          </div>
          <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
            {total > 0 ? (
              <>
                {done} of {total} done
                {inProgress > 0 ? ` · ${inProgress} in progress` : ""}
              </>
            ) : (
              meta.blurb
            )}
          </div>
        </div>
        {total > 0 ? (
          <Progress
            type="circle"
            size={46}
            percent={pct}
            strokeColor={meta.tint}
            strokeWidth={9}
            format={(p) => (
              <span style={{ fontSize: 12, fontWeight: 700, color: token.colorText }}>{p}%</span>
            )}
          />
        ) : null}
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: total === 0 && !loading ? 0 : "6px 8px" }}>
        {loading ? (
          <div style={{ padding: 16 }}>
            <Skeleton active paragraph={{ rows: 4 }} />
          </div>
        ) : total === 0 ? (
          <div style={{ textAlign: "center", padding: "36px 20px 40px" }}>
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: `color-mix(in srgb, ${meta.tint} 10%, transparent)`,
              }}
            >
              <MIcon name={meta.icon} size={26} color={meta.tint} />
            </span>
            <div style={{ marginTop: 12, fontSize: 13.5, fontWeight: 600, color: token.colorText }}>
              No {meta.title.toLowerCase()} tasks yet
            </div>
            <div style={{ margin: "4px auto 14px", fontSize: 12.5, color: token.colorTextTertiary, maxWidth: 260 }}>
              {meta.blurb}
            </div>
            {canEdit ? (
              <Button
                icon={<MIcon name="playlist_add_check" size={17} />}
                onClick={handleSeed}
                loading={seed.isPending}
              >
                Generate default checklist
              </Button>
            ) : null}
          </div>
        ) : (
          tasks.map((t) => {
            const isDone = t.status === "done";
            const due = t.due_date ? dayjs(t.due_date) : null;
            const overdue = due ? due.isBefore(dayjs().startOf("day")) && !isDone : false;
            return (
              <div key={t.id} className="ob-row">
                {/* Done toggle — one click completes, another reopens. */}
                <Tooltip title={isDone ? "Reopen" : "Mark done"}>
                  <button
                    type="button"
                    className={`ob-check${isDone ? " on" : ""}`}
                    disabled={!canEdit}
                    onClick={() => handleStatus(t.id, isDone ? "pending" : "done")}
                    aria-label={isDone ? "Reopen task" : "Mark task done"}
                    style={{ ["--tint" as string]: meta.tint }}
                  >
                    <MIcon name={isDone ? "check_circle" : "radio_button_unchecked"} size={20} />
                  </button>
                </Tooltip>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 550,
                      color: isDone ? token.colorTextTertiary : token.colorText,
                      textDecoration: isDone ? "line-through" : undefined,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={t.title}
                  >
                    {t.title}
                  </div>
                  {due ? (
                    <div
                      style={{
                        marginTop: 1,
                        fontSize: 11.5,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        color: overdue ? token.colorError : token.colorTextTertiary,
                      }}
                    >
                      <MIcon name="event" size={12} />
                      {due.format("MMM D, YYYY")}
                      {overdue ? " · overdue" : ""}
                    </div>
                  ) : null}
                </div>

                {canEdit ? (
                  <>
                    <Select<TaskStatus>
                      size="small"
                      variant="filled"
                      value={t.status as TaskStatus}
                      options={statusOptions}
                      onChange={(v) => handleStatus(t.id, v)}
                      popupMatchSelectWidth={false}
                      suffixIcon={null}
                      style={{ width: 120, flex: "none" }}
                    />
                    <Popconfirm
                      title="Delete this task?"
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                      cancelText="Keep"
                      onConfirm={() => handleDelete(t.id)}
                    >
                      <button type="button" className="ob-del" aria-label="Delete task">
                        <MIcon name="delete" size={16} />
                      </button>
                    </Popconfirm>
                  </>
                ) : (
                  <Tag style={{ margin: 0 }} color={isDone ? "green" : t.status === "in_progress" ? "blue" : undefined}>
                    {STATUS_META[(t.status as TaskStatus) ?? "pending"]?.label ?? t.status}
                  </Tag>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      {canEdit && total > 0 ? (
        <div style={{ padding: "10px 12px 12px", borderTop: `1px solid ${token.colorSplit}` }}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder={`Add ${meta.title.toLowerCase()} task…`}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onPressEnter={handleAdd}
              prefix={<MIcon name="add_task" size={16} color={token.colorTextTertiary} />}
            />
            <Button
              type="primary"
              onClick={handleAdd}
              loading={createTask.isPending}
              disabled={!newTitle.trim()}
            >
              Add
            </Button>
          </Space.Compact>
        </div>
      ) : null}
    </div>
  );
}

/* ========================================================================== */
/* Page                                                                        */
/* ========================================================================== */

export default function HrOnboardingPage() {
  const { token } = theme.useToken();
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
  const selected = useMemo(
    () => employees.find((e) => e.id === employeeId),
    [employees, employeeId],
  );

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
  const tasks = useMemo(
    () => (tasksData ?? []) as unknown as OnboardingTaskRow[],
    [tasksData],
  );

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
      <style>{OB_CSS(token)}</style>
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
                icon={<MIcon name="person_add" size={17} />}
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
          <div style={{ textAlign: "center", padding: "44px 20px 48px" }}>
            <span
              style={{
                width: 56,
                height: 56,
                borderRadius: 18,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: token.colorPrimaryBg,
              }}
            >
              <MIcon name="badge" size={28} color="#4a4ad0" />
            </span>
            <div style={{ marginTop: 14, fontSize: 15, fontWeight: 600, color: token.colorText }}>
              Pick an employee to get started
            </div>
            <div style={{ margin: "4px auto 0", fontSize: 13, color: token.colorTextTertiary, maxWidth: 340 }}>
              Their onboarding and offboarding checklists, plus letters and
              documents, all live here.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {/* Who we're working on — identity strip */}
            {selected ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorFillQuaternary,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 999,
                    flex: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#4a4ad0",
                    background: token.colorPrimaryBg,
                  }}
                >
                  {initials(selected.full_name)}
                </span>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: token.colorText }}>
                    {selected.full_name}
                  </div>
                  <div style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
                    {[selected.designation?.title, selected.department?.name]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                </div>
                {selected.date_of_joining ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: token.colorTextSecondary }}>
                    <MIcon name="calendar_month" size={15} color={token.colorTextTertiary} />
                    Joined {dayjs(selected.date_of_joining).format("MMM D, YYYY")}
                  </span>
                ) : null}
                {selected.status ? (
                  <Tag color={statusColor(selected.status)} style={{ margin: 0 }}>
                    {statusLabel(selected.status)}
                  </Tag>
                ) : null}
              </div>
            ) : null}

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <ChecklistSection
                  employeeId={employeeId}
                  kind="onboarding"
                  tasks={onboarding}
                  loading={tasksLoading}
                  canEdit={isHrAdmin}
                />
              </Col>
              <Col xs={24} lg={12}>
                <ChecklistSection
                  employeeId={employeeId}
                  kind="offboarding"
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

/** Row/checkbox chrome shared by both checklist cards. */
function OB_CSS(token: ReturnType<typeof theme.useToken>["token"]): string {
  return `
  .ob-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;transition:background .12s;}
  .ob-row:hover{background:${token.colorFillQuaternary};}
  .ob-row + .ob-row{margin-top:1px;}

  .ob-check{display:inline-flex;align-items:center;justify-content:center;flex:none;border:none;background:transparent;padding:2px;cursor:pointer;color:${token.colorTextQuaternary};transition:color .12s,transform .12s;}
  .ob-check:hover:not(:disabled){color:var(--tint);transform:scale(1.08);}
  .ob-check.on{color:var(--tint);}
  .ob-check:disabled{cursor:default;}

  .ob-del{display:inline-flex;align-items:center;justify-content:center;flex:none;border:none;background:transparent;padding:4px;border-radius:7px;cursor:pointer;color:${token.colorTextQuaternary};opacity:0;transition:opacity .12s,color .12s,background .12s;}
  .ob-row:hover .ob-del{opacity:1;}
  .ob-del:hover{color:${token.colorError};background:${token.colorErrorBg};}
  `;
}
