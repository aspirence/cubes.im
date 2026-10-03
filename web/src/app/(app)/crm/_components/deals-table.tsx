"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  Divider,
  Dropdown,
  InputNumber,
  Popconfirm,
  Select,
  Spin,
  Tooltip,
  theme,
} from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  useSetCrmDealDeleted,
  useUpdateCrmDeal,
} from "@/features/app-crm/use-crm-deals";
import {
  CRM_LEAD_STATUSES,
  crmLeadStatusMeta,
  type CrmDealWithRefs,
  type CrmLeadStatus,
  type CrmStage,
} from "@/features/app-crm/types";
import { errMsg } from "@/lib/err";
import { MIcon } from "./m-icon";
import { DealCell } from "./deal-glyph";
import { DealLabels } from "./label-picker";
import { leadStatusIcon } from "./entity-meta";
import { BulkBar, BulkMoveToProject, useBulkRun } from "./bulk-bar";
import {
  CrmTable,
  DateCell,
  ManageColumns,
  OrgCell,
  PhoneChip,
  TagPill,
  UpdatedCell,
  useColumnLayout,
  type ColumnChoice,
  type CrmMenuItem,
} from "./data-table";
import {
  useDealMenuItems,
  useProjectMoveItem,
  useRecordMenu,
} from "./record-menu";
import { EmptyState, EntityCell, crmMoney, crmPersonName } from "../_lib/ui";
import { useResetOnScopeChange } from "../_lib/crm-scope";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * The columns after the deal, with their widths. The widths also size the
 * horizontal scroll, so hiding columns shrinks it.
 */
const SIZED_COLUMNS = {
  company: { title: "Company", width: 160 },
  contact: { title: "Contact", width: 170 },
  phone: { title: "Phone", width: 175 },
  status: { title: "Status", width: 150 },
  labels: { title: "Tags", width: 210 },
  stage: { title: "Stage", width: 135 },
  close_date: { title: "Close date", width: 120 },
  updated_at: { title: "Last update", width: 120 },
} as const;
type SizedKey = keyof typeof SIZED_COLUMNS;

/**
 * Every column — the deal itself included — can be hidden and dragged into
 * another place from "Manage columns" (the kit keeps one showing). Default
 * left-to-right order; keys match the columns' `key`s.
 */
const COLUMN_CHOICES: ColumnChoice[] = [
  { key: "name", title: "Deal" },
  ...Object.entries(SIZED_COLUMNS).map(([key, c]) => ({ key, title: c.title })),
];

/** The selection checkbox column. */
const SELECT_WIDTH = 48;
/** The Deal column takes the slack; this is its comfortable minimum while it shows. */
const DEAL_MIN_WIDTH = 250;

const sized = (key: SizedKey) => ({ key, ...SIZED_COLUMNS[key] });

/**
 * The lead desk: every deal in one dense table, selectable in bulk.
 *
 * Working a lead list is repetitive — twenty rows all need the same status, or
 * the same five are junk. Doing that one drawer at a time is the whole cost of
 * the job, so selection + a bulk bar is the point of this table, not a
 * decoration on it.
 *
 * Drawn in the CRM record-table style (`CrmTable` + the kit's cells). It sits
 * inside the dashboard's own Panel, so it carries no card of its own; its
 * table controls — page size, go to page, Manage columns — live in the footer.
 *
 * Right-click a row for the shared record menu (record-menu.tsx): open it,
 * change its status, stage or project, start a task / note / reminder on it,
 * call or copy, and delete it (after a confirm; it can be restored).
 */
export function DealsTable({
  deals,
  stages,
  loading,
  onOpen,
}: {
  deals: CrmDealWithRefs[];
  stages: CrmStage[];
  loading?: boolean;
  onOpen: (dealId: string) => void;
}) {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const updateDeal = useUpdateCrmDeal();
  const setDeleted = useSetCrmDealDeleted();
  const recordMenu = useRecordMenu();
  const dealItems = useDealMenuItems();
  const projectMove = useProjectMoveItem();

  const [selected, setSelected] = useState<string[]>([]);
  // The selection survives paging (preserveSelectedRowKeys), so a project
  // switch would leave rows ticked that are no longer on screen — and the
  // bulk bar would act on them. Outside the scope provider this is a no-op.
  useResetOnScopeChange(() => setSelected([]));
  // For the same reason, a deal that leaves the list passed in leaves the
  // selection too, however it left (deleted, moved to another project, given
  // a status the dashboard's filter hides; from the row menu, the status pill,
  // the drawer or the toolbar). Adjusted during render, not in an effect, so
  // the bulk bar never counts a deal that is gone. This table's own column
  // filters only hide rows, like paging, so their ticks stay as before.
  const [listed, setListed] = useState(deals);
  if (listed !== deals) {
    setListed(deals);
    const ids = new Set(deals.map((d) => d.id));
    setSelected((keys) => {
      const kept = keys.filter((k) => ids.has(k));
      return kept.length === keys.length ? keys : kept;
    });
  }
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [goTo, setGoTo] = useState<number | null>(null);
  const bulk = useBulkRun(() => setSelected([]));
  // Same key as the old hidden-columns list, so saved choices carry over.
  const layout = useColumnLayout("dashboard-deals", COLUMN_CHOICES);

  const stageById = useMemo(() => {
    const map = new Map<string, CrmStage>();
    for (const s of stages) map.set(s.id, s);
    return map;
  }, [stages]);
  // Board order, for sorting by stage; deals with no stage sort last.
  const stageRank = useMemo(() => {
    const map = new Map<string, number>();
    stages.forEach((s, i) => map.set(s.id, i));
    return (id: string | null) =>
      (id ? map.get(id) : undefined) ?? stages.length;
  }, [stages]);

  const confirmDelete = (d: CrmDealWithRefs) => {
    modal.confirm({
      title: `Delete "${d.name}"?`,
      content: "It moves to Deleted and can be restored.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await setDeleted.mutateAsync({ id: d.id, deleted: true });
          message.success("Deal deleted. Restore it from Deals → Deleted.");
        } catch (err) {
          message.error(errMsg(err, "Couldn't delete the deal."));
        }
      },
    });
  };

  /** The row's right-click menu, built from the deal as it is right now. */
  const dealMenu = (d: CrmDealWithRefs): CrmMenuItem[] =>
    recordMenu.build({
      target: { type: "deal", id: d.id },
      name: d.name,
      onOpen: () => onOpen(d.id),
      phone: d.phone,
      manage: [
        dealItems.status(d),
        dealItems.stage(d),
        projectMove({
          current: d.project_id,
          noun: "Deal",
          onMove: (projectId) =>
            updateDeal.mutateAsync({
              id: d.id,
              patch: { project_id: projectId },
            }),
        }),
      ],
      danger: [
        {
          key: "delete",
          label: "Delete…",
          icon: "delete",
          danger: true,
          onSelect: () => confirmDelete(d),
        },
      ],
    });

  const pageCount = Math.max(1, Math.ceil(deals.length / pageSize));
  const safePage = Math.min(page, pageCount);

  const dash = <span style={{ color: token.colorTextQuaternary }}>—</span>;

  const allColumns: ColumnsType<CrmDealWithRefs> = [
    {
      title: "Deal",
      key: "name",
      render: (_, d) => {
        // The amount is the second line. The company joins it only while its
        // own column is hidden (never for campaign leads, as before).
        const subtitle = [
          d.amount !== null ? crmMoney(d.amount, d.currency_code) : null,
          !layout.isVisible("company") && !d.campaign_id ? d.company?.name : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return <DealCell name={d.name} subtitle={subtitle || undefined} />;
      },
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      ...sized("company"),
      render: (_, d) => <OrgCell name={d.company?.name} />,
      sorter: (a, b) =>
        (a.company?.name ?? "").localeCompare(b.company?.name ?? ""),
    },
    {
      ...sized("contact"),
      render: (_, d) => {
        const name = crmPersonName(d.contact);
        return name ? <EntityCell name={name} kind="person" size={24} /> : dash;
      },
      sorter: (a, b) =>
        crmPersonName(a.contact).localeCompare(crmPersonName(b.contact)),
    },
    {
      ...sized("phone"),
      render: (_, d) => <PhoneCell phone={d.phone} />,
    },
    {
      ...sized("status"),
      render: (_, d) => <StatusPill dealId={d.id} status={d.status} />,
      filters: CRM_LEAD_STATUSES.map((s) => ({ text: s.label, value: s.value })),
      onFilter: (value, d) => crmLeadStatusMeta(d.status).value === value,
      sorter: (a, b) =>
        CRM_LEAD_STATUSES.indexOf(crmLeadStatusMeta(a.status)) -
        CRM_LEAD_STATUSES.indexOf(crmLeadStatusMeta(b.status)),
    },
    {
      ...sized("labels"),
      // The chips are the editor too (add a tag, remove one) — the row's
      // drawer never opens from here.
      render: (_, d) => <DealLabels deal={d} max={2} />,
    },
    {
      ...sized("stage"),
      render: (_, d) => {
        const stage = d.stage_id ? stageById.get(d.stage_id) : null;
        return stage ? (
          <TagPill label={stage.name} color={stage.color} />
        ) : (
          <TagPill label="No stage" />
        );
      },
      filters: stages.map((s) => ({ text: s.name, value: s.id })),
      onFilter: (value, d) => d.stage_id === value,
      sorter: (a, b) => stageRank(a.stage_id) - stageRank(b.stage_id),
    },
    {
      ...sized("close_date"),
      sorter: (a, b) =>
        (a.close_date ?? "").localeCompare(b.close_date ?? ""),
      render: (_, d) => <DateCell value={d.close_date} />,
    },
    {
      ...sized("updated_at"),
      sorter: (a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at),
      render: (_, d) => <UpdatedCell value={d.updated_at} />,
    },
  ];

  const columns = layout.arrange(allColumns);
  const scrollX = columns.reduce(
    (sum, c) => sum + (typeof c.width === "number" ? c.width : 0),
    SELECT_WIDTH + (layout.isVisible("name") ? DEAL_MIN_WIDTH : 0),
  );

  return (
    <div style={{ position: "relative" }}>
      <CrmTable<CrmDealWithRefs>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={deals}
        scroll={{ x: scrollX }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys as string[]),
          preserveSelectedRowKeys: true,
        }}
        onRow={(d) => ({ onClick: () => onOpen(d.id) })}
        rowContextMenu={dealMenu}
        locale={{
          // An empty list can mean anything upstream (a team with no projects
          // and no deals, a failed load, the dashboard's status filter), so it
          // gets a neutral line. With deals passed in, only this table's own
          // Status/Stage column filters can empty it — say so then.
          emptyText: loading ? (
            <div style={{ height: 120 }} />
          ) : deals.length === 0 ? (
            <EmptyState compact icon="handshake" title="No deals to show" />
          ) : (
            <EmptyState
              compact
              icon="filter_alt_off"
              title="No deals match the column filters"
              description="Clear the Status or Stage column filter to see them."
            />
          ),
        }}
        pagination={{
          current: safePage,
          pageSize,
          total: deals.length,
          onChange: (p) => setPage(p),
          showSizeChanger: false,
          hideOnSinglePage: false,
        }}
        footer={() => (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 12.5,
              color: token.colorTextSecondary,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              Showing per page
              <Select
                size="small"
                value={pageSize}
                onChange={(v) => {
                  setPageSize(v);
                  setPage(1);
                }}
                options={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: n }))}
                style={{ width: 76 }}
              />
              <span style={{ color: token.colorTextTertiary }}>
                of {deals.length}
              </span>
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              Go to page
              <InputNumber
                size="small"
                min={1}
                max={pageCount}
                value={goTo}
                onChange={setGoTo}
                style={{ width: 68 }}
              />
              <Button
                size="small"
                onClick={() => {
                  if (goTo) setPage(Math.min(Math.max(1, goTo), pageCount));
                }}
              >
                Go
              </Button>
              <Divider type="vertical" style={{ marginInline: 2 }} />
              <ManageColumns layout={layout} size="small" />
            </span>
          </div>
        )}
      />

      <BulkBar count={selected.length} onClear={() => setSelected([])}>
        <Dropdown
          disabled={bulk.busy}
          menu={{
            items: CRM_LEAD_STATUSES.map((s) => ({
              key: s.value,
              label: s.label,
              icon: <MIcon name={leadStatusIcon(s.value)} size={15} />,
            })),
            onClick: ({ key }) =>
              void bulk.run(
                selected,
                `Marked ${crmLeadStatusMeta(key).label.toLowerCase()}`,
                (id) =>
                  updateDeal.mutateAsync({
                    id,
                    patch: { status: key as CrmLeadStatus },
                  }),
              ),
          }}
        >
          <Button size="small" icon={<MIcon name="flag" size={15} />}>
            Set status
          </Button>
        </Dropdown>

        <Dropdown
          disabled={bulk.busy || stages.length === 0}
          menu={{
            items: stages.map((s) => ({ key: s.id, label: s.name })),
            onClick: ({ key }) =>
              void bulk.run(selected, "Moved stage", (id) =>
                updateDeal.mutateAsync({ id, patch: { stage_id: key } }),
              ),
          }}
        >
          <Button size="small" icon={<MIcon name="swap_horiz" size={15} />}>
            Move stage
          </Button>
        </Dropdown>

        {/* Re-file a batch under another project (or none). The rows leave
            this view once they land, which the result message explains. */}
        <BulkMoveToProject
          disabled={bulk.busy}
          onMove={(projectId, name) =>
            void bulk.run(
              selected,
              projectId ? `Moved to ${name}` : "Moved to no project",
              (id) => updateDeal.mutateAsync({ id, patch: { project_id: projectId } }),
            )
          }
        />

        <Popconfirm
          title={`Delete ${selected.length} deal${selected.length === 1 ? "" : "s"}?`}
          description="They move to Deleted and can be restored."
          okText="Delete"
          okButtonProps={{ danger: true }}
          onConfirm={() =>
            void bulk.run(selected, "Deleted", (id) =>
              setDeleted.mutateAsync({ id, deleted: true }),
            )
          }
        >
          <Button size="small" danger icon={<MIcon name="delete" size={15} />}>
            Delete
          </Button>
        </Popconfirm>
      </BulkBar>

      {/* The menu's New task / Add note / Remind me dialogs — outside the
          table, so their events never reach a row. */}
      {recordMenu.dialogs}
    </div>
  );
}

/**
 * A lead's status, editable in place — `LeadStatusPicker`'s behaviour (the
 * value being written shows at once, one write, a toast if it fails, the row
 * click swallowed) drawn as the kit's dotted pill so it reads like the other
 * pills on the row.
 */
function StatusPill({ dealId, status }: { dealId: string; status: string }) {
  const { message } = App.useApp();
  const updateDeal = useUpdateCrmDeal();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<CrmLeadStatus | null>(null);

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

  return (
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
        style={{ display: "inline-flex", maxWidth: "100%", cursor: "pointer" }}
      >
        <TagPill
          tone={current.tone}
          label={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              {current.label}
              {pending ? (
                <Spin size="small" />
              ) : (
                <MIcon name="arrow_drop_down" size={15} style={{ marginRight: -4 }} />
              )}
            </span>
          }
        />
      </span>
    </Dropdown>
  );
}

/**
 * The deal's number as the kit's dial pill, plus the copy button the old
 * `PhoneWithCopy` cell carried — "find the number, call the number" stays one
 * click either way, and neither control opens the row's drawer.
 */
function PhoneCell({ phone }: { phone: string | null }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);

  if (!phone) return <PhoneChip phone={null} />;

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      message.success("Number copied");
    } catch {
      message.error("Couldn't copy the number.");
    }
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      <PhoneChip phone={phone} />
      <Tooltip title={copied ? "Copied" : "Copy number"}>
        <button
          type="button"
          aria-label={`Copy ${phone}`}
          onClick={(e) => void copy(e)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: 3,
            border: "none",
            borderRadius: 5,
            background: "transparent",
            cursor: "pointer",
            color: copied ? token.colorSuccess : token.colorTextTertiary,
            flex: "none",
          }}
        >
          <MIcon name={copied ? "check" : "content_copy"} size={14} />
        </button>
      </Tooltip>
    </span>
  );
}
