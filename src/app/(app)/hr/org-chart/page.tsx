"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Modal,
  Skeleton,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import {
  useHrAccess,
  useHrEmployees,
  useUpdateEmployee,
} from "@/features/hr/use-hr";
import type { HrEmployeeWithRelations } from "../_lib/types";
import { initials, statusColor, statusLabel } from "../_lib/labels";

const { Title, Text } = Typography;

/** Cubes are new (not in generated types) — read/patch loosely. */
function cubesOf(e: HrEmployeeWithRelations): number {
  return (e as unknown as { cubes?: number }).cubes ?? 0;
}

/** Performance tier from a cubes score — drives the card's status border. */
function cubesTier(cubes: number): { color: string; label: string } {
  if (cubes >= 80) return { color: "#2bb36e", label: "Excelling" };
  if (cubes >= 50) return { color: "#4a63f6", label: "On track" };
  if (cubes >= 25) return { color: "#f0883e", label: "Needs a push" };
  return { color: "#e5484d", label: "At risk" };
}

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

type Token = ReturnType<typeof theme.useToken>["token"];

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/**
 * One employee card.
 *
 * Declared at module scope ON PURPOSE. Defined inside the page component it got
 * a fresh identity on every render, so React treated it as a different
 * component type and unmounted/remounted the whole tree on any state change —
 * including mid-drag, which destroys the element the browser is dragging and is
 * what made dragging feel broken. At module scope the type is stable, so React
 * reconciles in place and a drag survives re-renders.
 *
 * The dragged id is passed as a REF, not state: it is only ever read inside
 * event handlers, so keeping it out of state means a drag causes zero renders.
 */
function NodeCard({
  e,
  token,
  tier,
  reports,
  isCollapsed,
  dimmed,
  highlighted,
  canDrag,
  dragIdRef,
  menuItems,
  onReparent,
  onToggleCollapse,
  onOpenProfile,
}: {
  e: HrEmployeeWithRelations;
  token: Token;
  tier: { color: string; label: string };
  reports: number;
  isCollapsed: boolean;
  dimmed: boolean;
  highlighted: boolean;
  canDrag: boolean;
  dragIdRef: React.MutableRefObject<string | null>;
  menuItems: MenuProps["items"];
  onReparent: (id: string, newManagerId: string | null) => void;
  onToggleCollapse: (id: string) => void;
  onOpenProfile: (id: string) => void;
}) {
  return (
    <Dropdown menu={{ items: menuItems }} trigger={["contextMenu"]}>
      <div
        className="org-card"
        draggable={canDrag}
        onDragStart={(ev) => {
          dragIdRef.current = e.id;
          ev.dataTransfer.effectAllowed = "move";
          // Firefox refuses to start a drag without a payload.
          ev.dataTransfer.setData("text/plain", e.id);
          // Without this the ghost is the whole card, which is what makes
          // the drag feel heavy. Use a compact chip that tracks the cursor.
          const ghost = document.createElement("div");
          ghost.textContent = e.full_name;
          ghost.style.cssText = `position:absolute;top:-1000px;left:-1000px;padding:6px 12px;border-radius:999px;font:600 12px/1.2 system-ui,-apple-system,sans-serif;color:#fff;background:${tier.color};box-shadow:0 6px 16px -4px rgba(0,0,0,.35);white-space:nowrap;`;
          document.body.appendChild(ghost);
          ev.dataTransfer.setDragImage(ghost, 12, 12);
          // Safe next frame — the browser has snapshotted it by then.
          requestAnimationFrame(() => ghost.remove());
        }}
        onDragEnd={(ev) => {
          // Covers aborted drags (Esc, drop outside the window), which would
          // otherwise leave the ref stuck and the chart un-droppable.
          ev.currentTarget.removeAttribute("data-drop");
          dragIdRef.current = null;
        }}
        onDragOver={(ev) => {
          const dragId = dragIdRef.current;
          if (dragId && dragId !== e.id) ev.preventDefault();
        }}
        onDragEnter={(ev) => {
          const dragId = dragIdRef.current;
          if (!dragId || dragId === e.id) return;
          // Set the highlight straight on the node: routing it through React
          // state would re-render the tree mid-drag.
          ev.currentTarget.setAttribute("data-drop", "1");
        }}
        onDragLeave={(ev) => {
          const next = ev.relatedTarget as Node | null;
          if (next && ev.currentTarget.contains(next)) return; // moved onto a child
          ev.currentTarget.removeAttribute("data-drop");
        }}
        onDrop={(ev) => {
          ev.preventDefault();
          // Without this the drop ALSO bubbles to the canvas handler, which
          // reparents to top-level — two competing writes per drop.
          ev.stopPropagation();
          ev.currentTarget.removeAttribute("data-drop");
          const dragId = dragIdRef.current;
          if (dragId && dragId !== e.id) onReparent(dragId, e.id);
          dragIdRef.current = null;
        }}
        onDoubleClick={() => onOpenProfile(e.id)}
        style={{
          display: "inline-block",
          verticalAlign: "top",
          textAlign: "left",
          width: 178,
          background: token.colorBgContainer,
          border: `1px solid ${highlighted ? token.colorPrimary : token.colorBorderSecondary}`,
          borderRadius: 10,
          padding: "8px 10px 7px",
          boxShadow: token.boxShadowTertiary,
          cursor: canDrag ? "grab" : "default",
          opacity: dimmed ? 0.35 : 1,
          transition:
            "opacity .15s ease, box-shadow .15s ease, border-color .15s ease, outline-color .12s ease, transform .12s ease",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 30,
              height: 30,
              flex: "none",
              borderRadius: 999,
              background: `${tier.color}1f`,
              color: tier.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {initials(e.full_name)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              title={e.full_name}
              style={{
                fontSize: 12.5,
                fontWeight: 650,
                color: token.colorText,
                lineHeight: 1.25,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {e.full_name}
            </div>
            <div
              title={[e.designation?.title, e.department?.name].filter(Boolean).join(" · ")}
              style={{
                fontSize: 10.5,
                color: token.colorTextTertiary,
                lineHeight: 1.3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {[e.designation?.title, e.department?.name].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
          <span
            title={`${tier.label} · ${cubesOf(e)} cubes`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 10.5,
              fontWeight: 700,
              color: tier.color,
              background: `${tier.color}16`,
              borderRadius: 999,
              padding: "1px 7px",
            }}
          >
            <MIcon name="deployed_code" size={12} color={tier.color} />
            {cubesOf(e)}
          </span>
          {e.status ? (
            <Tag
              color={statusColor(e.status)}
              style={{ margin: 0, fontSize: 10, lineHeight: "15px", padding: "0 5px" }}
            >
              {statusLabel(e.status)}
            </Tag>
          ) : null}
        </div>

        {/* Reports count + collapse toggle (like the reference's "59^"). */}
        {reports > 0 ? (
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onToggleCollapse(e.id);
            }}
            style={{
              position: "absolute",
              bottom: -10,
              left: "50%",
              transform: "translateX(-50%)",
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              height: 19,
              padding: "0 7px",
              borderRadius: 999,
              border: "none",
              background: token.colorText,
              color: token.colorBgContainer,
              fontSize: 10.5,
              fontWeight: 700,
              cursor: "pointer",
              zIndex: 1,
            }}
          >
            {reports}
            <MIcon name={isCollapsed ? "expand_more" : "expand_less"} size={13} />
          </button>
        ) : null}
      </div>
    </Dropdown>
  );
}

/* -------------------------------------------------------------------------- */

export default function HrOrgChartPage() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const router = useRouter();
  const { isHrAdmin } = useHrAccess();
  const { data, isLoading, isError, error } = useHrEmployees();
  const updateEmployee = useUpdateEmployee();

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // A ref, not state: it is only read in event handlers, so a drag triggers
  // zero re-renders and the tree is never rebuilt underneath the pointer.
  const dragIdRef = useRef<string | null>(null);
  const [cubesTarget, setCubesTarget] = useState<HrEmployeeWithRelations | null>(null);
  const [cubesValue, setCubesValue] = useState<number>(0);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  // Drag-to-pan state — a ref for the same reason as dragIdRef: it is only
  // read inside pointer handlers, so panning causes zero React renders.
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Ctrl/Cmd + wheel zooms the chart instead of the whole page. Registered by
  // hand because the listener must be non-passive to preventDefault the
  // browser's native page zoom — React's onWheel can't opt out of passive.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      setZoom((z) => clampZoom(z - Math.sign(ev.deltaY) * ZOOM_STEP));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // Re-attach once the canvas actually exists (it renders only with data).
  }, [isLoading, isError, data?.length]);

  const employees = useMemo<HrEmployeeWithRelations[]>(() => data ?? [], [data]);
  const byId = useMemo(() => {
    const m = new Map<string, HrEmployeeWithRelations>();
    for (const e of employees) m.set(e.id, e);
    return m;
  }, [employees]);

  // manager -> direct reports; roots = no (in-org) manager.
  const { childrenOf, roots } = useMemo(() => {
    const kids = new Map<string, HrEmployeeWithRelations[]>();
    const rootList: HrEmployeeWithRelations[] = [];
    for (const e of employees) {
      const mgr = e.manager_id;
      if (mgr && byId.has(mgr) && mgr !== e.id) {
        const arr = kids.get(mgr) ?? [];
        arr.push(e);
        kids.set(mgr, arr);
      } else {
        rootList.push(e);
      }
    }
    return { childrenOf: kids, roots: rootList };
  }, [employees, byId]);

  // Total descendant count (shown on the collapse badge, like the reference).
  const descendantCount = useMemo(() => {
    const cache = new Map<string, number>();
    const count = (id: string, seen: Set<string>): number => {
      if (cache.has(id)) return cache.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      let n = 0;
      for (const c of childrenOf.get(id) ?? []) n += 1 + count(c.id, seen);
      cache.set(id, n);
      return n;
    };
    const out = new Map<string, number>();
    for (const e of employees) out.set(e.id, count(e.id, new Set()));
    return out;
  }, [childrenOf, employees]);

  // Descendants of an id (to keep the "change manager" list cycle-safe).
  const descendantsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    const walk = (cur: string) => {
      for (const c of childrenOf.get(cur) ?? []) {
        if (!out.has(c.id)) {
          out.add(c.id);
          walk(c.id);
        }
      }
    };
    walk(id);
    return out;
  };

  const wouldCycle = (managerId: string, movingId: string): boolean => {
    let cur: string | null | undefined = managerId;
    const seen = new Set<string>();
    while (cur) {
      if (cur === movingId) return true;
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = byId.get(cur)?.manager_id ?? null;
    }
    return false;
  };

  const matched = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return null;
    const set = new Set<string>();
    for (const e of employees) {
      const hay = [e.full_name, e.designation?.title, e.department?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(term)) set.add(e.id);
    }
    return set;
  }, [search, employees]);

  /** Writes the new reporting line. Never call directly — go through `reparent`. */
  const applyReparent = async (id: string, newManagerId: string | null) => {
    const emp = byId.get(id);
    if (!emp) return;
    try {
      await updateEmployee.mutateAsync({ id, patch: { manager_id: newManagerId } });
      message.success(
        newManagerId
          ? `${emp.full_name} now reports to ${byId.get(newManagerId)?.full_name ?? "a manager"}.`
          : `${emp.full_name} is now top-level.`,
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't update the reporting line.");
    }
  };

  /**
   * The single choke point for every reporting-line change (drag-drop, the
   * canvas drop, and both context-menu items). Moving someone takes their whole
   * subtree with them, so nothing is written until the change is confirmed —
   * a mis-drop should cost a click, not a reorg.
   */
  const reparent = (id: string, newManagerId: string | null) => {
    const emp = byId.get(id);
    if (!emp) return;
    if (newManagerId === id) return;
    if ((emp.manager_id ?? null) === newManagerId) return;
    if (newManagerId && wouldCycle(newManagerId, id)) {
      message.error("Can't move a manager under one of their own reports.");
      return;
    }

    const target = newManagerId ? byId.get(newManagerId) : null;
    const currentMgr = emp.manager_id ? byId.get(emp.manager_id) : null;
    const moving = descendantCount.get(id) ?? 0;

    modal.confirm({
      title: target
        ? `Move ${emp.full_name} under ${target.full_name}?`
        : `Make ${emp.full_name} top-level?`,
      icon: <MIcon name="account_tree" size={20} color={token.colorWarning} />,
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text type="secondary">Reports to</Text>
            <Tag style={{ margin: 0 }}>{currentMgr?.full_name ?? "No manager"}</Tag>
            <MIcon name="arrow_forward" size={15} color={token.colorTextTertiary} />
            <Tag color="blue" style={{ margin: 0 }}>
              {target?.full_name ?? "No manager (top-level)"}
            </Tag>
          </div>
          {moving > 0 ? (
            <Text type="warning">
              {moving} {moving === 1 ? "person" : "people"} in their org move with them.
            </Text>
          ) : null}
        </div>
      ),
      okText: target ? "Move" : "Make top-level",
      cancelText: "Cancel",
      onOk: () => applyReparent(id, newManagerId),
    });
  };

  const saveCubes = async () => {
    if (!cubesTarget) return;
    try {
      await updateEmployee.mutateAsync({
        id: cubesTarget.id,
        patch: { cubes: Math.max(0, Math.round(cubesValue)) } as never,
      });
      message.success(`Updated cubes for ${cubesTarget.full_name}.`);
      setCubesTarget(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't update cubes.");
    }
  };

  const showPerformance = (e: HrEmployeeWithRelations) => {
    const cubes = cubesOf(e);
    const tier = cubesTier(cubes);
    const reports = descendantCount.get(e.id) ?? 0;
    modal.info({
      title: `${e.full_name} — performance`,
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontWeight: 700,
                color: tier.color,
              }}
            >
              <MIcon name="deployed_code" size={18} color={tier.color} />
              {cubes} cubes
            </span>
            <Tag color={statusColor(e.status)} style={{ margin: 0 }}>
              {tier.label}
            </Tag>
          </div>
          <Text type="secondary">{e.designation?.title ?? "—"} · {e.department?.name ?? "—"}</Text>
          <Text type="secondary">{reports} people in their org</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Cubes accrue from the work each person does — a fuller performance
            breakdown lands with the gamification app.
          </Text>
        </div>
      ),
    });
  };

  const menuFor = (e: HrEmployeeWithRelations): MenuProps["items"] => {
    const blocked = descendantsOf(e.id);
    return [
      { key: "view", icon: <MIcon name="person" />, label: "View profile", onClick: () => router.push(`/hr/employees/${e.id}`) },
      { key: "perf", icon: <MIcon name="insights" />, label: "Check performance", onClick: () => showPerformance(e) },
      ...(isHrAdmin
        ? ([
            { key: "edit", icon: <MIcon name="edit" />, label: "Change details…", onClick: () => router.push(`/hr/employees/${e.id}`) },
            { key: "cubes", icon: <MIcon name="deployed_code" />, label: "Set cubes…", onClick: () => { setCubesTarget(e); setCubesValue(cubesOf(e)); } },
            { type: "divider" as const },
            {
              key: "mgr",
              icon: <MIcon name="account_tree" />,
              label: "Change manager",
              children: employees
                .filter((m) => m.id !== e.id && !blocked.has(m.id))
                .slice(0, 50)
                .map((m) => ({
                  key: `mgr:${m.id}`,
                  label: m.full_name,
                  disabled: (e.manager_id ?? null) === m.id,
                  onClick: () => reparent(e.id, m.id),
                })),
            },
            {
              key: "remove",
              icon: <MIcon name="vertical_align_top" />,
              label: "Remove manager (top-level)",
              disabled: !e.manager_id,
              onClick: () => reparent(e.id, null),
            },
          ] satisfies MenuProps["items"])
        : []),
    ];
  };

  /* --------------------------------------------------------- recursion --- */
  const renderNode = (e: HrEmployeeWithRelations): React.ReactNode => {
    const kids = childrenOf.get(e.id) ?? [];
    const showKids = kids.length > 0 && !collapsed.has(e.id);
    return (
      <li key={e.id}>
        <NodeCard
          e={e}
          token={token}
          tier={cubesTier(cubesOf(e))}
          reports={descendantCount.get(e.id) ?? 0}
          isCollapsed={collapsed.has(e.id)}
          dimmed={Boolean(matched && !matched.has(e.id))}
          highlighted={Boolean(matched && matched.has(e.id))}
          canDrag={isHrAdmin && !search}
          dragIdRef={dragIdRef}
          menuItems={menuFor(e)}
          onReparent={reparent}
          onToggleCollapse={toggleCollapse}
          onOpenProfile={(id) => router.push(`/hr/employees/${id}`)}
        />
        {showKids ? <ul>{kids.map(renderNode)}</ul> : null}
      </li>
    );
  };

  return (
    <Card styles={{ body: { padding: 0 } }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          padding: "18px 20px 12px",
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Org chart
          </Title>
          <Text type="secondary">Reporting lines & performance across your organization.</Text>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Text type="secondary" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
            Drag to pan · ⌘/Ctrl + scroll to zoom
          </Text>
          <Input.Search
            allowClear
            placeholder="Search by name, role or department"
            style={{ width: 280 }}
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
          />
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              padding: 2,
              borderRadius: 8,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
            }}
          >
            <Tooltip title="Zoom out">
              <Button
                type="text"
                size="small"
                aria-label="Zoom out"
                disabled={zoom <= ZOOM_MIN}
                onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
                icon={<MIcon name="remove" size={16} />}
              />
            </Tooltip>
            <Tooltip title="Reset zoom">
              <Button
                type="text"
                size="small"
                onClick={() => setZoom(1)}
                style={{
                  minWidth: 46,
                  fontVariantNumeric: "tabular-nums",
                  fontSize: 12,
                  fontWeight: 600,
                  color: token.colorTextSecondary,
                }}
              >
                {Math.round(zoom * 100)}%
              </Button>
            </Tooltip>
            <Tooltip title="Zoom in">
              <Button
                type="text"
                size="small"
                aria-label="Zoom in"
                disabled={zoom >= ZOOM_MAX}
                onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
                icon={<MIcon name="add" size={16} />}
              />
            </Tooltip>
          </div>
        </div>
      </div>

      {isError ? (
        <div style={{ padding: 20 }}>
          <Alert type="error" showIcon message="Failed to load employees" description={error instanceof Error ? error.message : "Please try again."} />
        </div>
      ) : isLoading ? (
        <div style={{ padding: 20 }}>
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      ) : employees.length === 0 ? (
        <div style={{ padding: 20 }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No employees to chart yet">
            <Button type="primary" onClick={() => router.push("/hr/employees")}>Go to employees</Button>
          </Empty>
        </div>
      ) : (
        <div
          ref={canvasRef}
          onDragOver={(ev) => {
            if (dragIdRef.current) ev.preventDefault();
          }}
          onDrop={(ev) => {
            // Drop on EMPTY canvas → make top-level. Drops that land on a card
            // stop propagation, so they never reach this handler.
            const dragId = dragIdRef.current;
            if (!dragId || ev.defaultPrevented) return;
            ev.preventDefault();
            reparent(dragId, null);
            dragIdRef.current = null;
          }}
          // Drag empty canvas to pan. Mouse only — touch pans via native
          // scrolling — and never from a card (cards drag to reparent) or a
          // control. Pointer capture keeps the pan alive outside the canvas.
          onPointerDown={(ev) => {
            if (ev.pointerType !== "mouse" || ev.button !== 0) return;
            if ((ev.target as Element).closest(".org-card, button, a, input")) return;
            const el = canvasRef.current;
            if (!el) return;
            ev.preventDefault();
            panRef.current = { x: ev.clientX, y: ev.clientY, left: el.scrollLeft, top: el.scrollTop };
            el.setPointerCapture(ev.pointerId);
            el.style.cursor = "grabbing";
          }}
          onPointerMove={(ev) => {
            const pan = panRef.current;
            const el = canvasRef.current;
            if (!pan || !el) return;
            el.scrollLeft = pan.left - (ev.clientX - pan.x);
            el.scrollTop = pan.top - (ev.clientY - pan.y);
          }}
          onPointerUp={(ev) => {
            const el = canvasRef.current;
            if (panRef.current && el) {
              el.releasePointerCapture(ev.pointerId);
              el.style.cursor = "";
            }
            panRef.current = null;
          }}
          onPointerCancel={() => {
            panRef.current = null;
            if (canvasRef.current) canvasRef.current.style.cursor = "";
          }}
          style={{
            // A bounded viewport, so scrolling and zooming happen INSIDE the
            // chart area instead of growing the page.
            height: "calc(100vh - 230px)",
            minHeight: 420,
            overflow: "auto",
            overscrollBehavior: "contain",
            padding: "22px 20px 40px",
          }}
        >
          <style>{ORG_CSS}</style>
          {/* CSS `zoom` (not `transform: scale`) on purpose: zoom reflows, so the
              scroll area grows with the tree and you can actually reach a card
              that's off-screen at 150%. A transform would scale the paint only
              and leave the scrollable extent at 100%. */}
          <div className="org-tree" style={{ zoom }}>
            <ul>{roots.map(renderNode)}</ul>
          </div>
        </div>
      )}

      {/* Set cubes modal */}
      <Modal
        open={cubesTarget !== null}
        title={cubesTarget ? `Set cubes — ${cubesTarget.full_name}` : "Set cubes"}
        onCancel={() => setCubesTarget(null)}
        onOk={() => void saveCubes()}
        okText="Save"
        confirmLoading={updateEmployee.isPending}
        destroyOnHidden
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 10 }}>
          Cubes are this person&apos;s performance points. The card border colour
          updates automatically. Automatic accrual from tasks comes with the
          gamification app.
        </Text>
        <InputNumber
          min={0}
          max={100000}
          value={cubesValue}
          onChange={(v) => setCubesValue(typeof v === "number" ? v : 0)}
          style={{ width: "100%" }}
          addonBefore={<MIcon name="deployed_code" size={15} />}
        />
      </Modal>
    </Card>
  );
}

/* Pure-CSS org-chart connectors (canonical nested-ul technique). Cards must be
   inline-block so text-align:center on the <li> centres them over the subtree. */
const ORG_CSS = `
.org-tree { display: inline-block; min-width: 100%; text-align: center; --org-line: #c9ccd6; }
/* Drop affordance — toggled by a data attribute straight on the node (not React
   state), so hovering a target during a drag never re-renders the tree. */
/* Transitions live in the card's inline style (inline declarations win, so
   listing them here would be dead CSS). The hover shadow needs !important for
   the same reason: the base box-shadow is an inline theme token. */
.org-card { outline: 2px dashed transparent; outline-offset: 3px; }
.org-card:hover { box-shadow: 0 8px 20px -10px rgba(0,0,0,.28) !important; }
.org-card[data-drop="1"] { outline-color: #4a4ad0; transform: translateY(-2px); }
.org-card[data-drop="1"] * { pointer-events: none; }
.org-tree ul { display: flex; justify-content: center; list-style: none; margin: 0; padding: 24px 0 0; position: relative; }
.org-tree li { list-style: none; position: relative; padding: 24px 10px 0; text-align: center; }
/* connectors from each node up to its siblings' horizontal bar */
.org-tree li::before, .org-tree li::after {
  content: ""; position: absolute; top: 0; right: 50%;
  border-top: 1.5px solid var(--org-line); width: 50%; height: 24px;
}
.org-tree li::after { right: auto; left: 50%; border-left: 1.5px solid var(--org-line); }
.org-tree li:only-child::before, .org-tree li:only-child::after { display: none; }
.org-tree li:only-child { padding-top: 0; }
.org-tree li:first-child::before, .org-tree li:last-child::after { border: 0 none; }
.org-tree li:last-child::before { border-right: 1.5px solid var(--org-line); border-radius: 0 6px 0 0; }
.org-tree li:first-child::after { border-radius: 6px 0 0 0; }
/* the vertical line dropping from a parent to its children's bar */
.org-tree ul ul::before {
  content: ""; position: absolute; top: 0; left: 50%;
  border-left: 1.5px solid var(--org-line); width: 0; height: 24px;
}
/* root level has no parent → no incoming connector */
.org-tree > ul { padding-top: 0; }
.org-tree > ul > li { padding-top: 0; }
.org-tree > ul > li::before, .org-tree > ul > li::after { display: none; }
:root[data-theme="dark"] .org-tree { --org-line: #39404e; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .org-tree { --org-line: #39404e; } }
`;
