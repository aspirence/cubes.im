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
import { NO_PROJECT, useCrmScope } from "../_lib/crm-scope";

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
 * The preferred project's rows first, the rest in the order they came. A
 * stable partition, never a filter: the group keeps every row and its count.
 * NO_PROJECT puts the unfiled rows first. No preference → the rows untouched,
 * so the unscoped picker is exactly what it always was.
 */
function preferProject<T extends { project_id?: string | null }>(
  rows: T[],
  preferId: string | null | undefined,
): T[] {
  if (!preferId) return rows;
  const want = preferId === NO_PROJECT ? null : preferId;
  const inPreferred = (r: T) => (r.project_id ?? null) === want;
  return [...rows.filter(inPreferred), ...rows.filter((r) => !inPreferred(r))];
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
  preferProjectId,
}: {
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  /**
   * The CRM's current project (crm-scope), if any: the people, companies and
   * deals filed under it lead each group (NO_PROJECT: the unfiled ones). Scope
   * is a default, never a constraint — every live record stays listed, since
   * linking a note to another project's contact is legitimate.
   */
  preferProjectId?: string | null;
}) {
  const { token } = theme.useToken();
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();

  const options = useMemo(() => {
    const peopleOptions: TargetOption[] = preferProject(
      (people ?? []).filter((p) => !p.deleted_at),
      preferProjectId,
    ).map((p) => ({
      value: encodeTarget({ type: "person", id: p.id }),
      label: crmPersonName(p) || "Unnamed person",
      kind: "person" as const,
      sub:
        [p.job_title, p.company?.name].filter(Boolean).join(" · ") ||
        p.email ||
        undefined,
      avatarUrl: p.avatar_url,
    }));
    const companyOptions: TargetOption[] = preferProject(
      (companies ?? []).filter((c) => !c.deleted_at),
      preferProjectId,
    ).map((c) => ({
      value: encodeTarget({ type: "company", id: c.id }),
      label: c.name,
      kind: "company" as const,
      sub: c.domain || undefined,
    }));
    const dealOptions: TargetOption[] = preferProject(
      (deals ?? []).filter((d) => !d.deleted_at),
      preferProjectId,
    ).map((d) => ({
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
  }, [people, companies, deals, preferProjectId]);

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

/** A ProjectPicker option — `label` stays a plain string so search still works. */
type ProjectOption = { value: string; label: string; color: string | null };

/**
 * The "Project" field on a deal, person or company form: which project the
 * record is filed under, and so which project's CRM view it shows up in.
 * Cleared = no project. Options are the team's live projects, A–Z; a record
 * already filed under one that is not in that list (archived, or pinned to
 * an archived project's view) keeps it as an option instead of showing a raw
 * id. value/onChange are optional so AntD Form.Item can inject them.
 */
export function ProjectPicker({
  value,
  onChange,
  placeholder = "No project",
  style,
}: {
  value?: string | null;
  onChange?: (value: string | null) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const { token } = theme.useToken();
  const { projects, project } = useCrmScope();

  const options = useMemo<ProjectOption[]>(() => {
    const list: ProjectOption[] = projects.map((p) => ({
      value: p.id,
      label: p.name,
      color: p.color,
    }));
    if (value && !list.some((o) => o.value === value)) {
      const pinned = project && project.id === value ? project : null;
      list.push({
        value,
        label: pinned?.name ?? "Archived or hidden project",
        color: pinned?.color ?? null,
      });
    }
    return list;
  }, [projects, project, value]);

  return (
    <Select<string>
      allowClear
      showSearch
      optionFilterProp="label"
      value={value ?? undefined}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
      placeholder={placeholder}
      notFoundContent="No projects yet"
      style={{ width: "100%", ...style }}
      optionRender={(option) => {
        const data = option.data as unknown as ProjectOption;
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 3,
                background: data.color ?? token.colorTextQuaternary,
                flex: "none",
              }}
            />
            <span style={{ flex: 1, ...ELLIPSIS }}>{data.label}</span>
          </span>
        );
      }}
    />
  );
}
