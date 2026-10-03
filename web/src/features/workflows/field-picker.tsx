"use client";

import { useMemo, useRef, useState } from "react";
import { Empty, Input, Popover, Tag, Tooltip, Tree, Typography, theme } from "antd";
import type { DataNode } from "antd/es/tree";
import {
  buildFieldTree,
  insertToken,
  searchFieldNodes,
  unknownTokens,
  type FieldGroup,
  type FieldNode,
  type FieldSource,
} from "./field-tokens";

/**
 * The field picker: a tree of the trigger's sample and every earlier step's
 * sample_output, each row showing the example value, clicking one inserting
 * `{{steps.key.path}}` at the caret.
 *
 * This is the thing that makes mapping possible for someone who has never seen
 * a dotted path. The rule the whole component follows: never offer a token the
 * engine cannot resolve — a key with a dash or a space in it is shown (so the
 * payload is not silently truncated) but cannot be clicked.
 */

function NodeTitle({ node }: { node: FieldNode }) {
  const { token } = theme.useToken();
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, maxWidth: "100%" }}>
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{node.name}</span>
      <span
        style={{
          fontSize: 11.5,
          color: token.colorTextTertiary,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 190,
        }}
      >
        {node.preview}
      </span>
      {!node.insertable ? (
        <Tooltip title="This field's name has characters the workflow engine cannot address, so it cannot be inserted.">
          <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>not mappable</span>
        </Tooltip>
      ) : null}
    </span>
  );
}

/**
 * Leaves insert, branches open. Clicking "contact" to be shown its fields is
 * what people expect; inserting the whole object is the rarer intent, and the
 * search box below still offers it for the cases (an HTTP body, mostly) where
 * a whole object is what you want.
 */
function toTreeData(nodes: FieldNode[], pickable: boolean): DataNode[] {
  return nodes.map((n) => ({
    key: n.path,
    title: <NodeTitle node={n} />,
    selectable: pickable && n.insertable && n.children.length === 0,
    disabled: pickable && !n.insertable,
    children: n.children.length ? toTreeData(n.children, pickable) : undefined,
  }));
}

/** The tree itself — also used read-only to show a captured payload. */
export function FieldTree({
  groups,
  onPick,
  height = 320,
  defaultExpandDepth = 1,
}: {
  groups: FieldGroup[];
  /** Omit to render a read-only view of the samples. */
  onPick?: (path: string) => void;
  height?: number;
  defaultExpandDepth?: number;
}) {
  const { token } = theme.useToken();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[] | null>(null);
  const pickable = Boolean(onPick);

  const matches = useMemo(() => searchFieldNodes(groups, query), [groups, query]);
  const defaultExpanded = useMemo(() => {
    const keys: string[] = [];
    const walk = (nodes: FieldNode[], depth: number) => {
      for (const n of nodes) {
        if (depth < defaultExpandDepth && n.children.length) {
          keys.push(n.path);
          walk(n.children, depth + 1);
        }
      }
    };
    for (const g of groups) walk(g.nodes, 0);
    return keys;
  }, [groups, defaultExpandDepth]);

  const expandedKeys = expanded ?? defaultExpanded;
  const toggle = (path: string) =>
    setExpanded(
      expandedKeys.includes(path)
        ? expandedKeys.filter((k) => k !== path)
        : [...expandedKeys, path],
    );

  const empty = groups.every((g) => g.nodes.length === 0);

  return (
    <div style={{ width: 380 }}>
      <Input
        allowClear
        size="small"
        placeholder="Search fields…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      {pickable && !query.trim() && !empty ? (
        <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
          Click a field to insert it. Search to insert a whole block.
        </Typography.Text>
      ) : null}
      <div style={{ maxHeight: height, overflow: "auto" }}>
        {query.trim() ? (
          matches.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Nothing matches “{query}”.
            </Typography.Text>
          ) : (
            matches.slice(0, 40).map((n) => (
              <button
                key={n.path}
                type="button"
                disabled={pickable && !n.insertable}
                onClick={() => onPick?.(n.path)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  background: "transparent",
                  padding: "4px 6px",
                  borderRadius: 6,
                  cursor: pickable && n.insertable ? "pointer" : "default",
                }}
              >
                <NodeTitle node={n} />
                <div style={{ fontSize: 11, color: token.colorTextQuaternary }}>{n.path}</div>
              </button>
            ))
          )
        ) : empty ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ fontSize: 12 }}>
                {groups[0]?.emptyHint ?? "No sample data yet."}
              </span>
            }
          />
        ) : (
          groups.map((g) => (
            <div key={g.root} style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  color: token.colorTextTertiary,
                  marginBottom: 2,
                }}
              >
                {g.label}
              </div>
              {g.nodes.length === 0 ? (
                <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                  {g.emptyHint ?? "Nothing to map from this step."}
                </Typography.Text>
              ) : (
                <Tree
                  blockNode
                  selectable={pickable}
                  expandedKeys={expandedKeys}
                  onExpand={(keys) => setExpanded(keys.map(String))}
                  treeData={toTreeData(g.nodes, pickable)}
                  onClick={(_e, node) => {
                    // A branch row opens; only a leaf inserts (see toTreeData).
                    const key = String(node.key);
                    if (node.children?.length) toggle(key);
                  }}
                  onSelect={(keys) => {
                    const key = keys[0];
                    if (typeof key === "string") onPick?.(key);
                  }}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** A read-only tree of one payload — the captured webhook body, a test result. */
export function SampleTree({
  sample,
  root = "payload",
  label = "Payload",
  height = 260,
}: {
  sample: unknown;
  root?: string;
  label?: string;
  height?: number;
}) {
  const groups = useMemo(
    () => buildFieldTree([{ key: root, label, root, sample }]),
    [sample, root, label],
  );
  return <FieldTree groups={groups} height={height} defaultExpandDepth={2} />;
}

/**
 * A text field with the picker attached. The caret is remembered on every
 * selection change, so a token lands where the user left it rather than always
 * at the end — which is the difference between writing a sentence and fighting
 * the box.
 */
export function TokenInput({
  value,
  onChange,
  groups,
  multiline,
  rows = 3,
  placeholder,
  disabled,
  label,
  required,
  help,
}: {
  value: string;
  onChange: (v: string) => void;
  groups: FieldGroup[];
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  required?: boolean;
  help?: string;
}) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const caret = useRef<{ start: number; end: number } | null>(null);

  const remember = (el: HTMLInputElement | HTMLTextAreaElement) => {
    caret.current = {
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  };

  const pick = (path: string) => {
    const at = caret.current ?? { start: value.length, end: value.length };
    const next = insertToken(value, at.start, at.end, path);
    caret.current = { start: next.cursor, end: next.cursor };
    onChange(next.value);
    setOpen(false);
  };

  const unknown = unknownTokens(groups, value);

  const common = {
    value,
    placeholder,
    disabled,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      remember(e.currentTarget);
      onChange(e.target.value);
    },
    onSelect: (e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      remember(e.currentTarget),
    onKeyUp: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      remember(e.currentTarget),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      remember(e.currentTarget),
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
          gap: 8,
        }}
      >
        <Typography.Text style={{ fontSize: 13 }}>
          {label}
          {required ? <span style={{ color: "#e0556a" }}> *</span> : null}
        </Typography.Text>
        <Popover
          open={open && !disabled}
          onOpenChange={setOpen}
          trigger="click"
          placement="bottomRight"
          title={<span style={{ fontSize: 12.5 }}>Insert data from an earlier step</span>}
          content={<FieldTree groups={groups} onPick={pick} />}
        >
          <button
            type="button"
            disabled={disabled}
            className="wl-token-btn"
            style={{
              border: "none",
              background: "transparent",
              color: disabled ? token.colorTextQuaternary : "#4a4ad0",
              cursor: disabled ? "not-allowed" : "pointer",
              fontSize: 12,
              padding: 0,
            }}
          >
            Insert data
          </button>
        </Popover>
      </div>
      {multiline ? (
        <Input.TextArea {...common} rows={rows} />
      ) : (
        <Input {...common} />
      )}
      {help ? (
        <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
          {help}
        </Typography.Text>
      ) : null}
      {unknown.length ? (
        <div style={{ marginTop: 4 }}>
          <Typography.Text type="warning" style={{ fontSize: 11.5 }}>
            No sample explains{" "}
            {unknown.slice(0, 3).map((u) => (
              <Tag key={u} style={{ marginInlineEnd: 4, fontSize: 10.5 }}>{`{{${u}}}`}</Tag>
            ))}
            — it will resolve to empty text unless the step really produces it.
          </Typography.Text>
        </div>
      ) : null}
    </div>
  );
}

export type { FieldGroup, FieldSource };
