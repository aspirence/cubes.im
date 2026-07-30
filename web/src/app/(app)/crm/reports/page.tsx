"use client";

import { useMemo, useState } from "react";
import { Button, Segmented, Select, Spin, theme } from "antd";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { EChart, CHART_FONT, CHART_PALETTE } from "@/features/home/echart";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import { useCrmTasks } from "@/features/app-crm/use-crm-tasks";
import {
  useCrmCampaigns,
  useCrmCampaignSpend,
} from "@/features/app-crm/use-crm-campaigns";
import {
  CRM_LEAD_STATUSES,
  crmLeadStatusMeta,
  type CrmChipTone,
} from "@/features/app-crm/types";
import { MIcon } from "../_components/m-icon";
import { CRM_ACCENT, NO_STAGE_COLOR } from "../_components/entity-meta";
import { CONTENT_GRID, TILE_GRID } from "../_components/layout";
import { closingWithin } from "../_lib/deal-metrics";
import {
  CrmPageHeader,
  CrmToolbar,
  EmptyState,
  ErrorState,
  Panel,
  StatTile,
  crmMoneyPrecise,
  crmPageStyle,
} from "../_lib/ui";

const MONTHS_BACK = 6;
const MONTHS_FORWARD = 6;

/** Magnitude charts use ONE hue (the shared chart palette's first slot). */
const MAG = CHART_PALETTE[0];

/**
 * Pick black or white for a label sitting *on* an entity colour. The stage
 * palette includes amber (#ca8a04), where white text only clears ~2.6:1.
 */
function labelOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  // Contrast against white vs against near-black, whichever wins.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05
    ? "#fff"
    : "#111827";
}

/**
 * How far back a report looks. "All time" stays the default: these numbers
 * have always meant all time, and silently re-scoping a report someone has
 * been reading for weeks is worse than making them pick.
 */
const RANGES = [
  { value: "30", label: "30 days", days: 30, phrase: "in the last 30 days" },
  { value: "90", label: "90 days", days: 90, phrase: "in the last 90 days" },
  { value: "365", label: "12 months", days: 365, phrase: "in the last 12 months" },
  { value: "ALL", label: "All time", days: null, phrase: "all time" },
] as const;

type RangeValue = (typeof RANGES)[number]["value"];

const rangeMeta = (value: RangeValue) =>
  RANGES.find((r) => r.value === value) ?? RANGES[3];

export default function CrmReportsPage() {
  const { token } = theme.useToken();
  const router = useRouter();
  const {
    data: deals,
    isLoading: dealsLoading,
    isError: dealsError,
    refetch: refetchDeals,
  } = useCrmDeals();
  const {
    data: stages,
    isLoading: stagesLoading,
    isError: stagesError,
    refetch: refetchStages,
  } = useCrmStages();
  const {
    data: people,
    isLoading: peopleLoading,
    isError: peopleError,
    refetch: refetchPeople,
  } = useCrmPeople();
  const {
    data: companies,
    isLoading: companiesLoading,
    isError: companiesError,
    refetch: refetchCompanies,
  } = useCrmCompanies();
  const {
    data: tasks,
    isLoading: tasksLoading,
    isError: tasksError,
    refetch: refetchTasks,
  } = useCrmTasks();
  const { data: campaigns, isLoading: campaignsLoading } = useCrmCampaigns();
  const { data: campaignSpend, isLoading: spendLoading } =
    useCrmCampaignSpend();
  const { data: members } = useTeamMembers();

  const [range, setRange] = useState<RangeValue>("ALL");
  const [ownerFilter, setOwnerFilter] = useState<string>("ALL");
  const meta = rangeMeta(range);

  /** `created_at` on or after this instant, or null when nothing is excluded. */
  const since = useMemo(
    () => (meta.days === null ? null : dayjs().subtract(meta.days, "day")),
    [meta.days],
  );
  const inRange = useMemo(
    () => (createdAt: string) =>
      since === null || !dayjs(createdAt).isBefore(since),
    [since],
  );

  /**
   * Three populations, because the filters don't all apply to everything.
   *
   * `scopedDeals` is date-scoped only — the owner chart compares owners, so
   * filtering it to one owner would leave it a single bar answering nothing.
   * `ownedDeals` is owner-scoped only — "closing in 30 days" looks forward,
   * and a lead created four months ago still closes next week.
   */
  const allLive = useMemo(
    () => (deals ?? []).filter((d) => !d.deleted_at),
    [deals],
  );
  const scopedDeals = useMemo(
    () => allLive.filter((d) => inRange(d.created_at)),
    [allLive, inRange],
  );
  const ownedDeals = useMemo(
    () =>
      ownerFilter === "ALL"
        ? allLive
        : allLive.filter((d) => (d.owner_id ?? "none") === ownerFilter),
    [allLive, ownerFilter],
  );
  const liveDeals = useMemo(
    () =>
      ownerFilter === "ALL"
        ? scopedDeals
        : scopedDeals.filter((d) => (d.owner_id ?? "none") === ownerFilter),
    [scopedDeals, ownerFilter],
  );

  /* ------------------------------------------------------------------ KPIs */

  const now = dayjs();
  const monthStart = now.startOf("month");

  const ownerLabel = useMemo(() => {
    if (ownerFilter === "ALL") return "everyone";
    if (ownerFilter === "none") return "unassigned deals";
    const m = (members ?? []).find((x) => x.user?.id === ownerFilter);
    return m?.user?.name ?? "this owner";
  }, [ownerFilter, members]);

  const scopeApplied = range !== "ALL" || ownerFilter !== "ALL";

  /** The one sentence every scoped figure and caption hangs off. */
  const scopeHint =
    ownerFilter === "ALL"
      ? meta.phrase
      : `${ownerLabel} · ${meta.phrase}`;

  /** New deals inside the scope — under "All time" that is every open deal. */
  const newDeals = liveDeals.length;
  // Forward-looking, so it reads the whole pipeline rather than the window.
  const closing30 = useMemo(
    () => closingWithin(ownedDeals, 30, now),
    [ownedDeals, now],
  );
  const tasksDone = useMemo(
    () =>
      (tasks ?? []).filter(
        (t) =>
          t.status === "DONE" &&
          inRange(t.created_at) &&
          (ownerFilter === "ALL" ||
            (t.assignee_id ?? "none") === ownerFilter),
      ).length,
    [tasks, inRange, ownerFilter],
  );

  /* ---------------------------------------------------------------- charts */

  const axisText = useMemo(
    () => ({
      color: token.colorTextSecondary,
      fontFamily: CHART_FONT,
      fontSize: 11,
    }),
    [token.colorTextSecondary],
  );
  const recessiveSplit = useMemo(
    () => ({
      show: true,
      lineStyle: { color: token.colorSplit },
    }),
    [token.colorSplit],
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

  // Stage funnel — pipeline order, count per stage, stage entity colors.
  const funnelOption = useMemo(() => {
    const data = (stages ?? []).map((s) => ({
      name: s.name,
      value: liveDeals.filter((d) => d.stage_id === s.id).length,
      itemStyle: { color: s.color },
      // Per-slice so an amber stage gets dark text instead of unreadable white.
      label: { color: labelOn(s.color) },
    }));
    return {
      tooltip: { ...chartTooltip, trigger: "item" as const },
      series: [
        {
          type: "funnel" as const,
          sort: "none" as const,
          left: 8,
          right: 8,
          top: 8,
          bottom: 8,
          gap: 2,
          minSize: "12%",
          label: {
            show: true,
            position: "inside" as const,
            fontFamily: CHART_FONT,
            formatter: "{b}: {c}",
          },
          data,
        },
      ],
    };
  }, [stages, liveDeals, chartTooltip]);

  // How many deals land in each close month (open deals, next 6 months).
  const closeMonthOption = useMemo(() => {
    const months = Array.from({ length: MONTHS_FORWARD }, (_, i) =>
      monthStart.add(i, "month"),
    );
    const values = months.map(
      (m) =>
        liveDeals.filter(
          (d) => d.close_date && dayjs(d.close_date).isSame(m, "month"),
        ).length,
    );
    return {
      grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
      xAxis: {
        type: "category" as const,
        data: months.map((m) => m.format("MMM")),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: axisText,
      },
      yAxis: {
        type: "value" as const,
        minInterval: 1,
        axisLabel: axisText,
        splitLine: recessiveSplit,
      },
      tooltip: {
        ...chartTooltip,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : params;
          const { name, value } = p as { name: string; value: number };
          return `${name}: ${value} deal${value === 1 ? "" : "s"}`;
        },
      },
      series: [
        {
          type: "bar" as const,
          data: values,
          barWidth: 18,
          itemStyle: { color: MAG, borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  }, [liveDeals, monthStart, axisText, recessiveSplit, chartTooltip]);

  // New records per month (People vs Companies) — two series, legend + fixed hues.
  const growthOption = useMemo(() => {
    const months = Array.from({ length: MONTHS_BACK }, (_, i) =>
      monthStart.subtract(MONTHS_BACK - 1 - i, "month"),
    );
    const count = (rows: { created_at: string; deleted_at: string | null }[] | undefined, m: dayjs.Dayjs) =>
      (rows ?? []).filter(
        (r) => !r.deleted_at && dayjs(r.created_at).isSame(m, "month"),
      ).length;
    return {
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      legend: {
        top: 0,
        textStyle: { ...axisText, color: token.colorTextSecondary },
        itemWidth: 14,
      },
      xAxis: {
        type: "category" as const,
        data: months.map((m) => m.format("MMM")),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: axisText,
      },
      yAxis: {
        type: "value" as const,
        minInterval: 1,
        axisLabel: axisText,
        splitLine: recessiveSplit,
      },
      tooltip: { ...chartTooltip, trigger: "axis" as const },
      series: [
        {
          name: "People",
          type: "line" as const,
          data: months.map((m) => count(people, m)),
          lineStyle: { width: 2, color: CHART_PALETTE[0] },
          itemStyle: { color: CHART_PALETTE[0] },
          symbolSize: 7,
        },
        {
          name: "Companies",
          type: "line" as const,
          data: months.map((m) => count(companies, m)),
          lineStyle: { width: 2, color: CHART_PALETTE[1] },
          itemStyle: { color: CHART_PALETTE[1] },
          symbolSize: 7,
        },
      ],
    };
  }, [people, companies, monthStart, axisText, recessiveSplit, chartTooltip, token.colorTextSecondary]);

  // Deals per owner — magnitude across owners, one hue, direct labels.
  const ownerOption = useMemo(() => {
    const nameById = new Map<string, string>();
    for (const m of members ?? []) if (m.user) nameById.set(m.user.id, m.user.name);
    const totals = new Map<string, number>();
    // scopedDeals, not liveDeals: this is the one chart the owner picker must
    // not narrow, or it ranks a field of one.
    for (const d of scopedDeals) {
      const key = d.owner_id ? (nameById.get(d.owner_id) ?? "Unknown") : "Unassigned";
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    const rows = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    return {
      rows,
      option: {
        grid: { left: 8, right: 28, top: 8, bottom: 8, containLabel: true },
        xAxis: {
          type: "value" as const,
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        yAxis: {
          type: "category" as const,
          inverse: true,
          data: rows.map(([name]) => name),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: axisText,
        },
        tooltip: {
          ...chartTooltip,
          trigger: "item" as const,
          formatter: (params: unknown) => {
            const p = params as { name?: string; value?: number };
            const count = p.value ?? 0;
            return `${p.name}: ${count} deal${count === 1 ? "" : "s"}`;
          },
        },
        series: [
          {
            type: "bar" as const,
            data: rows.map(([, value]) => value),
            barWidth: 14,
            itemStyle: { color: MAG, borderRadius: [0, 4, 4, 0] },
            label: {
              show: true,
              position: "right" as const,
              color: token.colorTextSecondary,
              fontFamily: CHART_FONT,
              formatter: "{c}",
            },
          },
        ],
      },
    };
  }, [scopedDeals, members, axisText, chartTooltip, token.colorTextSecondary]);

  /**
   * Lead status is a STATE, not a category, so it wears the reserved status
   * colours instead of a categorical hue — and every bar is named on the axis,
   * so identity is never carried by colour alone.
   */
  const statusToneColor = useMemo<Record<CrmChipTone, string>>(
    () => ({
      neutral: NO_STAGE_COLOR,
      success: token.colorSuccess,
      warning: token.colorWarning,
      danger: token.colorError,
      accent: token.colorPrimary,
    }),
    [
      token.colorSuccess,
      token.colorWarning,
      token.colorError,
      token.colorPrimary,
    ],
  );

  // Leads by status — the whole fixed vocabulary, in order, zeroes included:
  // an empty "Qualified" is a finding, not a row to hide.
  const statusOption = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of liveDeals) {
      const key = crmLeadStatusMeta(d.status).value;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const rows = CRM_LEAD_STATUSES.map((s) => ({
      ...s,
      count: counts.get(s.value) ?? 0,
    }));
    return {
      rows,
      option: {
        grid: { left: 8, right: 28, top: 8, bottom: 8, containLabel: true },
        xAxis: {
          type: "value" as const,
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        yAxis: {
          type: "category" as const,
          inverse: true,
          data: rows.map((r) => r.label),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: axisText,
        },
        tooltip: {
          ...chartTooltip,
          trigger: "item" as const,
          formatter: (params: unknown) => {
            const p = params as { name?: string; value?: number };
            const count = p.value ?? 0;
            return `${p.name}: ${count} lead${count === 1 ? "" : "s"}`;
          },
        },
        series: [
          {
            type: "bar" as const,
            data: rows.map((r) => ({
              value: r.count,
              itemStyle: {
                color: statusToneColor[r.tone],
                borderRadius: [0, 4, 4, 0],
              },
            })),
            barWidth: 14,
            label: {
              show: true,
              position: "right" as const,
              color: token.colorTextSecondary,
              fontFamily: CHART_FONT,
              formatter: "{c}",
            },
          },
        ],
      },
    };
  }, [
    liveDeals,
    statusToneColor,
    axisText,
    chartTooltip,
    token.colorTextSecondary,
  ]);

  // Leads by campaign — magnitude, so one hue; cost-per-lead rides the direct
  // label wherever spend has been logged (derived, never stored).
  const campaignOption = useMemo(() => {
    const spendByCampaign = new Map<string, number>();
    for (const s of campaignSpend ?? []) {
      spendByCampaign.set(
        s.campaign_id,
        (spendByCampaign.get(s.campaign_id) ?? 0) + Number(s.amount),
      );
    }
    // Two counts per campaign: every attributed lead (the bar) and the ones a
    // cost per lead may divide by. 'junk' is excluded from the denominator on
    // purpose — that is the whole reason it is a separate status from
    // 'not_interested', which was a real lead that simply said no.
    const leadsByCampaign = new Map<string, number>();
    const billableByCampaign = new Map<string, number>();
    for (const d of liveDeals) {
      if (!d.campaign_id) continue;
      leadsByCampaign.set(
        d.campaign_id,
        (leadsByCampaign.get(d.campaign_id) ?? 0) + 1,
      );
      if (crmLeadStatusMeta(d.status).value !== "junk") {
        billableByCampaign.set(
          d.campaign_id,
          (billableByCampaign.get(d.campaign_id) ?? 0) + 1,
        );
      }
    }
    const rows = (campaigns ?? [])
      .filter((c) => !c.deleted_at)
      .map((c) => {
        const leads = leadsByCampaign.get(c.id) ?? 0;
        const billable = billableByCampaign.get(c.id) ?? 0;
        const spend = spendByCampaign.get(c.id) ?? 0;
        return {
          name: c.name,
          leads,
          cpl:
            billable > 0 && spend > 0
              ? crmMoneyPrecise(spend / billable, c.currency_code)
              : null,
        };
      })
      .filter((r) => r.leads > 0)
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 8);
    return {
      rows,
      option: {
        // Wide right gutter: the direct label carries the cost per lead too.
        grid: { left: 8, right: 132, top: 8, bottom: 8, containLabel: true },
        xAxis: {
          type: "value" as const,
          axisLabel: { show: false },
          splitLine: { show: false },
        },
        yAxis: {
          type: "category" as const,
          inverse: true,
          data: rows.map((r) => r.name),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: axisText,
        },
        tooltip: {
          ...chartTooltip,
          trigger: "item" as const,
          formatter: (params: unknown) => {
            const idx = (params as { dataIndex?: number }).dataIndex ?? 0;
            const row = rows[idx];
            if (!row) return "";
            const leads = `${row.name}: ${row.leads} lead${
              row.leads === 1 ? "" : "s"
            }`;
            return row.cpl ? `${leads}<br/>${row.cpl} per lead` : leads;
          },
        },
        series: [
          {
            type: "bar" as const,
            data: rows.map((r) => r.leads),
            barWidth: 14,
            itemStyle: { color: MAG, borderRadius: [0, 4, 4, 0] },
            label: {
              show: true,
              position: "right" as const,
              color: token.colorTextSecondary,
              fontFamily: CHART_FONT,
              formatter: (params: unknown) => {
                const idx = (params as { dataIndex?: number }).dataIndex ?? 0;
                const row = rows[idx];
                if (!row) return "";
                return row.cpl
                  ? `${row.leads}  ·  ${row.cpl}/lead`
                  : String(row.leads);
              },
            },
          },
        ],
      },
    };
  }, [
    campaigns,
    campaignSpend,
    liveDeals,
    axisText,
    chartTooltip,
    token.colorTextSecondary,
  ]);

  const hasDeals = liveDeals.length > 0;
  /** The close-month chart needs dates, not just deals, or it plots zeroes. */
  const hasCloseDates = useMemo(
    () => liveDeals.some((d) => d.close_date),
    [liveDeals],
  );
  /** Funnel + close-month + owner charts all wait on deals (and stages). */
  const pipelineLoading = dealsLoading || stagesLoading;
  const growthLoading = peopleLoading || companiesLoading;
  const hasRecords =
    (people ?? []).length + (companies ?? []).length > 0;

  /**
   * A report is only ever read as a fact. A chart drawn from a query that
   * failed doesn't look broken — it looks like a flat month — so the whole
   * page says so once, up top, rather than plotting a confident zero.
   */
  const loadFailed =
    dealsError || stagesError || peopleError || companiesError || tasksError;
  const retryAll = () => {
    if (dealsError) void refetchDeals();
    if (stagesError) void refetchStages();
    if (peopleError) void refetchPeople();
    if (companiesError) void refetchCompanies();
    if (tasksError) void refetchTasks();
  };

  /** In-panel loading treatment — same shape in every panel on the page. */
  const panelSpin = (
    <div style={{ display: "grid", placeItems: "center", padding: 40 }}>
      <Spin size="small" />
    </div>
  );

  /** One-line answer the panel's chart gives, sitting above the plot. */
  const caption = (text: string) => (
    <p
      style={{
        margin: "0 0 12px",
        fontSize: 12,
        lineHeight: 1.5,
        color: token.colorTextTertiary,
      }}
    >
      {text}
    </p>
  );

  const goToDeals = (
    <Button type="primary" onClick={() => router.push("/crm/deals")}>
      Open the pipeline
    </Button>
  );

  const clearScope = () => {
    setRange("ALL");
    setOwnerFilter("ALL");
  };

  /**
   * The empty state a *filter* produced, as opposed to an empty CRM. Offering
   * "Add deals to the pipeline" to someone whose 30-day window happens to be
   * quiet sends them to create records they already have.
   */
  const scopeEmpty = (
    <EmptyState
      compact
      icon="filter_alt_off"
      title="Nothing in this range"
      description={`No deals ${scopeHint}. Widen the range, or clear the filters to see all ${allLive.length}.`}
      action={<Button onClick={clearScope}>Clear filters</Button>}
    />
  );

  /** True when the CRM has deals but this scope hides them all. */
  const hiddenByScope = scopeApplied && allLive.length > 0;
  const hiddenByRange = range !== "ALL" && allLive.length > 0;

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="CRM Reports"
        subtitle="Pipeline health, upcoming closes, and team performance for this workspace."
        right={
          <Button
            icon={<MIcon name="dashboard" size={16} />}
            onClick={() => router.push("/crm/dashboard")}
          >
            Dashboard
          </Button>
        }
      />

      {loadFailed ? (
        <div style={{ marginBottom: 14 }}>
          <Panel padding={8}>
            <ErrorState
              compact
              title="Some of these numbers didn't load"
              onRetry={retryAll}
            />
          </Panel>
        </div>
      ) : null}

      <CrmToolbar>
        <Segmented
          value={range}
          onChange={(v) => setRange(v as RangeValue)}
          options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
        />
        <Select
          value={ownerFilter}
          onChange={setOwnerFilter}
          style={{ minWidth: 190 }}
          options={[
            { value: "ALL", label: "Everyone" },
            ...(members ?? [])
              .filter((m) => m.user)
              .map((m) => ({ value: m.user!.id, label: m.user!.name })),
            { value: "none", label: "Unassigned" },
          ]}
        />
        {scopeApplied ? (
          <Button
            type="text"
            icon={<MIcon name="filter_alt_off" size={16} />}
            onClick={() => {
              setRange("ALL");
              setOwnerFilter("ALL");
            }}
          >
            Clear
          </Button>
        ) : null}
      </CrmToolbar>

      <div style={TILE_GRID}>
        {/* Every label below names its own scope. A report whose caption says
            "this month" while a 90-day filter is on is worse than one with no
            filter at all — it is confidently mislabelled. */}
        <StatTile
          icon="target"
          color={CRM_ACCENT.deal}
          label={range === "ALL" ? "Open deals" : "New deals"}
          value={dealsLoading || dealsError ? "—" : newDeals}
          hint={scopeHint}
        />
        <StatTile
          icon="handshake"
          color={CRM_ACCENT.deal}
          label="In the pipeline"
          value={dealsLoading || dealsError ? "—" : ownedDeals.length}
          hint={
            ownerFilter === "ALL"
              ? "every open deal, whenever it came in"
              : `${ownerLabel}, whenever it came in`
          }
        />
        <StatTile
          icon="event_upcoming"
          color={CRM_ACCENT.deal}
          label="Closing in 30 days"
          value={dealsLoading || dealsError ? "—" : closing30}
          hint="due to close — the whole pipeline, not the window"
        />
        <StatTile
          icon="task_alt"
          color={CRM_ACCENT.done}
          label="Tasks completed"
          value={tasksLoading || tasksError ? "—" : tasksDone}
          hint={scopeHint}
        />
      </div>

      <div style={CONTENT_GRID}>
        <Panel title="Stage funnel">
          {caption(`How many deals sit in each stage of the pipeline — ${scopeHint}.`)}
          {pipelineLoading ? (
            panelSpin
          ) : hasDeals ? (
            <EChart option={funnelOption} height={260} />
          ) : hiddenByScope ? (
            scopeEmpty
          ) : (
            <EmptyState
              compact
              icon="filter_alt"
              title="No deals yet"
              description="Add deals to the pipeline and the funnel shows how they spread across your stages."
              action={goToDeals}
            />
          )}
        </Panel>

        <Panel title="Deals by close month">
          {caption(
            `Of the deals ${scopeHint}, how many are set to close in each of the next six months.`,
          )}
          {dealsLoading ? (
            panelSpin
          ) : hasCloseDates ? (
            <EChart option={closeMonthOption} height={260} />
          ) : hiddenByScope ? (
            scopeEmpty
          ) : (
            <EmptyState
              compact
              icon="event_upcoming"
              title="No close dates yet"
              description="Add close dates to your deals to see how many are due to land over the next six months."
              action={goToDeals}
            />
          )}
        </Panel>

        <Panel title="Deals by owner">
          {caption(
            // Deliberately ignores the owner picker: a one-bar ranking of one
            // person answers nothing, so this panel always shows the field.
            `Who is carrying the pipeline — deals per owner, ${meta.phrase}. Every owner, whichever one is picked above.`,
          )}
          {dealsLoading ? (
            panelSpin
          ) : ownerOption.rows.length > 0 ? (
            <EChart
              option={ownerOption.option}
              height={Math.max(200, ownerOption.rows.length * 40)}
            />
          ) : hiddenByRange ? (
            scopeEmpty
          ) : (
            <EmptyState
              compact
              icon="group"
              title="No owners to compare"
              description="Assign owners to deals and this chart ranks the team by how many deals each person is carrying."
              action={goToDeals}
            />
          )}
        </Panel>

        <Panel title="New records per month">
          {caption(
            "How fast the database is growing — people and companies added each month. Always the last twelve months, whatever the range above.",
          )}
          {growthLoading ? (
            panelSpin
          ) : hasRecords ? (
            <EChart option={growthOption} height={260} />
          ) : (
            <EmptyState
              compact
              icon="trending_up"
              title="Nothing to chart yet"
              description="Add people and companies and this chart tracks how fast the database is growing."
              action={
                <Button
                  type="primary"
                  onClick={() => router.push("/crm/people")}
                >
                  Add your first person
                </Button>
              }
            />
          )}
        </Panel>

        <Panel title="Leads by status">
          {caption(
            `How the leads ${scopeHint} are doing — a separate question from where their cards sit on the board.`,
          )}
          {dealsLoading ? (
            panelSpin
          ) : hasDeals ? (
            <EChart
              option={statusOption.option}
              height={Math.max(220, statusOption.rows.length * 34)}
            />
          ) : hiddenByScope ? (
            scopeEmpty
          ) : (
            <EmptyState
              compact
              icon="flag"
              title="No leads yet"
              description="Every deal carries a lead status — New through Converted — and this chart shows how the desk is spread across them."
              action={goToDeals}
            />
          )}
        </Panel>

        <Panel title="Leads by campaign">
          {caption(
            `Which campaigns actually produce leads ${meta.phrase} — with cost per lead wherever daily spend has been logged. Junk leads count on the bar but not in the cost per lead.`,
          )}
          {dealsLoading || campaignsLoading || spendLoading ? (
            panelSpin
          ) : campaignOption.rows.length > 0 ? (
            <EChart
              option={campaignOption.option}
              height={Math.max(200, campaignOption.rows.length * 40)}
            />
          ) : hiddenByScope ? (
            scopeEmpty
          ) : (
            <EmptyState
              compact
              icon="campaign"
              title="No campaign leads yet"
              description="Attach a campaign to your deals and log its daily spend — this chart then ranks the top campaigns by lead volume and prints what each lead cost."
              action={
                <Button
                  type="primary"
                  onClick={() => router.push("/crm/campaigns")}
                >
                  Set up campaigns
                </Button>
              }
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
