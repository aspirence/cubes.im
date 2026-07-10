"use client";

import { useSyncExternalStore } from "react";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import {
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  HeatmapChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
  GraphicComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

// Register only the chart types + components the dashboard uses (tree-shaken).
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
  GraphicComponent,
  CanvasRenderer,
]);

/** Shared visual language for every dashboard chart. */
export const CHART_PALETTE = [
  "#5a5ad6",
  "#e0a83e",
  "#3a9d6e",
  "#8b6fd6",
  "#2f9c9c",
  "#d96a8f",
  "#e0663f",
  "#8a8d98",
];

export const CHART_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

const noopSubscribe = () => () => {};
/** false during SSR/first paint, true after client hydration — no effect. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Thin Apache ECharts wrapper. Renders a placeholder until the client mounts so
 * the heavy canvas init never runs during SSR/prerender (and hydration stays
 * clean).
 */
export function EChart({
  option,
  height = 200,
}: {
  option: EChartsOption;
  height?: number;
}) {
  const isClient = useIsClient();

  if (!isClient) {
    return <div style={{ height, width: "100%" }} aria-hidden />;
  }

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height, width: "100%" }}
      opts={{ renderer: "canvas" }}
      notMerge
      lazyUpdate
    />
  );
}
