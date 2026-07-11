"use client";

import { useState } from "react";
import { Divider, Drawer, Input, Segmented, Select, Space, Switch, Typography } from "antd";
import { useProjects } from "@/features/projects/use-projects";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { MemberSelect } from "@/features/team-members/member-select";
import {
  type DashboardCard,
  type CardKind,
  DEFAULT_FILTER,
  CARD_KIND_OPTIONS,
  CHART_TYPE_OPTIONS,
  GROUP_BY_OPTIONS,
  METRIC_OPTIONS,
  DUE_FILTER_OPTIONS,
  SCOPE_OPTIONS,
} from "./dashboard-types";

const { Text } = Typography;

function blankCard(): DashboardCard {
  return {
    id: typeof crypto !== "undefined" ? crypto.randomUUID() : `card-${Date.now()}`,
    kind: "chart",
    title: "New chart",
    span: "half",
    chart: "donut",
    groupBy: "status",
    filter: { ...DEFAULT_FILTER },
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text style={{ fontSize: 12.5, color: "#6a6d78" }}>{label}</Text>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

/**
 * Per-card editor: pick the card kind, its display (chart type / grouping /
 * metric), and the filters that decide which tasks it counts. Used to add a new
 * card or edit an existing one — only reachable in the dashboard's Edit mode.
 */
export function CardConfigDrawer({
  open,
  card,
  facets,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** null = creating a new card. */
  card: DashboardCard | null;
  facets: { statuses: string[]; priorities: string[] };
  onClose: () => void;
  onSubmit: (card: DashboardCard) => void;
}) {
  const { data: projects } = useProjects();
  const { data: members } = useTeamMembers();

  const [draft, setDraft] = useState<DashboardCard>(card ?? blankCard());
  const [seeded, setSeeded] = useState(false);

  // Reseed the draft from the target card each time the drawer opens.
  if (open && !seeded) {
    setDraft(card ?? blankCard());
    setSeeded(true);
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const patch = (p: Partial<DashboardCard>) => setDraft((d) => ({ ...d, ...p }));
  const patchFilter = (p: Partial<DashboardCard["filter"]>) =>
    setDraft((d) => ({ ...d, filter: { ...d.filter, ...p } }));

  const showFilters = draft.kind === "chart" || draft.kind === "metric" || draft.kind === "tasks";

  const projectOptions = (projects ?? []).map((p) => ({ value: p.id, label: p.name }));
  const memberOptions = (members ?? [])
    .filter((m) => m.user)
    .map((m) => ({
      value: m.id,
      label: m.user!.name,
      avatarUrl: m.user!.avatar_url,
      email: m.user!.email,
    }));

  return (
    <Drawer
      title={card ? "Edit card" : "Add card"}
      placement="right"
      width="min(400px, calc(100vw - 24px))"
      open={open}
      onClose={onClose}
      extra={
        <button
          type="button"
          onClick={() => onSubmit(draft)}
          style={{
            background: "#4c4cd6",
            color: "#fff",
            border: "none",
            borderRadius: 7,
            padding: "5px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {card ? "Save" : "Add"}
        </button>
      }
    >
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Field label="Title">
          <Input
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Card title"
          />
        </Field>

        <Field label="Type">
          <Select<CardKind>
            value={draft.kind}
            onChange={(kind) => {
              // Fill sensible defaults for the chosen kind.
              patch({
                kind,
                chart: kind === "chart" ? (draft.chart ?? "donut") : draft.chart,
                groupBy: kind === "chart" ? (draft.groupBy ?? "status") : draft.groupBy,
                metric: kind === "metric" ? (draft.metric ?? "open") : draft.metric,
              });
            }}
            options={CARD_KIND_OPTIONS}
            style={{ width: "100%" }}
          />
        </Field>

        {draft.kind === "chart" ? (
          <Space size={10} wrap style={{ width: "100%" }}>
            <Field label="Chart">
              <Select
                value={draft.chart}
                onChange={(chart) => patch({ chart })}
                options={CHART_TYPE_OPTIONS}
                style={{ width: 150 }}
              />
            </Field>
            <Field label="Group by">
              <Select
                value={draft.groupBy}
                onChange={(groupBy) => patch({ groupBy })}
                options={GROUP_BY_OPTIONS}
                style={{ width: 150 }}
              />
            </Field>
          </Space>
        ) : null}

        {draft.kind === "metric" ? (
          <Field label="Metric">
            <Select
              value={draft.metric}
              onChange={(metric) => patch({ metric })}
              options={METRIC_OPTIONS}
              style={{ width: "100%" }}
            />
          </Field>
        ) : null}

        {draft.kind === "tasks" ? (
          <Field label="Rows">
            <Select
              value={draft.limit ?? 12}
              onChange={(limit) => patch({ limit })}
              options={[8, 12, 20, 50].map((n) => ({ value: n, label: `${n} rows` }))}
              style={{ width: "100%" }}
            />
          </Field>
        ) : null}

        <Field label="Width">
          <Segmented
            value={draft.span}
            onChange={(v) => patch({ span: v as "half" | "full" })}
            options={[
              { label: "Half", value: "half" },
              { label: "Full", value: "full" },
            ]}
            block
          />
        </Field>

        {showFilters ? (
          <>
            <Divider style={{ margin: "2px 0" }}>Filters</Divider>

            <Field label="Scope">
              <Segmented
                value={draft.filter.scope}
                onChange={(v) => patchFilter({ scope: v as "team" | "me" })}
                options={SCOPE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                block
              />
            </Field>

            <Field label="Projects">
              <Select
                mode="multiple"
                allowClear
                value={draft.filter.projectIds}
                onChange={(projectIds) => patchFilter({ projectIds })}
                options={projectOptions}
                placeholder="All projects"
                optionFilterProp="label"
                maxTagCount="responsive"
                style={{ width: "100%" }}
              />
            </Field>

            <Field label="Assignees">
              <MemberSelect
                value={draft.filter.assigneeIds}
                onChange={(assigneeIds) => patchFilter({ assigneeIds })}
                options={memberOptions}
                placeholder="Any assignee"
              />
            </Field>

            <Space size={10} wrap style={{ width: "100%" }}>
              <Field label="Priority">
                <Select
                  mode="multiple"
                  allowClear
                  value={draft.filter.priorities}
                  onChange={(priorities) => patchFilter({ priorities })}
                  options={facets.priorities.map((p) => ({ value: p, label: p }))}
                  placeholder="Any"
                  style={{ width: 150 }}
                  maxTagCount="responsive"
                />
              </Field>
              <Field label="Status">
                <Select
                  mode="multiple"
                  allowClear
                  value={draft.filter.statuses}
                  onChange={(statuses) => patchFilter({ statuses })}
                  options={facets.statuses.map((s) => ({ value: s, label: s }))}
                  placeholder="Any"
                  style={{ width: 150 }}
                  maxTagCount="responsive"
                />
              </Field>
            </Space>

            <Field label="Due date">
              <Select
                value={draft.filter.due}
                onChange={(due) => patchFilter({ due })}
                options={DUE_FILTER_OPTIONS}
                style={{ width: "100%" }}
              />
            </Field>

            {draft.kind !== "metric" ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ fontSize: 13 }}>Include completed tasks</Text>
                <Switch
                  checked={draft.filter.includeCompleted}
                  onChange={(includeCompleted) => patchFilter({ includeCompleted })}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </Space>
    </Drawer>
  );
}
