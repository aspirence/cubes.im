"use client";

import { useState } from "react";
import { App, Dropdown, Spin, theme } from "antd";
import type { MenuProps } from "antd";
import { useUpdateCrmDeal } from "@/features/app-crm/use-crm-deals";
import {
  CRM_LEAD_TIERS,
  crmLeadTierMeta,
  type CrmLeadTier,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "./m-icon";
import { SoftChip } from "../_lib/ui";

/**
 * A lead's tier, editable in place — the same shape as `LeadStatusPicker`,
 * because grading a lead and moving its status are the same gesture from the
 * user's side: read the row, change the thing.
 *
 * Ungraded renders as a quiet outline rather than a fourth coloured chip. It is
 * the absence of a judgement, and dressing it up like a grade would make every
 * un-triaged lead look triaged.
 *
 * Clicks are swallowed so the row underneath (which usually opens a drawer)
 * stays put while the menu is open.
 */
export function LeadTierPicker({
  dealId,
  tier,
  size = "default",
}: {
  dealId: string;
  tier: string | null | undefined;
  /** "small" trims the chip for dense surfaces like board cards. */
  size?: "default" | "small";
}) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const updateDeal = useUpdateCrmDeal();
  const [open, setOpen] = useState(false);
  // `undefined` = nothing in flight; `null` = clearing the grade.
  const [pending, setPending] = useState<CrmLeadTier | null | undefined>(
    undefined,
  );

  // Show the value being written straight away; the row's own data catches up
  // when the query settles.
  const effective = pending === undefined ? tier : pending;
  const current = crmLeadTierMeta(effective);
  const busy = pending !== undefined;

  const pick = (next: CrmLeadTier | null) => {
    if (next === (current?.value ?? null)) return;
    setPending(next);
    updateDeal.mutate(
      { id: dealId, patch: { tier: next } },
      {
        onError: (err) => {
          setPending(undefined);
          message.error(errMsg(err, "Couldn't change the tier."));
        },
        onSuccess: () => setPending(undefined),
      },
    );
  };

  const items: MenuProps["items"] = [
    // Highest first: the menu is opened to promote a lead far more often than
    // to demote one.
    ...[...CRM_LEAD_TIERS].reverse().map((t) => ({
      key: t.value,
      label: t.label,
      icon: <MIcon name={t.icon} size={15} color={t.color} />,
      disabled: t.value === current?.value,
    })),
    { type: "divider" as const },
    {
      key: "none",
      label: "Ungraded",
      icon: <MIcon name="remove" size={15} />,
      disabled: current === null,
    },
  ];

  const chipStyle: React.CSSProperties =
    size === "small"
      ? { height: 18, padding: "0 7px", fontSize: 11, cursor: "pointer" }
      : { cursor: "pointer" };

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={["click"]}
      menu={{
        items,
        selectable: true,
        selectedKeys: [current?.value ?? "none"],
        onClick: ({ key }) =>
          pick(key === "none" ? null : (key as CrmLeadTier)),
      }}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={`Tier: ${current?.label ?? "ungraded"}. Change it.`}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        }}
        style={{ flex: "none", display: "inline-flex" }}
      >
        <SoftChip
          tone={current ? "custom" : "neutral"}
          color={current?.color}
          icon={busy ? undefined : (current?.icon ?? "label_off")}
          style={
            current
              ? chipStyle
              : {
                  ...chipStyle,
                  background: "transparent",
                  border: `1px dashed ${token.colorBorder}`,
                  color: token.colorTextTertiary,
                }
          }
        >
          {busy ? <Spin size="small" style={{ marginRight: 4 }} /> : null}
          {current?.label ?? "Ungraded"}
          <MIcon name="arrow_drop_down" size={size === "small" ? 14 : 16} />
        </SoftChip>
      </span>
    </Dropdown>
  );
}
