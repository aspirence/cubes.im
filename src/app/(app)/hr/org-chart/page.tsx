"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Avatar,
  Card,
  Empty,
  Input,
  Skeleton,
  Space,
  Tag,
  Tree,
  Typography,
} from "antd";
import type { DataNode, TreeProps } from "antd/es/tree";
import { InfoCircleOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import Link from "next/link";
import {
  useHrAccess,
  useHrEmployees,
  useUpdateEmployee,
} from "@/features/hr/use-hr";
import type { HrEmployeeWithRelations } from "../_lib/types";
import { initials, statusColor, statusLabel } from "../_lib/labels";

const { Title, Text } = Typography;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again.";
}

/** Synthetic key for the "Unassigned manager" group node (no real employee). */
const UNASSIGNED_KEY = "__unassigned__";

/** Renders one person's node title: avatar/initials + name + role + status. */
function PersonTitle({ e }: { e: HrEmployeeWithRelations }) {
  const role = e.designation?.title;
  const dept = e.department?.name;
  const sub = [role, dept].filter(Boolean).join(" · ");
  return (
    <Space size={8} align="center" style={{ padding: "2px 0" }}>
      <Avatar size="small" icon={<UserOutlined />}>
        {initials(e.full_name)}
      </Avatar>
      <span>
        <Link href={`/hr/employees/${e.id}`}>{e.full_name}</Link>
        {sub ? (
          <Text type="secondary" style={{ marginInlineStart: 8, fontSize: 12 }}>
            {sub}
          </Text>
        ) : null}
      </span>
      {e.status ? (
        <Tag
          color={statusColor(e.status)}
          style={{ marginInlineStart: 4, fontSize: 11 }}
        >
          {statusLabel(e.status)}
        </Tag>
      ) : null}
    </Space>
  );
}

/**
 * Builds the manager hierarchy as antd `Tree` nodes.
 *
 * Roots are employees with no `manager_id` (or one pointing outside the org).
 * Children are employees whose `manager_id` equals a parent's id. Any employee
 * not reachable from a root — because of a cycle or a dangling manager pointer —
 * is collected under a synthetic "Unassigned manager" group so nobody is lost.
 */
function buildTree(employees: HrEmployeeWithRelations[]): {
  nodes: DataNode[];
  expandedKeys: string[];
} {
  const byId = new Map<string, HrEmployeeWithRelations>();
  for (const e of employees) byId.set(e.id, e);

  const childrenOf = new Map<string, HrEmployeeWithRelations[]>();
  const roots: HrEmployeeWithRelations[] = [];
  for (const e of employees) {
    const mgr = e.manager_id;
    if (mgr && byId.has(mgr) && mgr !== e.id) {
      const list = childrenOf.get(mgr) ?? [];
      list.push(e);
      childrenOf.set(mgr, list);
    } else {
      // No manager, manager outside the org, or self-reference → a root.
      roots.push(e);
    }
  }

  const expandedKeys: string[] = [];
  const visited = new Set<string>();

  const toNode = (e: HrEmployeeWithRelations): DataNode => {
    visited.add(e.id);
    const kids = (childrenOf.get(e.id) ?? []).filter((c) => !visited.has(c.id));
    const children = kids.map(toNode);
    if (children.length > 0) expandedKeys.push(e.id);
    return {
      key: e.id,
      title: <PersonTitle e={e} />,
      children: children.length > 0 ? children : undefined,
    };
  };

  const nodes = roots.map(toNode);

  // Anyone never visited is part of a cycle or otherwise unreachable.
  const orphans = employees.filter((e) => !visited.has(e.id));
  if (orphans.length > 0) {
    expandedKeys.push(UNASSIGNED_KEY);
    nodes.push({
      key: UNASSIGNED_KEY,
      selectable: false,
      title: (
        <Text type="secondary">
          Unassigned manager{" "}
          <Tag style={{ fontSize: 11 }}>{orphans.length}</Tag>
        </Text>
      ),
      children: orphans.map((e) => ({
        key: e.id,
        title: <PersonTitle e={e} />,
      })),
    });
  }

  return { nodes, expandedKeys };
}

export default function HrOrgChartPage() {
  const { message } = App.useApp();
  const { isHrAdmin } = useHrAccess();
  const { data, isLoading, isError, error } = useHrEmployees();
  const updateEmployee = useUpdateEmployee();

  const [search, setSearch] = useState("");
  const [autoExpand, setAutoExpand] = useState(true);
  const [manualExpanded, setManualExpanded] = useState<React.Key[]>([]);

  const employees = useMemo<HrEmployeeWithRelations[]>(
    () => data ?? [],
    [data],
  );

  const byId = useMemo(() => {
    const m = new Map<string, HrEmployeeWithRelations>();
    for (const e of employees) m.set(e.id, e);
    return m;
  }, [employees]);

  const { nodes, expandedKeys } = useMemo(
    () => buildTree(employees),
    [employees],
  );

  // Keys of people matching the search term (by name / role / department).
  const matchedKeys = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return null;
    const keys: string[] = [];
    for (const e of employees) {
      const hay = [e.full_name, e.designation?.title, e.department?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(term)) keys.push(e.id);
    }
    return keys;
  }, [search, employees]);

  // While searching, expand everything so matches are always visible.
  const effectiveExpanded = useMemo<React.Key[]>(() => {
    if (matchedKeys) return employees.map((e) => e.id).concat(UNASSIGNED_KEY);
    return autoExpand ? expandedKeys : manualExpanded;
  }, [matchedKeys, employees, autoExpand, expandedKeys, manualExpanded]);

  const matchedSet = useMemo(
    () => (matchedKeys ? new Set(matchedKeys) : null),
    [matchedKeys],
  );

  // Apply a highlight to matched nodes without rebuilding the tree.
  const filterTreeData = (input: DataNode[]): DataNode[] =>
    input.map((node) => {
      const isMatch = matchedSet?.has(String(node.key)) ?? false;
      return {
        ...node,
        title:
          isMatch && typeof node.title !== "function" ? (
            <span style={{ background: "#fffbe6", borderRadius: 4 }}>
              {node.title as React.ReactNode}
            </span>
          ) : (
            node.title
          ),
        children: node.children ? filterTreeData(node.children) : undefined,
      };
    });

  const treeData = matchedSet ? filterTreeData(nodes) : nodes;

  /**
   * Would assigning `managerId` as the manager of `movingId` create a cycle?
   * True when `movingId` is an ancestor of `managerId` (walking up the chain).
   */
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

  /**
   * Drag-to-reorganise (HR admins). Dropping a person ONTO another makes that
   * person their manager; dropping into a gap makes them a sibling (same manager).
   * Dropping on/near the "Unassigned" group clears the manager (top-level).
   */
  const onDrop: TreeProps["onDrop"] = async (info) => {
    const dragKey = String(info.dragNode.key);
    const dropKey = String(info.node.key);
    if (dragKey === UNASSIGNED_KEY) return;

    const dragEmp = byId.get(dragKey);
    if (!dragEmp) return;

    let newManagerId: string | null;
    if (!info.dropToGap) {
      newManagerId = dropKey === UNASSIGNED_KEY ? null : dropKey;
    } else {
      newManagerId =
        dropKey === UNASSIGNED_KEY ? null : byId.get(dropKey)?.manager_id ?? null;
    }

    if (newManagerId === dragKey) return;
    if ((dragEmp.manager_id ?? null) === newManagerId) return; // no change

    if (newManagerId && wouldCycle(newManagerId, dragKey)) {
      message.error("Can't move a manager under one of their own reports.");
      return;
    }

    try {
      await updateEmployee.mutateAsync({
        id: dragKey,
        patch: { manager_id: newManagerId },
      });
      message.success(
        newManagerId
          ? `${dragEmp.full_name} now reports to ${
              byId.get(newManagerId)?.full_name ?? "a manager"
            }.`
          : `${dragEmp.full_name} is now top-level.`,
      );
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Couldn't update the reporting line.",
      );
    }
  };

  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          <TeamOutlined style={{ marginInlineEnd: 8 }} />
          Org chart
        </Title>
        <Input.Search
          allowClear
          placeholder="Search by name, role or department"
          style={{ maxWidth: 320 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isHrAdmin && !search ? (
        <Alert
          type="info"
          showIcon
          icon={<InfoCircleOutlined />}
          style={{ marginBottom: 16 }}
          message="Build your teams by dragging"
          description="Drag a person onto a manager to make them report to that manager, or drop them beside someone to make them peers. Drag to the top to remove their manager."
        />
      ) : null}

      {isError ? (
        <Alert
          type="error"
          showIcon
          message="Failed to load employees"
          description={errorMessage(error)}
        />
      ) : isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : employees.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No employees to chart yet"
        />
      ) : matchedKeys && matchedKeys.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No one matches your search"
        />
      ) : (
        <Tree
          treeData={treeData}
          expandedKeys={effectiveExpanded}
          onExpand={(keys) => {
            setAutoExpand(false);
            setManualExpanded(keys);
          }}
          selectable={false}
          showLine={{ showLeafIcon: false }}
          blockNode
          draggable={
            isHrAdmin && !search
              ? { icon: false, nodeDraggable: (node) => node.key !== UNASSIGNED_KEY }
              : false
          }
          onDrop={onDrop}
        />
      )}
    </Card>
  );
}
