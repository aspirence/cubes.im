"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tooltip,
  theme,
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
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import {
  type CrmDealWithRefs,
  type CrmStage,
  type CrmTargetRef,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";
import { DealQuickCreate } from "../_components/paste-deal";
import { CrmToggle } from "../_components/crm-toggle";
import { DealCell } from "../_components/deal-glyph";
import { CRM_ACCENT, NO_STAGE_COLOR } from "../_components/entity-meta";
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
  CrmSearch,
  CrmToolbar,
  EmptyState,
  EntityAvatar,
  Panel,
  RowActions,
  SoftChip,
  StatTile,
  crmDate,
  crmDateShort,
  crmPageStyle,
  crmPersonName,
  fallbackDealName,
  tint,
} from "../_lib/ui";
import { useCrmPrefsStore } from "../_lib/crm-prefs-store";
import { PhoneWithCopy } from "../_components/phone-cell";

/** The board's "no stage" pseudo-column id (column ids are `col:<id>`). */
const NO_STAGE = "none";
const colId = (stageId: string) => `col:${stageId}`;

/** Hover-lift class for board cards (see the <style> block in the page). */
const DEAL_CARD_CLASS = "crm-deal-card";

type DealFormValues = {
  /** Optional — a blank one is filled in from the deal's relations on save. */
  name?: string;
  phone?: string;
  stage_id?: string | null;
  close_date?: Dayjs | null;
  company_id?: string | null;
  contact_id?: string | null;
  owner_id?: string | null;
};

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
  dragOverlay,
}: {
  deal: CrmDealWithRefs;
  color: string;
  onOpen?: (deal: CrmDealWithRefs) => void;
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

  const contactName = crmPersonName(deal.contact);
  const overdue = isOverdue(deal.close_date);
  const hasMeta = Boolean(deal.company || contactName || deal.close_date);

  return (
    <div
      ref={dragOverlay ? undefined : setNodeRef}
      {...(dragOverlay ? {} : attributes)}
      {...(dragOverlay ? {} : listeners)}
      onClick={() => onOpen?.(deal)}
      className={DEAL_CARD_CLASS}
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
  onAdd,
}: {
  id: string;
  name: string;
  color: string;
  deals: CrmDealWithRefs[];
  onOpen: (deal: CrmDealWithRefs) => void;
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
            <DealCard key={d.id} deal={d} color={color} onOpen={onOpen} />
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

export default function CrmDealsPage() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const router = useRouter();
  const { data: deals, isLoading } = useCrmDeals();
  const { data: stages, isLoading: stagesLoading } = useCrmStages();
  const { data: companies } = useCrmCompanies();
  const { data: people } = useCrmPeople();
  const { data: members } = useTeamMembers();
  const lastCompanyId = useCrmPrefsStore((s) => s.lastCompanyId);
  const setLastCompanyId = useCrmPrefsStore((s) => s.setLastCompanyId);
  const createDeal = useCreateCrmDeal();
  const updateDeal = useUpdateCrmDeal();
  const moveDeal = useMoveCrmDeal();
  const setDeleted = useSetCrmDealDeleted();
  const destroyDeal = useDestroyCrmDeal();

  const [view, setView] = useState<"board" | "table">("board");
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmDealWithRefs | null>(null);
  const [viewTarget, setViewTarget] = useState<CrmTargetRef | null>(null);
  const [activeDeal, setActiveDeal] = useState<CrmDealWithRefs | null>(null);
  const [confirmRowId, setConfirmRowId] = useState<string | null>(null);
  const [form] = Form.useForm<DealFormValues>();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const liveDeals = useMemo(
    () => (deals ?? []).filter((d) => !d.deleted_at),
    [deals],
  );

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
      deals: liveDeals
        .filter((d) => d.stage_id === s.id)
        .sort((a, b) => a.position - b.position),
    }));
    const orphans = liveDeals
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
  }, [stages, liveDeals, knownStageIds]);

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string | null) => (id && map.get(id)) || "—";
  }, [members]);

  const tableRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (deals ?? [])
      .filter((d) => (showDeleted ? Boolean(d.deleted_at) : !d.deleted_at))
      .filter((d) => {
        if (!needle) return true;
        return [d.name, d.company?.name ?? "", crmPersonName(d.contact)]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [deals, search, showDeleted]);

  const stageById = useMemo(() => {
    const map = new Map<string, CrmStage>();
    for (const s of stages ?? []) map.set(s.id, s);
    return map;
  }, [stages]);

  /** Board summary — same 30-day window the dashboard and reports tiles use. */
  const closing30 = useMemo(() => closingWithin(liveDeals, 30), [liveDeals]);

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

    const rest = targetCol.deals.filter((d) => d.id !== dealId);
    let position: number;
    if (overId.startsWith("col:") || rest.length === 0) {
      position = (rest[rest.length - 1]?.position ?? 0) + 1;
    } else {
      const overIndex = rest.findIndex((d) => d.id === overId);
      if (overIndex === -1) {
        position = (rest[rest.length - 1]?.position ?? 0) + 1;
      } else {
        const prev = rest[overIndex - 1];
        const next = rest[overIndex];
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

  const openCreate = (stageId?: string | null) => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      stage_id: stageId ?? stages?.[0]?.id ?? null,
      // Most deals are captured for something happening now; today is the
      // useful default and a wrong date is one click away.
      close_date: dayjs(),
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
      close_date: deal.close_date ? dayjs(deal.close_date) : null,
      company_id: deal.company_id,
      contact_id: deal.contact_id,
      owner_id: deal.owner_id,
    });
    setFormOpen(true);
  };

  const handleSubmit = async (values: DealFormValues) => {
    const stageDeals = liveDeals.filter(
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
      close_date: values.close_date
        ? values.close_date.format("YYYY-MM-DD")
        : null,
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
      // Remember the account so the next capture defaults to it.
      setLastCompanyId(patch.company_id);
      setFormOpen(false);
    } catch (err) {
      message.error(errMsg(err, "Failed to save deal."));
    }
  };

  const boardLoading = isLoading || stagesLoading;

  const tableEmpty = search.trim() ? (
    <EmptyState
      compact
      icon="search_off"
      title="No deals match your search"
      description={`Nothing found for “${search.trim()}”. Try a deal, company or contact name.`}
      action={<Button onClick={() => setSearch("")}>Clear search</Button>}
    />
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
      description="Deals are the opportunities you move across the pipeline. Create the first one to get the board going."
      action={
        <Button
          type="primary"
          icon={<MIcon name="add" size={16} />}
          onClick={() => openCreate()}
        >
          New deal
        </Button>
      }
    />
  );

  return (
    <div style={crmPageStyle(view === "board" ? "100%" : CRM_MAX_WIDTH)}>
      <CrmPageHeader
        title="Deals"
        count={
          view === "board"
            ? boardLoading
              ? null
              : liveDeals.length
            : isLoading
              ? null
              : tableRows.length
        }
        subtitle={
          view === "board"
            ? "Drag a card to move it through the pipeline — stage and order save instantly."
            : "Every deal in one sortable list, including the ones you've deleted."
        }
      />

      <CrmToolbar>
        <Segmented
          value={view}
          onChange={(v) => setView(v as "board" | "table")}
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

        {view === "table" && (
          <>
            <CrmSearch
              value={search}
              onChange={setSearch}
              placeholder="Search deals…"
            />
            <CrmToggle
              checked={showDeleted}
              onChange={setShowDeleted}
              label="Deleted"
            />
          </>
        )}

        <Button
          type="primary"
          icon={<MIcon name="add" size={16} />}
          onClick={() => openCreate()}
          style={{ marginLeft: "auto" }}
        >
          New deal
        </Button>
      </CrmToolbar>

      {view === "board" ? (
        <>
          <div style={TILE_GRID}>
            <StatTile
              icon="handshake"
              color={CRM_ACCENT.deal}
              label="Open deals"
              value={boardLoading ? "—" : liveDeals.length}
              hint={`Across ${columns.length} ${
                columns.length === 1 ? "column" : "columns"
              } on the board`}
            />
            <StatTile
              icon="event_upcoming"
              color={CRM_ACCENT.deal}
              label="Closing in 30 days"
              value={boardLoading ? "—" : closing30}
              hint="deals due to close"
            />
          </div>

          {boardLoading ? (
            <div style={{ display: "grid", placeItems: "center", padding: 64 }}>
              <Spin size="large" />
            </div>
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
        <Panel padding={0}>
          <Table
            rowKey="id"
            size="middle"
            loading={isLoading}
            dataSource={tableRows}
            pagination={{
              pageSize: 25,
              hideOnSinglePage: true,
              style: { marginInline: 16 },
            }}
            // Sum of the fixed column widths — anything smaller and AntD's
            // fixed table layout squeezes every column instead of scrolling.
            scroll={{ x: 1180 }}
            locale={{
              emptyText: isLoading ? (
                <div style={{ height: 120 }} />
              ) : (
                tableEmpty
              ),
            }}
            onRow={(d) => ({
              onClick: () => setViewTarget({ type: "deal", id: d.id }),
              style: { cursor: "pointer" },
            })}
            columns={[
              {
                title: "Deal",
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
                    <SoftChip tone="custom" color={stage.color}>
                      {stage.name}
                    </SoftChip>
                  ) : (
                    <SoftChip>No stage</SoftChip>
                  );
                },
                filters: (stages ?? []).map((s) => ({
                  text: s.name,
                  value: s.id,
                })),
                onFilter: (value, d) => d.stage_id === value,
              },
              {
                title: "Contact",
                key: "contact",
                width: 190,
                render: (_, d) => {
                  const name = crmPersonName(d.contact);
                  if (!name) {
                    return (
                      <span style={{ color: token.colorTextQuaternary }}>—</span>
                    );
                  }
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
                      <EntityAvatar name={name} kind="person" size={22} />
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
                title: "Mobile",
                key: "phone",
                width: 180,
                render: (_, d) => (
                  <PhoneWithCopy
                    phone={d.phone}
                    size={13}
                    fallback={
                      <span style={{ color: token.colorTextQuaternary }}>—</span>
                    }
                  />
                ),
              },
              {
                title: "Owner",
                key: "owner",
                width: 150,
                render: (_, d) => (
                  <span style={{ color: token.colorTextSecondary }}>
                    {memberName(d.owner_id)}
                  </span>
                ),
              },
              {
                title: "Close date",
                dataIndex: "close_date",
                width: 140,
                render: (v: string | null) => {
                  const overdue = isOverdue(v);
                  return (
                    <span
                      style={{
                        whiteSpace: "nowrap",
                        color: overdue
                          ? token.colorError
                          : token.colorTextSecondary,
                        fontWeight: overdue ? 600 : undefined,
                      }}
                    >
                      {crmDate(v)}
                    </span>
                  );
                },
                sorter: (a, b) =>
                  (a.close_date ?? "").localeCompare(b.close_date ?? ""),
              },
              {
                title: "",
                key: "actions",
                width: 110,
                align: "right",
                render: (_, d) => (
                  <RowActions open={confirmRowId === d.id}>
                    {d.deleted_at ? (
                      <>
                        <Tooltip title="Restore">
                          <Button
                            type="text"
                            size="small"
                            icon={<MIcon name="restore_from_trash" size={16} />}
                            onClick={async () => {
                              try {
                                await setDeleted.mutateAsync({
                                  id: d.id,
                                  deleted: false,
                                });
                                message.success("Deal restored.");
                              } catch (err) {
                                message.error(
                                  errMsg(err, "Failed to restore."),
                                );
                              }
                            }}
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
                          onConfirm={async () => {
                            try {
                              await destroyDeal.mutateAsync(d.id);
                              message.success("Deal permanently deleted.");
                            } catch (err) {
                              message.error(errMsg(err, "Failed to delete."));
                            }
                          }}
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
                          onConfirm={async () => {
                            try {
                              await setDeleted.mutateAsync({
                                id: d.id,
                                deleted: true,
                              });
                              message.success("Deal deleted.");
                            } catch (err) {
                              message.error(errMsg(err, "Failed to delete."));
                            }
                          }}
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
            ]}
          />
        </Panel>
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

      <RecordDrawer target={viewTarget} onClose={() => setViewTarget(null)} />

      {/* Paste a lead anywhere on the board to start a deal from it. */}
      <DealQuickCreate />

      <style>{`
        .${DEAL_CARD_CLASS} {
          border: 1px solid ${token.colorBorderSecondary};
          border-left-width: 3px;
          transition: border-color .12s ease, box-shadow .12s ease;
        }
        .${DEAL_CARD_CLASS}:hover { border-color: ${token.colorBorder}; box-shadow: ${token.boxShadowTertiary}; }
      `}</style>
    </div>
  );
}
