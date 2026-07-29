"use client";

import { useMemo } from "react";
import { Card, Col, Empty, Row, Statistic, Typography, theme } from "antd";
import dayjs from "dayjs";
import { EChart, CHART_FONT, CHART_PALETTE } from "@/features/home/echart";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import { useCrmTasks } from "@/features/app-crm/use-crm-tasks";
import { crmMoney } from "@/features/app-crm/types";

const MONTHS_BACK = 6;
const MONTHS_FORWARD = 6;

/** Magnitude charts use ONE hue (the shared chart palette's first slot). */
const MAG = CHART_PALETTE[0];

export default function CrmReportsPage() {
  const { token } = theme.useToken();
  const { data: deals } = useCrmDeals();
  const { data: stages } = useCrmStages();
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: tasks } = useCrmTasks();
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

  // Stage funnel — pipeline order, count per stage, stage entity colors.
  const funnelOption = useMemo(() => {
    const data = (stages ?? []).map((s) => ({
      name: s.name,
      value: liveDeals.filter((d) => d.stage_id === s.id).length,
      itemStyle: { color: s.color },
    }));
    return {
      tooltip: { trigger: "item" as const },
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
            color: "#fff",
            fontFamily: CHART_FONT,
            formatter: "{b}: {c}",
          },
          data,
        },
      ],
    };
  }, [stages, liveDeals]);

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
  }, [liveDeals, monthStart, mainCurrency, axisText, recessiveSplit]);

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
      tooltip: { trigger: "axis" as const },
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
  }, [people, companies, monthStart, axisText, recessiveSplit, token.colorTextSecondary]);

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
  }, [liveDeals, members, mainCurrency, axisText, token.colorTextSecondary]);

  const hasDeals = liveDeals.length > 0;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>
        CRM Reports
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        Pipeline health, forecast, and team performance for this workspace.
      </Typography.Paragraph>

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="New deals this month" value={newDealsThisMonth} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Average deal size"
              value={crmMoney(avgDealSize, mainCurrency)}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Closing in 30 days"
              value={crmMoney(closing30, mainCurrency)}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Tasks completed" value={tasksDone} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Stage funnel (deal count)">
            {hasDeals ? (
              <EChart option={funnelOption} height={260} />
            ) : (
              <Empty description="No deals yet." />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Forecast — value by close month">
            {hasDeals ? (
              <EChart option={forecastOption} height={260} />
            ) : (
              <Empty description="Add close dates to deals to see the forecast." />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Pipeline value by owner">
            {ownerOption.rows.length > 0 ? (
              <EChart
                option={ownerOption.option}
                height={Math.max(200, ownerOption.rows.length * 40)}
              />
            ) : (
              <Empty description="Assign owners to deals to compare the team." />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="New records per month">
            <EChart option={growthOption} height={260} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
