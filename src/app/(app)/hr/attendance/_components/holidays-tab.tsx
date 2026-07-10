"use client";

import { useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useHrAccess } from "@/features/hr/use-hr";
import {
  useHolidays,
  useCreateHoliday,
  useDeleteHoliday,
} from "@/features/hr/use-attendance";
import type { HrHolidayRow } from "@/features/hr/types";

/**
 * Turns an RLS/permission error into a friendly message. Writes to the holiday
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

/** Postgres `date` columns serialize as "YYYY-MM-DD". */
const DATE_FORMAT = "YYYY-MM-DD" as const;
/** Friendly display format for the table. */
const DATE_DISPLAY = "ddd, DD MMM YYYY" as const;

/**
 * Parses a Postgres `date` string ("YYYY-MM-DD") into a Dayjs. ISO dates parse
 * natively, so no customParseFormat plugin is required.
 */
function parseDate(value: string | null | undefined): Dayjs | null {
  if (!value) return null;
  const d = dayjs(value);
  return d.isValid() ? d : null;
}

interface HolidayFormValues {
  date: Dayjs | null;
  name: string;
  optional: boolean;
}

/**
 * Holidays management tab. HR admins get add/delete via a modal; non-admins see
 * the same table read-only (no action column, no add button).
 */
export function HolidaysTab() {
  const { message } = App.useApp();
  const { isHrAdmin } = useHrAccess();
  const { data, isLoading } = useHolidays();
  const createHoliday = useCreateHoliday();
  const deleteHoliday = useDeleteHoliday();

  const holidays = useMemo(() => {
    const rows = (data ?? []) as HrHolidayRow[];
    return [...rows].sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<HolidayFormValues>();

  useEffect(() => {
    if (modalOpen) {
      form.setFieldsValue({ date: null, name: "", optional: false });
    }
  }, [modalOpen, form]);

  const closeModal = () => {
    setModalOpen(false);
    form.resetFields();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const date = values.date;
    if (!date) {
      message.warning("Please pick a date.");
      return;
    }
    try {
      await createHoliday.mutateAsync({
        date: date.format(DATE_FORMAT),
        name: values.name.trim(),
        optional: values.optional ?? false,
      });
      message.success("Holiday added.");
      closeModal();
    } catch (err) {
      message.error(friendlyError(err, "Failed to add holiday."));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteHoliday.mutateAsync(id);
      message.success("Holiday deleted.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to delete holiday."));
    }
  };

  const columns = useMemo<ColumnsType<HrHolidayRow>>(() => {
    const base: ColumnsType<HrHolidayRow> = [
      {
        title: "Date",
        dataIndex: "date",
        key: "date",
        width: 220,
        defaultSortOrder: "ascend",
        sorter: (a, b) => a.date.localeCompare(b.date),
        render: (value: string) =>
          parseDate(value)?.format(DATE_DISPLAY) ?? value,
      },
      {
        title: "Name",
        dataIndex: "name",
        key: "name",
        sorter: (a, b) => a.name.localeCompare(b.name),
      },
      {
        title: "Type",
        dataIndex: "optional",
        key: "optional",
        width: 130,
        render: (optional: boolean) =>
          optional ? (
            <Tag color="gold">Optional</Tag>
          ) : (
            <Tag color="green">Public</Tag>
          ),
      },
    ];

    if (!isHrAdmin) return base;

    return [
      ...base,
      {
        title: "Actions",
        key: "actions",
        width: 100,
        align: "right",
        render: (_, record) => (
          <Popconfirm
            title="Delete this holiday?"
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Tooltip title="Delete holiday">
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label="Delete holiday"
              />
            </Tooltip>
          </Popconfirm>
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
            Holidays
          </Typography.Title>
          <Typography.Text type="secondary">
            Company holidays counted in attendance.
          </Typography.Text>
        </div>
        {isHrAdmin ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setModalOpen(true)}
          >
            Add holiday
          </Button>
        ) : null}
      </div>

      <Table<HrHolidayRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={holidays}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      {isHrAdmin ? (
        <Modal
          title="Add holiday"
          open={modalOpen}
          onOk={handleSubmit}
          confirmLoading={createHoliday.isPending}
          okText="Add"
          onCancel={closeModal}
          destroyOnHidden
        >
          <Form<HolidayFormValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{ optional: false }}
          >
            <Form.Item
              label="Date"
              name="date"
              rules={[{ required: true, message: "Please pick a date." }]}
            >
              <DatePicker format={DATE_DISPLAY} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              label="Name"
              name="name"
              rules={[{ required: true, message: "Please enter a name." }]}
            >
              <Input placeholder="e.g. New Year's Day" autoFocus />
            </Form.Item>
            <Form.Item
              label="Optional holiday"
              name="optional"
              valuePropName="checked"
              tooltip="Optional holidays are floating — employees may choose to take them."
            >
              <Switch />
            </Form.Item>
          </Form>
        </Modal>
      ) : null}
    </>
  );
}

export default HolidaysTab;
