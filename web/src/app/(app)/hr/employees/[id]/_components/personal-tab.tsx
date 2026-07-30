"use client";

import { Descriptions } from "antd";
import dayjs from "dayjs";
import type { HrEmployeeWithRelations } from "../../../_lib/types";
import { genderLabel } from "../../../_lib/labels";

function date(value: string | null): string {
  return value ? dayjs(value).format("MMM D, YYYY") : "—";
}

function text(value: string | null): string {
  return value && value.trim() ? value : "—";
}

export function PersonalTab({
  employee,
}: {
  employee: HrEmployeeWithRelations;
}) {
  return (
    <Descriptions
      bordered
      column={{ xs: 1, sm: 1, md: 2 }}
      size="small"
      items={[
        {
          key: "dob",
          label: "Date of birth",
          children: date(employee.date_of_birth),
        },
        {
          key: "gender",
          label: "Gender",
          children: genderLabel(employee.gender),
        },
        {
          key: "personal_email",
          label: "Personal email",
          children: text(employee.personal_email),
        },
        { key: "phone", label: "Phone", children: text(employee.phone) },
        {
          key: "address",
          label: "Address",
          span: 2,
          children: text(employee.address),
        },
        {
          key: "emergency_contact",
          label: "Emergency contact",
          span: 2,
          children: text(employee.emergency_contact),
        },
      ]}
    />
  );
}
