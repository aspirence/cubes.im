"use client";

import { Col, DatePicker, Form, Input, Row, Select } from "antd";
import type {
  HrDepartmentRow,
  HrDesignationRow,
  HrEmployeeRow,
} from "../../_lib/types";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  STATUS_OPTIONS,
} from "../../_lib/labels";

/**
 * Shared Form.Item fields for creating an employee. Rendered inside a parent
 * <Form/> (the parent owns the form instance & submit). `full_name` is the only
 * required field — everything else is optional (record-only directory entry).
 */
export function EmployeeFormFields({
  departments,
  designations,
  managers,
}: {
  departments: HrDepartmentRow[];
  designations: HrDesignationRow[];
  managers: HrEmployeeRow[];
}) {
  const departmentOptions = departments.map((d) => ({
    value: d.id,
    label: d.name,
  }));
  const designationOptions = designations.map((d) => ({
    value: d.id,
    label: d.title,
  }));
  const managerOptions = managers.map((m) => ({
    value: m.id,
    label: m.full_name,
  }));

  return (
    <>
      <Form.Item
        label="Full name"
        name="full_name"
        rules={[{ required: true, message: "Please enter a full name." }]}
      >
        <Input placeholder="e.g. Jane Doe" autoFocus />
      </Form.Item>

      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item label="Employee code" name="employee_code">
            <Input placeholder="e.g. EMP-001" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item
            label="Work email"
            name="work_email"
            rules={[{ type: "email", message: "Enter a valid email." }]}
          >
            <Input placeholder="name@company.com" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
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
      </Row>

      <Row gutter={16}>
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
      </Row>

      <Row gutter={16}>
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
          <Form.Item label="Work location" name="work_location">
            <Input placeholder="e.g. Remote, HQ" />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
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

      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item label="Date of birth" name="date_of_birth">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item label="Gender" name="gender">
            <Select
              allowClear
              placeholder="Select gender"
              options={GENDER_OPTIONS}
            />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item
            label="Personal email"
            name="personal_email"
            rules={[{ type: "email", message: "Enter a valid email." }]}
          >
            <Input placeholder="name@example.com" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item label="Phone" name="phone">
            <Input placeholder="+1 555 123 4567" />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item label="Address" name="address">
        <Input.TextArea rows={2} placeholder="Street, city, country" />
      </Form.Item>

      <Form.Item label="Emergency contact" name="emergency_contact">
        <Input placeholder="Name and phone" />
      </Form.Item>
    </>
  );
}
