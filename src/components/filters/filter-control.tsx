"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Empty, Popover, Select, theme } from "antd";

/** One filterable field (e.g. Status, Priority, Assignee). */
export interface FilterField {
  key: string;
  label: string;
  /** Material Symbols glyph name. */
  icon: string;
  /** The values a user can pick for this field. */
  options: { value: string; label: string; dot?: string; avatarUrl?: string | null }[];
}

/** Selected values per field key. A field is "active" when its array is non-empty. */
export type FilterValues = Record<string, string[]>;

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

export function activeFilterCount(value: FilterValues): number {
  return Object.values(value).reduce((n, arr) => n + (arr?.length ? 1 : 0), 0);
}

/**
 * A ClickUp-style filter control: a compact "Filter" button that opens a panel
 * where you add filters by field, then pick one or more values. Config-driven
 * via `fields`, so the same component works on any list across the platform.
 */
export function FilterControl({
  fields,
  value,
  onChange,
  buttonSize = "middle",
}: {
  fields: FilterField[];
  value: FilterValues;
  onChange: (next: FilterValues) => void;
  buttonSize?: "small" | "middle";
}) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  // Fields shown as rows: those with a value, plus any the user just added.
  const [added, setAdded] = useState<string[]>([]);

  const fieldByKey = useMemo(() => {
    const m = new Map<string, FilterField>();
    for (const f of fields) m.set(f.key, f);
    return m;
  }, [fields]);

  const shownKeys = useMemo(() => {
    const keys = new Set<string>([
      ...Object.keys(value).filter((k) => value[k]?.length),
      ...added,
    ]);
    // Preserve the `fields` order.
    return fields.map((f) => f.key).filter((k) => keys.has(k));
  }, [value, added, fields]);

  const availableToAdd = fields.filter((f) => !shownKeys.includes(f.key));
  const count = activeFilterCount(value);

  const setField = (key: string, vals: string[]) => {
    const next = { ...value };
    if (vals.length) next[key] = vals;
    else delete next[key];
    onChange(next);
  };

  const removeField = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
    setAdded((prev) => prev.filter((k) => k !== key));
  };

  const clearAll = () => {
    onChange({});
    setAdded([]);
  };

  const panel = (
    <div style={{ width: 380, maxWidth: "90vw" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 700, color: token.colorText }}>Filters</span>
        {count > 0 ? (
          <Button type="text" size="small" onClick={clearAll} style={{ color: token.colorTextTertiary }}>
            Clear all
          </Button>
        ) : null}
      </div>

      {shownKeys.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No filters yet"
          style={{ margin: "6px 0 12px" }}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {shownKeys.map((key) => {
            const field = fieldByKey.get(key);
            if (!field) return null;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    width: 108,
                    flex: "none",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: token.colorTextSecondary,
                  }}
                >
                  <MIcon name={field.icon} size={16} color={token.colorTextTertiary} />
                  {field.label}
                </span>
                <span style={{ fontSize: 12, color: token.colorTextTertiary, flex: "none" }}>is</span>
                <Select
                  mode="multiple"
                  size="small"
                  autoFocus={added[added.length - 1] === key}
                  style={{ flex: 1, minWidth: 0 }}
                  placeholder={`Any ${field.label.toLowerCase()}`}
                  value={value[key] ?? []}
                  onChange={(vals) => setField(key, vals as string[])}
                  optionFilterProp="label"
                  maxTagCount="responsive"
                  options={field.options.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  optionRender={(opt) => {
                    const o = field.options.find((x) => x.value === opt.value);
                    return (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        {o?.dot ? (
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: o.dot }} />
                        ) : null}
                        {opt.label}
                      </span>
                    );
                  }}
                />
                <Button
                  type="text"
                  size="small"
                  aria-label={`Remove ${field.label} filter`}
                  onClick={() => removeField(key)}
                  icon={<MIcon name="close" size={15} color={token.colorTextTertiary} />}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Add filter — searchable field picker */}
      {availableToAdd.length > 0 ? (
        <Select
          showSearch
          size="small"
          value={null}
          placeholder="+ Add filter"
          style={{ width: "100%" }}
          optionFilterProp="label"
          onChange={(key) => {
            if (typeof key === "string") setAdded((prev) => [...prev, key]);
          }}
          options={availableToAdd.map((f) => ({ value: f.key, label: f.label }))}
          optionRender={(opt) => {
            const f = fieldByKey.get(String(opt.value));
            return (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <MIcon name={f?.icon ?? "filter_list"} size={16} color={token.colorTextTertiary} />
                {opt.label}
              </span>
            );
          }}
        />
      ) : null}
    </div>
  );

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomLeft"
      content={panel}
    >
      <Badge count={count} size="small" offset={[-2, 2]} color="#4a4ad0">
        <Button
          size={buttonSize}
          icon={<MIcon name="filter_list" size={17} />}
          type={count > 0 ? "primary" : "default"}
          ghost={count > 0}
        >
          Filter
        </Button>
      </Badge>
    </Popover>
  );
}

export default FilterControl;
