"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Col,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Row,
  Select,
  Space,
} from "antd";
import type { Dayjs } from "dayjs";
import { EditOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import {
  useUpdateEmployee,
  useDepartments,
  useDesignations,
  useHrEmployees,
} from "@/features/hr/use-hr";
import type { HrEmployeeWithRelations } from "../../../_lib/types";
import {
  employmentTypeLabel,
  statusLabel,
  EMPLOYMENT_TYPE_OPTIONS,
  STATUS_OPTIONS,
} from "../../../_lib/labels";
import { toEmployeePatch, type EmployeeFormValues } from "../../../_lib/form";

function errorMessage(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : "";
  if (/forbidden|permission|not allowed|policy|rls/i.test(msg)) {
    return "HR admins only.";
  }
  return msg || fallback;
}

function date(value: string | null): string {
  return value ? dayjs(value).format("MMM D, YYYY") : "—";
}

function text(value: string | null): string {
  return value && value.trim() ? value : "—";
}

interface JobFormValues {
  employee_code?: string | null;
  department_id?: string | null;
  designation_id?: string | null;
  manager_id?: string | null;
  employment_type?: string | null;
  status?: string | null;
  work_location?: string | null;
  date_of_joining?: Dayjs | null;
  probation_end?: Dayjs | null;
}

export function JobTab({
  employee,
  canEdit,
}: {
  employee: HrEmployeeWithRelations;
  canEdit: boolean;
}) {
  const { message, modal } = App.useApp();
  const { data: departments } = useDepartments();
  const { data: designations } = useDesignations();
  const { data: employees } = useHrEmployees();
  const updateEmployee = useUpdateEmployee();

  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<JobFormValues>();

  useEffect(() => {
    if (editing) {
      form.setFieldsValue({
        employee_code: employee.employee_code,
        department_id: employee.department_id,
        designation_id: employee.designation_id,
        manager_id: employee.manager_id,
        employment_type: employee.employment_type,
        status: employee.status,
        work_location: employee.work_location,
        date_of_joining: employee.date_of_joining
          ? dayjs(employee.date_of_joining)
          : null,
        probation_end: employee.probation_end
          ? dayjs(employee.probation_end)
          : null,
      });
    }
  }, [editing, employee, form]);

  const departmentOptions = (departments ?? []).map((d) => ({
    value: d.id,
    label: d.name,
  }));
  const designationOptions = (designations ?? []).map((d) => ({
    value: d.id,
    label: d.title,
  }));
  // Anyone below this employee is an invalid manager — picking one would make a
  // reporting cycle, which silently drops the whole loop out of the org chart.
  const descendantIds = (() => {
    const kids = new Map<string, string[]>();
    for (const e of employees ?? []) {
      if (!e.manager_id) continue;
      kids.set(e.manager_id, [...(kids.get(e.manager_id) ?? []), e.id]);
    }
    const out = new Set<string>();
    const walk = (id: string) => {
      for (const childId of kids.get(id) ?? []) {
        if (out.has(childId)) continue;
        out.add(childId);
        walk(childId);
      }
    };
    walk(employee.id);
    return out;
  })();

  const managerOptions = (employees ?? [])
    .filter((e) => e.id !== employee.id && !descendantIds.has(e.id))
    .map((e) => ({ value: e.id, label: e.full_name }));

  const nameOf = (id: string | null | undefined) =>
    (employees ?? []).find((e) => e.id === id)?.full_name ?? "No manager";
  const deptOf = (id: string | null | undefined) =>
    (departments ?? []).find((d) => d.id === id)?.name ?? "No department";

  const save = async (patch: ReturnType<typeof toEmployeePatch>) => {
    try {
      await updateEmployee.mutateAsync({ id: employee.id, patch });
      message.success("Job details updated.");
      setEditing(false);
    } catch (err) {
      message.error(errorMessage(err, "Failed to update job details."));
    }
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const patch = toEmployeePatch(values as EmployeeFormValues);

    // Moving someone's reporting line or department reorganises the org chart,
    // so those two changes are confirmed rather than saved silently.
    const managerChanged =
      "manager_id" in patch &&
      (patch.manager_id ?? null) !== (employee.manager_id ?? null);
    const deptChanged =
      "department_id" in patch &&
      (patch.department_id ?? null) !== (employee.department_id ?? null);

    if (!managerChanged && !deptChanged) {
      await save(patch);
      return;
    }

    modal.confirm({
      title: `Confirm changes for ${employee.full_name}`,
      okText: "Save changes",
      cancelText: "Cancel",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {managerChanged ? (
            <span>
              Reports to: <b>{nameOf(employee.manager_id)}</b> →{" "}
              <b>{nameOf(patch.manager_id)}</b>
            </span>
          ) : null}
          {deptChanged ? (
            <span>
              Department: <b>{deptOf(employee.department_id)}</b> →{" "}
              <b>{deptOf(patch.department_id)}</b>
            </span>
          ) : null}
          {descendantIds.size > 0 && managerChanged ? (
            <span style={{ marginTop: 4 }}>
              {descendantIds.size}{" "}
              {descendantIds.size === 1 ? "person" : "people"} in their org move
              with them.
            </span>
          ) : null}
        </div>
      ),
      onOk: () => save(patch),
    });
  };

  if (editing) {
    return (
      <Form<JobFormValues> form={form} layout="vertical" requiredMark={false}>
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item label="Employee code" name="employee_code">
              <Input placeholder="e.g. EMP-001" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="Work location" name="work_location">
              <Input placeholder="e.g. Remote, HQ" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="Department" name="department_id">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Select department"
                options={departmentOptions}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="Designation" name="designation_id">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Select designation"
                options={designationOptions}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="Manager" name="manager_id">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="Select manager"
                options={managerOptions}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="Employment type" name="employment_type">
              <Select
                allowClear
                placeholder="Select type"
                options={EMPLOYMENT_TYPE_OPTIONS}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="Status" name="status">
              <Select
                allowClear
                placeholder="Select status"
                options={STATUS_OPTIONS}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="Date of joining" name="date_of_joining">
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item label="Probation end" name="probation_end">
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>

        <Space>
          <Button
            type="primary"
            loading={updateEmployee.isPending}
            onClick={handleSave}
          >
            Save changes
          </Button>
          <Button onClick={() => setEditing(false)}>Cancel</Button>
        </Space>
      </Form>
    );
  }

  return (
    <div>
      {canEdit ? (
        <div style={{ textAlign: "right", marginBottom: 12 }}>
          <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      ) : null}
      <Descriptions
        bordered
        column={{ xs: 1, sm: 1, md: 2 }}
        size="small"
        items={[
          {
            key: "code",
            label: "Employee code",
            children: text(employee.employee_code),
          },
          {
            key: "work_location",
            label: "Work location",
            children: text(employee.work_location),
          },
          {
            key: "department",
            label: "Department",
            children: employee.department?.name ?? "—",
          },
          {
            key: "designation",
            label: "Designation",
            children: employee.designation?.title ?? "—",
          },
          {
            key: "manager",
            label: "Manager",
            children: employee.manager?.full_name ?? "—",
          },
          {
            key: "type",
            label: "Employment type",
            children: employmentTypeLabel(employee.employment_type),
          },
          {
            key: "status",
            label: "Status",
            children: statusLabel(employee.status),
          },
          {
            key: "joining",
            label: "Date of joining",
            children: date(employee.date_of_joining),
          },
          {
            key: "probation",
            label: "Probation end",
            children: date(employee.probation_end),
          },
        ]}
      />
    </div>
  );
}
