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
  RadarChart,
  FunnelChart,
  TreemapChart,
} from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
  GraphicComponent,
  PolarComponent,
  RadarComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

// Register only the chart types + components the dashboard uses (tree-shaken).
// PolarComponent powers the radial-bar form; Radar/Funnel/Treemap are their own
// series types and each needs its own registration.
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  HeatmapChart,
  RadarChart,
  FunnelChart,
  TreemapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  CalendarComponent,
  GraphicComponent,
  PolarComponent,
  RadarComponent,
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
  onEvents,
  clickable,
}: {
  option: EChartsOption;
  height?: number;
  /** ECharts event name → handler, e.g. `{ click: (p) => … }`. */
  onEvents?: Record<string, (params: never) => void>;
  /** Shows a pointer cursor over the canvas when marks are clickable. */
  clickable?: boolean;
}) {
  const isClient = useIsClient();

  if (!isClient) {
    return <div style={{ height, width: "100%" }} aria-hidden />;
  }

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height, width: "100%", cursor: clickable ? "pointer" : undefined }}
      opts={{ renderer: "canvas" }}
      onEvents={onEvents}
      notMerge
      lazyUpdate
    />
  );
}
