"use client";

import { useRef, useState } from "react";
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
  const chipRef = useRef<HTMLSpanElement>(null);

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
    // The wrapper, not just the chip, guards the card or row underneath: the
    // menu renders in a portal, and React bubbles its events along the
    // component tree.
    //  - click: picking a status would also open the drawer underneath;
    //  - pointerdown from the menu: would arm a board card's drag, and a
    //    small wobble while picking would move the card instead;
    //  - Enter/Space: a board card's keyboard drag starts on Space;
    //  - Escape while the menu is open: closes the menu only, not the
    //    RecordDrawer around it (rc-drawer closes on Escape).
    <span
      style={{ flex: "none", display: "inline-flex" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        else if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          chipRef.current?.focus();
        }
      }}
    >
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        trigger={["click"]}
        // Focus moves into the menu when it opens, so arrow keys pick.
        autoFocus
        menu={{
          items,
          selectable: true,
          selectedKeys: [current.value],
          onClick: ({ key }) => pick(key as CrmLeadStatus),
        }}
      >
        <span
          ref={chipRef}
          role="button"
          tabIndex={0}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Status: ${current.label}. Change it.`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onKeyDown={(e) => {
            // A span is not a native button: Enter/Space open the menu here
            // (and Space must not scroll the page).
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setOpen((o) => !o);
            }
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
    </span>
  );
}
