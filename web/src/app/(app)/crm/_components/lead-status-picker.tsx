"use client";

import { useState } from "react";
import { App, Dropdown, Spin } from "antd";
import type { MenuProps } from "antd";
import { useUpdateCrmDeal } from "@/features/app-crm/use-crm-deals";
import {
  CRM_LEAD_STATUSES,
  crmLeadStatusMeta,
  type CrmLeadStatus,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "./m-icon";
import { leadStatusIcon } from "./entity-meta";
import { SoftChip } from "../_lib/ui";

/**
 * A lead's status, editable in place. Working leads is mostly "read the row,
 * move the status" — so the chip is the control, wherever a deal is listed
 * (dashboard, board card, table) instead of only inside the record drawer.
 *
 * Clicks are swallowed so the row underneath (which usually opens a drawer)
 * stays put while the menu is open.
 */
export function LeadStatusPicker({
  dealId,
  status,
  size = "default",
}: {
  dealId: string;
  status: string | null | undefined;
  /** "small" trims the chip for dense surfaces like board cards. */
  size?: "default" | "small";
}) {
  const { message } = App.useApp();
  const updateDeal = useUpdateCrmDeal();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<CrmLeadStatus | null>(null);

  // Show the value being written straight away; the row's own data catches up
  // when the query settles.
  const current = crmLeadStatusMeta(pending ?? status);

  const pick = (next: CrmLeadStatus) => {
    if (next === current.value) return;
    setPending(next);
    updateDeal.mutate(
      { id: dealId, patch: { status: next } },
      {
        onError: (err) => {
          setPending(null);
          message.error(errMsg(err, "Couldn't change the status."));
        },
        onSuccess: () => setPending(null),
      },
    );
  };

  const items: MenuProps["items"] = CRM_LEAD_STATUSES.map((s) => ({
    key: s.value,
    label: s.label,
    icon: <MIcon name={leadStatusIcon(s.value)} size={15} />,
    disabled: s.value === current.value,
  }));

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
        selectedKeys: [current.value],
        onClick: ({ key }) => pick(key as CrmLeadStatus),
      }}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={`Status: ${current.label}. Change it.`}
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
          tone={current.tone}
          icon={pending ? undefined : leadStatusIcon(current.value)}
          style={chipStyle}
        >
          {pending ? (
            <Spin size="small" style={{ marginRight: 4 }} />
          ) : null}
          {current.label}
          <MIcon name="arrow_drop_down" size={size === "small" ? 14 : 16} />
        </SoftChip>
      </span>
    </Dropdown>
  );
}
