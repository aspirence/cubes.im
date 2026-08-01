"use client";

import { useMemo, useState } from "react";
import { App, Button, Input, Popover, Spin, Tooltip, theme } from "antd";
import { useRouter } from "next/navigation";
import {
  useCreateCrmLabel,
  useCrmLabels,
  useSetCrmDealLabel,
} from "@/features/app-crm/use-crm-labels";
import type { CrmDealWithRefs, CrmLabel } from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "./m-icon";
import { SoftChip } from "../_lib/ui";

/** One tag, rendered as the chip it is everywhere in the CRM. */
export function LabelChip({
  label,
  size = "default",
  onRemove,
}: {
  label: CrmLabel;
  size?: "default" | "small";
  onRemove?: () => void;
}) {
  return (
    <SoftChip
      tone="custom"
      color={label.color}
      style={
        size === "small"
          ? { height: 18, padding: "0 7px", fontSize: 11 }
          : undefined
      }
    >
      {label.name}
      {onRemove ? (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Remove ${label.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onRemove();
            }
          }}
          style={{ display: "inline-flex", cursor: "pointer", marginLeft: 1 }}
        >
          <MIcon name="close" size={size === "small" ? 12 : 14} />
        </span>
      ) : null}
    </SoftChip>
  );
}

/**
 * The tag picker — WhatsApp's "add to list", which is the interaction this was
 * asked for by name.
 *
 * A checkbox list that commits on the click, no Save button: putting a lead on
 * a list is one gesture and confirming it would be a second. Typing filters,
 * and a name that matches nothing offers to become a tag right there — the
 * whole point of a team-defined vocabulary is that it grows while you are
 * using it, not on a trip to Settings first.
 */
function LabelMenu({
  deal,
  onClose,
}: {
  deal: CrmDealWithRefs;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const router = useRouter();
  const { data: labels, isLoading } = useCrmLabels();
  const setLabel = useSetCrmDealLabel();
  const createLabel = useCreateCrmLabel();

  const [search, setSearch] = useState("");
  // Which rows have a write in flight, so a slow network can't be double-hit.
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const attached = useMemo(
    () => new Set(deal.labels.map((l) => l.id)),
    [deal.labels],
  );

  const needle = search.trim().toLowerCase();
  const rows = (labels ?? []).filter(
    (l) => !needle || l.name.toLowerCase().includes(needle),
  );
  const exact = (labels ?? []).some((l) => l.name.toLowerCase() === needle);

  const mark = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle = async (label: CrmLabel) => {
    const on = attached.has(label.id);
    mark(label.id, true);
    try {
      await setLabel.mutateAsync({
        dealId: deal.id,
        labelId: label.id,
        attached: !on,
      });
    } catch (err) {
      message.error(errMsg(err, "Couldn't change the tag."));
    } finally {
      mark(label.id, false);
    }
  };

  /** Create the typed name and put it on this lead in one gesture. */
  const createAndAttach = async () => {
    const name = search.trim();
    if (!name) return;
    try {
      const label = await createLabel.mutateAsync({ name });
      await setLabel.mutateAsync({
        dealId: deal.id,
        labelId: label.id,
        attached: true,
      });
      setSearch("");
    } catch (err) {
      message.error(errMsg(err, "Couldn't create that tag."));
    }
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 10px",
    border: "none",
    borderRadius: 8,
    background: "transparent",
    font: "inherit",
    color: token.colorText,
    textAlign: "left",
    cursor: "pointer",
  };

  return (
    <div style={{ width: 260 }}>
      <Input
        autoFocus
        size="small"
        allowClear
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search or create a tag…"
        prefix={<MIcon name="search" size={14} />}
        onPressEnter={() => {
          // Enter does the obvious thing: toggle the one match, or create what
          // was typed when there is none.
          if (rows.length === 1) void toggle(rows[0]);
          else if (needle && !exact) void createAndAttach();
        }}
      />

      <div
        style={{
          maxHeight: 240,
          overflowY: "auto",
          margin: "8px -4px 0",
          padding: "0 4px",
        }}
      >
        {isLoading ? (
          <div style={{ display: "grid", placeItems: "center", padding: 20 }}>
            <Spin size="small" />
          </div>
        ) : (
          <>
            {needle && !exact ? (
              <button
                type="button"
                style={{ ...rowStyle, color: token.colorPrimary }}
                onClick={() => void createAndAttach()}
                disabled={createLabel.isPending}
              >
                {createLabel.isPending ? (
                  <Spin size="small" />
                ) : (
                  <MIcon name="add" size={16} />
                )}
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  Create “{search.trim()}”
                </span>
              </button>
            ) : null}

            {rows.map((label) => {
              const on = attached.has(label.id);
              const pending = busy.has(label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  style={rowStyle}
                  onClick={() => void toggle(label)}
                  disabled={pending}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 16,
                      height: 16,
                      flex: "none",
                      display: "grid",
                      placeItems: "center",
                      borderRadius: 4,
                      border: `1px solid ${on ? label.color : token.colorBorder}`,
                      background: on ? label.color : "transparent",
                      color: "#fff",
                    }}
                  >
                    {pending ? null : on ? (
                      <MIcon name="check" size={13} color="#fff" />
                    ) : null}
                  </span>
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      flex: "none",
                      borderRadius: 999,
                      background: label.color,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {label.name}
                  </span>
                  {pending ? <Spin size="small" /> : null}
                </button>
              );
            })}

            {rows.length === 0 && !needle ? (
              <p
                style={{
                  margin: 0,
                  padding: "14px 10px",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: token.colorTextTertiary,
                }}
              >
                No tags yet. Type a name above — “Gold”, “Hot”, “Call back
                Monday” — and it becomes one.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: `1px solid ${token.colorSplit}`,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Button
          type="text"
          size="small"
          icon={<MIcon name="tune" size={15} />}
          onClick={() => {
            onClose();
            router.push("/crm/settings");
          }}
        >
          Manage tags
        </Button>
        <Button type="text" size="small" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * A lead's tags, with the picker attached.
 *
 * Chips are the display AND the control, the rule `LeadStatusPicker` set: the
 * work of a lead desk is reading a row and changing one thing on it, so making
 * that cost a drawer trip is the thing to avoid.
 */
export function DealLabels({
  deal,
  size = "default",
  editable = true,
  /** Caps the chips shown before "+N"; the rest live behind the tooltip. */
  max,
}: {
  deal: CrmDealWithRefs;
  size?: "default" | "small";
  editable?: boolean;
  max?: number;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const setLabel = useSetCrmDealLabel();
  const [open, setOpen] = useState(false);

  const shown = max ? deal.labels.slice(0, max) : deal.labels;
  const hidden = deal.labels.length - shown.length;

  const detach = async (labelId: string) => {
    try {
      await setLabel.mutateAsync({ dealId: deal.id, labelId, attached: false });
    } catch (err) {
      message.error(errMsg(err, "Couldn't remove the tag."));
    }
  };

  if (!editable && deal.labels.length === 0) {
    return <span style={{ color: token.colorTextQuaternary }}>—</span>;
  }

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}
      onClick={(e) => {
        // The row underneath usually opens a drawer; tagging shouldn't.
        e.stopPropagation();
      }}
    >
      {shown.map((label) => (
        <LabelChip
          key={label.id}
          label={label}
          size={size}
          onRemove={editable ? () => void detach(label.id) : undefined}
        />
      ))}

      {hidden > 0 ? (
        <Tooltip
          title={deal.labels
            .slice(shown.length)
            .map((l) => l.name)
            .join(", ")}
        >
          <span>
            <SoftChip
              style={
                size === "small"
                  ? { height: 18, padding: "0 7px", fontSize: 11 }
                  : undefined
              }
            >
              +{hidden}
            </SoftChip>
          </span>
        </Tooltip>
      ) : null}

      {editable ? (
        <Popover
          open={open}
          onOpenChange={setOpen}
          trigger="click"
          placement="bottomLeft"
          content={
            open ? <LabelMenu deal={deal} onClose={() => setOpen(false)} /> : null
          }
        >
          <Tooltip title={deal.labels.length === 0 ? "Add a tag" : undefined}>
            <Button
              size="small"
              type={deal.labels.length === 0 ? "text" : "text"}
              aria-label="Add a tag"
              icon={
                <MIcon name={deal.labels.length === 0 ? "sell" : "add"} size={15} />
              }
              style={{
                height: size === "small" ? 18 : 22,
                paddingInline: 6,
                color: token.colorTextTertiary,
              }}
            >
              {deal.labels.length === 0 ? "Tag" : null}
            </Button>
          </Tooltip>
        </Popover>
      ) : null}
    </span>
  );
}
