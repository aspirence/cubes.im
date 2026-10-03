"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Drawer,
  Dropdown,
  Form,
  Input,
  Popconfirm,
  Radio,
  Segmented,
  Select,
  Space,
  Spin,
  Tooltip,
  theme,
  type MenuProps,
  type TableColumnsType,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useCreateCrmDeal,
  useCrmDeals,
  useDestroyCrmDeal,
  useMoveCrmDeal,
  useSetCrmDealDeleted,
  useUpdateCrmDeal,
} from "@/features/app-crm/use-crm-deals";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import {
  useCrmLabels,
  useSetCrmDealLabel,
} from "@/features/app-crm/use-crm-labels";
import { useCrmCampaigns } from "@/features/app-crm/use-crm-campaigns";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  CRM_LEAD_STATUSES,
  CRM_LEAD_STATUS_DEFAULT,
  crmLeadStatusMeta,
  type CrmDealWithRefs,
  type CrmLeadStatus,
  type CrmStage,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import { DealQuickCreate } from "../_components/paste-deal";
import { LeadImportDialog } from "../_components/lead-import-dialog";
import { importRefOf } from "../_lib/lead-import";
import { CrmToggle } from "../_components/crm-toggle";
import {
  BulkBar,
  BulkMoveToProject,
  useBulkRun,
} from "../_components/bulk-bar";
import { LeadStatusPicker } from "../_components/lead-status-picker";
import { DealLabels, LabelChip } from "../_components/label-picker";
import { DealCell } from "../_components/deal-glyph";
import {
  CRM_ACCENT,
  NO_STAGE_COLOR,
  leadStatusIcon,
} from "../_components/entity-meta";
import { TILE_GRID } from "../_components/layout";
import { FormSection } from "../_components/form-section";
import { closingWithin } from "../_lib/deal-metrics";
import {
  CRM_DRAWER_BODY_STYLE,
  CRM_DRAWER_FORM_STYLE,
  CRM_DRAWER_WIDTH,
  CrmDrawerFields,
  CrmDrawerFooter,
} from "../_components/drawer-footer";
import {
  CRM_MAX_WIDTH,
  CrmPageHeader,
  CrmToolbar,
  EmptyState,
  ErrorState,
  EntityAvatar,
  EntityCell,
  Panel,
  RowActions,
  StatTile,
  crmDateShort,
  crmPageStyle,
  crmPersonName,
  fallbackDealName,
  tint,
} from "../_lib/ui";
import {
  CrmTable,
  CrmTableCard,
  DateCell,
  DateCreatedFilter,
  EmptyCell,
  FilterButton,
  ManageColumns,
  PhoneChip,
  TableSearch,
  TagPill,
  ToolbarSpacer,
  UpdatedCell,
  createdWindow,
  inCreatedWindow,
  useColumnLayout,
  useContextMenu,
  type ColumnChoice,
  type CreatedPreset,
  type CreatedRange,
  type CrmMenuItem,
} from "../_components/data-table";
import {
  useDealMenuItems,
  useProjectMoveItem,
  useRecordMenu,
} from "../_components/record-menu";
import { useCrmPrefsStore } from "../_lib/crm-prefs-store";
import { useRecordDeepLink } from "../_lib/record-deep-link";
import {
  NO_PROJECT,
  useCrmScope,
  useResetOnScopeChange,
  useScopeMismatchNotice,
} from "../_lib/crm-scope";
import { ScopedEmptyState } from "../_components/crm-scope-bar";
import { ProjectPicker } from "../_components/target-picker";
import { PhoneWithCopy } from "../_components/phone-cell";

/** The board's "no stage" pseudo-column id (column ids are `col:<id>`). */
const NO_STAGE = "none";
const colId = (stageId: string) => `col:${stageId}`;

/** Hover-lift class for board cards (see the <style> block in the page). */
const DEAL_CARD_CLASS = "crm-deal-card";
/** The card whose right-click menu is open, outlined like a table row's. */
const DEAL_CARD_MENU_CLASS = "crm-deal-card--menu";

/**
 * Whether a right-click on a board card gets the deal menu: not with Shift
 * held (the way back to the browser's own menu), and only on the card itself —
 * the status picker's list is a portal whose events bubble through the card.
 */
function wantsCardMenu(e: React.MouseEvent<HTMLElement>): boolean {
  if (e.shiftKey) return false;
  return e.target instanceof Node && e.currentTarget.contains(e.target);
}

/** Ctrl+click is the Mac's right-click: it opens the deal menu, nothing else. */
function isMacCtrlClick(e: React.MouseEvent<HTMLElement>): boolean {
  return e.ctrlKey && /Mac/.test(navigator.userAgent);
}

type DealFormValues = {
  /** Optional — a blank one is filled in from the deal's relations on save. */
  name?: string;
  phone?: string;
  stage_id?: string | null;
  /** The lead's own health — never the board axis, which is `stage_id`. */
  status?: CrmLeadStatus;
  campaign_id?: string | null;
  close_date?: Dayjs | null;
  /** The project the deal is filed under; cleared = no project. */
  project_id?: string | null;
  company_id?: string | null;
  contact_id?: string | null;
  owner_id?: string | null;
};

/** Toolbar lead-status filter — the seven statuses plus "show everything". */
type StatusFilter = "ALL" | CrmLeadStatus;

/**
 * The table columns "Manage columns" can hide and reorder, in their default
 * left-to-right order. Every data column is here, the deal itself included;
 * only the row actions stay put (last). Keys match the antd column keys.
 */
const COLUMN_CHOICES: ColumnChoice[] = [
  { key: "name", title: "Deal" },
  { key: "stage", title: "Stage" },
  { key: "status", title: "Status" },
  { key: "labels", title: "Tags" },
  { key: "campaign", title: "Campaign" },
  { key: "source", title: "Source" },
  { key: "contact", title: "Contact" },
  { key: "phone", title: "Mobile" },
  { key: "owner", title: "Owner" },
  { key: "close_date", title: "Close date" },
  { key: "created_at", title: "Created" },
  { key: "updated_at", title: "Last update" },
];
/** Off until asked for: the table is already wide, and "Last update" is the
 *  date people actually scan. Source is there for the import / channel pass. */
const DEFAULT_HIDDEN_COLUMNS = ["created_at", "source"];

/** "meta_lead_ads" → "Meta lead ads"; "Facebook" stays "Facebook". */
function sourceLabel(source: string): string {
  const t = source.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** `true` when a close date has already passed (day granularity). */
function isOverdue(closeDate: string | null): boolean {
  return closeDate ? dayjs(closeDate).isBefore(dayjs(), "day") : false;
}

/** One muted glyph + label pair in a card's meta row. */
function CardMeta({ icon, text }: { icon: string; text: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <MIcon name={icon} size={13} />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </span>
  );
}

function DealCard({
  deal,
  color,
  onOpen,
  onContextMenu,
  menuOpen,
  dragOverlay,
}: {
  deal: CrmDealWithRefs;
  color: string;
  onOpen?: (deal: CrmDealWithRefs) => void;
  /** Right-click: the deal's menu (opened at page level, outside the card). */
  onContextMenu?: (
    e: React.MouseEvent<HTMLElement>,
    deal: CrmDealWithRefs,
  ) => void;
  /** This card's right-click menu is open. */
  menuOpen?: boolean;
  dragOverlay?: boolean;
}) {
  const { token } = theme.useToken();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id, disabled: dragOverlay });
  const startDrag = listeners?.onPointerDown as
    | ((e: React.PointerEvent<HTMLDivElement>) => void)
    | undefined;

  const contactName = crmPersonName(deal.contact);
  const overdue = isOverdue(deal.close_date);
  const hasMeta = Boolean(deal.company || contactName || deal.close_date);

  return (
    <div
      ref={dragOverlay ? undefined : setNodeRef}
      {...(dragOverlay ? {} : attributes)}
      {...(dragOverlay ? {} : listeners)}
      onPointerDown={
        dragOverlay
          ? undefined
          : (e) => {
              // A Mac right-click must not arm a drag as well.
              if (isMacCtrlClick(e)) return;
              startDrag?.(e);
            }
      }
      onClick={(e) => {
        if (!isMacCtrlClick(e)) onOpen?.(deal);
      }}
      onContextMenu={
        onContextMenu ? (e) => onContextMenu(e, deal) : undefined
      }
      className={
        menuOpen ? `${DEAL_CARD_CLASS} ${DEAL_CARD_MENU_CLASS}` : DEAL_CARD_CLASS
      }
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        background: token.colorBgContainer,
        // Base border lives in DEAL_CARD_CLASS so the :hover rule can win — an
        // inline `border` would outrank it. Only the stage accent (data) is inline.
        borderLeftColor: color,
        borderRadius: 10,
        padding: "10px 12px",
        cursor: dragOverlay || isDragging ? "grabbing" : "grab",
        boxShadow: dragOverlay ? token.boxShadowSecondary : undefined,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 13.5,
          fontWeight: 500,
          lineHeight: 1.4,
          color: token.colorText,
          wordBreak: "break-word",
        }}
      >
        {deal.name}
      </div>

      {/* Lead health, one size down — the board should read as states at a
          glance without competing with the stage colour on the card's edge.
          The glyph is what separates New from Qualified (both `accent`) and
          Contacted from Not interested (both `neutral`) on a card. Editable
          here too, so a status move never costs a drag or a drawer. */}
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <LeadStatusPicker dealId={deal.id} status={deal.status} size="small" />
        {/* Tags a card already carries, read-only here: a card is dragged, and
            an "x" on every chip is a mis-click waiting to happen mid-drag. The
            picker is one click away in the drawer. */}
        {deal.labels.map((label) => (
          <LabelChip key={label.id} label={label} size="small" />
        ))}
      </span>

      {hasMeta ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            minWidth: 0,
            fontSize: 11.5,
            color: token.colorTextTertiary,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              flexWrap: "wrap",
            }}
          >
            {deal.company ? (
              <CardMeta icon="domain" text={deal.company.name} />
            ) : null}
            {contactName ? (
              <CardMeta icon="person" text={contactName} />
            ) : null}
          </div>
          {deal.close_date ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                flex: "none",
                color: overdue ? token.colorError : token.colorTextTertiary,
                fontWeight: overdue ? 600 : 500,
              }}
            >
              <MIcon name="event" size={13} />
              {crmDateShort(deal.close_date)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Calling is the next action on most cards — number and copy inline. */}
      {deal.phone ? (
        <div style={{ marginTop: 6 }}>
          <PhoneWithCopy phone={deal.phone} size={11.5} />
        </div>
      ) : null}
    </div>
  );
}

function BoardColumn({
  id,
  name,
  color,
  deals,
  onOpen,
  onCardContextMenu,
  menuDealId,
  onAdd,
}: {
  id: string;
  name: string;
  color: string;
  deals: CrmDealWithRefs[];
  onOpen: (deal: CrmDealWithRefs) => void;
  onCardContextMenu: (
    e: React.MouseEvent<HTMLElement>,
    deal: CrmDealWithRefs,
  ) => void;
  /** The deal whose right-click menu is open, if any. */
  menuDealId: string | null;
  onAdd?: () => void;
}) {
  const { token } = theme.useToken();
  const { setNodeRef, isOver } = useDroppable({ id });
  // A whisper of the stage colour over the standard column fill.
  const wash = tint(color, isOver ? 0.13 : 0.05);

  return (
    <div
      ref={setNodeRef}
      style={{
        width: 292,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        borderRadius: 12,
        border: `1px solid ${isOver ? tint(color, 0.5) : "transparent"}`,
        background: `linear-gradient(${wash}, ${wash}), ${token.colorFillQuaternary}`,
        transition: "background .12s ease, border-color .12s ease",
        maxHeight: "calc(100vh - 260px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "2px 2px 8px",
          borderBottom: `1px solid ${token.colorSplit}`,
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 999,
            background: color,
            flex: "none",
          }}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: token.colorText,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginLeft: "auto",
            flex: "none",
            minWidth: 20,
            height: 18,
            padding: "0 6px",
            borderRadius: 999,
            background: tint(color, 0.16),
            color,
            fontSize: 11.5,
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          {deals.length}
        </span>
        {onAdd ? (
          <Tooltip title={`Add a deal in ${name}`}>
            <Button
              type="text"
              size="small"
              aria-label={`Add a deal in ${name}`}
              icon={<MIcon name="add" size={16} />}
              onClick={onAdd}
              style={{ flexShrink: 0 }}
            />
          </Tooltip>
        ) : null}
      </div>

      <div
        style={{
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 24,
          padding: 2,
        }}
      >
        <SortableContext
          items={deals.map((d) => d.id)}
          strategy={verticalListSortingStrategy}
        >
          {deals.map((d) => (
            <DealCard
              key={d.id}
              deal={d}
              color={color}
              onOpen={onOpen}
              onContextMenu={onCardContextMenu}
              menuOpen={menuDealId === d.id}
            />
          ))}
        </SortableContext>
        {deals.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              flex: "none",
              minHeight: 76,
              padding: "16px 12px",
              borderRadius: 10,
              border: `1px dashed ${tint(color, 0.45)}`,
              color: token.colorTextTertiary,
              fontSize: 12,
              textAlign: "center",
            }}
          >
            <MIcon name="inbox" size={18} color={token.colorTextQuaternary} />
            Drop a deal here
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A filter button names its value; a long tag name is cut to keep it a button. */
function shortLabel(text: string, max = 18): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * A single-choice list for a toolbar filter panel — the status and tag
 * filters hold ONE value each, so radios, not a multi-select. A search box
 * appears once the list is long enough to need one (the old Select had it).
 */
function ChoiceList<V extends string>({
  value,
  onChange,
  options,
  searchPlaceholder = "Search…",
}: {
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: React.ReactNode; text: string }[];
  searchPlaceholder?: string;
}) {
  const { token } = theme.useToken();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => o.text.toLowerCase().includes(needle))
    : options;
  return (
    <>
      {options.length > 8 ? (
        <Input
          size="small"
          allowClear
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          prefix={<MIcon name="search" size={14} />}
        />
      ) : null}
      <Radio.Group
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        style={{
          display: "grid",
          gap: 6,
          maxHeight: 280,
          overflowY: "auto",
        }}
      >
        {shown.map((o) => (
          <Radio key={o.value} value={o.value}>
            {o.label}
          </Radio>
        ))}
      </Radio.Group>
      {shown.length === 0 ? (
        <span style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
          Nothing matches “{query.trim()}”.
        </span>
      ) : null}
    </>
  );
}

/**
 * The table's lead status: the kit's dotted pill, still editable in place the
 * way `LeadStatusPicker` is on the board cards — triaging a lead list is
 * mostly moving this one value, so it never costs a drawer. The wrapper
 * swallows clicks (the menu's included, which bubble through the portal) so
 * the row underneath does not open its record.
 */
function StatusPill({
  dealId,
  status,
}: {
  dealId: string;
  status: string | null | undefined;
}) {
  const { message } = App.useApp();
  const updateDeal = useUpdateCrmDeal();
  const [pending, setPending] = useState<CrmLeadStatus | null>(null);

  // Show the value being written straight away; the row catches up when the
  // query settles.
  const current = crmLeadStatusMeta(pending ?? status);

  const pick = (next: CrmLeadStatus) => {
    if (next === current.value) return;
    setPending(next);
    updateDeal.mutate(
      { id: dealId, patch: { status: next } },
      {
        onError: (err) => {
          setPending(null);
          message.error(errMsg(err, "Couldn't change the status."));
        },
        onSuccess: () => setPending(null),
      },
    );
  };

  const items: MenuProps["items"] = CRM_LEAD_STATUSES.map((s) => ({
    key: s.value,
    label: s.label,
    icon: <MIcon name={leadStatusIcon(s.value)} size={15} />,
    disabled: s.value === current.value,
  }));

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      style={{ display: "inline-flex", maxWidth: "100%" }}
    >
      <Dropdown
        trigger={["click"]}
        menu={{
          items,
          selectable: true,
          selectedKeys: [current.value],
          onClick: ({ key }) => pick(key as CrmLeadStatus),
        }}
      >
        <button
          type="button"
          aria-label={`Status: ${current.label}. Change it.`}
          style={{
            display: "inline-flex",
            maxWidth: "100%",
            padding: 0,
            border: "none",
            background: "transparent",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          <TagPill
            tone={current.tone}
            label={
              <>
                {current.label}
                {pending ? (
                  <Spin size="small" />
                ) : (
                  <MIcon
                    name="arrow_drop_down"
                    size={15}
                    style={{ marginInline: -3 }}
                  />
                )}
              </>
            }
          />
        </button>
      </Dropdown>
    </span>
  );
}

/**
 * The table's number: the kit's dial-able phone pill, plus the one-click copy
 * the lead desk relies on (`PhoneWithCopy` still does both on board cards).
 */
function MobileCell({ phone }: { phone: string | null }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);

  if (!phone) return <PhoneChip phone={null} />;

  const copy = async (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      message.success("Number copied");
    } catch {
      message.error("Couldn't copy the number.");
    }
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      <PhoneChip phone={phone} />
      <Tooltip title={copied ? "Copied" : "Copy number"}>
        <Button
          type="text"
          size="small"
          aria-label={`Copy ${phone}`}
          onClick={(e) => void copy(e)}
          icon={
            <MIcon
              name={copied ? "check" : "content_copy"}
              size={14}
              color={copied ? token.colorSuccess : token.colorTextTertiary}
            />
          }
          style={{ flex: "none" }}
        />
      </Tooltip>
    </span>
  );
}

export default function CrmDealsPage() {
  // `useSearchParams` (the ?m= deep link below) forces a client bailout — it has
  // to sit under a Suspense boundary or the production static pass errors out.
  return (
    <Suspense fallback={null}>
      <CrmDealsPageInner />
    </Suspense>
  );
}

function CrmDealsPageInner() {
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const router = useRouter();
  const {
    data: deals,
    isLoading,
    isError,
    error,
    refetch,
  } = useCrmDeals();
  const {
    data: stages,
    isLoading: stagesLoading,
    isError: stagesError,
    refetch: refetchStages,
  } = useCrmStages();
  const { data: campaigns } = useCrmCampaigns();
  const { data: labels } = useCrmLabels();
  const { data: companies } = useCrmCompanies();
  const { data: people } = useCrmPeople();
  const { data: members } = useTeamMembers();
  const lastCompanyId = useCrmPrefsStore((s) => s.lastCompanyId);
  const setLastCompanyId = useCrmPrefsStore((s) => s.setLastCompanyId);
  // The CRM's current project (the bar above the CRM tabs). Every list this
  // page renders passes through `inScope`; a new deal is filed under it; a
  // deal saved to another project is announced, never blocked. Unscoped,
  // `inScope` is always true and nothing here changes.
  const {
    projectId,
    isScoped,
    inScope,
    fixed: scopeFixed,
    projects: scopeProjects,
    setProjectId: setScopeProjectId,
  } = useCrmScope();
  const notify = useScopeMismatchNotice();
  /** `?import=<id>`: the page opened on one lead import (see the banner). */
  const searchParams = useSearchParams();
  const importId = searchParams.get("import");
  const createDeal = useCreateCrmDeal();
  const updateDeal = useUpdateCrmDeal();
  const moveDeal = useMoveCrmDeal();
  const setDeleted = useSetCrmDealDeleted();
  const setDealLabel = useSetCrmDealLabel();
  const destroyDeal = useDestroyCrmDeal();
  /** Right-click menus: rows (through CrmTable) and board cards (below). */
  const recordMenu = useRecordMenu();
  const dealMenuItems = useDealMenuItems();
  const projectMoveItem = useProjectMoveItem();
  const cardMenu = useContextMenu();
  const [menuDealId, setMenuDealId] = useState<string | null>(null);

  // An import is a list to work through, so it opens as the table. It can
  // arrive on a page that is already mounted (the import dialog lives here
  // too), so the switch is made during render when the param changes — the
  // same pattern as the ?m= deep link — rather than in an effect.
  const [view, setView] = useState<"board" | "table">(
    importId ? "table" : "board",
  );
  const [seenImportId, setSeenImportId] = useState(importId);
  if (importId !== seenImportId) {
    setSeenImportId(importId);
    if (importId) setView("table");
  }
  const [search, setSearch] = useState("");
  /** Narrows both the board and the table — lead health, not pipeline stage. */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  /**
   * "UNTAGGED" is a real answer, not a missing one — the untagged pile is the
   * first thing anyone looks for when they sit down to work the desk.
   */
  const [labelFilter, setLabelFilter] = useState<"ALL" | "UNTAGGED" | string>(
    "ALL",
  );
  const [showDeleted, setShowDeleted] = useState(false);
  /**
   * Table-only narrowing, like the Deleted toggle: the board's columns ARE the
   * stages, and its filters stay exactly the three it always had (search,
   * status, tags). Stage ids plus `NO_STAGE` for deals on no (or a deleted)
   * stage — the same deals the Stage cell shows as "No stage".
   */
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [createdPreset, setCreatedPreset] = useState<CreatedPreset>("any");
  const [createdRange, setCreatedRange] = useState<CreatedRange | null>(null);
  /** The quick deal dialog, opened from the New deal menu (paste opens it too). */
  const [quickOpen, setQuickOpen] = useState(false);
  /** The lead importer; `importText` is a block of rows pasted on the page. */
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmDealWithRefs | null>(null);
  /** Seeded from `?m=` so a reminder notification opens the lead it names. */
  const [viewTarget, setViewTarget, closeViewTarget] =
    useRecordDeepLink("deal");
  const [activeDeal, setActiveDeal] = useState<CrmDealWithRefs | null>(null);
  const [confirmRowId, setConfirmRowId] = useState<string | null>(null);
  /**
   * The table's selection. The dashboard's deal list has had bulk status and
   * stage moves since the lead-desk work; this screen — the one people
   * actually work leads on all day — was still one drawer at a time.
   */
  const [selected, setSelected] = useState<string[]>([]);
  // A batch picked under one project must not act on rows the next one hides.
  useResetOnScopeChange(() => setSelected([]));
  const bulk = useBulkRun(() => setSelected([]));
  const [form] = Form.useForm<DealFormValues>();
  const columnLayout = useColumnLayout(
    "deals",
    COLUMN_CHOICES,
    DEFAULT_HIDDEN_COLUMNS,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  /** Every live deal on the team — the real columns, whatever the scope shows. */
  const allLiveDeals = useMemo(
    () => (deals ?? []).filter((d) => !d.deleted_at),
    [deals],
  );
  /** What this page shows and works on: the current project's deals. */
  const liveDeals = useMemo(
    () => allLiveDeals.filter((d) => inScope(d.project_id)),
    [allLiveDeals, inScope],
  );

  /**
   * The import the page was opened on: every deal it created (deleted ones
   * too, for the Deleted toggle), the live ones for the banner, and where it
   * came from. Null without `?import=`.
   */
  const importBatch = useMemo(() => {
    if (!importId) return null;
    const all = (deals ?? []).filter(
      (d) => importRefOf(d.source_ref)?.importId === importId,
    );
    const live = all.filter((d) => !d.deleted_at);
    const ref = all.length ? importRefOf(all[0].source_ref) : null;
    return {
      ids: new Set(all.map((d) => d.id)),
      live: [...live].sort(
        (a, b) =>
          (importRefOf(a.source_ref)?.row ?? 0) -
          (importRefOf(b.source_ref)?.row ?? 0),
      ),
      file: ref?.file ?? null,
      importedAt: ref?.importedAt ?? all[0]?.created_at ?? null,
      projectId: live[0]?.project_id ?? null,
    };
  }, [importId, deals]);
  const inImport = useCallback(
    (d: CrmDealWithRefs) => !importBatch || importBatch.ids.has(d.id),
    [importBatch],
  );
  const clearImport = () => router.replace("/crm/deals", { scroll: false });

  // An import filed under another project than the one the CRM is on would
  // open to an empty list: follow it to its project instead. Only to a project
  // the switcher can show — the provider heals a scope pointing at an archived
  // one straight back, and following it again would ping-pong forever.
  useEffect(() => {
    if (!importBatch || scopeFixed) return;
    const first = importBatch.live[0];
    if (!first || importBatch.live.some((d) => inScope(d.project_id))) return;
    const target = first.project_id;
    if (target === null || scopeProjects.some((p) => p.id === target)) {
      setScopeProjectId(target ?? NO_PROJECT);
    }
  }, [importBatch, scopeFixed, inScope, scopeProjects, setScopeProjectId]);

  /** Deal / company / contact name match — the same needle in both views. */
  const matchesSearch = useCallback(
    (d: CrmDealWithRefs, needle: string) =>
      !needle ||
      [d.name, d.company?.name ?? "", crmPersonName(d.contact)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    [],
  );

  /**
   * What the board actually renders. Status is matched through
   * `crmLeadStatusMeta` so a blank or unknown value lands under "New", exactly
   * like the chip on the card. Search narrows the board too — the box stays on
   * screen in both views, so a filter can never be silently in force.
   */
  /** Untagged is a value, so "ALL" is the only pass-through. */
  const matchesLabel = useCallback(
    (d: CrmDealWithRefs) => {
      if (labelFilter === "ALL") return true;
      if (labelFilter === "UNTAGGED") return d.labels.length === 0;
      return d.labels.some((l) => l.id === labelFilter);
    },
    [labelFilter],
  );

  const boardDeals = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return liveDeals
      .filter(inImport)
      .filter(
        (d) =>
          statusFilter === "ALL" ||
          crmLeadStatusMeta(d.status).value === statusFilter,
      )
      .filter(matchesLabel)
      .filter((d) => matchesSearch(d, needle));
  }, [liveDeals, inImport, statusFilter, matchesLabel, search, matchesSearch]);

  const knownStageIds = useMemo(
    () => new Set((stages ?? []).map((s) => s.id)),
    [stages],
  );

  const columns = useMemo(() => {
    const cols: {
      id: string;
      stageId: string | null;
      name: string;
      color: string;
      deals: CrmDealWithRefs[];
    }[] = (stages ?? []).map((s: CrmStage) => ({
      id: colId(s.id),
      stageId: s.id,
      name: s.name,
      color: s.color,
      deals: boardDeals
        .filter((d) => d.stage_id === s.id)
        .sort((a, b) => a.position - b.position),
    }));
    const orphans = boardDeals
      .filter((d) => !d.stage_id || !knownStageIds.has(d.stage_id))
      .sort((a, b) => a.position - b.position);
    if (orphans.length > 0) {
      cols.push({
        id: colId(NO_STAGE),
        stageId: null,
        name: "No stage",
        color: NO_STAGE_COLOR,
        deals: orphans,
      });
    }
    return cols;
  }, [stages, boardDeals, knownStageIds]);

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string | null) => (id && map.get(id)) || "—";
  }, [members]);

  /**
   * Who a batch can be handed to. "Unassigned" is on the list on purpose:
   * taking an owner off is as much a bulk action as putting one on.
   */
  const ownerOptions = useMemo(
    () => [
      ...(members ?? [])
        .filter((m) => m.user)
        .map((m) => ({
          key: m.user!.id,
          label: m.user!.name,
        })),
      { type: "divider" as const, key: "sep" },
      { key: "none", label: "Unassigned" },
    ],
    [members],
  );

  /** Soft-deleted campaigns are included — a deal keeps the name it was won on. */
  const campaignName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of campaigns ?? []) map.set(c.id, c.name);
    return (id: string | null) => (id ? (map.get(id) ?? "") : "");
  }, [campaigns]);

  const tableRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const created = createdWindow(createdPreset, createdRange);
    const rows = (deals ?? [])
      .filter((d) => (showDeleted ? Boolean(d.deleted_at) : !d.deleted_at))
      // After the deleted toggle, so "Deleted" under a project is that
      // project's deleted deals rather than everyone's.
      .filter((d) => inScope(d.project_id))
      .filter(inImport)
      .filter(
        (d) =>
          statusFilter === "ALL" ||
          crmLeadStatusMeta(d.status).value === statusFilter,
      )
      .filter(matchesLabel)
      .filter(
        (d) =>
          stageFilter.length === 0 ||
          stageFilter.includes(
            d.stage_id && knownStageIds.has(d.stage_id)
              ? d.stage_id
              : NO_STAGE,
          ),
      )
      .filter((d) => inCreatedWindow(created, d.created_at))
      .filter((d) => matchesSearch(d, needle));
    // An import reads in the order of its file, so row 2 is at the top.
    return importBatch
      ? rows.sort(
          (a, b) =>
            (importRefOf(a.source_ref)?.row ?? 0) -
            (importRefOf(b.source_ref)?.row ?? 0),
        )
      : rows;
  }, [
    deals,
    search,
    showDeleted,
    inScope,
    inImport,
    importBatch,
    statusFilter,
    matchesLabel,
    stageFilter,
    knownStageIds,
    createdPreset,
    createdRange,
    matchesSearch,
  ]);

  const stageById = useMemo(() => {
    const map = new Map<string, CrmStage>();
    for (const s of stages ?? []) map.set(s.id, s);
    return map;
  }, [stages]);

  /** Pipeline order for the Stage column's sort; "No stage" sorts last. */
  const stageRank = useMemo(() => {
    const map = new Map<string, number>();
    (stages ?? []).forEach((s, i) => map.set(s.id, i));
    return (stageId: string | null) =>
      (stageId ? map.get(stageId) : undefined) ?? Number.MAX_SAFE_INTEGER;
  }, [stages]);

  /** Board summary — same 30-day window the dashboard and reports tiles use,
   *  counted over what the status filter is actually showing. */
  const closing30 = useMemo(() => closingWithin(boardDeals, 30), [boardDeals]);

  const stageColorOf = (stageId: string | null) =>
    (stageId ? stageById.get(stageId)?.color : null) ?? NO_STAGE_COLOR;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDeal(liveDeals.find((d) => d.id === event.active.id) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDeal(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const overId = String(over.id);

    // Resolve the target column: a column id, or the column holding the card.
    const targetCol = overId.startsWith("col:")
      ? columns.find((c) => c.id === overId)
      : columns.find((c) => c.deals.some((d) => d.id === overId));
    if (!targetCol) return;

    // Neighbours come from the REAL column, not the visible subset. Under a
    // project scope (or a filter) the cards between two visible ones are
    // hidden, so a midpoint of the visible pair could land on top of — or
    // tie with — one of them. The user still sees the visible order; only
    // the numbers come from the full column. Membership mirrors `columns`:
    // "No stage" also holds deals whose stage has since been deleted.
    const full = allLiveDeals
      .filter(
        (d) =>
          d.id !== dealId &&
          (targetCol.stageId
            ? d.stage_id === targetCol.stageId
            : !d.stage_id || !knownStageIds.has(d.stage_id)),
      )
      .sort((a, b) => a.position - b.position);
    const append = () => Math.max(0, ...full.map((d) => d.position)) + 1;
    let position: number;
    if (overId.startsWith("col:")) {
      position = append();
    } else {
      const overIndex = full.findIndex((d) => d.id === overId);
      if (overIndex === -1) {
        position = append();
      } else {
        const prev = full[overIndex - 1];
        const next = full[overIndex];
        position = prev
          ? (prev.position + next.position) / 2
          : next.position - 1;
      }
    }

    const current = liveDeals.find((d) => d.id === dealId);
    if (
      current &&
      current.stage_id === targetCol.stageId &&
      current.position === position
    ) {
      return;
    }
    moveDeal.mutate(
      { id: dealId, stage_id: targetCol.stageId, position },
      {
        onError: (err) =>
          message.error(errMsg(err, "Failed to move the deal.")),
      },
    );
  };

  const companyOptions = useMemo(
    () =>
      (companies ?? [])
        .filter((c) => !c.deleted_at)
        .map((c) => ({ value: c.id, label: c.name })),
    [companies],
  );
  const peopleOptions = useMemo(
    () =>
      (people ?? [])
        .filter((p) => !p.deleted_at)
        .map((p) => ({ value: p.id, label: crmPersonName(p) || "Unnamed" })),
    [people],
  );
  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.active && m.user)
        .map((m) => ({ value: m.user!.id, label: m.user!.name })),
    [members],
  );
  const stageOptions = useMemo(
    () => (stages ?? []).map((s) => ({ value: s.id, label: s.name })),
    [stages],
  );
  const statusOptions = useMemo(
    () => CRM_LEAD_STATUSES.map((s) => ({ value: s.value, label: s.label })),
    [],
  );
  /** Live campaigns to pick from, plus whatever the deal being edited already
   *  points at — a deleted campaign should still read as its name, not an id. */
  const campaignOptions = useMemo(() => {
    const live = (campaigns ?? []).filter((c) => !c.deleted_at);
    const options = live.map((c) => ({ value: c.id, label: c.name }));
    const current = editing?.campaign_id;
    if (current && !live.some((c) => c.id === current)) {
      const gone = (campaigns ?? []).find((c) => c.id === current);
      if (gone) {
        options.push({ value: gone.id, label: `${gone.name} (deleted)` });
      }
    }
    return options;
  }, [campaigns, editing]);

  const openCreate = (stageId?: string | null) => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      stage_id: stageId ?? stages?.[0]?.id ?? null,
      // Every lead starts life as "new" — the team moves it from there.
      status: CRM_LEAD_STATUS_DEFAULT,
      campaign_id: null,
      // Most deals are captured for something happening now; today is the
      // useful default and a wrong date is one click away.
      close_date: dayjs(),
      // Filed under the project this board is showing (none under "No
      // project"). A default: the Project picker below stays editable.
      project_id: projectId,
      // Leads arrive in runs for the same account — default to the last one.
      company_id: (companies ?? []).some((c) => c.id === lastCompanyId)
        ? lastCompanyId
        : null,
    });
    setFormOpen(true);
  };

  const openEdit = (deal: CrmDealWithRefs) => {
    setEditing(deal);
    form.setFieldsValue({
      name: deal.name,
      phone: deal.phone ?? undefined,
      stage_id: deal.stage_id,
      status: crmLeadStatusMeta(deal.status).value,
      campaign_id: deal.campaign_id,
      close_date: deal.close_date ? dayjs(deal.close_date) : null,
      project_id: deal.project_id,
      company_id: deal.company_id,
      contact_id: deal.contact_id,
      owner_id: deal.owner_id,
    });
    setFormOpen(true);
  };

  const handleSubmit = async (values: DealFormValues) => {
    // Position is max+1 over the REAL column, not the visible subset — two
    // projects' cards in one stage must never tie.
    const stageDeals = allLiveDeals.filter(
      (d) => d.stage_id === (values.stage_id ?? null),
    );
    const phone = values.phone?.trim() || null;
    // Name is optional — a blank one borrows the deal's identity from whatever
    // it is attached to, so no card or row ever renders untitled.
    const typedName = values.name?.trim();
    const patch = {
      name:
        typedName ||
        fallbackDealName({
          company: (companies ?? []).find((c) => c.id === values.company_id)
            ?.name,
          contact: crmPersonName(
            (people ?? []).find((p) => p.id === values.contact_id),
          ),
          phone,
        }),
      phone,
      stage_id: values.stage_id ?? null,
      status: values.status ?? CRM_LEAD_STATUS_DEFAULT,
      campaign_id: values.campaign_id ?? null,
      close_date: values.close_date
        ? values.close_date.format("YYYY-MM-DD")
        : null,
      project_id: values.project_id ?? null,
      company_id: values.company_id ?? null,
      contact_id: values.contact_id ?? null,
      owner_id: values.owner_id ?? null,
    };
    try {
      if (editing) {
        await updateDeal.mutateAsync({ id: editing.id, patch });
        message.success("Deal updated.");
      } else {
        await createDeal.mutateAsync({
          ...patch,
          position:
            Math.max(0, ...stageDeals.map((d) => d.position)) + 1,
        });
        message.success("Deal created.");
      }
      // Filed under a project other than the one this board shows — created
      // there, or moved there by an edit? Either way it just left this board:
      // say so, with a way to go and look. A no-op while it is still in
      // scope; an edit that left the project alone says nothing.
      if (!editing) {
        notify({ recordProjectId: patch.project_id, noun: "Deal" });
      } else if ((editing.project_id ?? null) !== patch.project_id) {
        notify({
          recordProjectId: patch.project_id,
          noun: "Deal",
          verb: "moved to",
        });
      }
      // Remember the account so the next capture defaults to it.
      setLastCompanyId(patch.company_id);
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save deal."));
    }
  };

  /* The row actions, the Deleted view's buttons and the right-click menus
     all delete, restore and destroy through these. */
  const deleteDeal = async (id: string) => {
    try {
      await setDeleted.mutateAsync({ id, deleted: true });
      message.success("Deal deleted.");
    } catch (err) {
      message.error(errMsg(err, "Failed to delete."));
    }
  };
  const restoreDeal = async (id: string) => {
    try {
      await setDeleted.mutateAsync({ id, deleted: false });
      message.success("Deal restored.");
    } catch (err) {
      message.error(errMsg(err, "Failed to restore."));
    }
  };
  const destroyDealForever = async (id: string) => {
    try {
      await destroyDeal.mutateAsync(id);
      message.success("Deal permanently deleted.");
    } catch (err) {
      message.error(errMsg(err, "Failed to delete."));
    }
  };

  const setOwner = async (id: string, ownerId: string | null) => {
    try {
      await updateDeal.mutateAsync({ id, patch: { owner_id: ownerId } });
      message.success(
        ownerId ? `Owner: ${memberName(ownerId)}.` : "Owner removed.",
      );
    } catch (err) {
      message.error(errMsg(err, "Couldn't change the owner."));
    }
  };

  /** The tag picker's write: attach or detach one tag. */
  const toggleTag = async (
    dealId: string,
    label: { id: string; name: string },
    on: boolean,
  ) => {
    try {
      await setDealLabel.mutateAsync({
        dealId,
        labelId: label.id,
        attached: !on,
      });
      message.success(on ? `Removed ${label.name}.` : `Tagged ${label.name}.`);
    } catch (err) {
      message.error(errMsg(err, "Couldn't change the tag."));
    }
  };

  /**
   * A deal's right-click menu, for its table row and its board card. A live
   * deal: Open · Edit… · Status, Stage, Owner, Tags, Move to project · New
   * task… · Add note… · Remind me · Call / Send email (its contact's) · Copy ·
   * Delete…. A deleted one only comes back or goes for good.
   */
  const dealMenu = (d: CrmDealWithRefs): CrmMenuItem[] => {
    const target = { type: "deal" as const, id: d.id };
    const openDeal = () => setViewTarget(target);

    if (d.deleted_at) {
      return recordMenu.build({
        target,
        name: d.name,
        onOpen: openDeal,
        canCreate: false,
        danger: [
          {
            key: "restore",
            label: "Restore",
            icon: "restore_from_trash",
            onSelect: () => void restoreDeal(d.id),
          },
          {
            key: "destroy",
            label: "Delete forever…",
            icon: "delete_forever",
            danger: true,
            onSelect: () =>
              modal.confirm({
                title: `Permanently delete “${d.name}”?`,
                content: "This cannot be undone.",
                okText: "Delete forever",
                okButtonProps: { danger: true },
                onOk: () => destroyDealForever(d.id),
              }),
          },
        ],
      });
    }

    const attached = new Set(d.labels.map((l) => l.id));
    const contactEmail = d.contact_id
      ? ((people ?? []).find((p) => p.id === d.contact_id)?.email ?? null)
      : null;

    return recordMenu.build({
      target,
      name: d.name,
      onOpen: openDeal,
      onEdit: () => openEdit(d),
      phone: d.phone,
      email: contactEmail,
      manage: [
        dealMenuItems.status(d),
        dealMenuItems.stage(d),
        {
          key: "owner",
          label: "Owner",
          icon: "person",
          extra: d.owner_id ? memberName(d.owner_id) : "Unassigned",
          children: [
            ...memberOptions.map((m) => ({
              key: m.value,
              label: m.label,
              checked: m.value === d.owner_id,
              onSelect:
                m.value === d.owner_id
                  ? undefined
                  : () => void setOwner(d.id, m.value),
            })),
            { type: "divider" as const },
            {
              key: "none",
              label: "Unassigned",
              icon: "person_off",
              checked: d.owner_id === null,
              onSelect:
                d.owner_id === null ? undefined : () => void setOwner(d.id, null),
            },
          ],
        },
        {
          key: "tags",
          label: "Tags",
          icon: "sell",
          extra: d.labels.length
            ? d.labels.map((l) => l.name).join(", ")
            : "None",
          disabled: (labels ?? []).length === 0,
          children: (labels ?? []).map((l) => ({
            key: l.id,
            label: (
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: l.color,
                    flex: "none",
                  }}
                />
                {l.name}
              </span>
            ),
            checked: attached.has(l.id),
            onSelect: () => void toggleTag(d.id, l, attached.has(l.id)),
          })),
        },
        { type: "divider" },
        projectMoveItem({
          current: d.project_id,
          noun: "Deal",
          onMove: (projectId) =>
            updateDeal.mutateAsync({
              id: d.id,
              patch: { project_id: projectId },
            }),
        }),
      ],
      danger: [
        {
          key: "delete",
          label: "Delete…",
          icon: "delete",
          danger: true,
          onSelect: () =>
            modal.confirm({
              title: `Delete “${d.name}”?`,
              content: "It moves to Deleted and can be restored.",
              okText: "Delete",
              okButtonProps: { danger: true },
              onOk: () => deleteDeal(d.id),
            }),
        },
      ],
    });
  };

  const openCardMenu = (
    e: React.MouseEvent<HTMLElement>,
    deal: CrmDealWithRefs,
  ) => {
    if (!wantsCardMenu(e)) return;
    // Open first: opening closes any menu already up, and that one's onClose
    // clears the outline.
    cardMenu.open(e, dealMenu(deal), { onClose: () => setMenuDealId(null) });
    setMenuDealId(deal.id);
  };

  const boardLoading = isLoading || stagesLoading;
  /**
   * The board is the worst place to swallow a failure: no columns reads as
   * "set up your pipeline" and no cards reads as "you have no deals", so a
   * dropped request would send someone off to rebuild a pipeline that exists.
   */
  const boardError = isError || stagesError;
  const retryBoard = () => {
    if (isError) void refetch();
    if (stagesError) void refetchStages();
  };

  /** The table-only filters (stage, date created) — see `stageFilter`. */
  const createdFilterOn =
    createdPreset !== "any" && createdWindow(createdPreset, createdRange) !== null;
  const tableFiltersOn = stageFilter.length > 0 || createdFilterOn;
  const clearTableFilters = () => {
    setStageFilter([]);
    setCreatedPreset("any");
    setCreatedRange(null);
  };
  const labelFilterName =
    labelFilter === "ALL" || labelFilter === "UNTAGGED"
      ? null
      : ((labels ?? []).find((l) => l.id === labelFilter)?.name ?? null);

  /**
   * "Your filters hid everything" — shared by the table and the board, which
   * both narrow on the same search box, the same status and tag filters and
   * the same project scope.
   */
  const filteredEmpty =
    importBatch &&
    !isLoading &&
    importBatch.live.length === 0 &&
    !(view === "table" && showDeleted) ? (
    <EmptyState
      compact
      icon="upload_file"
      title="No leads left from this import"
      description="They were deleted or the import was undone. Deleted leads are under the table's Deleted toggle."
      action={<Button onClick={clearImport}>Show all deals</Button>}
    />
  ) : search.trim() ? (
    <EmptyState
      compact
      icon="search_off"
      title="No deals match your search"
      description={`Nothing found for “${search.trim()}”. Try a deal, company or contact name.`}
      action={<Button onClick={() => setSearch("")}>Clear search</Button>}
    />
  ) : statusFilter !== "ALL" ? (
    <EmptyState
      compact
      icon="filter_alt_off"
      title={`No ${crmLeadStatusMeta(statusFilter).label.toLowerCase()} leads`}
      description="No deal currently carries this lead status. Clear the filter to see the rest."
      action={
        <Button onClick={() => setStatusFilter("ALL")}>Clear status</Button>
      }
    />
  ) : labelFilter !== "ALL" ? (
    <EmptyState
      compact
      icon="filter_alt_off"
      title={
        labelFilter === "UNTAGGED"
          ? "No untagged deals"
          : labelFilterName
            ? `No deals tagged “${labelFilterName}”`
            : "No deals with this tag"
      }
      description="Clear the tag filter to see the rest."
      action={<Button onClick={() => setLabelFilter("ALL")}>Clear tag</Button>}
    />
  ) : view === "table" && tableFiltersOn ? (
    <EmptyState
      compact
      icon="filter_alt_off"
      title="No deals match these filters"
      description="Nothing fits the stage or creation date you picked. Clear them to see the rest."
      action={<Button onClick={clearTableFilters}>Clear filters</Button>}
    />
  ) : !(view === "table" && showDeleted) &&
    isScoped &&
    allLiveDeals.length > 0 &&
    liveDeals.length === 0 ? (
    /* The team has deals, the current project has none. Not "No deals yet":
       that would send someone off to seed a pipeline that already exists.
       Not under the table's Deleted toggle either — that list is about the
       project's deleted deals, so "Nothing in Deleted" is the honest answer.
       The toggle's state outlives a switch to the board, which never shows
       deleted deals, so the guard is table-only. */
    <ScopedEmptyState compact nouns="deals" onCreate={() => openCreate()} />
  ) : null;

  const tableEmpty = isError ? (
    <ErrorState
      compact
      title="Couldn't load deals"
      error={error}
      onRetry={() => void refetch()}
    />
  ) : filteredEmpty ? (
    filteredEmpty
  ) : showDeleted ? (
    <EmptyState
      compact
      icon="restore_from_trash"
      title="Nothing in Deleted"
      description="Deals you delete land here first, so you can restore them before they are permanently removed."
    />
  ) : (
    <EmptyState
      compact
      icon="handshake"
      accent={token.colorPrimary}
      title="No deals yet"
      description="Deals are the opportunities you move across the pipeline. Create the first one, or bring your leads in from a spreadsheet."
      action={
        <Space>
          <Button
            type="primary"
            icon={<MIcon name="add" size={16} />}
            onClick={() => openCreate()}
          >
            New deal
          </Button>
          <Button
            icon={<MIcon name="upload_file" size={16} />}
            onClick={() => setImportOpen(true)}
          >
            Import leads
          </Button>
        </Space>
      }
    />
  );

  /**
   * Opened on an import: what it was, how many of its leads are left, and the
   * two ways on from here. Everything below the banner — board, table, counts
   * and filters — is narrowed to the import.
   */
  const importBanner = importBatch ? (
    <Panel padding={12} style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 36,
            height: 36,
            borderRadius: 10,
            background: tint(token.colorPrimary, 0.12),
            flex: "none",
          }}
        >
          <MIcon name="upload_file" size={20} color={token.colorPrimary} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {isLoading
              ? "Opening the import…"
              : `Imported from ${importBatch.file ?? "pasted rows"}`}
          </div>
          {isLoading ? null : (
            <div style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
              {importBatch.live.length}{" "}
              {importBatch.live.length === 1 ? "lead" : "leads"}
              {importBatch.importedAt
                ? ` · ${dayjs(importBatch.importedAt).format("D MMM YYYY, h:mm A")}`
                : ""}
              {" · "}
              {importBatch.projectId
                ? (scopeProjects.find((p) => p.id === importBatch.projectId)
                    ?.name ?? "a project")
                : "No project"}
              {" · in the order of the file"}
            </div>
          )}
        </div>
        <Space wrap>
          {importBatch.live[0] ? (
            <Button
              icon={<MIcon name="open_in_new" size={16} />}
              onClick={() =>
                setViewTarget({ type: "deal", id: importBatch.live[0].id })
              }
            >
              Open first lead
            </Button>
          ) : null}
          <Button onClick={clearImport}>Show all deals</Button>
        </Space>
      </div>
    </Panel>
  ) : null;

  const searchBox = (
    <TableSearch
      value={search}
      onChange={setSearch}
      placeholder="Search deals…"
    />
  );

  /* Lead status narrows both views — it is the marketing lens on the same
     deals, independent of where they sit on the board. One value at a time,
     as it always was, and the button names it the way the old Select did. */
  const statusFilterButton = (
    <FilterButton
      icon="flag"
      label={
        statusFilter === "ALL"
          ? "Status"
          : crmLeadStatusMeta(statusFilter).label
      }
      activeCount={statusFilter === "ALL" ? 0 : 1}
      onClear={() => setStatusFilter("ALL")}
      width={220}
    >
      <ChoiceList<StatusFilter>
        value={statusFilter}
        onChange={setStatusFilter}
        options={[
          { value: "ALL", label: "All statuses", text: "All statuses" },
          ...CRM_LEAD_STATUSES.map((st) => ({
            value: st.value,
            label: <TagPill tone={st.tone} label={st.label} />,
            text: st.label,
          })),
        ]}
      />
    </FilterButton>
  );

  /* One list, one question: "who is on this list". Untagged is on it because
     that pile is what a triage session actually starts from. */
  const tagFilterButton = (
    <FilterButton
      icon="sell"
      label={
        labelFilter === "ALL"
          ? "Tags"
          : labelFilter === "UNTAGGED"
            ? "Untagged"
            : shortLabel(labelFilterName ?? "Tags")
      }
      activeCount={labelFilter === "ALL" ? 0 : 1}
      onClear={() => setLabelFilter("ALL")}
      width={240}
    >
      <ChoiceList
        value={labelFilter}
        onChange={setLabelFilter}
        searchPlaceholder="Search tags…"
        options={[
          { value: "ALL", label: "All tags", text: "All tags" },
          ...(labels ?? []).map((l) => ({
            value: l.id,
            label: <TagPill color={l.color} label={l.name} />,
            text: l.name,
          })),
          { value: "UNTAGGED", label: "Untagged", text: "Untagged" },
        ]}
      />
    </FilterButton>
  );

  const stageFilterButton = (
    <FilterButton
      icon="view_kanban"
      label="Stage"
      activeCount={stageFilter.length}
      onClear={() => setStageFilter([])}
      width={240}
    >
      <Checkbox.Group
        value={stageFilter}
        onChange={(next) => setStageFilter(next)}
        style={{
          display: "grid",
          gap: 6,
          maxHeight: 280,
          overflowY: "auto",
        }}
      >
        {(stages ?? []).map((st) => (
          <Checkbox key={st.id} value={st.id}>
            <TagPill color={st.color} label={st.name} />
          </Checkbox>
        ))}
        <Checkbox value={NO_STAGE}>
          <TagPill label="No stage" />
        </Checkbox>
      </Checkbox.Group>
    </FilterButton>
  );

  const createdFilterButton = (
    <DateCreatedFilter
      preset={createdPreset}
      range={createdRange}
      onChange={(preset, range) => {
        setCreatedPreset(preset);
        setCreatedRange(range);
      }}
    />
  );

  /**
   * The page's other way in: the quick deal dialog the paste shortcut opens,
   * here as a menu entry — which also says the shortcut exists.
   */
  const newDealMenu: MenuProps["items"] = [
    {
      key: "quick",
      icon: <MIcon name="bolt" size={16} />,
      label: "Quick deal",
    },
    {
      key: "import",
      icon: <MIcon name="upload_file" size={16} />,
      label: "Import from Excel or CSV",
    },
    { type: "divider" },
    {
      key: "paste-hint",
      disabled: true,
      icon: <MIcon name="content_paste" size={16} />,
      label: "Or paste a lead — or rows from a sheet — anywhere on this page",
    },
  ];

  const tableColumns: TableColumnsType<CrmDealWithRefs> = [
    {
      title: "Deal",
      key: "name",
      dataIndex: "name",
      width: 260,
      render: (v: string, d) => (
        <DealCell
          name={v}
          subtitle={d.company?.name ?? undefined}
          muted={Boolean(d.deleted_at)}
        />
      ),
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "Stage",
      key: "stage",
      width: 150,
      render: (_, d) => {
        const stage = d.stage_id ? stageById.get(d.stage_id) : null;
        return stage ? (
          <TagPill color={stage.color} label={stage.name} />
        ) : (
          <TagPill label="No stage" />
        );
      },
      sorter: (a, b) => stageRank(a.stage_id) - stageRank(b.stage_id),
    },
    {
      title: "Status",
      key: "status",
      width: 160,
      // Editable in the cell — triaging a lead list is mostly this.
      render: (_, d) => <StatusPill dealId={d.id} status={d.status} />,
      sorter: (a, b) =>
        CRM_LEAD_STATUSES.indexOf(crmLeadStatusMeta(a.status)) -
        CRM_LEAD_STATUSES.indexOf(crmLeadStatusMeta(b.status)),
    },
    {
      title: "Tags",
      key: "labels",
      width: 230,
      // Editable in the cell for the same reason status is: tagging a list of
      // leads is a pass down the column, not twenty drawers.
      render: (_, d) => <DealLabels deal={d} max={2} />,
    },
    {
      title: "Campaign",
      key: "campaign",
      width: 160,
      render: (_, d) => {
        const name = campaignName(d.campaign_id);
        if (!name) return <EmptyCell />;
        return (
          <span
            style={{
              display: "block",
              color: token.colorTextSecondary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
        );
      },
    },
    {
      title: "Source",
      key: "source",
      width: 140,
      render: (_, d) =>
        d.source ? (
          <span
            style={{
              display: "block",
              color: token.colorTextSecondary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sourceLabel(d.source)}
          </span>
        ) : (
          <EmptyCell />
        ),
      sorter: (a, b) => (a.source ?? "").localeCompare(b.source ?? ""),
    },
    {
      title: "Contact",
      key: "contact",
      width: 190,
      render: (_, d) => {
        const name = crmPersonName(d.contact);
        return name ? (
          <EntityCell name={name} kind="person" size={22} />
        ) : (
          <EmptyCell />
        );
      },
    },
    {
      title: "Mobile",
      key: "phone",
      width: 190,
      render: (_, d) => <MobileCell phone={d.phone} />,
    },
    {
      title: "Owner",
      key: "owner",
      width: 160,
      render: (_, d) => {
        const name = memberName(d.owner_id);
        if (name === "—") return <EmptyCell />;
        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              maxWidth: "100%",
            }}
          >
            <EntityAvatar name={name} kind="person" size={20} />
            <span
              style={{
                color: token.colorTextSecondary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </span>
          </span>
        );
      },
    },
    {
      title: "Close date",
      key: "close_date",
      dataIndex: "close_date",
      width: 140,
      render: (v: string | null) =>
        // A date already behind us is the one thing on the row that needs
        // doing today, so it keeps its red.
        isOverdue(v) ? (
          <span
            style={{
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              color: token.colorError,
              fontWeight: 600,
            }}
          >
            {dayjs(v).format("MMM D, YYYY")}
          </span>
        ) : (
          <DateCell value={v} />
        ),
      sorter: (a, b) =>
        (a.close_date ?? "").localeCompare(b.close_date ?? ""),
    },
    {
      title: "Created",
      key: "created_at",
      dataIndex: "created_at",
      width: 130,
      render: (v: string) => <DateCell value={v} />,
      sorter: (a, b) => a.created_at.localeCompare(b.created_at),
    },
    {
      title: "Last update",
      key: "updated_at",
      dataIndex: "updated_at",
      width: 130,
      render: (v: string) => <UpdatedCell value={v} />,
      sorter: (a, b) => a.updated_at.localeCompare(b.updated_at),
    },
    {
      title: "",
      key: "actions",
      width: 110,
      align: "right",
      fixed: "right",
      render: (_, d) => (
        <RowActions open={confirmRowId === d.id}>
          {d.deleted_at ? (
            <>
              <Tooltip title="Restore">
                <Button
                  type="text"
                  size="small"
                  icon={<MIcon name="restore_from_trash" size={16} />}
                  onClick={() => void restoreDeal(d.id)}
                />
              </Tooltip>
              <Popconfirm
                title="Permanently delete this deal?"
                description="This cannot be undone."
                okText="Delete forever"
                okButtonProps={{ danger: true }}
                onOpenChange={(open) =>
                  setConfirmRowId(open ? d.id : null)
                }
                onConfirm={() => destroyDealForever(d.id)}
              >
                <Tooltip title="Delete forever">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={
                      <MIcon name="delete_forever" size={16} />
                    }
                  />
                </Tooltip>
              </Popconfirm>
            </>
          ) : (
            <>
              <Tooltip title="Edit">
                <Button
                  type="text"
                  size="small"
                  icon={<MIcon name="edit" size={16} />}
                  onClick={() => openEdit(d)}
                />
              </Tooltip>
              <Popconfirm
                title="Delete this deal?"
                description="It moves to Deleted and can be restored."
                okText="Delete"
                okButtonProps={{ danger: true }}
                onOpenChange={(open) =>
                  setConfirmRowId(open ? d.id : null)
                }
                onConfirm={() => deleteDeal(d.id)}
              >
                <Tooltip title="Delete">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<MIcon name="delete" size={16} />}
                  />
                </Tooltip>
              </Popconfirm>
            </>
          )}
        </RowActions>
      ),
    },
  ];
  // The user's order, without the hidden columns; the actions keep the last slot.
  const visibleColumns = columnLayout.arrange(tableColumns);
  // Sum of the visible columns' widths plus the 32px selection column —
  // anything smaller and AntD's fixed table layout squeezes every column
  // instead of scrolling.
  const tableScrollX = visibleColumns.reduce(
    (sum, c) => sum + (typeof c.width === "number" ? c.width : 0),
    32,
  );

  return (
    <div style={crmPageStyle(view === "board" ? "100%" : CRM_MAX_WIDTH)}>
      <CrmPageHeader
        title="Deals"
        count={
          view === "board"
            ? boardLoading || boardError
              ? null
              : boardDeals.length
            : isLoading || isError
              ? null
              : tableRows.length
        }
        subtitle={
          importBatch
            ? "The leads from one import — work through them here, then show all deals."
            : view === "board"
              ? "Drag a card to move it through the pipeline — stage and order save instantly."
              : "Every deal in one sortable list, including the ones you've deleted."
        }
        right={
          <>
            <Segmented
              value={view}
              onChange={(v) => {
                setView(v as "board" | "table");
                // The board has no bulk bar to act on a carried-over selection.
                setSelected([]);
              }}
              options={[
                {
                  value: "board",
                  label: (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <MIcon name="view_kanban" size={16} />
                      Board
                    </span>
                  ),
                },
                {
                  value: "table",
                  label: (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <MIcon name="table_rows" size={16} />
                      Table
                    </span>
                  ),
                },
              ]}
            />

            <Button
              icon={<MIcon name="upload_file" size={16} />}
              onClick={() => setImportOpen(true)}
            >
              Import
            </Button>

            <Space.Compact>
              <Button
                type="primary"
                icon={<MIcon name="add" size={16} />}
                onClick={() => openCreate()}
              >
                New deal
              </Button>
              <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{
                  items: newDealMenu,
                  onClick: ({ key }) => {
                    if (key === "quick") setQuickOpen(true);
                    if (key === "import") setImportOpen(true);
                  },
                }}
              >
                <Button
                  type="primary"
                  aria-label="More ways to add a deal"
                  icon={<MIcon name="expand_more" size={18} />}
                />
              </Dropdown>
            </Space.Compact>
          </>
        }
      />

      {importBanner}

      {view === "board" ? (
        <>
          {/* Search, status and tags narrow the board too, so they stay on
              screen in both views — hiding them on the board used to leave a
              filter silently in force. */}
          <CrmToolbar>
            {searchBox}
            {statusFilterButton}
            {tagFilterButton}
          </CrmToolbar>

          <div style={TILE_GRID}>
            <StatTile
              icon="handshake"
              color={CRM_ACCENT.deal}
              label="Open deals"
              value={boardLoading || boardError ? "—" : boardDeals.length}
              hint={`Across ${columns.length} ${
                columns.length === 1 ? "column" : "columns"
              } on the board`}
            />
            <StatTile
              icon="event_upcoming"
              color={CRM_ACCENT.deal}
              label="Closing in 30 days"
              value={boardLoading || boardError ? "—" : closing30}
              hint="deals due to close"
            />
          </div>

          {boardLoading ? (
            <div style={{ display: "grid", placeItems: "center", padding: 64 }}>
              <Spin size="large" />
            </div>
          ) : boardError ? (
            <Panel padding={8}>
              <ErrorState
                title="Couldn't load the pipeline"
                error={error}
                onRetry={retryBoard}
              />
            </Panel>
          ) : boardDeals.length === 0 && filteredEmpty ? (
            /* Without this the board renders N columns of "Drop a deal here"
               and never says the filter is why they are all empty. */
            <Panel padding={8}>{filteredEmpty}</Panel>
          ) : columns.length === 0 ? (
            <Panel padding={0}>
              <EmptyState
                icon="view_kanban"
                accent={token.colorPrimary}
                title="Your pipeline has no stages yet"
                description="Stages are the board's columns — Discovery, Proposal, Won, and so on. Add a few in CRM settings, then start dropping deals into them."
                action={
                  <Space>
                    <Button
                      type="primary"
                      icon={<MIcon name="tune" size={16} />}
                      onClick={() => router.push("/crm/settings")}
                    >
                      Manage stages
                    </Button>
                    <Button
                      icon={<MIcon name="add" size={16} />}
                      onClick={() => openCreate()}
                    >
                      New deal
                    </Button>
                  </Space>
                }
              />
            </Panel>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setActiveDeal(null)}
            >
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  overflowX: "auto",
                  alignItems: "flex-start",
                  paddingBottom: 12,
                }}
              >
                {columns.map((c) => (
                  <BoardColumn
                    key={c.id}
                    id={c.id}
                    name={c.name}
                    color={c.color}
                    deals={c.deals}
                    onOpen={(deal) =>
                      setViewTarget({ type: "deal", id: deal.id })
                    }
                    onCardContextMenu={openCardMenu}
                    menuDealId={menuDealId}
                    onAdd={
                      c.stageId ? () => openCreate(c.stageId) : undefined
                    }
                  />
                ))}
              </div>
              <DragOverlay>
                {activeDeal ? (
                  <DealCard
                    deal={activeDeal}
                    color={stageColorOf(activeDeal.stage_id)}
                    dragOverlay
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </>
      ) : (
        <CrmTableCard
          toolbar={
            <>
              {searchBox}
              {statusFilterButton}
              {tagFilterButton}
              {stageFilterButton}
              {createdFilterButton}
              <ToolbarSpacer />
              {/* Deleted deals never appear on the board, so the toggle is the
                  one control that really is table-only. */}
              <CrmToggle
                checked={showDeleted}
                onChange={(next) => {
                  setShowDeleted(next);
                  setSelected([]);
                }}
                label="Deleted"
              />
              <ManageColumns layout={columnLayout} />
            </>
          }
          footer={
            <BulkBar count={selected.length} onClear={() => setSelected([])}>
              {showDeleted ? (
                <>
                  <Button
                    size="small"
                    disabled={bulk.busy}
                    icon={<MIcon name="restore_from_trash" size={15} />}
                    onClick={() =>
                      void bulk.run(selected, "Restored", (id) =>
                        setDeleted.mutateAsync({ id, deleted: false }),
                      )
                    }
                  >
                    Restore
                  </Button>
                  <Popconfirm
                    title={`Permanently delete ${selected.length} deal${selected.length === 1 ? "" : "s"}?`}
                    description="This cannot be undone."
                    okText="Delete forever"
                    okButtonProps={{ danger: true }}
                    onConfirm={() =>
                      void bulk.run(selected, "Permanently deleted", (id) =>
                        destroyDeal.mutateAsync(id),
                      )
                    }
                  >
                    <Button
                      size="small"
                      danger
                      disabled={bulk.busy}
                      icon={<MIcon name="delete_forever" size={15} />}
                    >
                      Delete forever
                    </Button>
                  </Popconfirm>
                </>
              ) : (
                <>
                  <Dropdown
                    disabled={bulk.busy}
                    menu={{
                      items: CRM_LEAD_STATUSES.map((st) => ({
                        key: st.value,
                        label: st.label,
                        icon: <MIcon name={leadStatusIcon(st.value)} size={15} />,
                      })),
                      onClick: ({ key }) =>
                        void bulk.run(
                          selected,
                          `Marked ${crmLeadStatusMeta(key).label.toLowerCase()}`,
                          (id) =>
                            updateDeal.mutateAsync({
                              id,
                              patch: { status: key as CrmLeadStatus },
                            }),
                        ),
                    }}
                  >
                    <Button size="small" icon={<MIcon name="flag" size={15} />}>
                      Set status
                    </Button>
                  </Dropdown>

                  <Dropdown
                    disabled={bulk.busy || (stages ?? []).length === 0}
                    menu={{
                      items: (stages ?? []).map((st) => ({
                        key: st.id,
                        label: st.name,
                      })),
                      onClick: ({ key }) =>
                        void bulk.run(selected, "Moved stage", (id) =>
                          updateDeal.mutateAsync({ id, patch: { stage_id: key } }),
                        ),
                    }}
                  >
                    <Button
                      size="small"
                      icon={<MIcon name="swap_horiz" size={15} />}
                    >
                      Move stage
                    </Button>
                  </Dropdown>

                  {/* Re-file a batch under another project (or none). The rows
                      leave this view once they land; the result message says
                      where they went. */}
                  <BulkMoveToProject
                    disabled={bulk.busy}
                    onMove={(target, name) =>
                      void bulk.run(
                        selected,
                        target ? `Moved to ${name}` : "Moved to no project",
                        (id) =>
                          updateDeal.mutateAsync({
                            id,
                            patch: { project_id: target },
                          }),
                      )
                    }
                  />

                  {/* Handing a batch of pasted leads to whoever is calling them
                      is the other half of the job the paste dialog started. */}
                  <Dropdown
                    disabled={bulk.busy || ownerOptions.length === 0}
                    menu={{
                      items: ownerOptions,
                      onClick: ({ key }) =>
                        void bulk.run(selected, "Owner set", (id) =>
                          updateDeal.mutateAsync({
                            id,
                            patch: { owner_id: key === "none" ? null : key },
                          }),
                        ),
                    }}
                  >
                    <Button
                      size="small"
                      icon={<MIcon name="person_add" size={15} />}
                    >
                      Assign
                    </Button>
                  </Dropdown>

                  {/* Add, not set: tags stack, so a bulk pass over a screen of
                      pasted leads must not wipe what is already on them. */}
                  <Dropdown
                    disabled={bulk.busy || (labels ?? []).length === 0}
                    menu={{
                      items: (labels ?? []).map((l) => ({
                        key: l.id,
                        label: l.name,
                        icon: <MIcon name="sell" size={15} color={l.color} />,
                      })),
                      onClick: ({ key }) => {
                        const label = (labels ?? []).find((l) => l.id === key);
                        void bulk.run(
                          selected,
                          `Tagged ${label?.name ?? ""}`.trim(),
                          (id) =>
                            setDealLabel.mutateAsync({
                              dealId: id,
                              labelId: key,
                              attached: true,
                            }),
                        );
                      },
                    }}
                  >
                    <Button size="small" icon={<MIcon name="sell" size={15} />}>
                      Add tag
                    </Button>
                  </Dropdown>

                  <Popconfirm
                    title={`Delete ${selected.length} deal${selected.length === 1 ? "" : "s"}?`}
                    description="They move to Deleted and can be restored."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() =>
                      void bulk.run(selected, "Deleted", (id) =>
                        setDeleted.mutateAsync({ id, deleted: true }),
                      )
                    }
                  >
                    <Button
                      size="small"
                      danger
                      disabled={bulk.busy}
                      icon={<MIcon name="delete" size={15} />}
                    >
                      Delete
                    </Button>
                  </Popconfirm>
                </>
              )}
            </BulkBar>
          }
        >
          <CrmTable<CrmDealWithRefs>
            rowKey="id"
            loading={isLoading}
            dataSource={tableRows}
            pagination={{ pageSize: 25, hideOnSinglePage: true }}
            scroll={{ x: tableScrollX }}
            locale={{
              emptyText: isLoading ? (
                <div style={{ height: 120 }} />
              ) : (
                tableEmpty
              ),
            }}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as string[]),
              // Keeps a selection alive across paging and re-sorting, which is
              // how a hundred pasted leads actually get worked.
              preserveSelectedRowKeys: true,
            }}
            onRow={(d) => ({
              onClick: () => setViewTarget({ type: "deal", id: d.id }),
            })}
            rowContextMenu={dealMenu}
            columns={visibleColumns}
          />
        </CrmTableCard>
      )}

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit deal" : "New deal"}
        width={CRM_DRAWER_WIDTH}
        destroyOnHidden
        styles={{ body: CRM_DRAWER_BODY_STYLE }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          style={CRM_DRAWER_FORM_STYLE}
        >
          <CrmDrawerFields>
            <FormSection label="Opportunity" first>
              <Form.Item
                name="name"
                label="Deal name"
                extra="Leave blank and we'll name it after the company or contact."
              >
                <Input placeholder="e.g. Acme — Annual plan" />
              </Form.Item>
              <Form.Item name="phone" label="Mobile number">
                <Input
                  inputMode="tel"
                  placeholder="+91 98765 43210"
                  maxLength={40}
                />
              </Form.Item>
            </FormSection>

            <FormSection label="Pipeline">
              <Form.Item name="stage_id" label="Stage">
                <Select allowClear options={stageOptions} placeholder="Stage" />
              </Form.Item>
              <Form.Item
                name="status"
                label="Status"
                extra="How the lead itself is doing — separate from the stage it sits in."
              >
                <Select options={statusOptions} placeholder="Status" />
              </Form.Item>
              <Form.Item name="close_date" label="Close date">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="owner_id" label="Owner">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={memberOptions}
                  placeholder="Team member"
                />
              </Form.Item>
            </FormSection>

            <FormSection label="Relations">
              <Form.Item
                name="project_id"
                label="Project"
                extra="Which project's CRM this deal is worked in."
              >
                <ProjectPicker />
              </Form.Item>
              <Form.Item name="company_id" label="Company">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={companyOptions}
                  placeholder="Company"
                />
              </Form.Item>
              <Form.Item name="contact_id" label="Point of contact">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={peopleOptions}
                  placeholder="Person"
                />
              </Form.Item>
              <Form.Item
                name="campaign_id"
                label="Campaign"
                extra="Where the lead came from — this is what makes cost per lead work."
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={campaignOptions}
                  placeholder="Campaign"
                  notFoundContent="No campaigns yet"
                />
              </Form.Item>
            </FormSection>
          </CrmDrawerFields>

          <CrmDrawerFooter>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={createDeal.isPending || updateDeal.isPending}
            >
              {editing ? "Save changes" : "Create deal"}
            </Button>
          </CrmDrawerFooter>
        </Form>
      </Drawer>

      <RecordDrawer target={viewTarget} onClose={closeViewTarget} />

      {/* Once per page, outside every card and row: the board's right-click
          menu and the New task / Add note / Remind me dialogs both menus open
          (portal events bubble to wherever these render). */}
      {cardMenu.element}
      {recordMenu.dialogs}

      {/* Paste a lead anywhere on the page to start a deal from it, or open
          it blank from the New deal menu. */}
      <DealQuickCreate
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onPasteTable={(text) => {
          setImportText(text);
          setImportOpen(true);
        }}
      />

      <LeadImportDialog
        open={importOpen}
        initialText={importText}
        onClose={() => {
          setImportOpen(false);
          setImportText(null);
        }}
      />

      <style>{`
        .${DEAL_CARD_CLASS} {
          border: 1px solid ${token.colorBorderSecondary};
          border-left-width: 3px;
          transition: border-color .12s ease, box-shadow .12s ease;
        }
        .${DEAL_CARD_CLASS}:hover { border-color: ${token.colorBorder}; box-shadow: ${token.boxShadowTertiary}; }
        .${DEAL_CARD_CLASS}.${DEAL_CARD_MENU_CLASS} { border-color: ${token.colorPrimary}; box-shadow: ${token.boxShadowTertiary}; }
      `}</style>
    </div>
  );
}
