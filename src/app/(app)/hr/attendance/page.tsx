"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  App,
  Badge,
  Button,
  Calendar,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Result,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  TimePicker,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import {
  ClockCircleOutlined,
  LoginOutlined,
  LogoutOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useHrAccess } from "@/features/hr/use-hr";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  useMyEmployee,
  useTodayAttendance,
  useClockIn,
  useClockOut,
  useMyAttendance,
  useTeamAttendance,
  useMyRegularizations,
  useRequestRegularization,
  usePendingRegularizations,
  useDecideRegularization,
} from "@/features/hr/use-attendance";
import ShiftsTab from "./_components/shifts-tab";
import HolidaysTab from "./_components/holidays-tab";
import WebhooksTab from "./_components/webhooks-tab";

const { Text, Title } = Typography;

/* -------------------------------------------------------------------------- */
/* Loosely-typed views of the contract rows so this page stays TS-sound        */
/* regardless of the exact shape Agent A's hooks return.                       */
/* -------------------------------------------------------------------------- */

type AttendanceStatus =
  | "present"
  | "absent"
  | "half_day"
  | "wfh"
  | "leave"
  | "holiday"
  | "weekend";

interface AttendanceRow {
  id: string;
  employee_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  status: string;
  work_minutes: number | null;
  source?: string | null;
}

interface RegularizationRow {
  id: string;
  date: string;
  requested_in: string | null;
  requested_out: string | null;
  reason: string | null;
  status: string;
  employee_id: string;
}

interface TeamAttendanceRow extends AttendanceRow {
  // Hooks may embed the employee; tolerate either a flat name or a join.
  employee?: { id?: string; full_name?: string } | null;
  full_name?: string | null;
}

interface PendingRegularizationRow extends RegularizationRow {
  employee?: { id?: string; full_name?: string } | null;
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
  return msg || fallback;
}

const STATUS_META: Record<
  AttendanceStatus,
  { label: string; color: string; badge: "success" | "error" | "warning" | "processing" | "default" }
> = {
  present: { label: "Present", color: "green", badge: "success" },
  wfh: { label: "WFH", color: "blue", badge: "processing" },
  half_day: { label: "Half day", color: "orange", badge: "warning" },
  leave: { label: "Leave", color: "purple", badge: "warning" },
  holiday: { label: "Holiday", color: "magenta", badge: "default" },
  weekend: { label: "Weekend", color: "default", badge: "default" },
  absent: { label: "Absent", color: "red", badge: "error" },
};

function statusMeta(status: string) {
  return (
    STATUS_META[status as AttendanceStatus] ?? {
      label: status,
      color: "default",
      badge: "default" as const,
    }
  );
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dayjs(iso).format("HH:mm");
}

function formatMinutes(mins: number | null | undefined): string {
  if (mins == null || Number.isNaN(mins)) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

/** Live "Hh Mm Ss" elapsed string from a start ISO, recomputed every second. */
function useElapsed(startIso: string | null | undefined): string {
  const [, force] = useState(0);
  useEffect(() => {
    if (!startIso) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [startIso]);
  if (!startIso) return "0:00:00";
  const total = Math.max(0, dayjs().diff(dayjs(startIso), "second"));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}`;
}

function teamName(row: TeamAttendanceRow | PendingRegularizationRow): string {
  return row.employee?.full_name ?? row.full_name ?? row.employee_id;
}

/* ========================================================================== */
/* Clock widget                                                                */
/* ========================================================================== */

function ClockWidget() {
  const { message } = App.useApp();
  const { data: today, isLoading } = useTodayAttendance();
  const clockIn = useClockIn();
  const clockOut = useClockOut();

  const attendance = (today ?? null) as AttendanceRow | null;
  const clockedIn = Boolean(attendance?.clock_in && !attendance?.clock_out);
  const clockedOut = Boolean(attendance?.clock_in && attendance?.clock_out);

  const elapsed = useElapsed(clockedIn ? attendance?.clock_in : null);

  const handleClockIn = async () => {
    try {
      await clockIn.mutateAsync();
      message.success("Clocked in.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to clock in."));
    }
  };

  const handleClockOut = async () => {
    try {
      await clockOut.mutateAsync();
      message.success("Clocked out.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to clock out."));
    }
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <Space
        direction="vertical"
        align="center"
        style={{ width: "100%" }}
        size={12}
      >
        <ClockCircleOutlined style={{ fontSize: 36, opacity: 0.65 }} />
        {isLoading ? (
          <Spin />
        ) : clockedOut ? (
          <>
            <Text type="secondary">
              {formatTime(attendance?.clock_in)} – {formatTime(attendance?.clock_out)}
            </Text>
            <Title level={3} style={{ margin: 0 }}>
              {formatMinutes(attendance?.work_minutes)}
            </Title>
            <Text type="secondary">You have clocked out for today.</Text>
            <Button size="large" icon={<LoginOutlined />} disabled>
              Clocked out
            </Button>
          </>
        ) : clockedIn ? (
          <>
            <Text type="secondary">
              Clocked in at {formatTime(attendance?.clock_in)}
            </Text>
            <Title
              level={2}
              style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}
            >
              {elapsed}
            </Title>
            <Button
              type="primary"
              danger
              size="large"
              icon={<LogoutOutlined />}
              loading={clockOut.isPending}
              onClick={handleClockOut}
            >
              Clock out
            </Button>
          </>
        ) : (
          <>
            <Title level={4} style={{ margin: 0 }}>
              {dayjs().format("dddd, D MMM")}
            </Title>
            <Text type="secondary">You have not clocked in yet.</Text>
            <Button
              type="primary"
              size="large"
              icon={<LoginOutlined />}
              loading={clockIn.isPending}
              onClick={handleClockIn}
            >
              Clock in
            </Button>
          </>
        )}
      </Space>
    </Card>
  );
}

/* ========================================================================== */
/* Regularization modal                                                        */
/* ========================================================================== */

interface RegularizationFormValues {
  date: Dayjs;
  in: Dayjs;
  out: Dayjs;
  reason?: string;
}

function RegularizationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<RegularizationFormValues>();
  const request = useRequestRegularization();

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const dateISO = values.date.format("YYYY-MM-DD");
    const toISO = (t: Dayjs) =>
      values.date
        .hour(t.hour())
        .minute(t.minute())
        .second(0)
        .millisecond(0)
        .toISOString();
    try {
      await request.mutateAsync({
        date: dateISO,
        in: toISO(values.in),
        out: toISO(values.out),
        reason: values.reason?.trim() ?? null,
      });
      message.success("Regularization requested.");
      form.resetFields();
      onClose();
    } catch (err) {
      message.error(friendlyError(err, "Failed to request regularization."));
    }
  };

  return (
    <Modal
      title="Request regularization"
      open={open}
      onOk={handleSubmit}
      confirmLoading={request.isPending}
      okText="Submit request"
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      destroyOnHidden
    >
      <Form<RegularizationFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ date: dayjs() }}
      >
        <Form.Item
          label="Date"
          name="date"
          rules={[{ required: true, message: "Please pick a date." }]}
        >
          <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              label="Clock in"
              name="in"
              rules={[{ required: true, message: "Required." }]}
            >
              <TimePicker style={{ width: "100%" }} format="HH:mm" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="Clock out"
              name="out"
              rules={[{ required: true, message: "Required." }]}
            >
              <TimePicker style={{ width: "100%" }} format="HH:mm" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label="Reason"
          name="reason"
          rules={[{ required: true, message: "Please give a reason." }]}
        >
          <Input.TextArea
            rows={3}
            placeholder="e.g. Forgot to clock in after a client meeting"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ========================================================================== */
/* My Attendance tab                                                           */
/* ========================================================================== */

function MyAttendanceTab() {
  const [cursor, setCursor] = useState<Dayjs>(dayjs());
  const [regOpen, setRegOpen] = useState(false);

  const year = cursor.year();
  const month = cursor.month() + 1; // contract: 1-based month

  const { data, isLoading } = useMyAttendance(year, month);
  const rows = (data ?? []) as unknown as AttendanceRow[];

  const byDate = useMemo(() => {
    const map = new Map<string, AttendanceRow>();
    for (const r of rows) map.set(r.date, r);
    return map;
  }, [rows]);

  const summary = useMemo(() => {
    let presentDays = 0;
    let totalMinutes = 0;
    for (const r of rows) {
      if (r.status === "present" || r.status === "wfh" || r.status === "half_day") {
        presentDays += 1;
      }
      totalMinutes += r.work_minutes ?? 0;
    }
    return { presentDays, totalMinutes };
  }, [rows]);

  const cellRender = (value: Dayjs) => {
    if (value.month() !== cursor.month() || value.year() !== cursor.year()) {
      return null;
    }
    const row = byDate.get(value.format("YYYY-MM-DD"));
    if (!row) return null;
    const meta = statusMeta(row.status);
    return (
      <Badge
        status={meta.badge}
        text={<span style={{ fontSize: 11 }}>{meta.label}</span>}
      />
    );
  };

  const { regsData, regsLoading } = useMyRegsView();

  return (
    <>
      <ClockWidget />

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={12} sm={8}>
            <Statistic
              title={`Present days (${cursor.format("MMM YYYY")})`}
              value={summary.presentDays}
            />
          </Col>
          <Col xs={12} sm={8}>
            <Statistic
              title="Total hours"
              value={(summary.totalMinutes / 60).toFixed(1)}
              suffix="h"
            />
          </Col>
        </Row>
      </Card>

      <Card
        title="Monthly calendar"
        loading={isLoading}
        style={{ marginBottom: 16 }}
      >
        <Calendar
          fullscreen
          value={cursor}
          onPanelChange={(v) => setCursor(v)}
          onChange={(v) => setCursor(v)}
          cellRender={cellRender}
        />
      </Card>

      <Card
        title="Regularization requests"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setRegOpen(true)}
          >
            Request regularization
          </Button>
        }
      >
        <List
          loading={regsLoading}
          dataSource={regsData}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No regularization requests"
              />
            ),
          }}
          renderItem={(item) => {
            const meta = statusMeta(item.status);
            return (
              <List.Item
                actions={[
                  <Tag
                    key="status"
                    color={
                      item.status === "approved"
                        ? "green"
                        : item.status === "rejected"
                          ? "red"
                          : "gold"
                    }
                  >
                    {item.status.toUpperCase()}
                  </Tag>,
                ]}
              >
                <List.Item.Meta
                  title={dayjs(item.date).format("ddd, D MMM YYYY")}
                  description={
                    <Space direction="vertical" size={0}>
                      <Text type="secondary">
                        In: {formatTime(item.requested_in)} · Out:{" "}
                        {formatTime(item.requested_out)}
                      </Text>
                      {item.reason ? <Text>{item.reason}</Text> : null}
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Card>

      <RegularizationModal open={regOpen} onClose={() => setRegOpen(false)} />
    </>
  );
}

/** Small wrapper so the regularizations query reads cleanly above. */
function useMyRegsView() {
  const { data, isLoading } = useMyRegularizations();
  return {
    regsData: (data ?? []) as unknown as RegularizationRow[],
    regsLoading: isLoading,
  };
}

/* ========================================================================== */
/* Team tab                                                                     */
/* ========================================================================== */

function TeamTab() {
  const [date, setDate] = useState<Dayjs>(dayjs());
  const dateISO = date.format("YYYY-MM-DD");
  const { data, isLoading } = useTeamAttendance(dateISO);
  const rows = (data ?? []) as unknown as TeamAttendanceRow[];

  const columns: ColumnsType<TeamAttendanceRow> = [
    {
      title: "Employee",
      key: "employee",
      render: (_, r) => teamName(r),
      sorter: (a, b) => teamName(a).localeCompare(teamName(b)),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        const meta = statusMeta(status);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "Clock in",
      dataIndex: "clock_in",
      key: "clock_in",
      render: (v: string | null) => formatTime(v),
    },
    {
      title: "Clock out",
      dataIndex: "clock_out",
      key: "clock_out",
      render: (v: string | null) => formatTime(v),
    },
    {
      title: "Hours",
      dataIndex: "work_minutes",
      key: "work_minutes",
      render: (v: number | null) => formatMinutes(v),
    },
  ];

  return (
    <Card>
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Title level={5} style={{ margin: 0 }}>
          Team attendance
        </Title>
        <DatePicker
          value={date}
          onChange={(v) => v && setDate(v)}
          allowClear={false}
          format="YYYY-MM-DD"
        />
      </Space>
      <Table<TeamAttendanceRow>
        rowKey={(r) => r.id ?? r.employee_id}
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />
    </Card>
  );
}

/* ========================================================================== */
/* Approvals tab                                                                */
/* ========================================================================== */

function ApprovalsTab() {
  const { message } = App.useApp();
  const { data, isLoading } = usePendingRegularizations();
  const decide = useDecideRegularization();
  const rows = (data ?? []) as unknown as PendingRegularizationRow[];

  const handleDecide = async (id: string, approve: boolean) => {
    try {
      await decide.mutateAsync({ id, approve, note: null });
      message.success(approve ? "Request approved." : "Request rejected.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to record decision."));
    }
  };

  const columns: ColumnsType<PendingRegularizationRow> = [
    {
      title: "Employee",
      key: "employee",
      render: (_, r) => teamName(r),
    },
    {
      title: "Date",
      dataIndex: "date",
      key: "date",
      render: (v: string) => dayjs(v).format("ddd, D MMM YYYY"),
    },
    {
      title: "Requested in/out",
      key: "times",
      render: (_, r) =>
        `${formatTime(r.requested_in)} – ${formatTime(r.requested_out)}`,
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
        Pending regularizations
      </Title>
      <Table<PendingRegularizationRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Nothing to approve"
            />
          ),
        }}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />
    </Card>
  );
}

/* ========================================================================== */
/* Manager detection                                                           */
/* ========================================================================== */

/**
 * A user is treated as a manager (for Team/Approvals visibility) when at least
 * one employee in the org reports to their employee record. Read-only, RLS-safe.
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
/* Page                                                                         */
/* ========================================================================== */

export default function HrAttendancePage() {
  const { isHrAdmin, isLoading: accessLoading } = useHrAccess();
  const { data: myEmployee, isLoading: employeeLoading } = useMyEmployee();
  const searchParams = useSearchParams();
  // Deep link target (?tab=webhooks from the App Center).
  const [activeTab, setActiveTab] = useState(
    () => searchParams.get("tab") ?? "mine",
  );

  const employee = (myEmployee ?? null) as { id?: string } | null;
  const isManager = useIsManager(employee?.id);
  const canSeeTeam = isHrAdmin || isManager;

  if (accessLoading || employeeLoading) {
    return (
      <Card>
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Spin />
        </div>
      </Card>
    );
  }

  // Non-admins need an employee record for anything here. HR admins without
  // one (e.g. the org owner doing initial setup) still get the admin surfaces
  // — shifts, holidays, webhooks — just not personal attendance.
  if (!employee?.id && !isHrAdmin) {
    return (
      <Card>
        <Result
          status="info"
          title="No employee record"
          subTitle="Your account is not linked to an employee in this organization, so attendance is unavailable. Contact your HR team to get set up."
        />
      </Card>
    );
  }

  const hasEmployee = Boolean(employee?.id);
  const items = [
    ...(hasEmployee
      ? [
          {
            key: "mine",
            label: "My Attendance",
            children: <MyAttendanceTab />,
          },
          ...(canSeeTeam
            ? [
                { key: "team", label: "Team", children: <TeamTab /> },
                { key: "approvals", label: "Approvals", children: <ApprovalsTab /> },
              ]
            : []),
        ]
      : []),
    { key: "shifts", label: "Shifts", children: <ShiftsTab /> },
    { key: "holidays", label: "Holidays", children: <HolidaysTab /> },
    ...(isHrAdmin
      ? [{ key: "webhooks", label: "Webhooks", children: <WebhooksTab /> }]
      : []),
  ];
  const fallbackTab = items[0]?.key ?? "mine";

  return (
    <Card>
      <Title level={4} style={{ marginTop: 0 }}>
        Attendance
      </Title>
      <Text type="secondary">
        Clock in and out, monthly calendars, shifts and holidays.
      </Text>
      {!hasEmployee ? (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message="Your account isn't linked to an employee record, so personal attendance is unavailable — you can still manage shifts, holidays and webhooks."
        />
      ) : null}
      <Tabs
        activeKey={items.some((i) => i.key === activeTab) ? activeTab : fallbackTab}
        onChange={setActiveTab}
        items={items}
        destroyOnHidden
        style={{ marginTop: 8 }}
      />
    </Card>
  );
}
