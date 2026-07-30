"use client";

import { useState } from "react";
import { Button, Divider, Drawer, Input, Segmented, Select, Space, Switch, Typography, theme } from "antd";
import { useProjects } from "@/features/projects/use-projects";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { MemberSelect } from "@/features/team-members/member-select";
import { useAllTeamTasks } from "@/features/tasks/use-all-tasks";
import { useAuth } from "@/features/auth/use-auth";
import { useUIStore } from "@/store/ui-store";
import { GroupedChart } from "./dashboard-grouped-chart";
import { ChartTypeGallery } from "./chart-type-gallery";
import type { CardPreset } from "./card-presets";
import { useAnalyticsCapabilities, clampCardForViewer } from "./analytics-access";
import {
  visibleTasks,
  groupTasks,
  computeMetric,
  paletteFor,
} from "./dashboard-engine";
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
  cardCols,
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
  const { token } = theme.useToken();
  return (
    <div>
      <Text style={{ fontSize: 12.5, color: token.colorTextSecondary }}>{label}</Text>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

/**
 * Live preview — the card rendered with the viewer's REAL tasks and the draft's
 * current filters, so "how will this look" is answered before it's added rather
 * than after. Reuses the same query as Home (TanStack dedupes it, no extra
 * fetch) and the same engine, so the preview can't disagree with the card.
 */
function CardPreview({ draft }: { draft: DashboardCard }) {
  const { token } = theme.useToken();
  const { user } = useAuth();
  const dark = useUIStore((s) => s.themeMode === "dark");
  const { data: members } = useTeamMembers();
  const { data: teamTasks } = useAllTeamTasks();
  const tasks = teamTasks ?? [];
  const myTeamMemberId = (members ?? []).find((m) => m.user?.id === user?.id)?.id;

  const frame = (children: React.ReactNode) => (
    <div
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 10,
        background: token.colorBgContainer,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          borderBottom: `1px solid ${token.colorSplit}`,
          fontSize: 12.5,
          fontWeight: 600,
          color: token.colorText,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {draft.title || "Untitled card"}
      </div>
      {children}
    </div>
  );

  if (draft.kind === "chart") {
    const visible = visibleTasks(tasks, draft.filter, myTeamMemberId);
    const assigneeAllow = new Set<string>(draft.filter.assigneeIds);
    if (draft.filter.scope === "me" && myTeamMemberId) assigneeAllow.add(myTeamMemberId);
    const data = groupTasks(visible, draft.groupBy ?? "status", assigneeAllow, paletteFor(dark));
    const hint = CHART_TYPE_OPTIONS.find((o) => o.value === draft.chart)?.hint;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {frame(
          <div style={{ padding: "8px 8px 4px" }}>
            <GroupedChart data={data} chart={draft.chart ?? "donut"} height={190} />
          </div>,
        )}
        <Text style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
          {hint} · {data.length} {data.length === 1 ? "group" : "groups"} from{" "}
          {visible.length} {visible.length === 1 ? "task" : "tasks"}.
        </Text>
      </div>
    );
  }

  if (draft.kind === "metric") {
    const value = computeMetric(tasks, draft.filter, draft.metric ?? "open", myTeamMemberId);
    return frame(
      <div style={{ padding: "16px 12px 18px" }}>
        <div className="font-mono" style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-1.4px", lineHeight: 1, color: token.colorText }}>
          {value}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: token.colorTextTertiary }}>
          {METRIC_OPTIONS.find((m) => m.value === (draft.metric ?? "open"))?.label}
          {draft.filter.scope === "me" ? " · you" : ""}
        </div>
      </div>,
    );
  }

  // tasks / activity / todo have no meaningful static preview — say so plainly
  // rather than faking one.
  return frame(
    <div style={{ padding: "22px 12px", textAlign: "center", fontSize: 12, color: token.colorTextTertiary }}>
      {CARD_KIND_OPTIONS.find((k) => k.value === draft.kind)?.label} — shown live on your dashboard.
    </div>,
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
  preset = null,
  facets,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** null = creating a new card. */
  card: DashboardCard | null;
  /** Gallery pick that seeds a NEW card (ignored when editing). */
  preset?: CardPreset | null;
  facets: { statuses: string[]; priorities: string[] };
  onClose: () => void;
  onSubmit: (card: DashboardCard) => void;
}) {
  const { data: projects } = useProjects();
  const { data: members } = useTeamMembers();
  const { data: teamTasks } = useAllTeamTasks();
  const { user } = useAuth();

  const { token } = theme.useToken();
  const caps = useAnalyticsCapabilities();
  const [draft, setDraft] = useState<DashboardCard>(card ?? blankCard());
  const [seeded, setSeeded] = useState(false);

  // Reseed the draft each time the drawer opens: the card being edited, the
  // gallery preset, or a blank card. EVERY seed is clamped to the viewer's
  // capabilities — an existing team-scoped card edited by a viewer who lost
  // team scope becomes (and saves as) a "me" card, so layouts self-heal
  // rather than carrying config the drawer can no longer even display.
  if (open && !seeded) {
    setDraft(
      clampCardForViewer(
        card ?? (preset ? { ...preset.card, id: blankCard().id } : blankCard()),
        caps,
      ),
    );
    setSeeded(true);
  } else if (!open && seeded) {
    setSeeded(false);
  }

  const patch = (p: Partial<DashboardCard>) => setDraft((d) => ({ ...d, ...p }));
  const patchFilter = (p: Partial<DashboardCard["filter"]>) =>
    setDraft((d) => ({ ...d, filter: { ...d.filter, ...p } }));

  const showFilters = draft.kind === "chart" || draft.kind === "metric" || draft.kind === "tasks";

  // How many groups the draft currently yields — lets the gallery flag forms
  // that blur past a handful of groups (donut, pie, radial…).
  const previewGroupCount = (() => {
    if (draft.kind !== "chart") return 0;
    const myId = (members ?? []).find((m) => m.user?.id === user?.id)?.id;
    const visible = visibleTasks(teamTasks ?? [], draft.filter, myId);
    const allow = new Set<string>(draft.filter.assigneeIds);
    if (draft.filter.scope === "me" && myId) allow.add(myId);
    return groupTasks(visible, draft.groupBy ?? "status", allow).length;
  })();

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
      width="min(460px, calc(100vw - 24px))"
      open={open}
      onClose={onClose}
      extra={
        <Button type="primary" onClick={() => onSubmit(draft)}>
          {card ? "Save" : "Add"}
        </Button>
      }
    >
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <CardPreview draft={draft} />

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
          <>
            <Field label="Group by">
              <Select
                value={draft.groupBy}
                onChange={(groupBy) => patch({ groupBy })}
                options={GROUP_BY_OPTIONS.filter(
                  (o) => caps.assigneeDimension || o.value !== "assignee",
                )}
                style={{ width: "100%" }}
              />
            </Field>
            <Field label="Chart type">
              <ChartTypeGallery
                value={draft.chart ?? "donut"}
                onChange={(chart) => patch({ chart })}
                groupCount={previewGroupCount}
              />
            </Field>
          </>
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
            // Display from cardCols (the field the grid actually renders), not
            // the legacy span — a grid-resized card can have w=3 with a stale
            // span, and the control should show what the card really is.
            value={cardCols(draft) >= 3 ? "full" : "half"}
            // Patch BOTH width fields: `w` (grid columns) wins over the legacy
            // `span` in cardCols, and presets/templates/grid-resizes all set
            // `w` — patching span alone leaves this control dead for them.
            onChange={(v) =>
              patch({ span: v as "half" | "full", w: v === "full" ? 4 : 2 })
            }
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

            {caps.teamScope ? (
              <Field label="Scope">
                <Segmented
                  value={draft.filter.scope}
                  onChange={(v) => patchFilter({ scope: v as "team" | "me" })}
                  options={SCOPE_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                  block
                />
              </Field>
            ) : (
              <Text style={{ fontSize: 12, color: token.colorTextTertiary }}>
                Cards cover your own tasks.
              </Text>
            )}

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

            {caps.assigneeDimension ? (
              <Field label="Assignees">
                <MemberSelect
                  value={draft.filter.assigneeIds}
                  onChange={(assigneeIds) => patchFilter({ assigneeIds })}
                  options={memberOptions}
                  placeholder="Any assignee"
                />
              </Field>
            ) : null}

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
              <Field label="Completed within">
                <Select
                  value={draft.filter.completedWithin ?? "any"}
                  onChange={(completedWithin) => patchFilter({ completedWithin })}
                  options={[
                    { value: "any", label: "Any time (open tasks)" },
                    { value: "today", label: "Completed today" },
                    { value: "week", label: "Completed this week" },
                    { value: "month", label: "Completed this month" },
                  ]}
                  style={{ width: "100%" }}
                />
              </Field>
            ) : null}

            {/* Moot in throughput mode — the population is completed tasks
                by definition, so hiding it beats a switch that does nothing. */}
            {draft.kind !== "metric" &&
            (draft.filter.completedWithin ?? "any") === "any" ? (
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
