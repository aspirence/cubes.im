"use client";

import { useMemo, useState } from "react";
import { App, Button, Space, Spin, Tooltip, theme } from "antd";
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
import {
  useCrmCampaigns,
  useCrmCampaignSpend,
} from "@/features/app-crm/use-crm-campaigns";
import {
  useCompleteCrmReminder,
  useCrmReminders,
} from "@/features/app-crm/use-crm-reminders";
import {
  crmLeadStatusMeta,
  type CrmActivity,
  type CrmTargetRef,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import { DealQuickCreate, PasteDealHint } from "../_components/paste-deal";
import { DealGlyph } from "../_components/deal-glyph";
import { PhoneWithCopy } from "../_components/phone-cell";
import { openReminders } from "../_components/reminder-controls";
import {
  CRM_ACCENT,
  NO_STAGE_COLOR,
  leadStatusIcon,
} from "../_components/entity-meta";
import { CONTENT_GRID, TILE_GRID } from "../_components/layout";
import { CrmListRow } from "../_components/list-row";
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
  crmMoney,
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
    case "status_changed":
      return `marked ${recordName} ${crmLeadStatusMeta(
        String(props.to ?? ""),
      ).label.toLowerCase()}`;
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
  status_changed: { label: "Status", icon: "flag", tone: "warning" },
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
  const { message } = App.useApp();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { data: people, isLoading: peopleLoading } = useCrmPeople();
  const { data: companies, isLoading: companiesLoading } = useCrmCompanies();
  const { data: deals, isLoading: dealsLoading } = useCrmDeals();
  const { data: stages, isLoading: stagesLoading } = useCrmStages();
  const { data: tasks, isLoading: tasksLoading } = useCrmTasks();
  const { data: activities, isLoading: activitiesLoading } =
    useCrmRecentActivities(12);
  const { data: reminders, isLoading: remindersLoading } = useCrmReminders();
  const { data: campaigns, isLoading: campaignsLoading } = useCrmCampaigns();
  const { data: campaignSpend, isLoading: spendLoading } =
    useCrmCampaignSpend();
  const { data: members } = useTeamMembers();
  const completeReminder = useCompleteCrmReminder();
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

  /**
   * The reminder desk: MY undismissed reminders, soonest first (the hook sorts
   * `remind_at` ASC and fetches the whole team, so the "mine" filter is ours).
   * A reminder is "remind ME" — counting a colleague's nudges here would make
   * the tile a number nobody can act on. "Due" means it has already come up —
   * overdue plus anything still landing today — because that is what a human
   * can clear before going home.
   */
  const myReminders = useMemo(() => {
    const open = openReminders(reminders).filter((r) => r.user_id === user?.id);
    const now = dayjs();
    const endOfToday = now.endOf("day");
    let overdue = 0;
    let today = 0;
    for (const r of open) {
      const at = dayjs(r.remind_at);
      if (at.isBefore(now)) overdue += 1;
      else if (!at.isAfter(endOfToday)) today += 1;
    }
    return { open, overdue, today, due: overdue + today, next: open.slice(0, 6) };
  }, [reminders, user?.id]);

  /** Deal lookup so a reminder on a deal can show that lead's status chip. */
  const dealById = useMemo(
    () => new Map((deals ?? []).map((d) => [d.id, d])),
    [deals],
  );

  /**
   * This calendar month's ad spend. Currencies are per campaign and never add
   * up, so the tile reports the DOMINANT currency's total and the hint says so
   * when a second currency is in play — a summed mixed number would be a lie.
   *
   * Soft-deleted campaigns are excluded, the same rule the campaigns page uses:
   * with them counted, deleting a campaign dropped one tile and left this one
   * high, and the two "Spend this month" numbers disagreed.
   */
  const spendThisMonth = useMemo(() => {
    const currencyOf = new Map(
      (campaigns ?? [])
        .filter((c) => !c.deleted_at)
        .map((c) => [c.id, c.currency_code]),
    );
    const start = dayjs().startOf("month");
    const byCurrency = new Map<string, number>();
    const campaignIds = new Set<string>();
    for (const row of campaignSpend ?? []) {
      if (!dayjs(row.spend_on).isSame(start, "month")) continue;
      const code = currencyOf.get(row.campaign_id);
      if (!code) continue; // soft-deleted campaign — off the books
      byCurrency.set(code, (byCurrency.get(code) ?? 0) + Number(row.amount));
      campaignIds.add(row.campaign_id);
    }
    const ranked = [...byCurrency.entries()].sort((a, b) => b[1] - a[1]);
    let currency = ranked[0]?.[0] ?? null;
    if (!currency) {
      // Nothing logged yet — borrow the team's most common campaign currency
      // so an empty month still reads in the money the team actually spends.
      const counts = new Map<string, number>();
      for (const c of campaigns ?? []) {
        if (c.deleted_at) continue;
        counts.set(c.currency_code, (counts.get(c.currency_code) ?? 0) + 1);
      }
      currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    const total = ranked[0]?.[1] ?? 0;
    const n = campaignIds.size;
    return {
      total,
      currency,
      hint:
        n === 0
          ? "no spend logged yet"
          : `${n} campaign${n === 1 ? "" : "s"}${
              ranked.length > 1 ? ` · ${currency} only` : ""
            }`,
    };
  }, [campaigns, campaignSpend]);

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

  /** Dismiss a reminder from the panel — same call the record drawer makes. */
  const markReminderDone = async (id: string) => {
    try {
      await completeReminder.mutateAsync(id);
      message.success("Reminder cleared.");
    } catch (err) {
      message.error(errMsg(err, "Failed to update reminder."));
    }
  };

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
          icon="alarm"
          /* Red only when something is genuinely late — otherwise the amber of
             the "Follow up" lead status, so the two read as the same idea. */
          color={myReminders.overdue > 0 ? token.colorError : token.colorWarning}
          label="Reminders due"
          value={remindersLoading || authLoading ? "—" : myReminders.due}
          hint={
            remindersLoading || authLoading
              ? undefined
              : myReminders.overdue > 0
                ? `${myReminders.overdue} overdue · ${myReminders.today} today`
                : `${myReminders.today} due today`
          }
          onClick={() => router.push("/crm/reminders")}
        />
        <StatTile
          icon="payments"
          color={CRM_ACCENT.campaign}
          label="Spend this month"
          value={
            campaignsLoading || spendLoading
              ? "—"
              : crmMoney(spendThisMonth.total, spendThisMonth.currency)
          }
          hint={
            campaignsLoading || spendLoading ? undefined : spendThisMonth.hint
          }
          onClick={() => router.push("/crm/campaigns")}
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
              const status = crmLeadStatusMeta(d.status);
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
                  {/* Where the card sits on the board is the stage; this is how
                      the LEAD itself is doing. Both matter, so both show. */}
                  <SoftChip
                    tone={status.tone}
                    icon={leadStatusIcon(status.value)}
                    style={{ flex: "none" }}
                  >
                    {status.label}
                  </SoftChip>
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
          title="My reminders"
          extra={
            <Button
              type="link"
              size="small"
              style={{ paddingInline: 0 }}
              onClick={() => router.push("/crm/reminders")}
            >
              All reminders
            </Button>
          }
          padding={
            remindersLoading || authLoading || myReminders.next.length === 0 ? 8 : 0
          }
        >
          {remindersLoading || authLoading ? (
            <PanelSpin />
          ) : myReminders.next.length === 0 ? (
            <EmptyState
              compact
              icon="alarm"
              title="Nothing to chase"
              description="Set a reminder on a lead — “call back Thursday at 4” — and it lands here, overdue first, and fires a notification when it's due."
              action={
                <Button
                  type="primary"
                  onClick={() => router.push("/crm/deals")}
                >
                  Open the pipeline
                </Button>
              }
            />
          ) : (
            myReminders.next.map((r, index) => {
              const type = r.target_type as CrmTargetRef["type"];
              const name = recordName(r.target_type, r.target_id);
              const exists = name !== "a deleted record";
              const overdue = dayjs(r.remind_at).isBefore(dayjs());
              const deal = type === "deal" ? dealById.get(r.target_id) : null;
              const status = deal ? crmLeadStatusMeta(deal.status) : null;
              return (
                <CrmListRow key={r.id} first={index === 0} align="flex-start">
                  {type === "deal" ? (
                    <DealGlyph name={name} size={28} />
                  ) : (
                    <EntityAvatar kind={type} name={name} size={28} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {/* The row carries a real Done button, so the record link
                        is its own control rather than the whole row. */}
                    <button
                      type="button"
                      disabled={!exists}
                      onClick={() => setDrawerTarget({ type, id: r.target_id })}
                      style={{
                        ...primaryLine,
                        display: "block",
                        maxWidth: "100%",
                        padding: 0,
                        border: "none",
                        background: "none",
                        fontFamily: "inherit",
                        fontSize: "inherit",
                        textAlign: "left",
                        cursor: exists ? "pointer" : "default",
                      }}
                    >
                      {name}
                    </button>
                    {r.note ? <div style={mutedLine}>{r.note}</div> : null}
                    <div
                      style={{
                        ...mutedLine,
                        color: overdue
                          ? token.colorError
                          : token.colorTextTertiary,
                      }}
                    >
                      {overdue ? "Overdue · " : ""}
                      {crmDateTime(r.remind_at)}
                    </div>
                  </div>
                  {status ? (
                    <SoftChip
                      tone={status.tone}
                      icon={leadStatusIcon(status.value)}
                      style={{ flex: "none" }}
                    >
                      {status.label}
                    </SoftChip>
                  ) : null}
                  <Tooltip title="Dismiss this reminder">
                    <Button
                      type="text"
                      size="small"
                      style={{ flex: "none" }}
                      icon={<MIcon name="check_circle" size={16} />}
                      onClick={() => markReminderDone(r.id)}
                    >
                      Done
                    </Button>
                  </Tooltip>
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
