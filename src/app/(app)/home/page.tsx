"use client";

import { useMemo, useRef, useState } from "react";
import {
  App as AntdApp,
  Button,
  Dropdown,
  Switch,
  Typography,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useAllTeamTasks } from "@/features/tasks/use-all-tasks";
import { useDashboardCards, useSaveDashboardCards } from "@/features/home/use-dashboard";
import { GettingStarted } from "@/features/home/getting-started";
import { DashboardCardView } from "@/features/home/dashboard-card";
import { CardConfigDrawer } from "@/features/home/card-config-drawer";
import { distinctFacets } from "@/features/home/dashboard-engine";
import {
  type DashboardCard,
  defaultDashboardCards,
  dashboardTemplates,
  cardCols,
  GRID_COLS,
  GRID_GAP,
} from "@/features/home/dashboard-types";

const { Text } = Typography;

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Resize handles on all four edges + corners. Edges are invisible strips
 *  (cursor only); the bottom-right corner carries a visible affordance icon.
 *  Edges are inset 16px from corners so the corner handles own the corners. */
const EDGE = 8;
const CORNER = 16;
const INSET = CORNER;
const RESIZE_HANDLES: {
  key: string;
  dirX: -1 | 0 | 1;
  dirY: -1 | 0 | 1;
  cursor: string;
  pos: React.CSSProperties;
}[] = [
  { key: "r", dirX: 1, dirY: 0, cursor: "ew-resize", pos: { top: INSET, bottom: INSET, right: 0, width: EDGE } },
  { key: "l", dirX: -1, dirY: 0, cursor: "ew-resize", pos: { top: INSET, bottom: INSET, left: 0, width: EDGE } },
  { key: "b", dirX: 0, dirY: 1, cursor: "ns-resize", pos: { left: INSET, right: INSET, bottom: 0, height: EDGE } },
  { key: "t", dirX: 0, dirY: -1, cursor: "ns-resize", pos: { left: INSET, right: INSET, top: 0, height: EDGE } },
  { key: "br", dirX: 1, dirY: 1, cursor: "nwse-resize", pos: { right: 0, bottom: 0, width: CORNER, height: CORNER } },
  { key: "bl", dirX: -1, dirY: 1, cursor: "nesw-resize", pos: { left: 0, bottom: 0, width: CORNER, height: CORNER } },
  { key: "tr", dirX: 1, dirY: -1, cursor: "nesw-resize", pos: { right: 0, top: 0, width: CORNER, height: CORNER } },
  { key: "tl", dirX: -1, dirY: -1, cursor: "nwse-resize", pos: { left: 0, top: 0, width: CORNER, height: CORNER } },
];

/** A grid cell that is drag-reorderable (header handle) and resizable from any
 *  edge or corner in edit mode. Width snaps to grid columns; height is free. */
function SortableCard({
  card,
  editMode,
  tasks,
  tasksLoading,
  myTeamMemberId,
  onEdit,
  onRemove,
  onResize,
}: {
  card: DashboardCard;
  editMode: boolean;
  tasks: DashboardCardProps["tasks"];
  tasksLoading: boolean;
  myTeamMemberId: string | undefined;
  onEdit: () => void;
  onRemove: () => void;
  onResize: (id: string, w: number, h: number | undefined) => void;
}) {
  const { token } = theme.useToken();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: !editMode });
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const resizeState = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    colUnit: number;
    dirX: -1 | 0 | 1;
    dirY: -1 | 0 | 1;
  } | null>(null);
  // Live size while dragging a resize handle (committed on pointer-up).
  const [preview, setPreview] = useState<{ w: number; h: number | undefined } | null>(null);

  const cols = preview?.w ?? cardCols(card);
  const height = preview ? preview.h : card.h;

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: preview ? "none" : transition,
    gridColumn: `span ${cols}`,
    minWidth: 0,
    position: "relative",
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 5 : undefined,
  };

  const handle = (
    <span
      {...attributes}
      {...listeners}
      role="button"
      aria-label="Drag to reorder"
      title="Drag to reorder"
      style={{
        display: "inline-flex",
        alignItems: "center",
        cursor: "grab",
        color: token.colorTextQuaternary,
        touchAction: "none",
        marginRight: 2,
        position: "relative",
        zIndex: 7,
      }}
    >
      <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 18 }}>
        drag_indicator
      </span>
    </span>
  );

  const compute = (
    clientX: number,
    clientY: number,
  ): { w: number; h: number | undefined } => {
    const s = resizeState.current;
    if (!s) return { w: cardCols(card), h: card.h };
    // Direction sets the sign: dragging a left/top handle outward enlarges.
    const wPx = s.startW + s.dirX * (clientX - s.startX);
    const hPx = s.startH + s.dirY * (clientY - s.startY);
    const w =
      s.dirX === 0
        ? cardCols(card)
        : Math.max(1, Math.min(GRID_COLS, Math.round((wPx + GRID_GAP) / (s.colUnit + GRID_GAP))));
    // Width-only handles leave height untouched (preserve natural height).
    const h = s.dirY === 0 ? card.h : Math.max(140, Math.min(760, Math.round(hPx)));
    return { w, h };
  };

  const onResizeDown =
    (dirX: -1 | 0 | 1, dirY: -1 | 0 | 1) => (e: React.PointerEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Column width from the grid container, so snapping is accurate.
      const grid = el.closest(".wl-dash-grid") as HTMLElement | null;
      const gridWidth = grid?.clientWidth ?? rect.width;
      const colUnit = (gridWidth - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS;
      resizeState.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW: rect.width,
        startH: card.h ?? rect.height,
        colUnit,
        dirX,
        dirY,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      setPreview({ w: cardCols(card), h: card.h });
    };

  const onResizeMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!resizeState.current) return;
    setPreview(compute(e.clientX, e.clientY));
  };

  const endResize = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!resizeState.current) return;
    const { w, h } = compute(e.clientX, e.clientY);
    resizeState.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    setPreview(null);
    onResize(card.id, w, h);
  };

  return (
    <div ref={setNodeRef} style={style} className={`wl-dash-cell wl-span-${cols}`}>
      <div ref={wrapRef}>
        <DashboardCardView
          card={card}
          tasks={tasks}
          tasksLoading={tasksLoading}
          myTeamMemberId={myTeamMemberId}
          editMode={editMode}
          dragHandle={handle}
          bodyHeight={height}
          onEdit={onEdit}
          onRemove={onRemove}
        />
      </div>
      {editMode
        ? RESIZE_HANDLES.map((rh) => (
            <span
              key={rh.key}
              className="wl-resize-h"
              role="button"
              aria-label={`Resize card (${rh.key})`}
              title="Drag to resize"
              onPointerDown={onResizeDown(rh.dirX, rh.dirY)}
              onPointerMove={onResizeMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              style={{
                position: "absolute",
                ...rh.pos,
                cursor: rh.cursor,
                touchAction: "none",
                zIndex: 6,
                // Corner affordance gets a subtle marker; edges are invisible strips.
                display: "inline-flex",
                alignItems: "flex-end",
                justifyContent: "flex-end",
                color: preview ? "#4a4ad0" : token.colorTextQuaternary,
              }}
            >
              {rh.key === "br" ? (
                <span
                  className="material-symbols-rounded"
                  aria-hidden
                  style={{ fontSize: 15, padding: 2 }}
                >
                  open_in_full
                </span>
              ) : null}
            </span>
          ))
        : null}
    </div>
  );
}

type DashboardCardProps = Parameters<typeof DashboardCardView>[0];

export default function HomePage() {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const { user, profile } = useAuth();
  const firstName = profile?.name?.split(" ")[0] ?? "there";

  const { data: members } = useTeamMembers();
  const { data: teamTasks, isLoading: tasksLoading } = useAllTeamTasks();
  const tasks = useMemo(() => teamTasks ?? [], [teamTasks]);

  const { data: cardsData } = useDashboardCards();
  const cards = useMemo(() => cardsData ?? defaultDashboardCards(), [cardsData]);
  const save = useSaveDashboardCards();

  const myTeamMemberId = useMemo(
    () => (members ?? []).find((m) => m.user?.id === user?.id)?.id,
    [members, user?.id],
  );
  const facets = useMemo(() => distinctFacets(tasks), [tasks]);

  const [editMode, setEditMode] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<DashboardCard | null>(null);

  const persist = (next: DashboardCard[]) => {
    save.mutate(next, {
      onError: (err) =>
        message.error(err instanceof Error ? err.message : "Failed to save dashboard."),
    });
  };

  const handleSubmitCard = (card: DashboardCard) => {
    const exists = cards.some((c) => c.id === card.id);
    persist(exists ? cards.map((c) => (c.id === card.id ? card : c)) : [...cards, card]);
    setConfigOpen(false);
    setEditingCard(null);
  };
  const handleRemove = (id: string) => persist(cards.filter((c) => c.id !== id));
  const handleResize = (id: string, w: number, h: number | undefined) =>
    persist(cards.map((c) => (c.id === id ? { ...c, w, h } : c)));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = cards.findIndex((c) => c.id === active.id);
    const to = cards.findIndex((c) => c.id === over.id);
    if (from < 0 || to < 0) return;
    persist(arrayMove(cards, from, to));
  };

  const templateMenu: MenuProps = {
    items: dashboardTemplates().map((t) => ({ key: t.key, label: t.label })),
    onClick: ({ key }) => {
      const tpl = dashboardTemplates().find((t) => t.key === key);
      if (tpl) persist(tpl.cards);
    },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            className="wl-home-h1"
            style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-.4px", color: token.colorText, margin: 0 }}
          >
            {greetingForNow()}, {firstName}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: token.colorTextSecondary }}>
            {editMode
              ? "Edit mode — add, configure, reorder, or remove cards. Changes save automatically."
              : "Here is what is happening across your work."}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {editMode ? (
            <>
              <Dropdown menu={templateMenu} trigger={["click"]}>
                <Button>Templates</Button>
              </Dropdown>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingCard(null);
                  setConfigOpen(true);
                }}
              >
                Card
              </Button>
            </>
          ) : null}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 13, color: token.colorTextSecondary }}>Edit mode</Text>
            <Switch checked={editMode} onChange={setEditMode} />
          </div>
        </div>
      </div>

      {/* First-run checklist — only while the workspace is still fresh. */}
      <GettingStarted tasksCount={tasks.length} tasksLoading={tasksLoading} />

      {/* Cards grid */}
      {cards.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px" }}>
          <span
            className="material-symbols-rounded"
            aria-hidden
            style={{ fontSize: 30, color: token.colorTextQuaternary }}
          >
            dashboard
          </span>
          <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: token.colorText }}>
            No cards yet
          </div>
          <p style={{ margin: "4px 0 16px", fontSize: 12.5, color: token.colorTextTertiary }}>
            Add charts, metrics and task lists to build your dashboard.
          </p>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditMode(true);
              setEditingCard(null);
              setConfigOpen(true);
            }}
          >
            Add a card
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={cards.map((c) => c.id)}
            strategy={rectSortingStrategy}
          >
            <div
              className="wl-dash-grid"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
                gap: GRID_GAP,
                alignItems: "start",
              }}
            >
              {cards.map((card) => (
                <SortableCard
                  key={card.id}
                  card={card}
                  editMode={editMode}
                  tasks={tasks}
                  tasksLoading={tasksLoading}
                  myTeamMemberId={myTeamMemberId}
                  onEdit={() => {
                    setEditingCard(card);
                    setConfigOpen(true);
                  }}
                  onRemove={() => handleRemove(card.id)}
                  onResize={handleResize}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <CardConfigDrawer
        open={configOpen}
        card={editingCard}
        facets={facets}
        onClose={() => {
          setConfigOpen(false);
          setEditingCard(null);
        }}
        onSubmit={handleSubmitCard}
      />

      <style>{`
        @media (max-width: 1280px) {
          .wl-dash-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          /* Clamp wide cards so inline span-3/4 can't overflow the 2-col grid. */
          .wl-dash-grid .wl-span-3,
          .wl-dash-grid .wl-span-4 { grid-column: span 2 !important; }
        }
        @media (max-width: 720px) {
          /* Phones: 2-up KPI tiles, everything else full width. */
          .wl-dash-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; gap: 10px !important; }
          .wl-dash-grid .wl-span-1 { grid-column: span 1 !important; }
          .wl-dash-grid .wl-span-2,
          .wl-dash-grid .wl-span-3,
          .wl-dash-grid .wl-span-4 { grid-column: span 2 !important; }
          /* Width resizing is meaningless in a stacked layout, and the invisible
             edge strips (touch-action: none) swallow scroll gestures. */
          .wl-resize-h { display: none !important; }
          .wl-home-h1 { font-size: 18px !important; }
        }
      `}</style>
    </div>
  );
}
