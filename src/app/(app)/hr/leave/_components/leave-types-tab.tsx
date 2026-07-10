"use client";

import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  ColorPicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Color } from "antd/es/color-picker";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useHrAccess } from "@/features/hr/use-hr";
import {
  useLeaveTypes,
  useCreateLeaveType,
  useUpdateLeaveType,
  useDeleteLeaveType,
} from "@/features/hr/use-leave";

/* -------------------------------------------------------------------------- */
/* Loosely-typed view of the leave-type row so this tab stays TS-sound         */
/* regardless of the exact row type Agent A's hooks return.                    */
/* -------------------------------------------------------------------------- */

type Accrual = "annual" | "monthly";

interface LeaveTypeRow {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  annual_quota: number;
  accrual: string;
  carry_forward: boolean;
  max_carry_forward: number;
  color: string | null;
}

/**
 * Turns an RLS/permission error into a friendly message. Writes to the leave
 * types table are gated to HR admins; the database raises a forbidden /
 * permission error which we surface as a clear "HR admins only" notice.
 */
function friendlyError(err: unknown, fallback: string): string {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/forbidden|permission|policy|not\s*authoriz|row-level/i.test(msg)) {
    return "HR admins only — you do not have permission to make this change.";
  }
  return msg || fallback;
}

const DEFAULT_COLOR = "#1677ff" as const;

const ACCRUAL_OPTIONS = [
  { label: "Annual", value: "annual" },
  { label: "Monthly", value: "monthly" },
] as const;

function accrualLabel(accrual: string): string {
  return accrual === "monthly" ? "Monthly" : "Annual";
}

interface LeaveTypeFormValues {
  name: string;
  code: string;
  paid: boolean;
  annual_quota: number;
  accrual: Accrual;
  carry_forward: boolean;
  max_carry_forward: number;
  color: string | Color;
}

/** Normalizes the ColorPicker value (string or antd Color) to a hex string. */
function toHex(value: string | Color | null | undefined): string {
  if (!value) return DEFAULT_COLOR;
  if (typeof value === "string") return value;
  return value.toHexString();
}

/**
 * Leave types management tab. HR admins get add/edit/delete via a modal;
 * non-admins see the same table read-only (no action column, no add button).
 */
export function LeaveTypesTab() {
  const { message } = App.useApp();
  const { isHrAdmin } = useHrAccess();
  const { data, isLoading } = useLeaveTypes();
  const createLeaveType = useCreateLeaveType();
  const updateLeaveType = useUpdateLeaveType();
  const deleteLeaveType = useDeleteLeaveType();

  const leaveTypes = useMemo(
    () => (data ?? []) as unknown as LeaveTypeRow[],
    [data],
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveTypeRow | null>(null);
  const [form] = Form.useForm<LeaveTypeFormValues>();

  // Watch carry_forward so max_carry_forward only applies when enabled.
  const carryForward = Form.useWatch("carry_forward", form);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({
        name: editing.name,
        code: editing.code,
        paid: editing.paid,
        annual_quota: editing.annual_quota,
        accrual: (editing.accrual as Accrual) ?? "annual",
        carry_forward: editing.carry_forward,
        max_carry_forward: editing.max_carry_forward,
        color: editing.color ?? DEFAULT_COLOR,
      });
    } else {
      form.setFieldsValue({
        name: "",
        code: "",
        paid: true,
        annual_quota: 0,
        accrual: "annual",
        carry_forward: false,
        max_carry_forward: 0,
        color: DEFAULT_COLOR,
      });
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (row: LeaveTypeRow) => {
    setEditing(row);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const payload = {
      name: values.name.trim(),
      code: values.code.trim(),
      paid: values.paid ?? false,
      annual_quota: values.annual_quota ?? 0,
      accrual: values.accrual,
      carry_forward: values.carry_forward ?? false,
      // When carry-forward is off, force the cap to 0 so the data stays clean.
      max_carry_forward: values.carry_forward ? (values.max_carry_forward ?? 0) : 0,
      color: toHex(values.color),
    };

    try {
      if (editing) {
        await updateLeaveType.mutateAsync({ id: editing.id, patch: payload });
        message.success("Leave type updated.");
      } else {
        await createLeaveType.mutateAsync(payload);
        message.success("Leave type created.");
      }
      closeModal();
    } catch (err) {
      message.error(
        friendlyError(
          err,
          editing ? "Failed to update leave type." : "Failed to create leave type.",
        ),
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteLeaveType.mutateAsync(id);
      message.success("Leave type deleted.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to delete leave type."));
    }
  };

  const columns = useMemo<ColumnsType<LeaveTypeRow>>(() => {
    const base: ColumnsType<LeaveTypeRow> = [
      {
        title: "Name",
        dataIndex: "name",
        key: "name",
        sorter: (a, b) => a.name.localeCompare(b.name),
        defaultSortOrder: "ascend",
        render: (name: string, record) => (
          <Space>
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: record.color ?? DEFAULT_COLOR,
              }}
            />
            <span>{name}</span>
          </Space>
        ),
      },
      {
        title: "Code",
        dataIndex: "code",
        key: "code",
        width: 120,
        render: (code: string) => <Tag>{code}</Tag>,
      },
      {
        title: "Paid",
        dataIndex: "paid",
        key: "paid",
        width: 110,
        render: (paid: boolean) =>
          paid ? (
            <Tag color="green">Paid</Tag>
          ) : (
            <Tag color="default">Unpaid</Tag>
          ),
      },
      {
        title: "Annual quota",
        dataIndex: "annual_quota",
        key: "annual_quota",
        width: 130,
        align: "right",
        sorter: (a, b) => a.annual_quota - b.annual_quota,
        render: (quota: number) => `${quota} day${quota === 1 ? "" : "s"}`,
      },
      {
        title: "Accrual",
        dataIndex: "accrual",
        key: "accrual",
        width: 120,
        render: (accrual: string) => accrualLabel(accrual),
      },
      {
        title: "Carry forward",
        dataIndex: "carry_forward",
        key: "carry_forward",
        width: 150,
        render: (carry: boolean, record) =>
          carry ? (
            <Tag color="blue">
              {record.max_carry_forward > 0
                ? `Up to ${record.max_carry_forward}`
                : "Yes"}
            </Tag>
          ) : (
            <Typography.Text type="secondary">No</Typography.Text>
          ),
      },
    ];

    if (!isHrAdmin) return base;

    return [
      ...base,
      {
        title: "Actions",
        key: "actions",
        width: 110,
        align: "right",
        render: (_, record) => (
          <Space size={0}>
            <Tooltip title="Edit leave type">
              <Button
                type="text"
                icon={<EditOutlined />}
                aria-label="Edit leave type"
                onClick={() => openEdit(record)}
              />
            </Tooltip>
            <Popconfirm
              title="Delete this leave type?"
              description="Existing balances and requests may be affected."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record.id)}
            >
              <Tooltip title="Delete leave type">
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label="Delete leave type"
                />
              </Tooltip>
            </Popconfirm>
          </Space>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHrAdmin]);

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
            Leave types
          </Typography.Title>
          <Typography.Text type="secondary">
            Categories of leave employees can request, with quotas and accrual.
          </Typography.Text>
        </div>
        {isHrAdmin ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add leave type
          </Button>
        ) : null}
      </div>

      <Table<LeaveTypeRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={leaveTypes}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      {isHrAdmin ? (
        <Modal
          title={editing ? "Edit leave type" : "Add leave type"}
          open={modalOpen}
          onOk={handleSubmit}
          confirmLoading={createLeaveType.isPending || updateLeaveType.isPending}
          okText={editing ? "Save" : "Add"}
          onCancel={closeModal}
          destroyOnHidden
        >
          <Form<LeaveTypeFormValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{
              paid: true,
              annual_quota: 0,
              accrual: "annual",
              carry_forward: false,
              max_carry_forward: 0,
              color: DEFAULT_COLOR,
            }}
          >
            <Form.Item
              label="Name"
              name="name"
              rules={[{ required: true, message: "Please enter a name." }]}
            >
              <Input placeholder="e.g. Annual Leave" autoFocus />
            </Form.Item>
            <Form.Item
              label="Code"
              name="code"
              rules={[{ required: true, message: "Please enter a code." }]}
              tooltip="Short identifier shown on balances, e.g. AL, SL, CL."
            >
              <Input placeholder="e.g. AL" />
            </Form.Item>
            <Form.Item
              label="Paid"
              name="paid"
              valuePropName="checked"
              tooltip="Paid leave does not deduct from salary."
            >
              <Switch />
            </Form.Item>
            <Form.Item
              label="Annual quota"
              name="annual_quota"
              rules={[{ required: true, message: "Please enter a quota." }]}
              tooltip="Number of days allotted per year."
            >
              <InputNumber min={0} style={{ width: "100%" }} addonAfter="days" />
            </Form.Item>
            <Form.Item
              label="Accrual"
              name="accrual"
              rules={[{ required: true, message: "Please choose an accrual." }]}
              tooltip="How the quota is granted over the year."
            >
              <Select options={[...ACCRUAL_OPTIONS]} />
            </Form.Item>
            <Form.Item
              label="Carry forward"
              name="carry_forward"
              valuePropName="checked"
              tooltip="Allow unused days to roll into the next year."
            >
              <Switch />
            </Form.Item>
            {carryForward ? (
              <Form.Item
                label="Max carry forward"
                name="max_carry_forward"
                tooltip="Maximum days that may be carried over (0 = no cap)."
              >
                <InputNumber min={0} style={{ width: "100%" }} addonAfter="days" />
              </Form.Item>
            ) : null}
            <Form.Item label="Color" name="color">
              <ColorPicker format="hex" />
            </Form.Item>
          </Form>
        </Modal>
      ) : null}
    </>
  );
}

export default LeaveTypesTab;
