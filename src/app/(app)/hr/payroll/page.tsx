"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { DownloadOutlined, PlusOutlined } from "@ant-design/icons";
import { jsPDF } from "jspdf";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHrAccess } from "@/features/hr/use-hr";
import { useMyEmployee } from "@/features/hr/use-attendance";
import { useUserOrg } from "@/features/admin/use-admin";
import {
  usePayrollRuns,
  useRunPayroll,
  useFinalizeRun,
  useRunPayslips,
  useMyPayslips,
  useMyReimbursements,
  useSubmitReimbursement,
  usePendingReimbursements,
  useDecideReimbursement,
} from "@/features/hr/use-payroll";
import SalaryTab from "./_components/salary-tab";
import LoansTab from "./_components/loans-tab";
import BankTab from "./_components/bank-tab";

const { Text, Title } = Typography;

/* -------------------------------------------------------------------------- */
/* Loosely-typed views of the contract rows so this page stays TS-sound        */
/* regardless of the exact shape Agent A's hooks return.                        */
/* -------------------------------------------------------------------------- */

interface PayslipLine {
  name: string;
  amount: number;
}

/** A payslip row with the run period embedded (per contract). */
interface PayslipRow {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  gross: number;
  total_deductions: number;
  net: number;
  working_days: number;
  paid_days: number;
  lop_days: number;
  earnings: PayslipLine[] | null;
  deductions: PayslipLine[] | null;
  // run period — embedded for "My Payslips", or carried alongside for runs
  payroll_run?: {
    period_month?: number | null;
    period_year?: number | null;
    status?: string | null;
  } | null;
  period_month?: number | null;
  period_year?: number | null;
  // employee name — embedded for run payslips
  employee?: { full_name?: string | null } | null;
  full_name?: string | null;
}

interface PayrollRunRow {
  id: string;
  period_month: number;
  period_year: number;
  status: string;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  employee_count: number;
}

type ReimbursementStatus = "pending" | "approved" | "rejected" | "paid";

interface ReimbursementRow {
  id: string;
  employee_id: string;
  category: string | null;
  amount: number;
  date: string;
  status: string;
  employee?: { full_name?: string | null } | null;
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

/** Formats a (month, year) pair as "Mon YYYY". `month` is 1-based. */
function formatPeriod(
  month: number | null | undefined,
  year: number | null | undefined,
): string {
  if (!month || !year) return "—";
  return dayjs(new Date(year, month - 1, 1)).format("MMM YYYY");
}

function formatMoney(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function periodOf(p: PayslipRow): { month: number | null; year: number | null } {
  return {
    month: p.payroll_run?.period_month ?? p.period_month ?? null,
    year: p.payroll_run?.period_year ?? p.period_year ?? null,
  };
}

function payslipStatus(p: PayslipRow): string {
  return p.payroll_run?.status ?? "draft";
}

function lines(value: PayslipLine[] | null | undefined): PayslipLine[] {
  return Array.isArray(value) ? value : [];
}

function sumLines(value: PayslipLine[] | null | undefined): number {
  return lines(value).reduce((acc, l) => acc + Number(l.amount ?? 0), 0);
}

const STATUS_COLOR: Record<string, string> = {
  draft: "gold",
  finalized: "blue",
  paid: "green",
  pending: "gold",
  approved: "green",
  rejected: "red",
};

function statusTag(status: string) {
  const color = STATUS_COLOR[status] ?? "default";
  return <Tag color={color}>{status.toUpperCase()}</Tag>;
}

/* ========================================================================== */
/* Payslip PDF                                                                 */
/* ========================================================================== */

function downloadPayslipPdf(
  slip: PayslipRow,
  employeeName: string,
  companyName: string,
) {
  const { month, year } = periodOf(slip);
  const period = formatPeriod(month, year);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  const contentRight = pageWidth - margin;
  let y = margin;

  // Title / company header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(companyName || "Payslip", margin, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Payslip for ${period}`, margin, y);
  y += 16;

  doc.setDrawColor(200);
  doc.line(margin, y, contentRight, y);
  y += 24;

  // Employee block
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Employee", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(employeeName, margin + 90, y);
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.text("Pay period", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(period, margin + 90, y);
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.text("Paid days", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(
    `${slip.paid_days ?? 0} / ${slip.working_days ?? 0}` +
      (slip.lop_days ? `  (LOP ${slip.lop_days})` : ""),
    margin + 90,
    y,
  );
  y += 28;

  // Two columns: earnings (left) and deductions (right)
  const colGap = 24;
  const colWidth = (contentRight - margin - colGap) / 2;
  const leftX = margin;
  const rightX = margin + colWidth + colGap;
  const startY = y;

  const renderColumn = (
    x: number,
    heading: string,
    rows: PayslipLine[],
    total: number,
    totalLabel: string,
  ): number => {
    let cy = startY;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(heading, x, cy);
    cy += 8;
    doc.setDrawColor(220);
    doc.line(x, cy, x + colWidth, cy);
    cy += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    if (rows.length === 0) {
      doc.setTextColor(150);
      doc.text("—", x, cy);
      doc.setTextColor(0);
      cy += 16;
    } else {
      for (const row of rows) {
        doc.text(String(row.name ?? ""), x, cy);
        doc.text(formatMoney(row.amount), x + colWidth, cy, {
          align: "right",
        });
        cy += 16;
      }
    }
    cy += 4;
    doc.line(x, cy, x + colWidth, cy);
    cy += 16;
    doc.setFont("helvetica", "bold");
    doc.text(totalLabel, x, cy);
    doc.text(formatMoney(total), x + colWidth, cy, { align: "right" });
    return cy;
  };

  const earnings = lines(slip.earnings);
  const deductions = lines(slip.deductions);
  const gross = slip.gross ?? sumLines(slip.earnings);
  const totalDed = slip.total_deductions ?? sumLines(slip.deductions);

  const leftEnd = renderColumn(
    leftX,
    "Earnings",
    earnings,
    gross,
    "Gross earnings",
  );
  const rightEnd = renderColumn(
    rightX,
    "Deductions",
    deductions,
    totalDed,
    "Total deductions",
  );

  y = Math.max(leftEnd, rightEnd) + 36;

  // Net pay banner
  doc.setDrawColor(150);
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y - 18, contentRight - margin, 30, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Net Pay", margin + 12, y);
  doc.text(formatMoney(slip.net), contentRight - 12, y, { align: "right" });

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - margin;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text(
    "This is a computer-generated payslip and does not require a signature.",
    margin,
    footerY,
  );
  doc.setTextColor(0);

  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_");
  doc.save(`payslip-${safe(employeeName)}-${safe(period)}.pdf`);
}

/* ========================================================================== */
/* Payslip detail drawer                                                       */
/* ========================================================================== */

function PayslipDetail({
  slip,
  employeeName,
  companyName,
  open,
  onClose,
}: {
  slip: PayslipRow | null;
  employeeName: string;
  companyName: string;
  open: boolean;
  onClose: () => void;
}) {
  const earnColumns: ColumnsType<PayslipLine> = [
    { title: "Earning", dataIndex: "name", key: "name" },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      align: "right",
      render: (v: number) => formatMoney(v),
    },
  ];
  const dedColumns: ColumnsType<PayslipLine> = [
    { title: "Deduction", dataIndex: "name", key: "name" },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      align: "right",
      render: (v: number) => formatMoney(v),
    },
  ];

  const period = slip
    ? formatPeriod(periodOf(slip).month, periodOf(slip).year)
    : "";

  return (
    <Drawer
      title="Payslip"
      width={640}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        slip ? (
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() =>
              downloadPayslipPdf(slip, employeeName, companyName)
            }
          >
            Download PDF
          </Button>
        ) : null
      }
    >
      {slip ? (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Descriptions
            column={1}
            size="small"
            items={[
              { key: "company", label: "Company", children: companyName || "—" },
              {
                key: "employee",
                label: "Employee",
                children: employeeName,
              },
              { key: "period", label: "Pay period", children: period },
              {
                key: "days",
                label: "Paid days",
                children:
                  `${slip.paid_days ?? 0} / ${slip.working_days ?? 0}` +
                  (slip.lop_days ? ` (LOP ${slip.lop_days})` : ""),
              },
              {
                key: "status",
                label: "Status",
                children: statusTag(payslipStatus(slip)),
              },
            ]}
          />

          <div>
            <Title level={5}>Earnings</Title>
            <Table<PayslipLine>
              rowKey={(_, i) => String(i)}
              size="small"
              pagination={false}
              columns={earnColumns}
              dataSource={lines(slip.earnings)}
              locale={{ emptyText: <Empty description="No earnings" /> }}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <Text strong>Gross earnings</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text strong>
                      {formatMoney(slip.gross ?? sumLines(slip.earnings))}
                    </Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </div>

          <div>
            <Title level={5}>Deductions</Title>
            <Table<PayslipLine>
              rowKey={(_, i) => String(i)}
              size="small"
              pagination={false}
              columns={dedColumns}
              dataSource={lines(slip.deductions)}
              locale={{ emptyText: <Empty description="No deductions" /> }}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <Text strong>Total deductions</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text strong>
                      {formatMoney(
                        slip.total_deductions ?? sumLines(slip.deductions),
                      )}
                    </Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </div>

          <Divider style={{ margin: 0 }} />
          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <Title level={4} style={{ margin: 0 }}>
              Net Pay
            </Title>
            <Title level={4} style={{ margin: 0 }}>
              {formatMoney(slip.net)}
            </Title>
          </Space>
        </Space>
      ) : null}
    </Drawer>
  );
}

/* ========================================================================== */
/* My Payslips tab                                                             */
/* ========================================================================== */

function MyPayslipsTab({
  employeeName,
  companyName,
}: {
  employeeName: string;
  companyName: string;
}) {
  const { data, isLoading } = useMyPayslips();
  const slips = (data ?? []) as unknown as PayslipRow[];
  const [selected, setSelected] = useState<PayslipRow | null>(null);

  const columns: ColumnsType<PayslipRow> = [
    {
      title: "Period",
      key: "period",
      render: (_, r) => {
        const { month, year } = periodOf(r);
        return formatPeriod(month, year);
      },
    },
    {
      title: "Gross",
      dataIndex: "gross",
      key: "gross",
      align: "right",
      render: (v: number) => formatMoney(v),
    },
    {
      title: "Deductions",
      dataIndex: "total_deductions",
      key: "deductions",
      align: "right",
      render: (v: number) => formatMoney(v),
    },
    {
      title: "Net",
      dataIndex: "net",
      key: "net",
      align: "right",
      render: (v: number) => <Text strong>{formatMoney(v)}</Text>,
    },
    {
      title: "Status",
      key: "status",
      render: (_, r) => statusTag(payslipStatus(r)),
    },
  ];

  return (
    <>
      <Table<PayslipRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={slips}
        onRow={(r) => ({
          onClick: () => setSelected(r),
          style: { cursor: "pointer" },
        })}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: <Empty description="No payslips yet" /> }}
        pagination={{ pageSize: 12, hideOnSinglePage: true }}
      />
      <PayslipDetail
        slip={selected}
        employeeName={employeeName}
        companyName={companyName}
        open={selected != null}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

/* ========================================================================== */
/* Payroll Runs tab (HR admin)                                                 */
/* ========================================================================== */

interface RunFormValues {
  period: Dayjs;
}

function RunPayslipsDrawer({
  run,
  companyName,
  open,
  onClose,
}: {
  run: PayrollRunRow | null;
  companyName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data, isLoading } = useRunPayslips(run?.id);
  const slips = (data ?? []) as unknown as PayslipRow[];
  const [selected, setSelected] = useState<PayslipRow | null>(null);

  const nameOf = (p: PayslipRow): string =>
    p.employee?.full_name ?? p.full_name ?? p.employee_id;

  const columns: ColumnsType<PayslipRow> = [
    {
      title: "Employee",
      key: "employee",
      render: (_, r) => nameOf(r),
    },
    {
      title: "Gross",
      dataIndex: "gross",
      key: "gross",
      align: "right",
      render: (v: number) => formatMoney(v),
    },
    {
      title: "Deductions",
      dataIndex: "total_deductions",
      key: "deductions",
      align: "right",
      render: (v: number) => formatMoney(v),
    },
    {
      title: "Net",
      dataIndex: "net",
      key: "net",
      align: "right",
      render: (v: number) => <Text strong>{formatMoney(v)}</Text>,
    },
  ];

  return (
    <>
      <Drawer
        title={
          run
            ? `Payslips — ${formatPeriod(run.period_month, run.period_year)}`
            : "Payslips"
        }
        width={760}
        open={open}
        onClose={onClose}
        destroyOnHidden
      >
        <Table<PayslipRow>
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={slips}
          onRow={(r) => ({
            onClick: () => setSelected(r),
            style: { cursor: "pointer" },
          })}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <Empty description="No payslips in this run" /> }}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
        />
      </Drawer>
      <PayslipDetail
        slip={selected}
        employeeName={selected ? nameOf(selected) : ""}
        companyName={companyName}
        open={selected != null}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function PayrollRunsTab({ companyName }: { companyName: string }) {
  const { message } = App.useApp();
  const { data, isLoading } = usePayrollRuns();
  const runPayroll = useRunPayroll();
  const finalize = useFinalizeRun();
  const [form] = Form.useForm<RunFormValues>();
  const [viewRun, setViewRun] = useState<PayrollRunRow | null>(null);

  const runs = (data ?? []) as unknown as PayrollRunRow[];

  const handleRun = async () => {
    const values = await form.validateFields();
    try {
      await runPayroll.mutateAsync({
        month: values.period.month() + 1,
        year: values.period.year(),
      });
      message.success("Payroll run created.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to run payroll."));
    }
  };

  const handleFinalize = async (runId: string) => {
    try {
      await finalize.mutateAsync(runId);
      message.success("Payroll run finalized.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to finalize run."));
    }
  };

  const columns: ColumnsType<PayrollRunRow> = [
    {
      title: "Period",
      key: "period",
      render: (_, r) => formatPeriod(r.period_month, r.period_year),
    },
    {
      title: "Employees",
      dataIndex: "employee_count",
      key: "employee_count",
      align: "center",
    },
    {
      title: "Gross",
      dataIndex: "total_gross",
      key: "total_gross",
      align: "right",
      render: (v: number) => formatMoney(v),
    },
    {
      title: "Net",
      dataIndex: "total_net",
      key: "total_net",
      align: "right",
      render: (v: number) => <Text strong>{formatMoney(v)}</Text>,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (v: string) => statusTag(v),
    },
    {
      title: "",
      key: "actions",
      align: "right",
      width: 200,
      render: (_, r) => (
        <Space>
          <Button size="small" onClick={() => setViewRun(r)}>
            View payslips
          </Button>
          {r.status === "draft" ? (
            <Button
              type="primary"
              size="small"
              loading={finalize.isPending}
              onClick={() => handleFinalize(r.id)}
            >
              Finalize
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Form
          form={form}
          layout="inline"
          requiredMark={false}
          initialValues={{ period: dayjs().subtract(1, "month").startOf("month") }}
        >
          <Form.Item
            label="Period"
            name="period"
            rules={[{ required: true, message: "Pick a month." }]}
          >
            <DatePicker
              picker="month"
              format="MMM YYYY"
              allowClear={false}
              style={{ width: 160 }}
            />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={runPayroll.isPending}
              onClick={handleRun}
            >
              Run payroll
            </Button>
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          Running payroll rebuilds the payslips for the selected month.
        </Text>
      </Card>

      <Table<PayrollRunRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={runs}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: <Empty description="No payroll runs yet" /> }}
        pagination={{ pageSize: 12, hideOnSinglePage: true }}
      />

      <RunPayslipsDrawer
        run={viewRun}
        companyName={companyName}
        open={viewRun != null}
        onClose={() => setViewRun(null)}
      />
    </>
  );
}

/* ========================================================================== */
/* Reimbursements tab                                                          */
/* ========================================================================== */

interface ClaimFormValues {
  category: string;
  amount: number;
  date: Dayjs;
}

function NewClaimModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ClaimFormValues>();
  const submit = useSubmitReimbursement();

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      await submit.mutateAsync({
        category: values.category.trim(),
        amount: values.amount,
        date: values.date.format("YYYY-MM-DD"),
      });
      message.success("Claim submitted.");
      form.resetFields();
      onClose();
    } catch (err) {
      message.error(friendlyError(err, "Failed to submit claim."));
    }
  };

  return (
    <Modal
      title="New reimbursement claim"
      open={open}
      onOk={handleSubmit}
      confirmLoading={submit.isPending}
      okText="Submit claim"
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      destroyOnHidden
    >
      <Form<ClaimFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ date: dayjs() }}
      >
        <Form.Item
          label="Category"
          name="category"
          rules={[{ required: true, message: "Please enter a category." }]}
        >
          <Input placeholder="e.g. Travel, Meals, Equipment" />
        </Form.Item>
        <Form.Item
          label="Amount"
          name="amount"
          rules={[{ required: true, message: "Please enter an amount." }]}
        >
          <InputNumber
            min={0}
            step={1}
            style={{ width: "100%" }}
            placeholder="0.00"
          />
        </Form.Item>
        <Form.Item
          label="Date"
          name="date"
          rules={[{ required: true, message: "Please pick a date." }]}
        >
          <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ApprovalsSection() {
  const { message } = App.useApp();
  const { data, isLoading } = usePendingReimbursements();
  const decide = useDecideReimbursement();
  const rows = (data ?? []) as unknown as ReimbursementRow[];

  const handleDecide = async (id: string, approve: boolean) => {
    try {
      await decide.mutateAsync({ id, approve });
      message.success(approve ? "Claim approved." : "Claim rejected.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to record decision."));
    }
  };

  const columns: ColumnsType<ReimbursementRow> = [
    {
      title: "Employee",
      key: "employee",
      render: (_, r) => r.employee?.full_name ?? r.full_name ?? r.employee_id,
    },
    {
      title: "Category",
      dataIndex: "category",
      key: "category",
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: "Date",
      dataIndex: "date",
      key: "date",
      render: (v: string) => dayjs(v).format("D MMM YYYY"),
    },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      align: "right",
      render: (v: number) => formatMoney(v),
    },
    {
      title: "Actions",
      key: "actions",
      align: "right",
      width: 200,
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
    <Card style={{ marginTop: 16 }}>
      <Title level={5} style={{ marginTop: 0 }}>
        Pending approvals
      </Title>
      <Table<ReimbursementRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: <Empty description="Nothing to approve" /> }}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />
    </Card>
  );
}

function ReimbursementsTab({ canApprove }: { canApprove: boolean }) {
  const { data, isLoading } = useMyReimbursements();
  const rows = (data ?? []) as unknown as ReimbursementRow[];
  const [claimOpen, setClaimOpen] = useState(false);

  const columns: ColumnsType<ReimbursementRow> = [
    {
      title: "Category",
      dataIndex: "category",
      key: "category",
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: "Date",
      dataIndex: "date",
      key: "date",
      render: (v: string) => dayjs(v).format("D MMM YYYY"),
    },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      align: "right",
      render: (v: number) => formatMoney(v),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (v: string) => statusTag(v),
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
          My claims
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setClaimOpen(true)}
        >
          New claim
        </Button>
      </div>

      <Table<ReimbursementRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: <Empty description="No claims yet" /> }}
        pagination={{ pageSize: 12, hideOnSinglePage: true }}
      />

      {canApprove ? <ApprovalsSection /> : null}

      <NewClaimModal open={claimOpen} onClose={() => setClaimOpen(false)} />
    </>
  );
}

/* ========================================================================== */
/* Manager detection (mirrors the leave/attendance pages)                      */
/* ========================================================================== */

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

export default function HrPayrollPage() {
  const { isHrAdmin, isLoading: accessLoading } = useHrAccess();
  const { data: myEmployee, isLoading: employeeLoading } = useMyEmployee();
  const { data: userOrg } = useUserOrg();

  const employee = (myEmployee ?? null) as {
    id?: string;
    full_name?: string | null;
  } | null;
  const isManager = useIsManager(employee?.id);
  const canApprove = isHrAdmin || isManager;

  const companyName = userOrg?.org?.organization_name ?? "";
  const employeeName = employee?.full_name ?? "Employee";

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
          subTitle="Your account is not linked to an employee in this organization, so payroll is unavailable. Contact your HR team to get set up."
        />
      </Card>
    );
  }

  const items = [
    {
      key: "payslips",
      label: "My Payslips",
      children: (
        <MyPayslipsTab employeeName={employeeName} companyName={companyName} />
      ),
    },
    ...(isHrAdmin
      ? [
          {
            key: "runs",
            label: "Payroll Runs",
            children: <PayrollRunsTab companyName={companyName} />,
          },
        ]
      : []),
    {
      key: "reimbursements",
      label: "Reimbursements",
      children: <ReimbursementsTab canApprove={canApprove} />,
    },
    { key: "salary", label: "Salary", children: <SalaryTab /> },
    { key: "loans", label: "Loans", children: <LoansTab /> },
    { key: "bank", label: "Bank", children: <BankTab /> },
  ];

  return (
    <Card>
      <Title level={4} style={{ marginTop: 0 }}>
        Payroll
      </Title>
      <Tabs defaultActiveKey="payslips" items={items} destroyOnHidden />
    </Card>
  );
}
