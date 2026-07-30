"use client";

/**
 * The CRM design system.
 *
 * Every CRM page (dashboard, people, companies, deals, tasks, notes, reports,
 * settings) builds its chrome out of these primitives so the eight screens read
 * as one product: same header rhythm, same panels, same avatars, same empty
 * states.
 *
 * Rules of the house:
 *  - Colours come from AntD tokens (`theme.useToken()`), never hardcoded hexes,
 *    because the app has a light/dark toggle. Entity/brand accents (a stage's
 *    colour, an avatar fill) are *data* and may be literal hexes — pass them in.
 *  - Styling is inline `style={{}}` off those tokens; the repo disables Tailwind
 *    Preflight and barely uses utility classes.
 *  - Icons are Material Symbols Rounded via the shared `MIcon` helper.
 */

import { useEffect, useState } from "react";
import { Input, theme } from "antd";
import type { GlobalToken } from "antd";
import { MIcon } from "../_components/m-icon";
import { avatarColor, initials, tint } from "./format";

/* Convenience re-exports so pages only ever import from `./_lib/ui`. */
export {
  CRM_AVATAR_PALETTE,
  avatarColor,
  initials,
  tint,
  crmDate,
  crmDateShort,
  crmDateTime,
  crmFromNow,
  fallbackDealName,
} from "./format";
export { crmMoney, crmPersonName } from "@/features/app-crm/types";

/**
 * Money for PER-UNIT figures — cost per lead, and anything else where the
 * interesting digits are after the decimal point.
 *
 * `crmMoney` rounds to whole units, which is right for a spend total (nobody
 * reads ₹1,24,500.00) and wrong here: a ₹33.40 cost per lead prints "₹33", and
 * anything under half a unit prints "₹0", which reads as free.
 */
export function crmMoneyPrecise(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency ?? ""} ${amount.toFixed(2)}`.trim();
  }
}

/* ------------------------------------------------------------------ *
 * Layout constants
 * ------------------------------------------------------------------ */

/** Content width for the centred (non full-bleed) CRM pages. */
export const CRM_MAX_WIDTH = 1240;
/** Outer page padding. */
export const CRM_PAGE_PADDING = 24;

/**
 * Standard page wrapper style: `<div style={crmPageStyle()}>`.
 * Full-bleed screens (the deals board) can pass a larger/`"100%"` width.
 */
export function crmPageStyle(
  maxWidth: number | string = CRM_MAX_WIDTH,
): React.CSSProperties {
  return { padding: CRM_PAGE_PADDING, maxWidth, margin: "0 auto" };
}

/* ------------------------------------------------------------------ *
 * Hover-reveal CSS (row actions)
 * ------------------------------------------------------------------ */

export const CRM_ROW_ACTIONS_CLASS = "crm-row-actions";
/** Put on any non-table container that should reveal its `<RowActions>`. */
export const CRM_HOVER_ROW_CLASS = "crm-hover-row";

/**
 * Token-free stylesheet (opacity/transition only) so it can be injected once
 * and never re-written when the theme flips.
 */
export const CRM_UI_CSS = `
.${CRM_ROW_ACTIONS_CLASS}{opacity:0;transition:opacity .12s ease;display:inline-flex;align-items:center;justify-content:flex-end;gap:2px}
.ant-table-row:hover .${CRM_ROW_ACTIONS_CLASS},
.ant-table-row-selected .${CRM_ROW_ACTIONS_CLASS},
.${CRM_HOVER_ROW_CLASS}:hover .${CRM_ROW_ACTIONS_CLASS},
.${CRM_ROW_ACTIONS_CLASS}:focus-within,
.${CRM_ROW_ACTIONS_CLASS}[data-open="true"]{opacity:1}
@media (hover:none){.${CRM_ROW_ACTIONS_CLASS}{opacity:1}}
`;

const CRM_STYLE_ID = "crm-ui-styles";
let styleInjected = false;

function ensureCrmStyles(): void {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  if (document.getElementById(CRM_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = CRM_STYLE_ID;
  el.textContent = CRM_UI_CSS;
  document.head.appendChild(el);
}

/** Injects {@link CRM_UI_CSS} once per document. Safe to call many times. */
export function useCrmStyles(): void {
  useEffect(ensureCrmStyles, []);
}

/**
 * Drop once per page (renders nothing). `RowActions` self-injects too, so this
 * is only needed when a page uses {@link CRM_HOVER_ROW_CLASS} on its own.
 */
export function CrmStyles(): null {
  useCrmStyles();
  return null;
}

/* ------------------------------------------------------------------ *
 * Shared card surface
 * ------------------------------------------------------------------ */

function cardSurface(token: GlobalToken, raised: boolean): React.CSSProperties {
  return {
    background: token.colorBgContainer,
    border: `1px solid ${raised ? token.colorBorder : token.colorBorderSecondary}`,
    borderRadius: 12,
    boxShadow: raised ? token.boxShadowTertiary : "none",
    transition: "border-color .12s ease, box-shadow .12s ease",
  };
}

/* ------------------------------------------------------------------ *
 * Page chrome
 * ------------------------------------------------------------------ */

/**
 * Page heading row: H1 (+ optional count pill) and subtitle on the left,
 * actions on the right.
 */
export function CrmPageHeader({
  title,
  subtitle,
  right,
  count,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  count?: number | string | null;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 18,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: "-0.4px",
              lineHeight: 1.2,
              color: token.colorText,
            }}
          >
            {title}
          </h1>
          {count === null || count === undefined ? null : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 20,
                padding: "0 8px",
                borderRadius: 999,
                background: token.colorFillTertiary,
                color: token.colorTextSecondary,
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              {count}
            </span>
          )}
        </div>
        {subtitle ? (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              lineHeight: 1.45,
              color: token.colorTextSecondary,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {right}
        </div>
      ) : null}
    </div>
  );
}

/** The search / filters / primary-action row that sits under the header. */
export function CrmToolbar({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        marginBottom: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Search box with a glyph prefix + clear affordance. Controlled. */
export function CrmSearch({
  value,
  onChange,
  placeholder = "Search…",
  width = 240,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number | string;
}) {
  const { token } = theme.useToken();
  return (
    <Input
      allowClear
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      prefix={
        <MIcon name="search" size={16} color={token.colorTextTertiary} />
      }
      style={{ width }}
    />
  );
}

/** Small uppercase label above grouped content. */
export function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.7px",
        textTransform: "uppercase",
        color: token.colorTextTertiary,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Containers
 * ------------------------------------------------------------------ */

/**
 * The CRM card container. `padding={0}` wraps a `<Table>` flush to the edges
 * (corners clip so the table header respects the radius); `hover` adds the lift
 * used by clickable cards.
 */
export function Panel({
  title,
  extra,
  padding = 16,
  children,
  hover = false,
  style,
}: {
  title?: React.ReactNode;
  extra?: React.ReactNode;
  padding?: number | string;
  children?: React.ReactNode;
  hover?: boolean;
  style?: React.CSSProperties;
}) {
  const { token } = theme.useToken();
  const [raised, setRaised] = useState(false);
  const hasHeader = title !== undefined || extra !== undefined;
  return (
    <div
      onMouseEnter={hover ? () => setRaised(true) : undefined}
      onMouseLeave={hover ? () => setRaised(false) : undefined}
      style={{
        ...cardSurface(token, hover && raised),
        overflow: padding === 0 ? "hidden" : undefined,
        ...style,
      }}
    >
      {hasHeader ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "12px 16px",
            borderBottom: `1px solid ${token.colorSplit}`,
          }}
        >
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              letterSpacing: "-0.1px",
              color: token.colorText,
              minWidth: 0,
            }}
          >
            {title}
          </span>
          {extra ? <div style={{ flex: "none" }}>{extra}</div> : null}
        </div>
      ) : null}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Metrics
 * ------------------------------------------------------------------ */

function StatTileBody({
  icon,
  color,
  label,
  value,
  hint,
  token,
}: {
  icon: string;
  color: string;
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  token: GlobalToken;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: tint(color, 0.12),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <MIcon name={icon} size={20} color={color} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: token.colorTextSecondary,
            lineHeight: 1.4,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 21,
            fontWeight: 650,
            lineHeight: 1.25,
            color: token.colorText,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {value}
        </div>
        {hint ? (
          <div
            style={{
              fontSize: 11.5,
              color: token.colorTextTertiary,
              lineHeight: 1.4,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Metric tile: accent icon chip + label + value (+ hint). Pass `onClick` for
 * the drill-down variant — it renders a real `<button>` and gains the lift.
 */
export function StatTile({
  icon,
  color,
  label,
  value,
  hint,
  onClick,
}: {
  icon: string;
  color: string;
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  onClick?: () => void;
}) {
  const { token } = theme.useToken();
  const [raised, setRaised] = useState(false);
  const body = (
    <StatTileBody
      icon={icon}
      color={color}
      label={label}
      value={value}
      hint={hint}
      token={token}
    />
  );

  if (!onClick) {
    return (
      <div style={{ ...cardSurface(token, false), padding: 14 }}>{body}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setRaised(true)}
      onMouseLeave={() => setRaised(false)}
      onFocus={() => setRaised(true)}
      onBlur={() => setRaised(false)}
      style={{
        ...cardSurface(token, raised),
        padding: 14,
        width: "100%",
        display: "block",
        textAlign: "left",
        fontFamily: "inherit",
        fontSize: "inherit",
        lineHeight: "inherit",
        color: "inherit",
        cursor: "pointer",
      }}
    >
      {body}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Entities
 * ------------------------------------------------------------------ */

/**
 * People are circles, companies are rounded squares — the one shape cue that
 * tells the two record types apart everywhere in the CRM. Fill is deterministic
 * from `name`, so a record keeps its colour across pages.
 */
export function EntityAvatar({
  name,
  kind,
  src,
  size = 28,
}: {
  name: string;
  kind: "person" | "company";
  src?: string | null;
  size?: number;
}) {
  const radius = kind === "person" ? 999 : Math.max(6, Math.round(size * 0.29));
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        style={{ ...base, objectFit: "cover" }}
      />
    );
  }

  return (
    <span
      aria-hidden
      title={name || undefined}
      style={{
        ...base,
        background: avatarColor(name),
        color: "#fff",
        fontSize: Math.max(9.5, Math.round(size * 0.38 * 10) / 10),
        fontWeight: 600,
        letterSpacing: "0.2px",
        lineHeight: 1,
      }}
    >
      {initials(name)}
    </span>
  );
}

/**
 * The avatar for record types that have no initials worth showing — a deal, a
 * campaign. Same deterministic fill and rounded-square footprint as
 * `EntityAvatar`, with a Material glyph where the initials would be, so one
 * record always looks like the same record. `DealGlyph` / `CampaignGlyph` are
 * the two named wrappers; nothing should re-implement this shape a third time.
 */
export function GlyphTile({
  name,
  icon,
  size = 28,
}: {
  name: string;
  icon: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      title={name || undefined}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(6, Math.round(size * 0.29)),
        background: avatarColor(name),
        color: "#fff",
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <MIcon name={icon} size={Math.round(size * 0.6)} color="#fff" />
    </span>
  );
}

/**
 * First-column cell for CRM tables: avatar + name (500) with an optional muted
 * second line.
 */
export function EntityCell({
  name,
  kind,
  subtitle,
  src,
  size = 28,
  muted = false,
}: {
  name: React.ReactNode;
  kind: "person" | "company";
  subtitle?: React.ReactNode;
  src?: string | null;
  size?: number;
  /** Dim the primary line (used for soft-deleted rows). */
  muted?: boolean;
}) {
  const { token } = theme.useToken();
  const avatarKey = typeof name === "string" ? name : "";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <EntityAvatar name={avatarKey} kind={kind} src={src} size={size} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 500,
            color: muted ? token.colorTextTertiary : token.colorText,
            lineHeight: 1.35,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        {subtitle ? (
          <div
            style={{
              fontSize: 12,
              color: token.colorTextTertiary,
              lineHeight: 1.35,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overview grid (definition list)
 * ------------------------------------------------------------------ */

/**
 * Two-column label/value grid — the "what is this record" block at the top of
 * the record drawer and the campaign drawer. One implementation, so a field
 * reads identically wherever a record is opened from.
 */
export function OverviewGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "14px 18px",
      }}
    >
      {children}
    </div>
  );
}

/**
 * One field of an `OverviewGrid`. An em-dash value dims itself, so an empty
 * field reads as absent rather than as data.
 */
export function OverviewField({
  label,
  children,
  span,
}: {
  label: string;
  children: React.ReactNode;
  /** Addresses, URLs and notes span both columns. */
  span?: 2;
}) {
  const { token } = theme.useToken();
  const empty = children === "—";
  return (
    <div style={{ minWidth: 0, gridColumn: span === 2 ? "1 / -1" : undefined }}>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.4,
          color: token.colorTextTertiary,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: empty ? token.colorTextQuaternary : token.colorText,
          wordBreak: "break-word",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chips
 * ------------------------------------------------------------------ */

export type SoftChipTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "accent"
  | "custom";

/**
 * Soft status pill — tinted background, saturated text. Use instead of a
 * default AntD `Tag` for status-ish values; keep `Tag` only where the colour is
 * genuinely arbitrary data. `tone="custom"` tints the supplied entity hex.
 */
export function SoftChip({
  tone = "neutral",
  color,
  icon,
  children,
  style,
}: {
  tone?: SoftChipTone;
  /** Required for tone="custom" — an entity/brand hex such as a stage colour. */
  color?: string;
  /** Optional Material Symbols glyph rendered before the label. */
  icon?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const { token } = theme.useToken();

  let bg = token.colorFillTertiary;
  let fg = token.colorTextSecondary;
  if (tone === "success") {
    bg = token.colorSuccessBg;
    fg = token.colorSuccess;
  } else if (tone === "warning") {
    bg = token.colorWarningBg;
    fg = token.colorWarning;
  } else if (tone === "danger") {
    bg = token.colorErrorBg;
    fg = token.colorError;
  } else if (tone === "accent") {
    bg = token.colorPrimaryBg;
    fg = token.colorPrimary;
  } else if (tone === "custom" && color) {
    bg = tint(color, 0.14);
    fg = color;
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth: "100%",
        height: 22,
        padding: "0 8px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        ...style,
      }}
    >
      {icon ? <MIcon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Empty states
 * ------------------------------------------------------------------ */

/**
 * Centred empty block. Use different copy for "nothing yet" vs "no results"
 * vs "nothing deleted" — same shape, different words.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  accent,
  compact = false,
}: {
  icon: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Tint the glyph chip with an accent (pass a token colour, not a literal). */
  accent?: string;
  /** Tighter vertical padding for in-panel/in-table usage. */
  compact?: boolean;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: compact ? "28px 20px" : "56px 24px",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: accent ? tint(accent, 0.12) : token.colorFillTertiary,
        }}
      >
        <MIcon
          name={icon}
          size={24}
          color={accent ?? token.colorTextQuaternary}
        />
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 14,
          fontWeight: 600,
          color: token.colorText,
        }}
      >
        {title}
      </div>
      {description ? (
        <div
          style={{
            marginTop: 4,
            maxWidth: 380,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: token.colorTextTertiary,
          }}
        >
          {description}
        </div>
      ) : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Table row actions
 * ------------------------------------------------------------------ */

/**
 * Wraps a table row's action buttons: hidden at rest, revealed on row hover /
 * keyboard focus (always visible on touch). Clicks are stopped so the row's
 * own drawer-open handler doesn't fire.
 *
 * Set `open` while a Dropdown/Popconfirm launched from inside is open, so the
 * cluster stays visible while the overlay is up.
 */
export function RowActions({
  children,
  open = false,
  style,
}: {
  children: React.ReactNode;
  open?: boolean;
  style?: React.CSSProperties;
}) {
  useCrmStyles();
  return (
    <div
      className={CRM_ROW_ACTIONS_CLASS}
      data-open={open ? "true" : undefined}
      onClick={(e) => e.stopPropagation()}
      style={style}
    >
      {children}
    </div>
  );
}
