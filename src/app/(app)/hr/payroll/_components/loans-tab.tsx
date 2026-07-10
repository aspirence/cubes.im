"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Result,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined } from "@ant-design/icons";
import { useHrAccess, useHrEmployees } from "@/features/hr/use-hr";
import {
  useLoans,
  useCreateLoan,
  useUpdateLoan,
} from "@/features/hr/use-payroll";

const { Text, Title } = Typography;

/* -------------------------------------------------------------------------- */
/* Loosely-typed views of the contract rows so this tab stays TS-sound         */
/* regardless of the exact shape Agent A's hooks return.                       */
/* -------------------------------------------------------------------------- */

type LoanStatus = "active" | "closed" | "paused";

interface LoanRow {
  id: string;
  employee_id: string;
  type: string;
  principal: number;
  emi: number;
  balance: number;
  status: string;
  /** Optional employee name embed (if Agent A embeds it). */
  employee?: { id?: string; full_name?: string | null } | null;
  full_name?: string | null;
}

interface EmployeeLite {
  id: string;
  full_name: string | null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function friendlyError(err: unknown, fallback: string): string {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/forbidden|permission|policy|not\s*authoriz|row-level/i.test(msg)) {
    return "HR admins only — you do not have permission to make this change.";
  }
  return msg || fallback;
}

const TYPE_OPTIONS = [
  { label: "Loan", value: "loan" },
  { label: "Advance", value: "advance" },
] as const;

const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Paused", value: "paused" },
  { label: "Closed", value: "closed" },
] as const;

const STATUS_COLOR: Record<LoanStatus, string> = {
  active: "green",
  paused: "gold",
  closed: "default",
};

function statusTag(status: string) {
  const color = STATUS_COLOR[status as LoanStatus] ?? "default";
  return <Tag color={color}>{status.toUpperCase()}</Tag>;
}

function typeLabel(type: string): string {
  return type === "advance" ? "Advance" : "Loan";
}

/* ========================================================================== */
/* Add-loan modal                                                              */
/* ========================================================================== */

interface LoanFormValues {
  employeeId: string;
  type: string;
  principal: number;
  emi: number;
}

function AddLoanModal({
  open,
  employees,
  onClose,
}: {
  open: boolean;
  employees: EmployeeLite[];
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<LoanFormValues>();
  const createLoan = useCreateLoan();

  const employeeOptions = employees.map((e) => ({
    value: e.id,
    label: e.full_name ?? e.id,
  }));

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      await createLoan.mutateAsync({
        employeeId: values.employeeId,
        type: values.type,
        principal: values.principal ?? 0,
        emi: values.emi ?? 0,
      } as never);
      message.success("Loan / advance created.");
      form.resetFields();
      onClose();
    } catch (err) {
      message.error(friendlyError(err, "Failed to create loan / advance."));
    }
  };

  return (
    <Modal
      title="Add loan / advance"
      open={open}
      onOk={handleSubmit}
      confirmLoading={createLoan.isPending}
      okText="Add"
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      destroyOnHidden
    >
      <Form<LoanFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ type: "loan", principal: 0, emi: 0 }}
      >
        <Form.Item
          label="Employee"
          name="employeeId"
          rules={[{ required: true, message: "Please select an employee." }]}
        >
          <Select
            showSearch
            placeholder="Select an employee"
            options={employeeOptions}
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item
          label="Type"
          name="type"
          rules={[{ required: true, message: "Please choose a type." }]}
        >
          <Select options={[...TYPE_OPTIONS]} />
        </Form.Item>
        <Form.Item
          label="Principal"
          name="principal"
          rules={[{ required: true, message: "Please enter the principal." }]}
          tooltip="Total amount lent / advanced."
        >
          <InputNumber<number>
            min={0}
            style={{ width: "100%" }}
            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
            parser={(v) => Number((v ?? "").replace(/,/g, ""))}
          />
        </Form.Item>
        <Form.Item
          label="EMI"
          name="emi"
          rules={[{ required: true, message: "Please enter the EMI." }]}
          tooltip="Amount deducted each payroll run."
        >
          <InputNumber<number>
            min={0}
            style={{ width: "100%" }}
            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
            parser={(v) => Number((v ?? "").replace(/,/g, ""))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ========================================================================== */
/* Loans tab                                                                   */
/* ========================================================================== */

/**
 * Loans & advances tab. HR admins manage the org's loans/advances via a table
 * and an add modal, and can flip a loan's status inline. Non-admins are denied
 * (the underlying list is RLS-scoped to HR admins).
 */
export function LoansTab() {
  const { message } = App.useApp();
  const { isHrAdmin } = useHrAccess();
  const { data: loansData, isLoading } = useLoans();
  const { data: employeesData } = useHrEmployees();
  const updateLoan = useUpdateLoan();

  const loans = useMemo(
    () => (loansData ?? []) as unknown as LoanRow[],
    [loansData],
  );
  const employees = useMemo(
    () => (employeesData ?? []) as unknown as EmployeeLite[],
    [employeesData],
  );

  const employeeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees) map.set(e.id, e.full_name ?? e.id);
    return (row: LoanRow): string =>
      row.employee?.full_name ??
      row.full_name ??
      map.get(row.employee_id) ??
      row.employee_id;
  }, [employees]);

  const [addOpen, setAddOpen] = useState(false);

  const handleStatusChange = async (row: LoanRow, status: string) => {
    try {
      await updateLoan.mutateAsync({ id: row.id, patch: { status } } as never);
      message.success("Loan updated.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to update loan."));
    }
  };

  if (!isHrAdmin) {
    return (
      <Card>
        <Result
          status="403"
          title="HR admins only"
          subTitle="Loans and advances are managed by your HR team."
        />
      </Card>
    );
  }

  const columns: ColumnsType<LoanRow> = [
    {
      title: "Employee",
      key: "employee",
      render: (_, r) => employeeName(r),
    },
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      width: 120,
      render: (type: string) => <Tag>{typeLabel(type)}</Tag>,
    },
    {
      title: "Principal",
      dataIndex: "principal",
      key: "principal",
      width: 140,
      align: "right",
      render: (v: number) => (v ?? 0).toLocaleString(),
      sorter: (a, b) => (a.principal ?? 0) - (b.principal ?? 0),
    },
    {
      title: "EMI",
      dataIndex: "emi",
      key: "emi",
      width: 130,
      align: "right",
      render: (v: number) => (v ?? 0).toLocaleString(),
    },
    {
      title: "Balance",
      dataIndex: "balance",
      key: "balance",
      width: 140,
      align: "right",
      render: (v: number) => (
        <Text strong>{(v ?? 0).toLocaleString()}</Text>
      ),
      sorter: (a, b) => (a.balance ?? 0) - (b.balance ?? 0),
    },
    {
      title: "Status",
      key: "status",
      width: 150,
      render: (_, r) => (
        <Select
          size="small"
          variant="borderless"
          value={r.status}
          options={[...STATUS_OPTIONS]}
          onChange={(v) => handleStatusChange(r, v)}
          style={{ minWidth: 110 }}
          labelRender={() => statusTag(r.status)}
        />
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
          <Title level={5} style={{ margin: 0 }}>
            Loans &amp; advances
          </Title>
          <Text type="secondary">
            Track principal, EMI and outstanding balance per employee.
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setAddOpen(true)}
        >
          Add loan / advance
        </Button>
      </div>

      <Table<LoanRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={loans}
        locale={{
          emptyText: <Empty description="No loans or advances yet" />,
        }}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      <AddLoanModal
        open={addOpen}
        employees={employees}
        onClose={() => setAddOpen(false)}
      />
    </>
  );
}

export default LoansTab;
