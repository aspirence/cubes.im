"use client";

import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Result,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import {
  PlusOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useHrAccess, useHrEmployees } from "@/features/hr/use-hr";
import {
  useEmployeeSalary,
  useUpsertSalaryStructure,
  useAddSalaryComponent,
  useDeleteSalaryComponent,
  useApplyIndiaPreset,
} from "@/features/hr/use-payroll";

const { Text, Title } = Typography;

/* -------------------------------------------------------------------------- */
/* Loosely-typed views of the contract rows so this tab stays TS-sound         */
/* regardless of the exact shape Agent A's hooks return.                       */
/* -------------------------------------------------------------------------- */

type ComponentKind = "earning" | "deduction";
type ComponentCalc = "fixed" | "percent_of_ctc" | "percent_of_basic";

interface SalaryStructureLite {
  id: string;
  employee_id: string;
  effective_from: string | null;
  ctc: number;
  currency: string | null;
}

interface SalaryComponentLite {
  id: string;
  structure_id: string;
  name: string;
  kind: string;
  calc: string;
  value: number;
  is_basic: boolean | null;
  sort_order: number | null;
}

/** Shape returned by useEmployeeSalary: { structure, components }. */
interface SalaryData {
  structure: SalaryStructureLite | null;
  components: SalaryComponentLite[];
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

const CURRENCY_OPTIONS = [
  { label: "INR (₹)", value: "INR" },
  { label: "USD ($)", value: "USD" },
  { label: "EUR (€)", value: "EUR" },
  { label: "GBP (£)", value: "GBP" },
  { label: "AUD (A$)", value: "AUD" },
  { label: "CAD (C$)", value: "CAD" },
  { label: "SGD (S$)", value: "SGD" },
] as const;

const KIND_OPTIONS = [
  { label: "Earning", value: "earning" },
  { label: "Deduction", value: "deduction" },
] as const;

const CALC_OPTIONS = [
  { label: "Fixed amount", value: "fixed" },
  { label: "% of CTC", value: "percent_of_ctc" },
  { label: "% of Basic", value: "percent_of_basic" },
] as const;

function calcLabel(calc: string): string {
  switch (calc) {
    case "percent_of_ctc":
      return "% of CTC";
    case "percent_of_basic":
      return "% of Basic";
    default:
      return "Fixed";
  }
}

function formatMoney(value: number, currency: string | null | undefined): string {
  const cur = currency || "INR";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${cur} ${value.toLocaleString()}`;
  }
}

function formatComponentValue(c: SalaryComponentLite): string {
  return c.calc === "fixed"
    ? c.value.toLocaleString()
    : `${c.value}%`;
}

/* ========================================================================== */
/* Set-structure form                                                          */
/* ========================================================================== */

interface StructureFormValues {
  ctc: number;
  currency: string;
  effectiveFrom?: Dayjs | null;
}

/* ========================================================================== */
/* Add-component modal                                                         */
/* ========================================================================== */

interface ComponentFormValues {
  name: string;
  kind: ComponentKind;
  calc: ComponentCalc;
  value: number;
  is_basic: boolean;
  sort_order?: number;
}

function AddComponentModal({
  open,
  structureId,
  onClose,
}: {
  open: boolean;
  structureId: string | undefined;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ComponentFormValues>();
  const addComponent = useAddSalaryComponent();

  const handleSubmit = async () => {
    if (!structureId) return;
    const values = await form.validateFields();
    try {
      await addComponent.mutateAsync({
        structureId,
        name: values.name.trim(),
        kind: values.kind,
        calc: values.calc,
        value: values.value ?? 0,
        isBasic: values.is_basic ?? false,
        sortOrder: values.sort_order ?? 0,
      } as never);
      message.success("Component added.");
      form.resetFields();
      onClose();
    } catch (err) {
      message.error(friendlyError(err, "Failed to add component."));
    }
  };

  return (
    <Modal
      title="Add salary component"
      open={open}
      onOk={handleSubmit}
      confirmLoading={addComponent.isPending}
      okText="Add"
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      destroyOnHidden
    >
      <Form<ComponentFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{
          kind: "earning",
          calc: "fixed",
          value: 0,
          is_basic: false,
          sort_order: 0,
        }}
      >
        <Form.Item
          label="Name"
          name="name"
          rules={[{ required: true, message: "Please enter a name." }]}
        >
          <Input placeholder="e.g. Basic, HRA, PF" autoFocus />
        </Form.Item>
        <Form.Item
          label="Kind"
          name="kind"
          rules={[{ required: true, message: "Please choose a kind." }]}
        >
          <Select options={[...KIND_OPTIONS]} />
        </Form.Item>
        <Form.Item
          label="Calculation"
          name="calc"
          rules={[{ required: true, message: "Please choose a calculation." }]}
          tooltip="Fixed amount, or a percentage of CTC / Basic."
        >
          <Select options={[...CALC_OPTIONS]} />
        </Form.Item>
        <Form.Item
          label="Value"
          name="value"
          rules={[{ required: true, message: "Please enter a value." }]}
          tooltip="An amount for fixed, or a percentage for the percent calculations."
        >
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          label="Is basic"
          name="is_basic"
          valuePropName="checked"
          tooltip="Mark the component that represents the Basic salary (used by percent-of-basic components)."
        >
          <Switch />
        </Form.Item>
        <Form.Item
          label="Sort order"
          name="sort_order"
          tooltip="Lower numbers appear first on the payslip."
        >
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ========================================================================== */
/* Salary tab                                                                  */
/* ========================================================================== */

/**
 * Salary structures tab. HR admins pick an employee, set their CTC + currency,
 * optionally apply the India preset, and add/delete components. Non-admins get
 * a read-only view (no employee picker writes are blocked by RLS anyway).
 */
export function SalaryTab() {
  const { message } = App.useApp();
  const { isHrAdmin } = useHrAccess();
  const { data: employeesData, isLoading: employeesLoading } = useHrEmployees();

  const employees = useMemo(
    () => (employeesData ?? []) as unknown as EmployeeLite[],
    [employeesData],
  );

  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined);

  // Default to the first employee once the list resolves.
  useEffect(() => {
    if (!employeeId && employees.length > 0) {
      setEmployeeId(employees[0]?.id);
    }
  }, [employees, employeeId]);

  const { data: salaryData, isLoading: salaryLoading } =
    useEmployeeSalary(employeeId);
  const salary = (salaryData ?? null) as unknown as SalaryData | null;
  const structure = salary?.structure ?? null;
  const components = useMemo(
    () => (salary?.components ?? []) as SalaryComponentLite[],
    [salary],
  );

  const upsertStructure = useUpsertSalaryStructure();
  const deleteComponent = useDeleteSalaryComponent();
  const applyPreset = useApplyIndiaPreset();

  const [form] = Form.useForm<StructureFormValues>();
  const [addOpen, setAddOpen] = useState(false);

  // Sync the form to the selected employee's structure.
  useEffect(() => {
    form.setFieldsValue({
      ctc: structure?.ctc ?? 0,
      currency: structure?.currency ?? "INR",
      effectiveFrom: structure?.effective_from
        ? dayjs(structure.effective_from)
        : null,
    });
  }, [form, structure]);

  const handleSaveStructure = async () => {
    if (!employeeId) return;
    const values = await form.validateFields();
    try {
      await upsertStructure.mutateAsync({
        employeeId,
        ctc: values.ctc ?? 0,
        currency: values.currency,
        effectiveFrom: values.effectiveFrom
          ? values.effectiveFrom.format("YYYY-MM-DD")
          : undefined,
      });
      message.success("Salary structure saved.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to save salary structure."));
    }
  };

  const handleApplyPreset = async () => {
    if (!structure?.id) return;
    try {
      await applyPreset.mutateAsync(structure.id);
      message.success("India salary preset applied.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to apply preset."));
    }
  };

  const handleDeleteComponent = async (id: string) => {
    try {
      await deleteComponent.mutateAsync(id);
      message.success("Component removed.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to remove component."));
    }
  };

  const columns = useMemo<ColumnsType<SalaryComponentLite>>(() => {
    const base: ColumnsType<SalaryComponentLite> = [
      {
        title: "Name",
        dataIndex: "name",
        key: "name",
        render: (name: string, record) => (
          <Space size={4}>
            <span>{name}</span>
            {record.is_basic ? <Tag color="blue">Basic</Tag> : null}
          </Space>
        ),
      },
      {
        title: "Kind",
        dataIndex: "kind",
        key: "kind",
        width: 130,
        render: (kind: string) =>
          kind === "deduction" ? (
            <Tag color="red">Deduction</Tag>
          ) : (
            <Tag color="green">Earning</Tag>
          ),
      },
      {
        title: "Calculation",
        dataIndex: "calc",
        key: "calc",
        width: 140,
        render: (calc: string) => calcLabel(calc),
      },
      {
        title: "Value",
        key: "value",
        width: 130,
        align: "right",
        render: (_, record) => formatComponentValue(record),
      },
    ];

    if (!isHrAdmin) return base;

    return [
      ...base,
      {
        title: "",
        key: "actions",
        width: 60,
        align: "right",
        render: (_, record) => (
          <Popconfirm
            title="Remove this component?"
            okText="Remove"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDeleteComponent(record.id)}
          >
            <Tooltip title="Remove component">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label="Remove component"
              />
            </Tooltip>
          </Popconfirm>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHrAdmin]);

  const employeeOptions = employees.map((e) => ({
    value: e.id,
    label: e.full_name ?? e.id,
  }));

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={5} style={{ margin: 0 }}>
            Salary structures
          </Title>
          <Text type="secondary">
            CTC, currency and the earning/deduction components per employee.
          </Text>
        </div>
        <Select
          showSearch
          style={{ minWidth: 260 }}
          placeholder="Select an employee"
          loading={employeesLoading}
          value={employeeId}
          onChange={setEmployeeId}
          options={employeeOptions}
          optionFilterProp="label"
        />
      </div>

      {!employeeId ? (
        <Empty description="Select an employee to view their salary structure" />
      ) : salaryLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={10}>
            <Card size="small" title="Structure">
              {isHrAdmin ? (
                <Form<StructureFormValues>
                  form={form}
                  layout="vertical"
                  requiredMark={false}
                >
                  <Form.Item
                    label="Annual CTC"
                    name="ctc"
                    rules={[{ required: true, message: "Please enter the CTC." }]}
                    tooltip="Total annual cost-to-company."
                  >
                    <InputNumber<number>
                      min={0}
                      style={{ width: "100%" }}
                      formatter={(v) =>
                        `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                      }
                      parser={(v) => Number((v ?? "").replace(/,/g, ""))}
                    />
                  </Form.Item>
                  <Form.Item
                    label="Currency"
                    name="currency"
                    rules={[
                      { required: true, message: "Please choose a currency." },
                    ]}
                  >
                    <Select options={[...CURRENCY_OPTIONS]} showSearch />
                  </Form.Item>
                  <Form.Item
                    label="Effective from"
                    name="effectiveFrom"
                    tooltip="When this structure takes effect (optional)."
                  >
                    <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
                  </Form.Item>
                  <Space>
                    <Button
                      type="primary"
                      loading={upsertStructure.isPending}
                      onClick={handleSaveStructure}
                    >
                      {structure ? "Save structure" : "Create structure"}
                    </Button>
                    {structure ? (
                      <Button
                        icon={<ThunderboltOutlined />}
                        loading={applyPreset.isPending}
                        onClick={handleApplyPreset}
                      >
                        Apply India preset
                      </Button>
                    ) : null}
                  </Space>
                </Form>
              ) : structure ? (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Annual CTC">
                    {formatMoney(structure.ctc, structure.currency)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Currency">
                    {structure.currency ?? "INR"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Effective from">
                    {structure.effective_from
                      ? dayjs(structure.effective_from).format("D MMM YYYY")
                      : "—"}
                  </Descriptions.Item>
                </Descriptions>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No salary structure set"
                />
              )}
            </Card>
          </Col>

          <Col xs={24} lg={14}>
            <Card
              size="small"
              title="Components"
              extra={
                isHrAdmin && structure ? (
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => setAddOpen(true)}
                  >
                    Add component
                  </Button>
                ) : null
              }
            >
              {!structure ? (
                <Result
                  status="info"
                  subTitle="Create a salary structure first, then add components."
                  style={{ padding: 16 }}
                />
              ) : (
                <Table<SalaryComponentLite>
                  rowKey="id"
                  size="small"
                  columns={columns}
                  dataSource={components}
                  scroll={{ x: "max-content" }}
                  locale={{
                    emptyText: (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="No components yet"
                      />
                    ),
                  }}
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                />
              )}
            </Card>
          </Col>
        </Row>
      )}

      {isHrAdmin ? (
        <AddComponentModal
          open={addOpen}
          structureId={structure?.id}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </>
  );
}

export default SalaryTab;
