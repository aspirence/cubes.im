"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Dropdown,
  InputNumber,
  Popconfirm,
  Select,
  Table,
  theme,
} from "antd";
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
import { MIcon } from "./m-icon";
import { DealCell } from "./deal-glyph";
import { LeadStatusPicker } from "./lead-status-picker";
import { PhoneWithCopy } from "./phone-cell";
import { leadStatusIcon } from "./entity-meta";
import { BulkBar, useBulkRun } from "./bulk-bar";
import { EntityAvatar, SoftChip, crmDate, crmPersonName } from "../_lib/ui";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * The lead desk: every deal in one dense table, selectable in bulk.
 *
 * Working a lead list is repetitive — twenty rows all need the same status, or
 * the same five are junk. Doing that one drawer at a time is the whole cost of
 * the job, so selection + a bulk bar is the point of this table, not a
 * decoration on it.
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
  const updateDeal = useUpdateCrmDeal();
  const setDeleted = useSetCrmDealDeleted();

  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [goTo, setGoTo] = useState<number | null>(null);
  const bulk = useBulkRun(() => setSelected([]));

  const stageById = useMemo(() => {
    const map = new Map<string, CrmStage>();
    for (const s of stages) map.set(s.id, s);
    return map;
  }, [stages]);

  const pageCount = Math.max(1, Math.ceil(deals.length / pageSize));
  const safePage = Math.min(page, pageCount);

  const columns: ColumnsType<CrmDealWithRefs> = [
    {
      title: "Deal",
      key: "name",
      render: (_, d) => (
        <DealCell
          name={d.name}
          subtitle={d.campaign_id ? undefined : d.company?.name}
        />
      ),
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "Company",
      key: "company",
      width: 170,
      render: (_, d) =>
        d.company ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <EntityAvatar name={d.company.name} kind="company" size={22} />
            <span
              style={{
                color: token.colorTextSecondary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {d.company.name}
            </span>
          </span>
        ) : (
          <span style={{ color: token.colorTextQuaternary }}>—</span>
        ),
    },
    {
      title: "Contact",
      key: "contact",
      width: 190,
      render: (_, d) => {
        const name = crmPersonName(d.contact);
        return (
          <div style={{ minWidth: 0 }}>
            {name ? (
              <div
                style={{
                  color: token.colorTextSecondary,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </div>
            ) : null}
            {d.phone ? <PhoneWithCopy phone={d.phone} size={12} /> : null}
            {!name && !d.phone ? (
              <span style={{ color: token.colorTextQuaternary }}>—</span>
            ) : null}
          </div>
        );
      },
    },
    {
      title: "Status",
      key: "status",
      width: 165,
      render: (_, d) => <LeadStatusPicker dealId={d.id} status={d.status} />,
      filters: CRM_LEAD_STATUSES.map((s) => ({ text: s.label, value: s.value })),
      onFilter: (value, d) => crmLeadStatusMeta(d.status).value === value,
    },
    {
      title: "Stage",
      key: "stage",
      width: 140,
      render: (_, d) => {
        const stage = d.stage_id ? stageById.get(d.stage_id) : null;
        return stage ? (
          <SoftChip tone="custom" color={stage.color}>
            {stage.name}
          </SoftChip>
        ) : (
          <SoftChip>No stage</SoftChip>
        );
      },
      filters: stages.map((s) => ({ text: s.name, value: s.id })),
      onFilter: (value, d) => d.stage_id === value,
    },
    {
      title: "Close date",
      key: "close_date",
      width: 130,
      sorter: (a, b) =>
        (a.close_date ?? "").localeCompare(b.close_date ?? ""),
      render: (_, d) =>
        d.close_date ? (
          <span className="font-mono" style={{ color: token.colorTextSecondary }}>
            {crmDate(d.close_date)}
          </span>
        ) : (
          <span style={{ color: token.colorTextQuaternary }}>—</span>
        ),
    },
  ];

  return (
    <div style={{ position: "relative" }}>
      <Table<CrmDealWithRefs>
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={deals}
        scroll={{ x: 1000 }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => setSelected(keys as string[]),
          preserveSelectedRowKeys: true,
        }}
        onRow={(d) => ({
          onClick: () => onOpen(d.id),
          style: { cursor: "pointer" },
        })}
        pagination={{
          current: safePage,
          pageSize,
          total: deals.length,
          onChange: (p) => setPage(p),
          showSizeChanger: false,
          hideOnSinglePage: false,
          style: { padding: "0 16px", marginBottom: 0 },
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
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
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
    </div>
  );
}
