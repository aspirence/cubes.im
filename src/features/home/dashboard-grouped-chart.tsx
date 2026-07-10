"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { EChart, CHART_FONT } from "./echart";
import type { ChartType } from "./dashboard-types";
import type { GroupDatum } from "./dashboard-engine";

const AXIS_LABEL = { color: "#9a9da8", fontSize: 11, fontFamily: CHART_FONT };
const SPLIT_LINE = { lineStyle: { color: "#f0f0f3" } };
const TOOLTIP = {
  backgroundColor: "#ffffff",
  borderColor: "#ececf0",
  borderWidth: 1,
  textStyle: { color: "#17171c", fontSize: 12, fontFamily: CHART_FONT },
  extraCssText: "box-shadow:0 6px 18px -6px rgba(16,24,40,.14);border-radius:8px;",
} as const;

const gradient = (color: string): unknown => ({
  type: "linear",
  x: 0,
  y: 0,
  x2: 0,
  y2: 1,
  colorStops: [
    { offset: 0, color: `${color}47` },
    { offset: 1, color: `${color}05` },
  ],
});

/** Renders one grouped dataset in the card's chosen chart type. */
export function GroupedChart({
  data,
  chart,
  height = 220,
}: {
  data: GroupDatum[];
  chart: ChartType;
  height?: number;
}) {
  const option = useMemo<EChartsOption>(() => {
    const labels = data.map((d) => d.label);

    if (chart === "pie" || chart === "donut") {
      const total = data.reduce((s, d) => s + d.value, 0);
      return {
        tooltip: {
          trigger: "item",
          ...TOOLTIP,
          formatter: "{b}: {c} ({d}%)",
        },
        legend: {
          type: "scroll",
          orient: "vertical",
          right: 0,
          top: "middle",
          icon: "circle",
          itemWidth: 8,
          itemHeight: 8,
          textStyle: { color: "#6a6d78", fontSize: 12, fontFamily: CHART_FONT },
        },
        graphic:
          chart === "donut"
            ? {
                type: "text",
                left: "31%",
                top: "middle",
                style: {
                  text: `${total}\ntotal`,
                  textAlign: "center",
                  fill: "#17171c",
                  fontSize: 20,
                  fontWeight: 600,
                  lineHeight: 20,
                },
              }
            : undefined,
        series: [
          {
            type: "pie",
            radius: chart === "donut" ? ["55%", "82%"] : "78%",
            center: ["32%", "50%"],
            avoidLabelOverlap: true,
            itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 4 },
            label: { show: false },
            data: data.map((d) => ({
              name: d.label,
              value: d.value,
              itemStyle: { color: d.color },
            })),
          },
        ],
      };
    }

    if (chart === "line" || chart === "area") {
      return {
        grid: { top: 16, right: 14, bottom: 46, left: 34 },
        tooltip: { trigger: "axis", ...TOOLTIP },
        xAxis: {
          type: "category",
          data: labels,
          axisLabel: { ...AXIS_LABEL, interval: 0, rotate: labels.length > 5 ? 30 : 0 },
          axisLine: { lineStyle: { color: "#ececf0" } },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          minInterval: 1,
          axisLabel: AXIS_LABEL,
          splitLine: SPLIT_LINE,
        },
        series: [
          {
            type: "line",
            smooth: true,
            symbolSize: 7,
            data: data.map((d) => d.value),
            lineStyle: { color: "#5a5ad6", width: 3 },
            itemStyle: { color: "#5a5ad6", borderColor: "#fff", borderWidth: 2 },
            areaStyle:
              chart === "area" ? { color: gradient("#5a5ad6") as never } : undefined,
          },
        ],
      };
    }

    if (chart === "hbar") {
      const rows = [...data].reverse(); // largest on top
      return {
        grid: { top: 8, right: 20, bottom: 20, left: 8, containLabel: true },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP },
        xAxis: {
          type: "value",
          minInterval: 1,
          axisLabel: AXIS_LABEL,
          splitLine: SPLIT_LINE,
        },
        yAxis: {
          type: "category",
          data: rows.map((d) =>
            d.label.length > 18 ? `${d.label.slice(0, 17)}…` : d.label,
          ),
          axisLabel: { ...AXIS_LABEL, color: "#6a6d78" },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            barMaxWidth: 18,
            data: rows.map((d) => ({
              value: d.value,
              itemStyle: { color: d.color, borderRadius: [0, 6, 6, 0] },
            })),
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
        axisLabel: {
          ...AXIS_LABEL,
          interval: 0,
          rotate: labels.length > 4 ? 30 : 0,
        },
        axisLine: { lineStyle: { color: "#ececf0" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: AXIS_LABEL,
        splitLine: SPLIT_LINE,
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 46,
          data: data.map((d) => ({
            value: d.value,
            itemStyle: { color: d.color, borderRadius: [6, 6, 0, 0] },
          })),
        },
      ],
    };
  }, [data, chart]);

  const isEmpty = data.length === 0 || data.every((d) => d.value === 0);
  if (isEmpty) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9a9da8",
          fontSize: 13,
        }}
      >
        No matching tasks
      </div>
    );
  }
  return <EChart option={option} height={height} />;
}
