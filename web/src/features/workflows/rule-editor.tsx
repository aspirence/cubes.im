"use client";

import { useRef, useState } from "react";
import { Alert, Button, Input, Popover, Segmented, Select, Tooltip, Typography, theme } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { FieldTree } from "./field-picker";
import { insertToken, type FieldGroup } from "./field-tokens";
import {
  FILTER_OPS,
  isUnaryOp,
  validateRuleGroup,
  type FilterOp,
  type MatchMode,
  type Rule,
} from "./rule-groups";

/**
 * The rule-group editor shared by the Filter step and each of a router's
 * routes: "all/any of these", then one row per rule — a value from an earlier
 * step, a plain-language comparison, and what to compare it against.
 */

/** A text box with the field picker on its right — the compact form of TokenInput. */
export function TokenCell({
  value,
  onChange,
  groups,
  placeholder,
  disabled,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  groups: FieldGroup[];
  placeholder?: string;
  disabled?: boolean;
  width?: number | string;
}) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const caret = useRef<{ start: number; end: number } | null>(null);
  const remember = (el: HTMLInputElement) => {
    caret.current = {
      start: el.selectionStart ?? el.value.length,
      end: el.selectionEnd ?? el.value.length,
    };
  };
  return (
    <Input
      style={{ width }}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => {
        remember(e.currentTarget);
        onChange(e.target.value);
      }}
      onSelect={(e) => remember(e.currentTarget as HTMLInputElement)}
      onKeyUp={(e) => remember(e.currentTarget)}
      onBlur={(e) => remember(e.currentTarget)}
      suffix={
        <Popover
          open={open && !disabled}
          onOpenChange={setOpen}
          trigger="click"
          placement="bottomRight"
          title={<span style={{ fontSize: 12.5 }}>Insert data from an earlier step</span>}
          content={
            <FieldTree
              groups={groups}
              onPick={(path) => {
                const at = caret.current ?? { start: value.length, end: value.length };
                const next = insertToken(value, at.start, at.end, path);
                caret.current = { start: next.cursor, end: next.cursor };
                onChange(next.value);
                setOpen(false);
              }}
            />
          }
        >
          <Tooltip title="Pick a field from the trigger or an earlier step">
            <button
              type="button"
              disabled={disabled}
              aria-label="Insert data"
              style={{
                border: "none",
                background: "transparent",
                cursor: disabled ? "not-allowed" : "pointer",
                color: disabled ? token.colorTextQuaternary : "#4a4ad0",
                fontSize: 12,
                padding: 0,
                lineHeight: 1,
              }}
            >
              <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 16 }}>
                data_object
              </span>
            </button>
          </Tooltip>
        </Popover>
      }
    />
  );
}

export function RuleGroupEditor({
  match,
  rules,
  groups,
  disabled,
  onChange,
  /** Shown above the rows; the router names the route here. */
  title,
}: {
  match: MatchMode;
  rules: Rule[];
  groups: FieldGroup[];
  disabled?: boolean;
  onChange: (next: { match: MatchMode; rules: Rule[] }) => void;
  title?: string;
}) {
  const { token } = theme.useToken();
  const problem = validateRuleGroup({ match, rules });

  const setRule = (i: number, patch: Partial<Rule>) => {
    const next = rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    // Switching to "is empty" drops the value, so a stale right-hand side is
    // never saved with an operator that ignores it.
    if (patch.op && isUnaryOp(patch.op)) next[i] = { left: next[i].left, op: next[i].op };
    onChange({ match, rules: next });
  };

  return (
    <div>
      {title ? (
        <Typography.Text style={{ fontSize: 13, display: "block", marginBottom: 6 }}>
          {title}
        </Typography.Text>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Continue when
        </Typography.Text>
        <Segmented
          size="small"
          disabled={disabled}
          value={match}
          onChange={(v) => onChange({ match: v as MatchMode, rules })}
          options={[
            { value: "all", label: "all rules match" },
            { value: "any", label: "any rule matches" },
          ]}
        />
      </div>

      {rules.map((rule, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 150px 1fr 28px",
            gap: 6,
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <TokenCell
            value={rule.left}
            onChange={(v) => setRule(i, { left: v })}
            groups={groups}
            placeholder="Value to check"
            disabled={disabled}
          />
          <Select
            value={rule.op}
            disabled={disabled}
            options={FILTER_OPS}
            onChange={(v) => setRule(i, { op: v as FilterOp })}
          />
          {isUnaryOp(rule.op) ? (
            <span style={{ fontSize: 12, color: token.colorTextTertiary }}>no value needed</span>
          ) : (
            <TokenCell
              value={rule.right ?? ""}
              onChange={(v) => setRule(i, { right: v })}
              groups={groups}
              placeholder="Compare to"
              disabled={disabled}
            />
          )}
          <Button
            type="text"
            size="small"
            danger
            disabled={disabled || rules.length === 1}
            aria-label="Remove rule"
            icon={<DeleteOutlined style={{ fontSize: 12 }} />}
            onClick={() => onChange({ match, rules: rules.filter((_, idx) => idx !== i) })}
          />
        </div>
      ))}

      <Button
        size="small"
        type="link"
        disabled={disabled}
        style={{ padding: 0 }}
        icon={<PlusOutlined style={{ fontSize: 11 }} />}
        onClick={() => onChange({ match, rules: [...rules, { left: "", op: "=", right: "" }] })}
      >
        Add rule
      </Button>

      {problem ? (
        <Alert type="warning" showIcon style={{ marginTop: 8 }} message={problem} />
      ) : null}
    </div>
  );
}
