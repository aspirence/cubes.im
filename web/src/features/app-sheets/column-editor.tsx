"use client";

/**
 * Sheets — the column editor: add, rename, retype, reorder, hide and delete
 * columns, and edit a select column's options.
 *
 * Works on a draft copy and saves the whole list in one write, so a
 * half-finished reorder never reaches other people's grids. The draft is
 * re-seeded every time the drawer opens (see the `open` handling below) —
 * reusing a draft from the previous opening would silently undo whatever
 * changed in between.
 *
 * A source-field column keeps the type its source gives it: a task's due
 * date is a date whatever the column says, and letting it be retyped would
 * only make the grid mis-read it. Its label, position and visibility are the
 * sheet's own business and stay editable.
 */

import { useState } from "react";
import { App, Button, Drawer, Dropdown, Input, Popconfirm, Select, Switch, Tag, Tooltip, theme } from "antd";
import { SOURCES } from "@/lib/sheets/sources";
import { newColumnId, type SelectOption, type SheetColumn, type SheetRecordRow } from "@/lib/sheets/types";
import { MIcon } from "@/features/app-content-studio/ui";
import { errMsg } from "@/lib/err";
import { TYPE_ICONS, TYPE_LABELS, isCustomColumn } from "./sheet-model";
import { optionValueFor } from "./grid-values";

export const OPTION_COLORS = ["#8a8d98", "#4a4ad0", "#1c7ed6", "#2f9c9c", "#2f8f5f", "#b8842a", "#d9480f", "#c0453c", "#862e9c"];

const CUSTOM_TYPES: SheetColumn["type"][] = [
  "text",
  "long_text",
  "number",
  "currency",
  "percent",
  "date",
  "datetime",
  "checkbox",
  "select",
  "multi_select",
  "person",
  "people",
  "url",
  "email",
  "phone",
];

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY"];

/** A new custom column of a type, with the extras that type needs. */
export function makeCustomColumn(type: SheetColumn["type"], label: string, taken: string[]): SheetColumn {
  const col: SheetColumn = { id: newColumnId(taken), label, type };
  if (type === "select" || type === "multi_select") col.options = [];
  if (type === "person" || type === "people") col.dynamicOptions = "team_members";
  if (type === "currency") col.currency = "INR";
  return col;
}

function retype(column: SheetColumn, type: SheetColumn["type"]): SheetColumn {
  const { options, dynamicOptions, currency, ...rest } = column;
  const next: SheetColumn = { ...rest, type };
  if (type === "select" || type === "multi_select") next.options = options ?? [];
  if (type === "person" || type === "people") next.dynamicOptions = "team_members";
  else if (dynamicOptions && dynamicOptions !== "team_members") next.dynamicOptions = dynamicOptions;
  if (type === "currency") next.currency = currency ?? "INR";
  return next;
}

export function OptionsEditor({
  options,
  onChange,
}: {
  options: SelectOption[];
  onChange: (next: SelectOption[]) => void;
}) {
  const { token } = theme.useToken();
  const [label, setLabel] = useState("");
  const add = () => {
    const t = label.trim();
    if (!t) return;
    if (options.some((o) => o.label.toLowerCase() === t.toLowerCase())) {
      setLabel("");
      return;
    }
    onChange([...options, { value: optionValueFor(t, options), label: t, color: OPTION_COLORS[options.length % OPTION_COLORS.length] }]);
    setLabel("");
  };
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {options.map((o, i) => (
        <div key={o.value} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: OPTION_COLORS.map((c) => ({
                key: c,
                label: <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 999, background: c }} />,
              })),
              onClick: ({ key }) => onChange(options.map((x, j) => (j === i ? { ...x, color: key } : x))),
            }}
          >
            <button
              type="button"
              aria-label="Option colour"
              style={{ width: 18, height: 18, borderRadius: 999, border: `1px solid ${token.colorBorder}`, background: o.color ?? token.colorFillSecondary, cursor: "pointer", flex: "none" }}
            />
          </Dropdown>
          {/* The label is free to change; the stored value stays, so cells
              already holding this option keep pointing at it. */}
          <Input
            size="small"
            value={o.label}
            onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <Button size="small" type="text" aria-label="Remove option" onClick={() => onChange(options.filter((_, j) => j !== i))} icon={<MIcon name="close" size={15} />} />
        </div>
      ))}
      <Input
        size="small"
        value={label}
        placeholder="Add an option and press Enter"
        onChange={(e) => setLabel(e.target.value)}
        onPressEnter={add}
        onBlur={add}
      />
    </div>
  );
}

export function ColumnEditorDrawer({
  open,
  sheet,
  focusColumnId,
  onClose,
  onSave,
}: {
  open: boolean;
  sheet: SheetRecordRow;
  focusColumnId?: string;
  onClose: () => void;
  onSave: (columns: SheetColumn[]) => Promise<void>;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [draft, setDraft] = useState<SheetColumn[]>(sheet.columns);
  const [expanded, setExpanded] = useState<string | null>(focusColumnId ?? null);
  const [saving, setSaving] = useState(false);
  // Re-seed on every opening (and when opened on another sheet): adjusting
  // state during render is React's own answer for "reset when a prop moves".
  const [seed, setSeed] = useState<string | null>(null);
  const seedKey = open ? `${sheet.id}:${focusColumnId ?? ""}` : null;
  if (seedKey !== seed) {
    setSeed(seedKey);
    if (seedKey) {
      setDraft(sheet.columns);
      setExpanded(focusColumnId ?? null);
    }
  }

  const src = SOURCES[sheet.source];
  const usedFields = new Set(draft.filter((c) => c.field).map((c) => c.field));
  const addableFields = src.fields.filter((f) => !usedFields.has(f.key));
  const dirty = JSON.stringify(draft) !== JSON.stringify(sheet.columns);

  const patch = (id: string, fn: (c: SheetColumn) => SheetColumn) => setDraft((d) => d.map((c) => (c.id === id ? fn(c) : c)));
  const moveBy = (index: number, delta: number) =>
    setDraft((d) => {
      const j = index + delta;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });

  const addCustom = (type: SheetColumn["type"]) => {
    const col = makeCustomColumn(type, TYPE_LABELS[type], draft.map((c) => c.id));
    setDraft((d) => [...d, col]);
    setExpanded(col.id);
  };
  const addField = (key: string) => {
    const f = src.fields.find((x) => x.key === key);
    if (!f) return;
    const col: SheetColumn = {
      id: newColumnId(draft.map((c) => c.id)),
      label: f.label,
      type: f.type,
      field: f.key,
      ...(f.dynamicOptions ? { dynamicOptions: f.dynamicOptions } : {}),
    };
    setDraft((d) => [...d, col]);
  };

  const save = async () => {
    const blank = draft.find((c) => !c.label.trim());
    if (blank) {
      message.warning("Every column needs a name.");
      setExpanded(blank.id);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft.map((c) => ({ ...c, label: c.label.trim().slice(0, 120) })));
      onClose();
    } catch (err) {
      message.error(errMsg(err, "Couldn't save the columns."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={460}
      title="Columns"
      destroyOnHidden
      extra={
        <Button type="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
          Save
        </Button>
      }
    >
      <div style={{ display: "grid", gap: 8 }}>
        {draft.map((c, i) => {
          const custom = isCustomColumn(c);
          const field = c.field ? src.fields.find((f) => f.key === c.field) : undefined;
          const isOpen = expanded === c.id;
          return (
            <div
              key={c.id}
              style={{
                border: `1px solid ${isOpen ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                borderRadius: 10,
                padding: "8px 10px",
                background: c.hidden ? token.colorFillQuaternary : token.colorBgContainer,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MIcon name={TYPE_ICONS[c.type]} size={16} color={token.colorTextTertiary} />
                <Input
                  size="small"
                  variant="borderless"
                  value={c.label}
                  maxLength={120}
                  onChange={(e) => patch(c.id, (x) => ({ ...x, label: e.target.value }))}
                  style={{ fontWeight: 600, flex: 1, paddingInline: 2 }}
                />
                {field ? (
                  <Tooltip title={field.writable ? `From ${src.label} — edits write back.` : `From ${src.label} — read-only.`}>
                    <Tag style={{ margin: 0, fontSize: 11 }} icon={field.writable ? undefined : <MIcon name="lock" size={11} />}>
                      {src.label}
                    </Tag>
                  </Tooltip>
                ) : null}
                <Tooltip title={c.hidden ? "Show in the grid" : "Hide from the grid"}>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => patch(c.id, (x) => ({ ...x, hidden: x.hidden ? undefined : true }))}
                    icon={<MIcon name={c.hidden ? "visibility_off" : "visibility"} size={16} />}
                  />
                </Tooltip>
                <Button size="small" type="text" aria-label="Move up" disabled={i === 0} onClick={() => moveBy(i, -1)} icon={<MIcon name="arrow_upward" size={15} />} />
                <Button size="small" type="text" aria-label="Move down" disabled={i === draft.length - 1} onClick={() => moveBy(i, 1)} icon={<MIcon name="arrow_downward" size={15} />} />
                <Button
                  size="small"
                  type="text"
                  aria-label="Settings"
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                  icon={<MIcon name={isOpen ? "expand_less" : "tune"} size={16} />}
                />
              </div>
              {isOpen ? (
                <div style={{ display: "grid", gap: 10, marginTop: 10, paddingLeft: 24 }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 12, color: token.colorTextSecondary }}>Type</span>
                    <Tooltip title={custom ? undefined : `${src.label} decides this field's type.`}>
                      <Select
                        size="small"
                        value={c.type}
                        disabled={!custom}
                        onChange={(t) => patch(c.id, (x) => retype(x, t))}
                        options={CUSTOM_TYPES.map((t) => ({
                          value: t,
                          label: (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <MIcon name={TYPE_ICONS[t]} size={14} /> {TYPE_LABELS[t]}
                            </span>
                          ),
                        }))}
                      />
                    </Tooltip>
                    {custom && c.type !== sheet.columns.find((o) => o.id === c.id)?.type && sheet.columns.some((o) => o.id === c.id) ? (
                      <span style={{ fontSize: 11.5, color: token.colorWarningText }}>
                        Existing values that don&apos;t fit the new type show as they are until they&apos;re edited.
                      </span>
                    ) : null}
                  </div>
                  {custom && (c.type === "select" || c.type === "multi_select") ? (
                    <div style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, color: token.colorTextSecondary }}>Options</span>
                      <OptionsEditor options={c.options ?? []} onChange={(options) => patch(c.id, (x) => ({ ...x, options }))} />
                    </div>
                  ) : null}
                  {c.type === "currency" ? (
                    <div style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, color: token.colorTextSecondary }}>Currency</span>
                      <Select
                        size="small"
                        allowClear
                        placeholder={field ? "Use the source's currency" : "No currency sign"}
                        value={c.currency}
                        onChange={(v) => patch(c.id, (x) => ({ ...x, currency: v || undefined }))}
                        options={CURRENCIES.map((x) => ({ value: x, label: x }))}
                      />
                    </div>
                  ) : null}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Switch size="small" checked={!c.hidden} onChange={(on) => patch(c.id, (x) => ({ ...x, hidden: on ? undefined : true }))} />
                    <span style={{ fontSize: 12.5 }}>Show in the grid</span>
                  </div>
                  <Popconfirm
                    title="Delete this column?"
                    description={
                      custom
                        ? "Its values are no longer shown or synced. Re-adding a column starts empty."
                        : `The ${src.label} data itself is untouched — only this sheet stops showing it.`
                    }
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => setDraft((d) => d.filter((x) => x.id !== c.id))}
                  >
                    <Button size="small" danger type="text" icon={<MIcon name="delete" size={15} />} style={{ justifySelf: "start" }}>
                      Delete column
                    </Button>
                  </Popconfirm>
                </div>
              ) : null}
            </div>
          );
        })}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: CUSTOM_TYPES.map((t) => ({ key: t, label: TYPE_LABELS[t], icon: <MIcon name={TYPE_ICONS[t]} size={15} /> })),
              onClick: ({ key }) => addCustom(key as SheetColumn["type"]),
            }}
          >
            <Button icon={<MIcon name="add" size={16} />}>Custom column</Button>
          </Dropdown>
          {addableFields.length > 0 ? (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: addableFields.map((f) => ({
                  key: f.key,
                  label: (
                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      {f.label}
                      {f.writable ? null : <MIcon name="lock" size={12} />}
                    </span>
                  ),
                  icon: <MIcon name={TYPE_ICONS[f.type]} size={15} />,
                })),
                onClick: ({ key }) => addField(key),
              }}
            >
              <Button icon={<MIcon name={src.icon} size={16} />}>Field from {src.label}</Button>
            </Dropdown>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
