"use client";

import { useMemo } from "react";
import { Select, theme } from "antd";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import {
  crmPersonName,
  type CrmTargetRef,
  type CrmTargetType,
} from "@/features/app-crm/types";
import { MIcon } from "./m-icon";
import { DealGlyph } from "./deal-glyph";
import { ENTITY_META, entityMeta } from "./entity-meta";
import { EntityAvatar, SectionLabel, SoftChip } from "../_lib/ui";

export const encodeTarget = (t: CrmTargetRef) => `${t.type}:${t.id}`;
export const decodeTarget = (value: string): CrmTargetRef => {
  const [type, id] = value.split(":");
  return { type: type as CrmTargetType, id };
};

/** An option row's payload — `label` stays a plain string so search still works. */
type TargetOption = {
  value: string;
  label: string;
  kind: CrmTargetType;
  sub?: string;
  avatarUrl?: string | null;
};

const ELLIPSIS: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** Group header inside the dropdown: kind glyph + label + count. */
function GroupLabel({
  kind,
  count,
}: {
  kind: CrmTargetType;
  count: number;
}) {
  const { token } = theme.useToken();
  const meta = ENTITY_META[kind];
  return (
    <SectionLabel
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <MIcon name={meta.icon} size={14} color={meta.color} />
      {meta.plural}
      <span style={{ color: token.colorTextQuaternary }}>{count}</span>
    </SectionLabel>
  );
}

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
  const { token } = theme.useToken();
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();

  const options = useMemo(() => {
    const peopleOptions: TargetOption[] = (people ?? [])
      .filter((p) => !p.deleted_at)
      .map((p) => ({
        value: encodeTarget({ type: "person", id: p.id }),
        label: crmPersonName(p) || "Unnamed person",
        kind: "person" as const,
        sub:
          [p.job_title, p.company?.name].filter(Boolean).join(" · ") ||
          p.email ||
          undefined,
        avatarUrl: p.avatar_url,
      }));
    const companyOptions: TargetOption[] = (companies ?? [])
      .filter((c) => !c.deleted_at)
      .map((c) => ({
        value: encodeTarget({ type: "company", id: c.id }),
        label: c.name,
        kind: "company" as const,
        sub: c.domain || undefined,
      }));
    const dealOptions: TargetOption[] = (deals ?? [])
      .filter((d) => !d.deleted_at)
      .map((d) => ({
        value: encodeTarget({ type: "deal", id: d.id }),
        label: d.name,
        kind: "deal" as const,
        sub: d.company?.name || undefined,
      }));

    return [
      {
        label: <GroupLabel kind="person" count={peopleOptions.length} />,
        options: peopleOptions,
      },
      {
        label: <GroupLabel kind="company" count={companyOptions.length} />,
        options: companyOptions,
      },
      {
        label: <GroupLabel kind="deal" count={dealOptions.length} />,
        options: dealOptions,
      },
    ];
  }, [people, companies, deals]);

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
      listItemHeight={44}
      listHeight={288}
      optionRender={(option) => {
        const data = option.data as unknown as TargetOption;
        const kind = data.kind ?? "person";
        return (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
            {kind === "deal" ? (
              <DealGlyph name={data.label} size={24} />
            ) : (
              <EntityAvatar
                name={data.label}
                kind={kind}
                src={data.avatarUrl}
                size={24}
              />
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 500, ...ELLIPSIS }}>{data.label}</div>
              {data.sub ? (
                <div
                  style={{
                    fontSize: 11.5,
                    lineHeight: 1.35,
                    color: token.colorTextTertiary,
                    ...ELLIPSIS,
                  }}
                >
                  {data.sub}
                </div>
              ) : null}
            </div>
            <MIcon
              name={ENTITY_META[kind].icon}
              size={15}
              color={token.colorTextQuaternary}
            />
          </div>
        );
      }}
      tagRender={(props) => {
        const { value: tagValue, label, closable, onClose } = props;
        const meta = entityMeta(decodeTarget(String(tagValue)).type);
        return (
          <span
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            style={{
              display: "inline-flex",
              maxWidth: "100%",
              marginInlineEnd: 4,
            }}
          >
            <SoftChip
              tone="custom"
              color={meta.color}
              icon={meta.icon}
              style={{ height: 24 }}
            >
              <span style={{ ...ELLIPSIS }}>{label}</span>
              {closable ? (
                <span
                  role="button"
                  aria-label="Remove"
                  onClick={onClose}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    cursor: "pointer",
                    marginInlineStart: 2,
                    opacity: 0.75,
                  }}
                >
                  <MIcon name="close" size={13} />
                </span>
              ) : null}
            </SoftChip>
          </span>
        );
      }}
    />
  );
}
