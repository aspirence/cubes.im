"use client";

import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  TimePicker,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useHrAccess } from "@/features/hr/use-hr";
import {
  useShifts,
  useCreateShift,
  useUpdateShift,
  useDeleteShift,
} from "@/features/hr/use-attendance";
import type { HrShiftRow } from "@/features/hr/types";

/**
 * Turns an RLS/permission error into a friendly message. Writes to the shift
 * table are gated to HR admins; the database raises a forbidden / permission
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

/** Postgres `time` columns serialize as e.g. "09:00:00". */
const TIME_FORMAT = "HH:mm:ss" as const;
/** What we show in the picker / table. */
const TIME_DISPLAY = "HH:mm" as const;

/** Days of the week; index === DB day number (0 = Sun .. 6 = Sat). */
const WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const WEEKDAY_OPTIONS = WEEKDAYS.map((label, value) => ({ label, value }));

/**
 * Parses a Postgres `time` string ("HH:mm:ss" / "HH:mm") into a Dayjs anchored
 * to today. We build a full ISO datetime so native `dayjs()` can parse it
 * without the customParseFormat plugin (which is not globally extended).
 */
function parseTime(value: string | null): Dayjs | null {
  if (!value) return null;
  const today = dayjs().format("YYYY-MM-DD");
  const d = dayjs(`${today}T${value}`);
  return d.isValid() ? d : null;
}

/** Serializes a TimePicker Dayjs back to a Postgres `time` string. */
function serializeTime(value: Dayjs | null | undefined): string | null {
  return value ? value.format(TIME_FORMAT) : null;
}

/** Renders a Postgres `time` string for display, falling back to a dash. */
function displayTime(value: string | null): string {
  const d = parseTime(value);
  return d ? d.format(TIME_DISPLAY) : "—";
}

interface ShiftFormValues {
  name: string;
  start_time: Dayjs | null;
  end_time: Dayjs | null;
  break_minutes: number;
  working_days: number[];
}

/**
 * Shifts management tab. HR admins get full CRUD (add/edit/delete) via a modal;
 * non-admins see the same table read-only (no action column, no add button).
 */
export function ShiftsTab() {
  const { message } = App.useApp();
  const { isHrAdmin } = useHrAccess();
  const { data, isLoading } = useShifts();
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const deleteShift = useDeleteShift();

  const shifts = (data ?? []) as HrShiftRow[];

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<HrShiftRow | null>(null);
  const [form] = Form.useForm<ShiftFormValues>();

  useEffect(() => {
    if (modalOpen) {
      form.setFieldsValue({
        name: editing?.name ?? "",
        start_time: parseTime(editing?.start_time ?? null),
        end_time: parseTime(editing?.end_time ?? null),
        break_minutes: editing?.break_minutes ?? 0,
        working_days: editing?.working_days ?? [1, 2, 3, 4, 5],
      });
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: HrShiftRow) => {
    setEditing(record);
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
      start_time: serializeTime(values.start_time),
      end_time: serializeTime(values.end_time),
      break_minutes: values.break_minutes ?? 0,
      working_days: [...(values.working_days ?? [])].sort((a, b) => a - b),
    };
    try {
      if (editing) {
        await updateShift.mutateAsync({ id: editing.id, patch: payload });
        message.success("Shift updated.");
      } else {
        await createShift.mutateAsync(payload);
        message.success("Shift created.");
      }
      closeModal();
    } catch (err) {
      message.error(friendlyError(err, "Failed to save shift."));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteShift.mutateAsync(id);
      message.success("Shift deleted.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to delete shift."));
    }
  };

  const columns = useMemo<ColumnsType<HrShiftRow>>(() => {
    const base: ColumnsType<HrShiftRow> = [
      {
        title: "Name",
        dataIndex: "name",
        key: "name",
        sorter: (a, b) => a.name.localeCompare(b.name),
        render: (name: string, record) => (
          <Space>
            <span>{name}</span>
            {record.is_default ? <Tag color="blue">Default</Tag> : null}
          </Space>
        ),
      },
      {
        title: "Time",
        key: "time",
        render: (_, record) =>
          `${displayTime(record.start_time)} – ${displayTime(record.end_time)}`,
      },
      {
        title: "Break",
        dataIndex: "break_minutes",
        key: "break_minutes",
        width: 110,
        render: (mins: number) => `${mins ?? 0} min`,
      },
      {
        title: "Working days",
        key: "working_days",
        render: (_, record) => {
          const days = [...(record.working_days ?? [])].sort((a, b) => a - b);
          if (days.length === 0)
            return <Typography.Text type="secondary">—</Typography.Text>;
          return (
            <Space size={4} wrap>
              {days.map((d) => (
                <Tag key={d}>{WEEKDAYS[d] ?? d}</Tag>
              ))}
            </Space>
          );
        },
      },
    ];

    if (!isHrAdmin) return base;

    return [
      ...base,
      {
        title: "Actions",
        key: "actions",
        width: 120,
        align: "right",
        render: (_, record) => (
          <Space>
            <Tooltip title="Edit shift">
              <Button
                type="text"
                icon={<EditOutlined />}
                onClick={() => openEdit(record)}
                aria-label="Edit shift"
              />
            </Tooltip>
            <Popconfirm
              title="Delete this shift?"
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record.id)}
            >
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label="Delete shift"
              />
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
            Shifts
          </Typography.Title>
          <Typography.Text type="secondary">
            Working hours and weekly schedules used for attendance.
          </Typography.Text>
        </div>
        {isHrAdmin ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add shift
          </Button>
        ) : null}
      </div>

      <Table<HrShiftRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={shifts}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
      />

      {isHrAdmin ? (
        <Modal
          title={editing ? "Edit shift" : "Add shift"}
          open={modalOpen}
          onOk={handleSubmit}
          confirmLoading={createShift.isPending || updateShift.isPending}
          okText={editing ? "Save" : "Create"}
          onCancel={closeModal}
          destroyOnHidden
        >
          <Form<ShiftFormValues>
            form={form}
            layout="vertical"
            requiredMark={false}
          >
            <Form.Item
              label="Name"
              name="name"
              rules={[{ required: true, message: "Please enter a name." }]}
            >
              <Input placeholder="e.g. General (9–6)" autoFocus />
            </Form.Item>

            <Space size="large" style={{ display: "flex" }}>
              <Form.Item
                label="Start time"
                name="start_time"
                style={{ flex: 1 }}
              >
                <TimePicker
                  format={TIME_DISPLAY}
                  minuteStep={5}
                  style={{ width: "100%" }}
                />
              </Form.Item>
              <Form.Item label="End time" name="end_time" style={{ flex: 1 }}>
                <TimePicker
                  format={TIME_DISPLAY}
                  minuteStep={5}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Space>

            <Form.Item
              label="Break (minutes)"
              name="break_minutes"
              rules={[
                { required: true, message: "Please enter break minutes." },
              ]}
            >
              <InputNumber min={0} max={600} style={{ width: "100%" }} />
            </Form.Item>

            <Form.Item
              label="Working days"
              name="working_days"
              rules={[
                {
                  required: true,
                  message: "Select at least one working day.",
                },
              ]}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="Select working days"
                options={WEEKDAY_OPTIONS}
              />
            </Form.Item>
          </Form>
        </Modal>
      ) : null}
    </>
  );
}

export default ShiftsTab;
