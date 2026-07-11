"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { PlusOutlined } from "@ant-design/icons";
import { useHrAccess } from "@/features/hr/use-hr";
import { useMyEmployee } from "@/features/hr/use-attendance";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  useMyLeaveBalances,
  useMyLeaveRequests,
  useApplyLeave,
  useCancelLeave,
  useLeaveTypes,
  usePendingLeaveRequests,
  useDecideLeave,
} from "@/features/hr/use-leave";
import LeaveTypesTab from "./_components/leave-types-tab";

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

/* -------------------------------------------------------------------------- */
/* Loosely-typed views of the contract rows so this page stays TS-sound        */
/* regardless of the exact shape Agent A's hooks return.                       */
/* -------------------------------------------------------------------------- */

interface LeaveTypeLite {
  id: string;
  name: string;
  code?: string | null;
  color?: string | null;
}

/** A balance row with the leave type's name/color embedded (per contract). */
interface LeaveBalanceRow {
  id?: string;
  leave_type_id: string;
  year: number;
  allotted: number;
  used: number;
  pending: number;
  carried_forward: number;
  leave_type?: { name?: string | null; color?: string | null } | null;
  // tolerate flat aliases
  name?: string | null;
  color?: string | null;
}

type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

/** A request row mine, with the leave type's name embedded. */
interface LeaveRequestRow {
  id: string;
  employee_id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  days: number;
  reason: string | null;
  status: string;
  note?: string | null;
  leave_type?: { name?: string | null; color?: string | null } | null;
  name?: string | null;
}

/** Org-pending request with the requesting employee + leave type embedded. */
interface PendingLeaveRow extends LeaveRequestRow {
  employee?: { id?: string; full_name?: string | null } | null;
  full_name?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function friendlyError(err: unknown, fallback: string): string {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/forbidden|permission|policy|not\s*authoriz|row-level/i.test(msg)) {
    return "You do not have permission to perform this action.";
  }
  if (/insufficient|balance|exceed|available/i.test(msg)) {
    return msg;
  }
  return msg || fallback;
}

function typeName(row: LeaveBalanceRow | LeaveRequestRow): string {
  return row.leave_type?.name ?? "Leave";
}

function typeColor(
  row: LeaveBalanceRow | LeaveRequestRow,
): string | undefined {
  return row.leave_type?.color ?? undefined;
}

function employeeName(row: PendingLeaveRow): string {
  return row.employee?.full_name ?? row.full_name ?? row.employee_id;
}

function available(b: LeaveBalanceRow): number {
  return (
    (b.allotted ?? 0) +
    (b.carried_forward ?? 0) -
    (b.used ?? 0) -
    (b.pending ?? 0)
  );
}

function formatRange(from: string, to: string): string {
  const f = dayjs(from);
  const t = dayjs(to);
  if (f.isSame(t, "day")) return f.format("D MMM YYYY");
  if (f.isSame(t, "year")) {
    return `${f.format("D MMM")} – ${t.format("D MMM YYYY")}`;
  }
  return `${f.format("D MMM YYYY")} – ${t.format("D MMM YYYY")}`;
}

const STATUS_COLOR: Record<LeaveStatus, string> = {
  pending: "gold",
  approved: "green",
  rejected: "red",
  cancelled: "default",
};

function statusTag(status: string) {
  const color = STATUS_COLOR[status as LeaveStatus] ?? "default";
  return <Tag color={color}>{status.toUpperCase()}</Tag>;
}

/** Colored dot used next to a leave type name. */
function ColorDot({ color }: { color?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color || "#d9d9d9",
        marginInlineEnd: 8,
        flex: "0 0 auto",
      }}
    />
  );
}

/* ========================================================================== */
/* Apply-for-leave modal                                                       */
/* ========================================================================== */

interface ApplyFormValues {
  leaveTypeId: string;
  range: [Dayjs, Dayjs];
  reason?: string;
}

function ApplyLeaveModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ApplyFormValues>();
  const apply = useApplyLeave();
  const { data: typesData } = useLeaveTypes();
  const types = (typesData ?? []) as unknown as LeaveTypeLite[];

  const options = types.map((t) => ({
    value: t.id,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <ColorDot color={t.color ?? undefined} />
        {t.name}
      </span>
    ),
  }));

  // Live working-day count via the count_working_days RPC, shown as a hint.
  const range = Form.useWatch("range", form);
  const from = range?.[0]?.format("YYYY-MM-DD");
  const to = range?.[1]?.format("YYYY-MM-DD");
  const workingDays = useWorkingDays(from, to);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      await apply.mutateAsync({
        leaveTypeId: values.leaveTypeId,
        from: values.range[0].format("YYYY-MM-DD"),
        to: values.range[1].format("YYYY-MM-DD"),
        reason: values.reason?.trim() || undefined,
      });
      message.success("Leave request submitted.");
      form.resetFields();
      onClose();
    } catch (err) {
      message.error(friendlyError(err, "Failed to submit leave request."));
    }
  };

  return (
    <Modal
      title="Apply for leave"
      open={open}
      onOk={handleSubmit}
      confirmLoading={apply.isPending}
      okText="Submit request"
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      destroyOnHidden
    >
      <Form<ApplyFormValues> form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          label="Leave type"
          name="leaveTypeId"
          rules={[{ required: true, message: "Please select a leave type." }]}
        >
          <Select placeholder="Select a leave type" options={options} />
        </Form.Item>
        <Form.Item
          label="Dates"
          name="range"
          rules={[{ required: true, message: "Please pick a date range." }]}
        >
          <RangePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
        </Form.Item>
        {workingDays != null ? (
          <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
            {workingDays} working day{workingDays === 1 ? "" : "s"} will be
            deducted.
          </Text>
        ) : null}
        <Form.Item label="Reason" name="reason">
          <Input.TextArea
            rows={3}
            placeholder="Optional — a short note for your approver"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/**
 * Computes the number of working days in a date range via the
 * `count_working_days` RPC (org holidays/weekends aware). Returns `null` until
 * a complete range is selected.
 */
function useWorkingDays(
  from: string | undefined,
  to: string | undefined,
): number | null {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();
  const { data } = useQuery({
    queryKey: ["hr", "count-working-days", orgId, from, to],
    enabled: Boolean(orgId) && Boolean(from) && Boolean(to),
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("count_working_days", {
        p_org_id: orgId as string,
        p_from: from as string,
        p_to: to as string,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
  });
  return data ?? null;
}

/* ========================================================================== */
/* My Leave tab                                                                */
/* ========================================================================== */

function MyLeaveTab() {
  const { message } = App.useApp();
  const [applyOpen, setApplyOpen] = useState(false);

  const { data: balancesData, isLoading: balancesLoading } =
    useMyLeaveBalances();
  const { data: requestsData, isLoading: requestsLoading } =
    useMyLeaveRequests();
  const cancel = useCancelLeave();

  const balances = (balancesData ?? []) as unknown as LeaveBalanceRow[];
  const requests = (requestsData ?? []) as unknown as LeaveRequestRow[];

  const handleCancel = async (id: string) => {
    try {
      await cancel.mutateAsync(id);
      message.success("Leave request cancelled.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to cancel leave request."));
    }
  };

  const columns: ColumnsType<LeaveRequestRow> = [
    {
      title: "Type",
      key: "type",
      render: (_, r) => (
        <Space size={4}>
          <ColorDot color={typeColor(r)} />
          {typeName(r)}
        </Space>
      ),
    },
    {
      title: "Dates",
      key: "dates",
      render: (_, r) => formatRange(r.from_date, r.to_date),
    },
    {
      title: "Days",
      dataIndex: "days",
      key: "days",
      width: 80,
      align: "center",
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string) => statusTag(status),
    },
    {
      title: "Reason",
      dataIndex: "reason",
      key: "reason",
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: "",
      key: "actions",
      width: 100,
      align: "right",
      render: (_, r) =>
        r.status === "pending" ? (
          <Popconfirm
            title="Cancel this leave request?"
            okText="Cancel request"
            okButtonProps={{ danger: true }}
            cancelText="Keep"
            onConfirm={() => handleCancel(r.id)}
          >
            <Button type="text" danger size="small" loading={cancel.isPending}>
              Cancel
            </Button>
          </Popconfirm>
        ) : null,
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
        <Title level={5} style={{ margin: 0 }}>
          My balances
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setApplyOpen(true)}
        >
          Apply for leave
        </Button>
      </div>

      {balancesLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : balances.length === 0 ? (
        <Empty
          description="No leave balances allotted yet"
          style={{ marginBottom: 16 }}
        />
      ) : (
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          {balances.map((b) => {
            const avail = available(b);
            const total = (b.allotted ?? 0) + (b.carried_forward ?? 0);
            const pct = total > 0 ? Math.round((avail / total) * 100) : 0;
            const color = typeColor(b);
            return (
              <Col xs={24} sm={12} lg={8} key={b.id ?? b.leave_type_id}>
                <Card size="small">
                  <Space
                    align="center"
                    style={{ marginBottom: 8 }}
                    size={4}
                  >
                    <ColorDot color={color} />
                    <Text strong>{typeName(b)}</Text>
                  </Space>
                  <Statistic
                    value={avail}
                    suffix={`/ ${total} available`}
                    valueStyle={{ fontSize: 22 }}
                  />
                  <Progress
                    percent={pct}
                    showInfo={false}
                    strokeColor={color || undefined}
                    style={{ marginTop: 4 }}
                  />
                  <Space
                    style={{
                      width: "100%",
                      justifyContent: "space-between",
                      marginTop: 4,
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Used {b.used ?? 0}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Pending {b.pending ?? 0}
                    </Text>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      <Title level={5}>My requests</Title>
      <Table<LeaveRequestRow>
        rowKey={(r) => r.id}
        loading={requestsLoading}
        columns={columns}
        dataSource={requests}
        locale={{ emptyText: <Empty description="No leave requests yet" /> }}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: "max-content" }}
      />

      <ApplyLeaveModal open={applyOpen} onClose={() => setApplyOpen(false)} />
    </>
  );
}

/* ========================================================================== */
/* Approvals tab                                                               */
/* ========================================================================== */

function ApprovalsTab() {
  const { message } = App.useApp();
  const { data, isLoading } = usePendingLeaveRequests();
  const decide = useDecideLeave();
  const rows = (data ?? []) as unknown as PendingLeaveRow[];

  const handleDecide = async (id: string, approve: boolean) => {
    try {
      await decide.mutateAsync({ id, approve });
      message.success(approve ? "Leave approved." : "Leave rejected.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to record decision."));
    }
  };

  const columns: ColumnsType<PendingLeaveRow> = [
    {
      title: "Employee",
      key: "employee",
      render: (_, r) => employeeName(r),
    },
    {
      title: "Type",
      key: "type",
      render: (_, r) => (
        <Space size={4}>
          <ColorDot color={typeColor(r)} />
          {typeName(r)}
        </Space>
      ),
    },
    {
      title: "Dates",
      key: "dates",
      render: (_, r) => formatRange(r.from_date, r.to_date),
    },
    {
      title: "Days",
      dataIndex: "days",
      key: "days",
      width: 80,
      align: "center",
    },
    {
      title: "Reason",
      dataIndex: "reason",
      key: "reason",
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: "Actions",
      key: "actions",
      width: 200,
      align: "right",
      render: (_, r) => (
        <Space>
          <Button
            type="primary"
            size="small"
            loading={decide.isPending}
            onClick={() => handleDecide(r.id, true)}
          >
            Approve
          </Button>
          <Button
            danger
            size="small"
            loading={decide.isPending}
            onClick={() => handleDecide(r.id, false)}
          >
            Reject
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <Title level={5} style={{ marginTop: 0 }}>
        Pending leave requests
      </Title>
      <Table<PendingLeaveRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        locale={{ emptyText: <Empty description="Nothing to approve" /> }}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: "max-content" }}
      />
    </Card>
  );
}

/* ========================================================================== */
/* Manager detection (mirrors the attendance page)                             */
/* ========================================================================== */

/**
 * A user is treated as a manager (for Approvals visibility) when at least one
 * employee in the org reports to their employee record. Read-only, RLS-safe.
 */
function useIsManager(employeeId: string | undefined): boolean {
  const supabase = useMemo(() => createClient(), []);
  const { data } = useQuery({
    queryKey: ["hr", "is-manager", employeeId],
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<boolean> => {
      const { count, error } = await supabase
        .from("hr_employees")
        .select("id", { count: "exact", head: true })
        .eq("manager_id", employeeId as string);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
  return data ?? false;
}

/* ========================================================================== */
/* Page                                                                        */
/* ========================================================================== */

export default function HrLeavePage() {
  const { isHrAdmin, isLoading: accessLoading } = useHrAccess();
  const { data: myEmployee, isLoading: employeeLoading } = useMyEmployee();

  const employee = (myEmployee ?? null) as { id?: string } | null;
  const isManager = useIsManager(employee?.id);
  const canApprove = isHrAdmin || isManager;

  if (accessLoading || employeeLoading) {
    return (
      <Card>
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin />
        </div>
      </Card>
    );
  }

  if (!employee?.id) {
    return (
      <Card>
        <Result
          status="info"
          title="No employee record"
          subTitle="Your account is not linked to an employee in this organization, so leave is unavailable. Contact your HR team to get set up."
        />
      </Card>
    );
  }

  const items = [
    { key: "mine", label: "My Leave", children: <MyLeaveTab /> },
    ...(canApprove
      ? [{ key: "approvals", label: "Approvals", children: <ApprovalsTab /> }]
      : []),
    { key: "types", label: "Leave Types", children: <LeaveTypesTab /> },
  ];

  return (
    <Card>
      <Title level={4} style={{ marginTop: 0 }}>
        Leave
      </Title>
      <Tabs defaultActiveKey="mine" items={items} destroyOnHidden />
    </Card>
  );
}
