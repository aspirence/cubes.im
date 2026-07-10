import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

/**
 * Cubes brand primary — indigo (UI refresh).
 */
export const PRIMARY_COLOR = "#4a4ad0";

const FONT_SANS =
  "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_MONO =
  "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Shared, color-agnostic shaping tokens. Dense controls (34px), 13px base type,
 * 8/12px radii — the biggest lever for the whole visual refresh.
 */
const sharedToken: ThemeConfig["token"] = {
  colorPrimary: PRIMARY_COLOR,
  colorLink: "#5a5ad6",
  colorInfo: PRIMARY_COLOR,
  colorSuccess: "#2f8f5f",
  colorWarning: "#b8842a",
  colorError: "#c0453c",

  fontFamily: FONT_SANS,
  fontSize: 13,

  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,

  controlHeight: 34,
  controlHeightLG: 40,
  controlHeightSM: 26,

  // No blue focus ring on form controls anywhere — inputs/selects/pickers show
  // only a subtle neutral border on focus (see the per-component tokens below).
  controlOutlineWidth: 0,
  controlOutline: "transparent",

  wireframe: false,
};

const sharedComponents: ThemeConfig["components"] = {
  Button: {
    fontWeight: 600,
    controlHeight: 34,
    borderRadius: 8,
    primaryShadow: "0 1px 2px rgba(74, 74, 208, 0.35)",
    defaultShadow: "none",
    dangerShadow: "none",
  },
  Card: { borderRadiusLG: 12, paddingLG: 16, headerBg: "transparent", headerFontSize: 15 },
  // `activeShadow: none` + neutral active/hover borders keep the blue focus
  // ring/border off every text control across the app.
  Input: {
    controlHeight: 34,
    borderRadius: 8,
    activeShadow: "none",
    activeBorderColor: "#b7bac6",
    hoverBorderColor: "#c9cbd4",
  },
  InputNumber: {
    controlHeight: 34,
    borderRadius: 8,
    activeShadow: "none",
    activeBorderColor: "#b7bac6",
    hoverBorderColor: "#c9cbd4",
  },
  Select: {
    controlHeight: 34,
    borderRadius: 8,
    activeBorderColor: "#b7bac6",
    hoverBorderColor: "#c9cbd4",
  },
  DatePicker: {
    controlHeight: 34,
    borderRadius: 8,
    activeBorderColor: "#b7bac6",
    hoverBorderColor: "#c9cbd4",
  },
  Table: {
    headerSplitColor: "transparent",
    cellPaddingBlock: 12,
    cellPaddingInline: 16,
    fontWeightStrong: 600,
    borderRadius: 12,
  },
  Tabs: { titleFontSize: 13, horizontalItemGutter: 24, inkBarColor: PRIMARY_COLOR },
  Tag: { borderRadiusSM: 6 },
  Segmented: { borderRadius: 8, controlHeight: 32 },
  Modal: { borderRadiusLG: 14 },
  Menu: { itemBorderRadius: 7, itemHeight: 34, itemMarginInline: 8 },
  Statistic: { contentFontSize: 26 },
};

export const lightTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    ...sharedToken,
    colorBgLayout: "#f6f7f9",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",
    colorBorder: "#e6e7ec",
    colorBorderSecondary: "#ececf0",
    colorText: "#17171c",
    colorTextSecondary: "#6a6d78",
    colorTextTertiary: "#9a9da8",
    boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
    boxShadowSecondary:
      "0 8px 24px -4px rgba(16, 24, 40, 0.10), 0 4px 8px -4px rgba(16, 24, 40, 0.06)",
    boxShadowTertiary: "0 1px 2px rgba(16, 24, 40, 0.04)",
  },
  components: {
    ...sharedComponents,
    Layout: {
      headerBg: "rgba(246, 247, 249, 0.85)",
      siderBg: "#fbfbfc",
      bodyBg: "#f6f7f9",
      headerHeight: 58,
      headerPadding: "0 24px",
    },
    Menu: {
      ...sharedComponents!.Menu,
      itemSelectedBg: "#eceefb",
      itemSelectedColor: PRIMARY_COLOR,
      itemColor: "#494b54",
      itemHoverBg: "#eef0f3",
    },
    Table: {
      ...sharedComponents!.Table,
      headerBg: "#ffffff",
      headerColor: "#a2a5af",
      rowHoverBg: "#fafafb",
      borderColor: "#f0f0f3",
    },
    Segmented: {
      ...sharedComponents!.Segmented,
      itemSelectedBg: "#eceefb",
      itemSelectedColor: PRIMARY_COLOR,
    },
    Input: { ...sharedComponents!.Input, colorBorder: "#e6e7ec" },
    Tag: { ...sharedComponents!.Tag, defaultBg: "#f2f3f5", defaultColor: "#6a6d78" },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    ...sharedToken,
    colorBgLayout: "#0b0d12",
    colorBgContainer: "#14171f",
    colorBgElevated: "#1a1e28",
    colorBorder: "#262b37",
    colorBorderSecondary: "#1e222c",
    colorText: "#e6e9ef",
    colorTextSecondary: "#9aa4b6",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.4)",
    boxShadowSecondary: "0 8px 24px -4px rgba(0, 0, 0, 0.5)",
  },
  components: {
    ...sharedComponents,
    Layout: {
      headerBg: "rgba(11, 13, 18, 0.85)",
      siderBg: "#14171f",
      bodyBg: "#0b0d12",
      headerHeight: 58,
      headerPadding: "0 24px",
    },
    Menu: {
      ...sharedComponents!.Menu,
      itemSelectedBg: "rgba(74, 74, 208, 0.20)",
      itemSelectedColor: "#a6a6f0",
    },
    Table: { ...sharedComponents!.Table, headerBg: "#1a1e28", rowHoverBg: "#1a1e28" },
  },
};

export type ThemeMode = "light" | "dark";

export function getThemeConfig(mode: ThemeMode): ThemeConfig {
  return mode === "dark" ? darkTheme : lightTheme;
}

/** Geist Mono stack — for numerals (KPIs, counts, dates, task keys). */
export const MONO_FONT = FONT_MONO;
