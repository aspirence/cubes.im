"use client";

import { useMemo } from "react";
import { Select } from "antd";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import {
  crmPersonName,
  type CrmTargetRef,
  type CrmTargetType,
} from "@/features/app-crm/types";

export const encodeTarget = (t: CrmTargetRef) => `${t.type}:${t.id}`;
export const decodeTarget = (value: string): CrmTargetRef => {
  const [type, id] = value.split(":");
  return { type: type as CrmTargetType, id };
};

/**
 * Multi-select over live People / Companies / Deals, encoded as
 * `<type>:<id>` — the polymorphic "Relations" picker for tasks and notes.
 * value/onChange are optional so AntD Form.Item can inject them.
 */
export function TargetPicker({
  value,
  onChange,
  placeholder = "Link to people, companies, deals…",
  style,
}: {
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();

  const options = useMemo(
    () => [
      {
        label: "People",
        options: (people ?? [])
          .filter((p) => !p.deleted_at)
          .map((p) => ({
            value: encodeTarget({ type: "person", id: p.id }),
            label: crmPersonName(p) || "Unnamed person",
          })),
      },
      {
        label: "Companies",
        options: (companies ?? [])
          .filter((c) => !c.deleted_at)
          .map((c) => ({
            value: encodeTarget({ type: "company", id: c.id }),
            label: c.name,
          })),
      },
      {
        label: "Deals",
        options: (deals ?? [])
          .filter((d) => !d.deleted_at)
          .map((d) => ({
            value: encodeTarget({ type: "deal", id: d.id }),
            label: d.name,
          })),
      },
    ],
    [people, companies, deals],
  );

  return (
    <Select
      mode="multiple"
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      optionFilterProp="label"
      style={{ width: "100%", ...style }}
      allowClear
    />
  );
}
