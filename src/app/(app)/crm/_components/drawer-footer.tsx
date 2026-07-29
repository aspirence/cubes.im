"use client";

import { theme } from "antd";

/**
 * The shared shell for every CRM create/edit `Drawer`.
 *
 * The People/Companies pattern, extracted: the fields scroll, the buttons stay
 * pinned to the bottom. Long forms (the deals drawer has eight fields) used to
 * push Save out of reach.
 *
 * Usage:
 * ```tsx
 * <Drawer width={CRM_DRAWER_WIDTH} styles={{ body: CRM_DRAWER_BODY_STYLE }}>
 *   <Form style={CRM_DRAWER_FORM_STYLE} …>
 *     <CrmDrawerFields>…</CrmDrawerFields>
 *     <CrmDrawerFooter>…</CrmDrawerFooter>
 *   </Form>
 * </Drawer>
 * ```
 */

/** One width for all five form drawers. */
export const CRM_DRAWER_WIDTH = 480;

/** Body owns no padding — the field area and the footer do. */
export const CRM_DRAWER_BODY_STYLE: React.CSSProperties = {
  padding: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

/** The `<Form>` becomes the flex column that splits fields from footer. */
export const CRM_DRAWER_FORM_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

/** The scrollable field area above the sticky footer. */
export function CrmDrawerFields({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "18px 24px 8px",
      }}
    >
      {children}
    </div>
  );
}

/** Sticky action bar: hairline on top, elevated surface, buttons right. */
export function CrmDrawerFooter({ children }: { children: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        justifyContent: "flex-end",
        gap: 8,
        padding: "12px 24px",
        borderTop: `1px solid ${token.colorSplit}`,
        background: token.colorBgElevated,
      }}
    >
      {children}
    </div>
  );
}
