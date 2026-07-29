"use client";

import { useMemo, useState } from "react";
import { Button, Space, Spin, Tooltip, theme } from "antd";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { EChart, CHART_FONT } from "@/features/home/echart";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import { useCrmTasks } from "@/features/app-crm/use-crm-tasks";
import { useCrmRecentActivities } from "@/features/app-crm/use-crm-activities";
import type { CrmActivity, CrmTargetRef } from "@/features/app-crm/types";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import { DealQuickCreate, PasteDealHint } from "../_components/paste-deal";
import { DealGlyph } from "../_components/deal-glyph";
import { PhoneWithCopy } from "../_components/phone-cell";
import { CRM_ACCENT, NO_STAGE_COLOR } from "../_components/entity-meta";
import { CONTENT_GRID, TILE_GRID } from "../_components/layout";
import { CrmListRow } from "../_components/list-row";
import { closingWithin } from "../_lib/deal-metrics";
import {
  CrmPageHeader,
  EmptyState,
  EntityAvatar,
  Panel,
  SoftChip,
  StatTile,
  crmDate,
  crmDateTime,
  crmFromNow,
  crmPageStyle,
  crmPersonName,
  type SoftChipTone,
} from "../_lib/ui";

function activityLine(a: CrmActivity, recordName: string): string {
  const props = (a.properties ?? {}) as Record<string, unknown>;
  switch (a.event) {
    case "created":
      return `created ${recordName}`;
    case "updated":
      return `updated ${recordName}`;
    case "stage_changed":
      return `moved ${recordName} to ${String(props.to ?? "no stage")}`;
    case "deleted":
      return `deleted ${recordName}`;
    case "restored":
      return `restored ${recordName}`;
    case "note_added":
      return `added a note on ${recordName}`;
    case "task_added":
      return `added a task on ${recordName}`;
    default:
      return `${a.event} — ${recordName}`;
  }
}

/** Soft chip vocabulary for the activity feed's event kinds. */
const EVENT_META: Record<
  string,
  { label: string; icon: string; tone: SoftChipTone }
> = {
  created: { label: "Created", icon: "add_circle", tone: "success" },
  updated: { label: "Updated", icon: "edit", tone: "neutral" },
  stage_changed: { label: "Stage", icon: "swap_horiz", tone: "accent" },
  deleted: { label: "Deleted", icon: "delete", tone: "danger" },
  restored: { label: "Restored", icon: "restore_from_trash", tone: "success" },
  note_added: { label: "Note", icon: "sticky_note_2", tone: "neutral" },
  task_added: { label: "Task", icon: "task_alt", tone: "accent" },
};

function eventMeta(event: string) {
  return (
    EVENT_META[event] ?? {
      label: event.replace(/_/g, " "),
      icon: "history",
      tone: "neutral" as SoftChipTone,
    }
  );
}

/** Non-entity leading glyph (tasks), same footprint as an EntityAvatar. */
function GlyphChip({ icon }: { icon: string }) {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: token.colorFillTertiary,
      }}
    >
      <MIcon name={icon} size={16} color={token.colorTextTertiary} />
    </span>
  );
}

/** In-panel loading treatment — same shape in every panel on the page. */
function PanelSpin() {
  return (
    <div style={{ display: "grid", placeItems: "center", padding: 40 }}>
      <Spin size="small" />
    </div>
  );
}

export default function CrmDashboardPage() {
  const { token } = theme.useToken();
  const router = useRouter();
  const { user } = useAuth();
  const { data: people, isLoading: peopleLoading } = useCrmPeople();
  const { data: companies, isLoading: companiesLoading } = useCrmCompanies();
  const { data: deals, isLoading: dealsLoading } = useCrmDeals();
  const { data: stages, isLoading: stagesLoading } = useCrmStages();
  const { data: tasks, isLoading: tasksLoading } = useCrmTasks();
  const { data: activities, isLoading: activitiesLoading } =
    useCrmRecentActivities(12);
  const { data: members } = useTeamMembers();
  const [drawerTarget, setDrawerTarget] = useState<CrmTargetRef | null>(null);
  // The quick-deal dialog also opens on paste; this is the button route.
  const [dealFormOpen, setDealFormOpen] = useState(false);

  /** While any of these is cold the tiles show "—" instead of a confident 0. */
  const pipelineLoading = dealsLoading || stagesLoading;

  const livePeople = useMemo(
    () => (people ?? []).filter((p) => !p.deleted_at),
    [people],
  );
  const liveCompanies = useMemo(
    () => (companies ?? []).filter((c) => !c.deleted_at),
    [companies],
  );
  const liveDeals = useMemo(
    () => (deals ?? []).filter((d) => !d.deleted_at),
    [deals],
  );

  const monthStart = dayjs().startOf("month");
  const addedThisMonth = (rows: { created_at: string }[]) =>
    rows.filter((r) => dayjs(r.created_at).isAfter(monthStart)).length;

  // Close-date pressure, as a count over the same 30-day horizon Reports uses.
  const closing30 = useMemo(() => closingWithin(liveDeals, 30), [liveDeals]);

  // One row per stage (board order), plus "No stage" only when needed.
  const stageRows = useMemo(() => {
    const rows = (stages ?? []).map((s) => ({
      name: s.name,
      color: s.color,
      count: liveDeals.filter((d) => d.stage_id === s.id).length,
    }));
    const orphans = liveDeals.filter(
      (d) => !d.stage_id || !(stages ?? []).some((s) => s.id === d.stage_id),
    );
    if (orphans.length > 0) {
      rows.push({
        name: "No stage",
        color: NO_STAGE_COLOR,
        count: orphans.length,
      });
    }
    return rows;
  }, [stages, liveDeals]);

  const userName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string | null | undefined) => (id && map.get(id)) || "Someone";
  }, [members]);

  const recordName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people ?? [])
      map.set(`person:${p.id}`, crmPersonName(p) || "Unnamed person");
    for (const c of companies ?? []) map.set(`company:${c.id}`, c.name);
    for (const d of deals ?? []) map.set(`deal:${d.id}`, d.name);
    return (type: string, id: string) =>
      map.get(`${type}:${id}`) ?? "a deleted record";
  }, [people, companies, deals]);

  const myOpenTasks = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => t.assignee_id === user?.id && t.status !== "DONE")
        .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"))
        .slice(0, 8),
    [tasks, user?.id],
  );

  // Overdue first, then the next closes — the "what needs attention" list.
  const upcomingCloses = useMemo(
    () =>
      liveDeals
        .filter((d) => d.close_date)
        .sort((a, b) => (a.close_date ?? "").localeCompare(b.close_date ?? ""))
        .slice(0, 8),
    [liveDeals],
  );

  // Tooltip chrome tracks the theme so dark mode stays legible.
  const chartTooltip = useMemo(
    () => ({
      backgroundColor: token.colorBgElevated,
      borderColor: token.colorBorderSecondary,
      textStyle: {
        color: token.colorText,
        fontFamily: CHART_FONT,
        fontSize: 12,
      },
    }),
    [token.colorBgElevated, token.colorBorderSecondary, token.colorText],
  );

  // Horizontal bars: stage identity comes from the axis label (color is the
  // stage's own entity color, mirrored from the board); counts direct-labeled.
  const chartOption = useMemo(
    () => ({
      grid: { left: 8, right: 28, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value" as const,
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "category" as const,
        inverse: true,
        data: stageRows.map((r) => r.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: token.colorTextSecondary,
          fontFamily: CHART_FONT,
        },
      },
      tooltip: {
        ...chartTooltip,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : params;
          const idx = (p as { dataIndex?: number }).dataIndex ?? 0;
          const row = stageRows[idx];
          if (!row) return "";
          return `${row.name}: ${row.count} deal${row.count === 1 ? "" : "s"}`;
        },
      },
      series: [
        {
          type: "bar" as const,
          data: stageRows.map((r) => ({
            value: r.count,
            itemStyle: { color: r.color, borderRadius: [0, 4, 4, 0] },
          })),
          barWidth: 16,
          label: {
            show: true,
            position: "right" as const,
            color: token.colorTextSecondary,
            fontFamily: CHART_FONT,
            formatter: "{c}",
          },
        },
      ],
    }),
    [stageRows, token.colorTextSecondary, chartTooltip],
  );

  const mutedLine: React.CSSProperties = {
    fontSize: 12,
    lineHeight: 1.35,
    color: token.colorTextTertiary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const primaryLine: React.CSSProperties = {
    fontWeight: 500,
    lineHeight: 1.35,
    color: token.colorText,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const panelExtraText: React.CSSProperties = {
    fontSize: 12,
    color: token.colorTextTertiary,
  };

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="CRM Dashboard"
        subtitle="Where the pipeline stands, what closes next, and what the team just touched."
        right={
          <>
            <PasteDealHint style={{ marginRight: 4 }} />
            <Button
              icon={<MIcon name="monitoring" size={16} />}
              onClick={() => router.push("/crm/reports")}
            >
              Reports
            </Button>
            <Button
              type="primary"
              icon={<MIcon name="view_kanban" size={16} />}
              onClick={() => router.push("/crm/deals")}
            >
              Open pipeline
            </Button>
          </>
        }
      />

      <div style={TILE_GRID}>
        <StatTile
          icon="person"
          color={CRM_ACCENT.person}
          label="People"
          value={peopleLoading ? "—" : livePeople.length}
          hint={
            peopleLoading ? undefined : `+${addedThisMonth(livePeople)} this month`
          }
          onClick={() => router.push("/crm/people")}
        />
        <StatTile
          icon="domain"
          color={CRM_ACCENT.company}
          label="Companies"
          value={companiesLoading ? "—" : liveCompanies.length}
          hint={
            companiesLoading
              ? undefined
              : `+${addedThisMonth(liveCompanies)} this month`
          }
          onClick={() => router.push("/crm/companies")}
        />
        <StatTile
          icon="handshake"
          color={CRM_ACCENT.deal}
          label="Open deals"
          value={dealsLoading ? "—" : liveDeals.length}
          hint={
            dealsLoading ? undefined : `+${addedThisMonth(liveDeals)} this month`
          }
          onClick={() => router.push("/crm/deals")}
        />
        <StatTile
          icon="event_upcoming"
          color={CRM_ACCENT.deal}
          label="Closing in 30 days"
          value={dealsLoading ? "—" : closing30}
          hint="deals due to close"
          onClick={() => router.push("/crm/deals")}
        />
      </div>

      <div style={CONTENT_GRID}>
        <Panel
          title="Pipeline by stage"
          extra={
            pipelineLoading ? null : (
              <span style={panelExtraText}>
                {liveDeals.length} deal{liveDeals.length === 1 ? "" : "s"} total
              </span>
            )
          }
          padding={pipelineLoading || stageRows.length === 0 ? 8 : 16}
        >
          {pipelineLoading ? (
            <PanelSpin />
          ) : stageRows.length === 0 ? (
            <EmptyState
              compact
              icon="flag"
              title="No stages yet"
              description="Set up the pipeline in CRM Settings and every deal shows up here by stage."
              action={
                <Button
                  type="primary"
                  onClick={() => router.push("/crm/settings")}
                >
                  Set up the pipeline
                </Button>
              }
            />
          ) : (
            <EChart
              option={chartOption}
              height={Math.max(180, stageRows.length * 44)}
            />
          )}
        </Panel>

        <Panel
          title="Upcoming closes"
          extra={
            <Space size={4}>
              <Tooltip title="New deal">
                <Button
                  type="text"
                  size="small"
                  aria-label="New deal"
                  icon={<MIcon name="add" size={16} />}
                  onClick={() => setDealFormOpen(true)}
                />
              </Tooltip>
              <Button
                type="link"
                size="small"
                style={{ paddingInline: 0 }}
                onClick={() => router.push("/crm/deals")}
              >
                All deals
              </Button>
            </Space>
          }
          padding={dealsLoading || upcomingCloses.length === 0 ? 8 : 0}
        >
          {dealsLoading ? (
            <PanelSpin />
          ) : upcomingCloses.length === 0 ? (
            <EmptyState
              compact
              icon="event_upcoming"
              title="No close dates yet"
              description="Give a deal a close date and it lands here — overdue first, then whatever is next."
              action={
                <Button type="primary" onClick={() => setDealFormOpen(true)}>
                  Create a deal
                </Button>
              }
            />
          ) : (
            upcomingCloses.map((d, index) => {
              const overdue = dayjs(d.close_date).isBefore(dayjs(), "day");
              return (
                <CrmListRow
                  key={d.id}
                  first={index === 0}
                  onClick={() => setDrawerTarget({ type: "deal", id: d.id })}
                >
                  <DealGlyph name={d.name} size={28} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={primaryLine}>{d.name}</div>
                    <div style={mutedLine}>
                      {d.company?.name ? `${d.company.name} · ` : ""}
                      <span
                        style={{
                          color: overdue
                            ? token.colorError
                            : token.colorTextTertiary,
                        }}
                      >
                        {crmDate(d.close_date)}
                      </span>
                    </div>
                    {/* The number is what the row is usually opened FOR, so
                        it sits on the row with its own copy button. */}
                    {d.phone ? (
                      <div style={{ marginTop: 2 }}>
                        <PhoneWithCopy phone={d.phone} />
                      </div>
                    ) : null}
                  </div>
                  {overdue ? (
                    <SoftChip
                      tone="danger"
                      icon="schedule"
                      style={{ flex: "none" }}
                    >
                      Overdue
                    </SoftChip>
                  ) : null}
                </CrmListRow>
              );
            })
          )}
        </Panel>

        <Panel
          title="My open tasks"
          extra={
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 0 }}
              onClick={() => router.push("/crm/tasks")}
            >
              All tasks
            </Button>
          }
          padding={tasksLoading || myOpenTasks.length === 0 ? 8 : 0}
        >
          {tasksLoading ? (
            <PanelSpin />
          ) : myOpenTasks.length === 0 ? (
            <EmptyState
              compact
              icon="task_alt"
              title="Nothing assigned to you"
              description="No open CRM tasks are waiting on you. Enjoy the calm — or line the next one up."
              action={
                <Button
                  type="primary"
                  onClick={() => router.push("/crm/tasks")}
                >
                  Create a task
                </Button>
              }
            />
          ) : (
            myOpenTasks.map((t, index) => {
              const overdue = Boolean(
                t.due_at && dayjs(t.due_at).isBefore(dayjs()),
              );
              return (
                <CrmListRow key={t.id} first={index === 0} hover={false}>
                  <GlyphChip icon="task_alt" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={primaryLine}>{t.title}</div>
                    <div style={mutedLine}>
                      {t.due_at ? `Due ${crmDate(t.due_at)}` : "No due date"}
                    </div>
                  </div>
                  {overdue ? (
                    <SoftChip tone="danger" icon="schedule">
                      Overdue
                    </SoftChip>
                  ) : null}
                </CrmListRow>
              );
            })
          )}
        </Panel>

        <Panel
          title="Recent activity"
          extra={<span style={panelExtraText}>Latest 12</span>}
          padding={
            activitiesLoading || (activities ?? []).length === 0 ? 8 : 0
          }
        >
          {activitiesLoading ? (
            <PanelSpin />
          ) : (activities ?? []).length === 0 ? (
            <EmptyState
              compact
              icon="history"
              title="No CRM activity yet"
              description="Add a person, company, or deal — every create, edit, and stage move shows up in this feed."
              action={
                <Button
                  type="primary"
                  onClick={() => router.push("/crm/people")}
                >
                  Add your first person
                </Button>
              }
            />
          ) : (
            (activities ?? []).map((a, index) => {
              const name = recordName(a.target_type, a.target_id);
              const exists = name !== "a deleted record";
              const meta = eventMeta(a.event);
              const actor = userName(a.actor_id);
              return (
                <CrmListRow
                  key={a.id}
                  first={index === 0}
                  onClick={
                    exists
                      ? () =>
                          setDrawerTarget({
                            type: a.target_type as CrmTargetRef["type"],
                            id: a.target_id,
                          })
                      : undefined
                  }
                >
                  <EntityAvatar kind="person" name={actor} size={28} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        lineHeight: 1.4,
                        color: token.colorTextSecondary,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 500,
                          color: token.colorText,
                        }}
                      >
                        {actor}
                      </span>{" "}
                      {activityLine(a, name)}
                    </div>
                    <Tooltip title={crmDateTime(a.created_at)}>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 11.5,
                          lineHeight: 1.4,
                          color: token.colorTextTertiary,
                        }}
                      >
                        {crmFromNow(a.created_at)}
                      </span>
                    </Tooltip>
                  </div>
                  <SoftChip
                    tone={meta.tone}
                    icon={meta.icon}
                    style={{ flex: "none" }}
                  >
                    {meta.label}
                  </SoftChip>
                </CrmListRow>
              );
            })
          )}
        </Panel>
      </div>

      <RecordDrawer
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
      />

      {/* Paste a lead anywhere on this page, or use the buttons above. */}
      <DealQuickCreate
        open={dealFormOpen}
        onClose={() => setDealFormOpen(false)}
      />
    </div>
  );
}
