"use client";

import { useMemo } from "react";
import { theme } from "antd";
import type { EChartsOption } from "echarts";
import { EChart, CHART_FONT } from "./echart";
import type { ChartType } from "./dashboard-types";
import type { GroupDatum } from "./dashboard-engine";

/** A soft top-to-bottom wash of the series hue (never a saturated block). */
const gradient = (color: string): unknown => ({
  type: "linear",
  x: 0,
  y: 0,
  x2: 0,
  y2: 1,
  colorStops: [
    { offset: 0, color: `${color}2e` },
    { offset: 1, color: `${color}03` },
  ],
});

const truncate = (s: string, n = 18) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a click on a mark reports back. ECharts params are loosely typed. */
type ClickParams = { name?: string; data?: { key?: string } | number | null };

function keyFromClick(p: ClickParams, data: GroupDatum[]): string | undefined {
  const d = p?.data;
  if (d && typeof d === "object" && typeof d.key === "string") return d.key;
  // Fallback: match on the rendered label (radar/gauge and axis-triggered marks).
  return data.find((x) => x.label === p?.name)?.key;
}

/**
 * Renders one grouped dataset (`GroupDatum[]` — a label, count and colour per
 * group) in the card's chosen chart type. Every form here is honest for a single
 * categorical series; forms needing a second dimension aren't offered.
 *
 * `onSelect` makes the marks clickable and drills into that group's tasks.
 */
export function GroupedChart({
  data,
  chart,
  height = 220,
  onSelect,
}: {
  data: GroupDatum[];
  chart: ChartType;
  height?: number;
  onSelect?: (key: string) => void;
}) {
  const { token } = theme.useToken();

  const option = useMemo<EChartsOption>(() => {
    const labels = data.map((d) => d.label);
    const total = data.reduce((s, d) => s + d.value, 0);
    const maxVal = data.reduce((m, d) => Math.max(m, d.value), 0);
    const surface = token.colorBgContainer;

    // Theme-derived chart chrome (tracks light/dark via the AntD algorithm).
    const AXIS_LABEL = { color: token.colorTextTertiary, fontSize: 11, fontFamily: CHART_FONT };
    const SPLIT_LINE = { lineStyle: { color: token.colorSplit } };
    const TOOLTIP = {
      backgroundColor: token.colorBgElevated,
      borderColor: token.colorBorderSecondary,
      borderWidth: 1,
      textStyle: { color: token.colorText, fontSize: 12, fontFamily: CHART_FONT },
      extraCssText: "box-shadow:0 6px 18px -6px rgba(16,24,40,.14);border-radius:8px;",
    } as const;
    const LEGEND = {
      type: "scroll" as const,
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: token.colorTextSecondary, fontSize: 12, fontFamily: CHART_FONT },
    };
    /** Each mark carries its group key so clicks map back without index math. */
    const items = data.map((d) => ({
      name: d.label,
      value: d.value,
      key: d.key,
      itemStyle: { color: d.color },
    }));

    /* ------------------------------------------------ part-to-whole (radial) */
    if (chart === "pie" || chart === "donut" || chart === "rose") {
      // ONE anchor for the ring and its centre label — they were 32% and 31%,
      // so the total sat a pixel off the hole it belongs in. Sharing the
      // constant is what stops that drifting apart again.
      const centreX = "38%";
      return {
        tooltip: { trigger: "item", ...TOOLTIP, formatter: "{b}: {c} ({d}%)" },
        legend: { ...LEGEND, orient: "vertical", right: 8, top: "middle" },
        graphic:
          chart === "donut"
            ? {
                type: "text",
                left: centreX,
                top: "middle",
                style: {
                  text: `${total}\ntotal`,
                  textAlign: "center",
                  fill: token.colorText,
                  fontSize: 20,
                  fontWeight: 600,
                  lineHeight: 20,
                },
              }
            : undefined,
        series: [
          {
            type: "pie",
            radius: chart === "donut" ? ["55%", "82%"] : chart === "rose" ? ["22%", "82%"] : "78%",
            center: [centreX, "50%"],
            roseType: chart === "rose" ? "area" : undefined,
            avoidLabelOverlap: true,
            // A 2px ring in the surface colour is the separator — not a stroke.
            itemStyle: { borderColor: surface, borderWidth: 2, borderRadius: 4 },
            label: { show: false },
            data: items,
          },
        ],
      };
    }

    if (chart === "treemap") {
      return {
        tooltip: { trigger: "item", ...TOOLTIP, formatter: "{b}: {c}" },
        series: [
          {
            type: "treemap",
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            width: "100%",
            height: "100%",
            itemStyle: { borderColor: surface, borderWidth: 2, gapWidth: 2 },
            label: {
              show: true,
              // Labels sit INSIDE the fill, so pick ink that clears it.
              color: "#fff",
              fontSize: 11,
              fontFamily: CHART_FONT,
              formatter: "{b}\n{c}",
            },
            data: items,
          },
        ],
      };
    }

    if (chart === "funnel") {
      return {
        tooltip: { trigger: "item", ...TOOLTIP, formatter: "{b}: {c} ({d}%)" },
        legend: { ...LEGEND, orient: "vertical", right: 0, top: "middle" },
        series: [
          {
            type: "funnel",
            left: 8,
            right: "34%",
            top: 8,
            bottom: 8,
            minSize: "18%",
            gap: 2,
            sort: "descending",
            label: { show: true, position: "inside", color: "#fff", fontSize: 11, fontFamily: CHART_FONT },
            itemStyle: { borderColor: surface, borderWidth: 2 },
            data: items,
          },
        ],
      };
    }

    if (chart === "stack") {
      // One 100%-wide bar split into its parts; each part is its own series so
      // the legend can name them.
      return {
        grid: { top: 8, right: 12, bottom: 8, left: 12, containLabel: true },
        tooltip: { trigger: "item", ...TOOLTIP, formatter: "{a}: {c}" },
        legend: { ...LEGEND, orient: "horizontal", bottom: 0, left: "center" },
        xAxis: { type: "value", max: total || 1, show: false },
        yAxis: { type: "category", data: [""], axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false } },
        series: data.map((d) => ({
          type: "bar" as const,
          name: d.label,
          stack: "total",
          barMaxWidth: 24,
          itemStyle: { color: d.color, borderColor: surface, borderWidth: 2 },
          data: [{ value: d.value, key: d.key }],
        })),
      };
    }

    /* ------------------------------------------------------------ comparison */
    if (chart === "hbar") {
      const rows = [...data].reverse(); // largest on top
      return {
        grid: { top: 8, right: 20, bottom: 20, left: 8, containLabel: true },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP },
        xAxis: { type: "value", minInterval: 1, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
        yAxis: {
          type: "category",
          data: rows.map((d) => truncate(d.label)),
          axisLabel: { ...AXIS_LABEL, color: token.colorTextSecondary },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            barMaxWidth: 24,
            data: rows.map((d) => ({
              value: d.value,
              key: d.key,
              // 4px rounded data-end, square at the baseline.
              itemStyle: { color: d.color, borderRadius: [0, 4, 4, 0] },
            })),
          },
        ],
      };
    }

    if (chart === "lollipop") {
      return {
        grid: { top: 16, right: 14, bottom: 52, left: 34 },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          ...TOOLTIP,
          // Both series share an x — show the value once.
          formatter: (p: unknown) => {
            const arr = p as { name?: string; value?: number }[];
            const first = arr?.[0];
            return first ? `${first.name}: <b>${first.value}</b>` : "";
          },
        },
        xAxis: {
          type: "category",
          data: labels,
          axisLabel: { ...AXIS_LABEL, interval: 0, rotate: labels.length > 4 ? 30 : 0 },
          axisLine: { lineStyle: { color: token.colorBorderSecondary } },
          axisTick: { show: false },
        },
        yAxis: { type: "value", minInterval: 1, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
        series: [
          {
            // the stem
            type: "bar",
            barWidth: 2,
            silent: true,
            data: data.map((d) => ({ value: d.value, key: d.key, itemStyle: { color: d.color } })),
          },
          {
            // the head — a marker, no connecting line
            type: "line",
            symbol: "circle",
            symbolSize: 11,
            lineStyle: { width: 0 },
            z: 3,
            data: data.map((d) => ({
              value: d.value,
              key: d.key,
              // 2px surface ring keeps overlapping heads legible.
              itemStyle: { color: d.color, borderColor: surface, borderWidth: 2 },
            })),
          },
        ],
      };
    }

    if (chart === "polar") {
      return {
        tooltip: { trigger: "item", ...TOOLTIP, formatter: "{b}: {c}" },
        polar: { radius: [24, "72%"], center: ["50%", "50%"] },
        angleAxis: {
          max: maxVal ? maxVal * 1.05 : 1,
          startAngle: 90,
          splitLine: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
        },
        radiusAxis: {
          type: "category",
          data: data.map((d) => truncate(d.label, 14)),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { ...AXIS_LABEL, fontSize: 10 },
          z: 10,
        },
        series: [
          {
            type: "bar",
            coordinateSystem: "polar",
            barMaxWidth: 14,
            roundCap: true,
            data: items,
          },
        ],
      };
    }

    if (chart === "radar") {
      return {
        tooltip: { ...TOOLTIP },
        radar: {
          radius: "64%",
          center: ["50%", "52%"],
          indicator: data.map((d) => ({ name: truncate(d.label, 12), max: maxVal || 1 })),
          axisName: { color: token.colorTextTertiary, fontSize: 11, fontFamily: CHART_FONT },
          splitLine: { lineStyle: { color: token.colorSplit } },
          axisLine: { lineStyle: { color: token.colorSplit } },
          splitArea: { show: false },
        },
        series: [
          {
            type: "radar",
            symbolSize: 6,
            lineStyle: { width: 2, color: "#5a5ad6" },
            itemStyle: { color: "#5a5ad6" },
            areaStyle: { color: "#5a5ad61f" },
            data: [{ value: data.map((d) => d.value), name: "Tasks" }],
          },
        ],
      };
    }

    /* ----------------------------------------------------------- single value */
    if (chart === "gauge") {
      // The biggest group as a share of the total — one honest ratio.
      const top = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
      const pct = total ? Math.round((top.value / total) * 100) : 0;
      return {
        series: [
          {
            type: "gauge",
            startAngle: 210,
            endAngle: -30,
            min: 0,
            max: 100,
            radius: "94%",
            center: ["50%", "58%"],
            progress: { show: true, width: 14, roundCap: true, itemStyle: { color: top?.color } },
            axisLine: { lineStyle: { width: 14, color: [[1, token.colorFillSecondary]] } },
            pointer: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { show: false },
            anchor: { show: false },
            title: {
              offsetCenter: [0, "34%"],
              color: token.colorTextTertiary,
              fontSize: 12,
              fontFamily: CHART_FONT,
            },
            detail: {
              offsetCenter: [0, "0%"],
              formatter: `${pct}%`,
              color: token.colorText,
              fontSize: 26,
              fontWeight: 600,
              fontFamily: CHART_FONT,
            },
            // `key` rides along so a click resolves via data.key — the label
            // is truncated, so the label-match fallback can't be relied on.
            data: [{ value: pct, name: truncate(top?.label ?? "", 16), key: top?.key }],
          },
        ],
      };
    }

    /* ------------------------------------------------------------- trend/bar */
    if (chart === "line" || chart === "area") {
      return {
        grid: { top: 16, right: 14, bottom: 46, left: 34 },
        tooltip: { trigger: "axis", ...TOOLTIP },
        xAxis: {
          type: "category",
          data: labels,
          axisLabel: { ...AXIS_LABEL, interval: 0, rotate: labels.length > 5 ? 30 : 0 },
          axisLine: { lineStyle: { color: token.colorBorderSecondary } },
          axisTick: { show: false },
        },
        yAxis: { type: "value", minInterval: 1, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
        series: [
          {
            type: "line",
            smooth: true,
            symbolSize: 8,
            data: data.map((d) => ({ value: d.value, key: d.key })),
            lineStyle: { color: "#5a5ad6", width: 2 },
            itemStyle: { color: "#5a5ad6", borderColor: surface, borderWidth: 2 },
            areaStyle: chart === "area" ? { color: gradient("#5a5ad6") as never } : undefined,
          },
        ],
      };
    }

    // vertical bar (default)
    return {
      grid: { top: 16, right: 14, bottom: 52, left: 34 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { ...AXIS_LABEL, interval: 0, rotate: labels.length > 4 ? 30 : 0 },
        axisLine: { lineStyle: { color: token.colorBorderSecondary } },
        axisTick: { show: false },
      },
      yAxis: { type: "value", minInterval: 1, axisLabel: AXIS_LABEL, splitLine: SPLIT_LINE },
      series: [
        {
          type: "bar",
          barMaxWidth: 24,
          data: data.map((d) => ({
            value: d.value,
            key: d.key,
            itemStyle: { color: d.color, borderRadius: [4, 4, 0, 0] },
          })),
        },
      ],
    };
  }, [data, chart, token]);

  const isEmpty = data.length === 0 || data.every((d) => d.value === 0);
  if (isEmpty) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: token.colorTextTertiary,
          fontSize: 13,
        }}
      >
        No matching tasks
      </div>
    );
  }

  // The accessible twin — the same numbers, no colour-only encoding.
  if (chart === "table") {
    return <GroupTable data={data} height={height} onSelect={onSelect} />;
  }

  // Radar draws ONE shape across all groups — a click can't identify a single
  // group, so offering a pointer there would be a dead affordance.
  const drillable = Boolean(onSelect) && chart !== "radar";
  const onEvents = drillable
    ? {
        click: (params: never) => {
          const key = keyFromClick(params as ClickParams, data);
          if (key) onSelect?.(key);
        },
      }
    : undefined;

  return <EChart option={option} height={height} onEvents={onEvents} clickable={drillable} />;
}

/** Chart type `table` — every value readable without hovering or seeing colour. */
function GroupTable({
  data,
  height,
  onSelect,
}: {
  data: GroupDatum[];
  height: number;
  onSelect?: (key: string) => void;
}) {
  const { token } = theme.useToken();
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ height, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ color: token.colorTextTertiary, textAlign: "left" }}>
            <th style={{ padding: "4px 6px", fontWeight: 600 }}>Group</th>
            <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>Tasks</th>
            <th style={{ padding: "4px 6px", fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr
              key={d.key}
              onClick={onSelect ? () => onSelect(d.key) : undefined}
              style={{
                borderTop: `1px solid ${token.colorSplit}`,
                cursor: onSelect ? "pointer" : undefined,
              }}
            >
              <td style={{ padding: "5px 6px", color: token.colorText }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flex: "none" }} />
                  {d.label}
                </span>
              </td>
              <td style={{ padding: "5px 6px", textAlign: "right", color: token.colorText, fontVariantNumeric: "tabular-nums" }}>
                {d.value}
              </td>
              <td style={{ padding: "5px 6px", textAlign: "right", color: token.colorTextTertiary, fontVariantNumeric: "tabular-nums" }}>
                {total ? Math.round((d.value / total) * 100) : 0}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
