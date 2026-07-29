"use client";

import { useMemo } from "react";
import { Button, Spin, theme } from "antd";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { EChart, CHART_FONT, CHART_PALETTE } from "@/features/home/echart";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import { useCrmTasks } from "@/features/app-crm/use-crm-tasks";
import { MIcon } from "../_components/m-icon";
import { CRM_ACCENT } from "../_components/entity-meta";
import { CONTENT_GRID, TILE_GRID } from "../_components/layout";
import {
  CrmPageHeader,
  EmptyState,
  Panel,
  StatTile,
  crmMoney,
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

export default function CrmReportsPage() {
  const { token } = theme.useToken();
  const router = useRouter();
  const { data: deals, isLoading: dealsLoading } = useCrmDeals();
  const { data: stages, isLoading: stagesLoading } = useCrmStages();
  const { data: people, isLoading: peopleLoading } = useCrmPeople();
  const { data: companies, isLoading: companiesLoading } = useCrmCompanies();
  const { data: tasks, isLoading: tasksLoading } = useCrmTasks();
  const { data: members } = useTeamMembers();

  const liveDeals = useMemo(
    () => (deals ?? []).filter((d) => !d.deleted_at),
    [deals],
  );

  const mainCurrency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of liveDeals)
      counts.set(d.currency_code, (counts.get(d.currency_code) ?? 0) + 1);
    let best = "USD";
    let bestCount = 0;
    for (const [code, count] of counts)
      if (count > bestCount) {
        best = code;
        bestCount = count;
      }
    return best;
  }, [liveDeals]);

  /* ------------------------------------------------------------------ KPIs */

  const now = dayjs();
  const monthStart = now.startOf("month");

  const newDealsThisMonth = useMemo(
    () => liveDeals.filter((d) => dayjs(d.created_at).isAfter(monthStart)).length,
    [liveDeals, monthStart],
  );
  const avgDealSize = useMemo(() => {
    const withAmount = liveDeals.filter((d) => (d.amount ?? 0) > 0);
    if (withAmount.length === 0) return 0;
    return (
      withAmount.reduce((sum, d) => sum + (d.amount ?? 0), 0) /
      withAmount.length
    );
  }, [liveDeals]);
  const closing30 = useMemo(() => {
    const cutoff = now.add(30, "day");
    return liveDeals
      .filter(
        (d) =>
          d.close_date &&
          dayjs(d.close_date).isAfter(now.subtract(1, "day")) &&
          dayjs(d.close_date).isBefore(cutoff),
      )
      .reduce((sum, d) => sum + (d.amount ?? 0), 0);
  }, [liveDeals, now]);
  const tasksDone = useMemo(
    () => (tasks ?? []).filter((t) => t.status === "DONE").length,
    [tasks],
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

  // Expected revenue by close month (open deals, next 6 months) — forecast.
  const forecastOption = useMemo(() => {
    const months = Array.from({ length: MONTHS_FORWARD }, (_, i) =>
      monthStart.add(i, "month"),
    );
    const values = months.map((m) =>
      liveDeals
        .filter(
          (d) =>
            d.close_date && dayjs(d.close_date).isSame(m, "month"),
        )
        .reduce((sum, d) => sum + (d.amount ?? 0), 0),
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
        axisLabel: { ...axisText, formatter: (v: number) => crmMoney(v, mainCurrency) },
        splitLine: recessiveSplit,
      },
      tooltip: {
        ...chartTooltip,
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : params;
          const { name, value } = p as { name: string; value: number };
          return `${name}: ${crmMoney(value, mainCurrency)}`;
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
  }, [liveDeals, monthStart, mainCurrency, axisText, recessiveSplit, chartTooltip]);

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

  // Pipeline by owner — magnitude across owners, one hue, direct labels.
  const ownerOption = useMemo(() => {
    const nameById = new Map<string, string>();
    for (const m of members ?? []) if (m.user) nameById.set(m.user.id, m.user.name);
    const totals = new Map<string, number>();
    for (const d of liveDeals) {
      const key = d.owner_id ? (nameById.get(d.owner_id) ?? "Unknown") : "Unassigned";
      totals.set(key, (totals.get(key) ?? 0) + (d.amount ?? 0));
    }
    const rows = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    return {
      rows,
      option: {
        grid: { left: 8, right: 90, top: 8, bottom: 8, containLabel: true },
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
            return `${p.name}: ${crmMoney(p.value ?? 0, mainCurrency)}`;
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
              formatter: (params: unknown) =>
                crmMoney((params as { value?: number }).value ?? 0, mainCurrency),
            },
          },
        ],
      },
    };
  }, [liveDeals, members, mainCurrency, axisText, chartTooltip, token.colorTextSecondary]);

  const hasDeals = liveDeals.length > 0;
  /** Funnel + forecast + owner charts all wait on deals (and stages). */
  const pipelineLoading = dealsLoading || stagesLoading;
  const growthLoading = peopleLoading || companiesLoading;
  const hasRecords =
    (people ?? []).length + (companies ?? []).length > 0;

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

  return (
    <div style={crmPageStyle()}>
      <CrmPageHeader
        title="CRM Reports"
        subtitle="Pipeline health, forecast, and team performance for this workspace."
        right={
          <Button
            icon={<MIcon name="dashboard" size={16} />}
            onClick={() => router.push("/crm/dashboard")}
          >
            Dashboard
          </Button>
        }
      />

      <div style={TILE_GRID}>
        <StatTile
          icon="target"
          color={CRM_ACCENT.deal}
          label="New deals this month"
          value={dealsLoading ? "—" : newDealsThisMonth}
          hint={now.format("MMMM YYYY")}
        />
        <StatTile
          icon="payments"
          color={CRM_ACCENT.money}
          label="Average deal size"
          value={dealsLoading ? "—" : crmMoney(avgDealSize, mainCurrency)}
          hint={
            dealsLoading
              ? undefined
              : `across ${liveDeals.length} open deal${liveDeals.length === 1 ? "" : "s"}`
          }
        />
        <StatTile
          icon="event_upcoming"
          color={CRM_ACCENT.money}
          label="Closing in 30 days"
          value={dealsLoading ? "—" : crmMoney(closing30, mainCurrency)}
          hint="value of deals due to close"
        />
        <StatTile
          icon="task_alt"
          color={CRM_ACCENT.done}
          label="Tasks completed"
          value={tasksLoading ? "—" : tasksDone}
          hint="all CRM tasks marked done"
        />
      </div>

      <div style={CONTENT_GRID}>
        <Panel title="Stage funnel (deal count)">
          {caption("How many open deals sit in each stage of the pipeline.")}
          {pipelineLoading ? (
            panelSpin
          ) : hasDeals ? (
            <EChart option={funnelOption} height={260} />
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

        <Panel title="Forecast — value by close month">
          {caption(
            "What the open deals are worth in the month they are set to close.",
          )}
          {dealsLoading ? (
            panelSpin
          ) : hasDeals ? (
            <EChart option={forecastOption} height={260} />
          ) : (
            <EmptyState
              compact
              icon="event_upcoming"
              title="Nothing to forecast"
              description="Add close dates to your deals to project expected revenue over the next six months."
              action={goToDeals}
            />
          )}
        </Panel>

        <Panel title="Pipeline value by owner">
          {caption("Who is carrying the pipeline — open value per deal owner.")}
          {dealsLoading ? (
            panelSpin
          ) : ownerOption.rows.length > 0 ? (
            <EChart
              option={ownerOption.option}
              height={Math.max(200, ownerOption.rows.length * 40)}
            />
          ) : (
            <EmptyState
              compact
              icon="group"
              title="No owners to compare"
              description="Assign owners to deals and this chart ranks the team by the value each person is carrying."
              action={goToDeals}
            />
          )}
        </Panel>

        <Panel title="New records per month">
          {caption(
            "How fast the database is growing — people and companies added each month.",
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
      </div>
    </div>
  );
}
