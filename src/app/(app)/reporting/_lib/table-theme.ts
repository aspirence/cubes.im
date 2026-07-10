/** Shared AntD Table theme override for the reporting suite. */

import type { ThemeConfig } from "antd";
import { T } from "./tokens";

export const reportingTableTheme: ThemeConfig = {
  token: {
    colorText: T.textPrimary,
    colorTextHeading: T.textSecondary,
    fontSize: 13,
    borderRadius: 8,
  },
  components: {
    Table: {
      headerBg: T.panel,
      headerColor: T.textSecondary,
      headerSplitColor: "transparent",
      borderColor: T.divider,
      rowHoverBg: "#fafafb",
      cellPaddingBlock: 11,
      cellPaddingInline: 16,
      headerBorderRadius: 0,
      fontWeightStrong: 600,
    },
  },
};
