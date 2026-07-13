"use client";

import { useMemo, useState } from "react";
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
  Typography,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [cubesTarget, setCubesTarget] = useState<HrEmployeeWithRelations | null>(null);
  const [cubesValue, setCubesValue] = useState<number>(0);

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

  const reparent = async (id: string, newManagerId: string | null) => {
    const emp = byId.get(id);
    if (!emp) return;
    if (newManagerId === id) return;
    if ((emp.manager_id ?? null) === newManagerId) return;
    if (newManagerId && wouldCycle(newManagerId, id)) {
      message.error("Can't move a manager under one of their own reports.");
      return;
    }
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
                  onClick: () => void reparent(e.id, m.id),
                })),
            },
            {
              key: "remove",
              icon: <MIcon name="vertical_align_top" />,
              label: "Remove manager (top-level)",
              disabled: !e.manager_id,
              onClick: () => void reparent(e.id, null),
            },
          ] satisfies MenuProps["items"])
        : []),
    ];
  };

  /* --------------------------------------------------------- node card --- */
  const NodeCard = ({ e }: { e: HrEmployeeWithRelations }) => {
    const tier = cubesTier(cubesOf(e));
    const reports = descendantCount.get(e.id) ?? 0;
    const isCollapsed = collapsed.has(e.id);
    const isMatch = matched?.has(e.id) ?? false;
    const dimmed = matched && !isMatch;
    return (
      <Dropdown menu={{ items: menuFor(e) }} trigger={["contextMenu"]}>
        <div
          draggable={isHrAdmin && !search}
          onDragStart={(ev) => {
            setDragId(e.id);
            ev.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(ev) => {
            if (dragId && dragId !== e.id) ev.preventDefault();
          }}
          onDrop={(ev) => {
            ev.preventDefault();
            if (dragId && dragId !== e.id) void reparent(dragId, e.id);
            setDragId(null);
          }}
          onDoubleClick={() => router.push(`/hr/employees/${e.id}`)}
          style={{
            display: "inline-block",
            verticalAlign: "top",
            textAlign: "left",
            width: 208,
            background: token.colorBgContainer,
            border: `2px solid ${tier.color}`,
            borderRadius: 14,
            padding: "14px 14px 10px",
            boxShadow: token.boxShadowTertiary,
            cursor: isHrAdmin && !search ? "grab" : "default",
            opacity: dimmed ? 0.4 : 1,
            transition: "opacity .15s ease",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center" }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 999,
                background: `${tier.color}22`,
                color: tier.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 15,
                fontWeight: 700,
              }}
            >
              {initials(e.full_name)}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: token.colorText, lineHeight: 1.2 }}>
              {e.full_name}
            </div>
            <div style={{ fontSize: 11.5, color: token.colorTextTertiary, lineHeight: 1.3 }}>
              {[e.designation?.title, e.department?.name].filter(Boolean).join(" · ") || "—"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap", justifyContent: "center" }}>
              <span
                title={`${tier.label} · ${cubesOf(e)} cubes`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: tier.color,
                  background: `${tier.color}18`,
                  borderRadius: 999,
                  padding: "2px 8px",
                }}
              >
                <MIcon name="deployed_code" size={13} color={tier.color} />
                {cubesOf(e)}
              </span>
              {e.status ? (
                <Tag color={statusColor(e.status)} style={{ margin: 0, fontSize: 10.5, lineHeight: "16px" }}>
                  {statusLabel(e.status)}
                </Tag>
              ) : null}
            </div>
          </div>

          {/* Reports count + collapse toggle (like the reference's "59^"). */}
          {reports > 0 ? (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(e.id)) next.delete(e.id);
                  else next.add(e.id);
                  return next;
                });
              }}
              style={{
                position: "absolute",
                bottom: -12,
                left: "50%",
                transform: "translateX(-50%)",
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                height: 22,
                padding: "0 9px",
                borderRadius: 999,
                border: "none",
                background: token.colorText,
                color: token.colorBgContainer,
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
                zIndex: 1,
              }}
            >
              {reports}
              <MIcon name={isCollapsed ? "expand_more" : "expand_less"} size={14} />
            </button>
          ) : null}
        </div>
      </Dropdown>
    );
  };

  /* --------------------------------------------------------- recursion --- */
  const renderNode = (e: HrEmployeeWithRelations): React.ReactNode => {
    const kids = childrenOf.get(e.id) ?? [];
    const showKids = kids.length > 0 && !collapsed.has(e.id);
    return (
      <li key={e.id}>
        <NodeCard e={e} />
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
        <Input.Search
          allowClear
          placeholder="Search by name, role or department"
          style={{ maxWidth: 320 }}
          value={search}
          onChange={(ev) => setSearch(ev.target.value)}
        />
      </div>

      {isHrAdmin ? (
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ margin: "0 20px 8px" }}
          message="Drag to reorganize · right-click for tools"
          description="Drag a card onto a manager to make them report to that manager. Right-click any card to change manager, set cubes, or check performance. Card border colour reflects their cubes score."
        />
      ) : null}

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
          onDragOver={(ev) => {
            if (dragId) ev.preventDefault();
          }}
          onDrop={(ev) => {
            // Drop on empty canvas → make top-level.
            if (dragId) {
              ev.preventDefault();
              void reparent(dragId, null);
              setDragId(null);
            }
          }}
          style={{ overflowX: "auto", padding: "22px 20px 40px" }}
        >
          <style>{ORG_CSS}</style>
          <div className="org-tree">
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
.org-tree ul { display: flex; justify-content: center; list-style: none; margin: 0; padding: 30px 0 0; position: relative; }
.org-tree li { list-style: none; position: relative; padding: 30px 16px 0; text-align: center; }
/* connectors from each node up to its siblings' horizontal bar */
.org-tree li::before, .org-tree li::after {
  content: ""; position: absolute; top: 0; right: 50%;
  border-top: 1.5px solid var(--org-line); width: 50%; height: 30px;
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
  border-left: 1.5px solid var(--org-line); width: 0; height: 30px;
}
/* root level has no parent → no incoming connector */
.org-tree > ul { padding-top: 0; }
.org-tree > ul > li { padding-top: 0; }
.org-tree > ul > li::before, .org-tree > ul > li::after { display: none; }
:root[data-theme="dark"] .org-tree { --org-line: #39404e; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .org-tree { --org-line: #39404e; } }
`;
