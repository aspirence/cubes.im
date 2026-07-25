"use client";

import { useMemo, useState } from "react";
import { Table, Tag, Tooltip, Empty, Spin, Button, theme } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  usePlatformAnalytics,
  money,
  type OwnerRow,
} from "@/features/platform/use-platform-analytics";
import { OwnerDetailDrawer } from "@/features/platform/owner-detail-drawer";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
};
const relDays = (iso: string | null | undefined) => {
  if (!iso) return "";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
};

type Tone = "brand" | "success" | "warning" | "error" | "default";

function StatTile({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  tone?: Tone;
}) {
  const { token } = theme.useToken();
  const accent =
    tone === "success"
      ? token.colorSuccess
      : tone === "warning"
        ? token.colorWarning
        : tone === "error"
          ? token.colorError
          : tone === "brand"
            ? token.colorPrimary
            : token.colorTextSecondary;
  const chipBg =
    tone === "success"
      ? token.colorSuccessBg
      : tone === "warning"
        ? token.colorWarningBg
        : tone === "error"
          ? token.colorErrorBg
          : tone === "brand"
            ? token.colorPrimaryBg
            : token.colorFillTertiary;
  return (
    <div
      style={{
        flex: "1 1 150px",
        minWidth: 150,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "13px 15px",
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          background: chipBg,
          color: accent,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MIcon name={icon} size={18} />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.15 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: token.colorText, letterSpacing: "-.3px" }}>
          {value}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: token.colorTextTertiary }}>{label}</span>
        {sub ? <span style={{ fontSize: 11, color: token.colorTextQuaternary, marginTop: 2 }}>{sub}</span> : null}
      </div>
    </div>
  );
}

function Panel({
  title,
  icon,
  children,
  note,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  note?: string;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        flex: "1 1 320px",
        minWidth: 300,
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 14px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <MIcon name={icon} size={17} color={token.colorTextSecondary} />
        <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{title}</span>
        {note ? (
          <span style={{ marginLeft: "auto", fontSize: 11, color: token.colorTextQuaternary }}>{note}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function PlatformDashboard({ enabled = true }: { enabled?: boolean }) {
  const { token } = theme.useToken();
  const { data, isLoading, isError, error, refetch, isFetching } = usePlatformAnalytics(enabled);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const ownerColumns: ColumnsType<OwnerRow> = useMemo(
    () => [
      {
        title: "Workspace",
        dataIndex: "workspace",
        key: "workspace",
        fixed: "left",
        render: (v: string, r) => (
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
            <span style={{ fontWeight: 600, color: token.colorText }}>{v}</span>
            <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
              {r.ownerName ? `${r.ownerName} · ` : ""}
              {r.ownerEmail}
            </span>
          </div>
        ),
      },
      {
        title: "Registered",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 130,
        sorter: (a, b) => (a.createdAt ? new Date(a.createdAt).getTime() : 0) - (b.createdAt ? new Date(b.createdAt).getTime() : 0),
        render: (v: string | null) => (
          <Tooltip title={relDays(v)}>
            <span style={{ color: token.colorTextSecondary }}>{fmtDate(v)}</span>
          </Tooltip>
        ),
      },
      {
        title: "Workspaces",
        dataIndex: "workspaces",
        key: "workspaces",
        width: 108,
        align: "right",
        sorter: (a, b) => a.workspaces - b.workspaces,
      },
      {
        title: "Members",
        dataIndex: "members",
        key: "members",
        width: 100,
        align: "right",
        sorter: (a, b) => a.members - b.members,
        render: (v: number, r) => (
          <span>
            {v}
            {r.guests ? <span style={{ color: token.colorTextQuaternary }}> +{r.guests}g</span> : null}
          </span>
        ),
      },
      { title: "Spaces", dataIndex: "spaces", key: "spaces", width: 90, align: "right", sorter: (a, b) => a.spaces - b.spaces },
      { title: "Projects", dataIndex: "projects", key: "projects", width: 92, align: "right", sorter: (a, b) => a.projects - b.projects },
      {
        title: "Plan",
        dataIndex: "plan",
        key: "plan",
        width: 92,
        filters: [
          { text: "Cloud", value: "cloud" },
          { text: "Free", value: "free" },
        ],
        onFilter: (val, r) => r.plan === val,
        render: (v: string) =>
          v === "cloud" ? <Tag color="green">Cloud</Tag> : <Tag>Free</Tag>,
      },
      {
        title: "Est. / mo",
        dataIndex: "estMonthlyCents",
        key: "estMonthlyCents",
        width: 110,
        align: "right",
        sorter: (a, b) => a.estMonthlyCents - b.estMonthlyCents,
        render: (v: number, r) =>
          r.plan === "cloud" ? (
            <span style={{ fontWeight: 600, color: token.colorText }}>{money(v, data?.currency)}</span>
          ) : (
            <span style={{ color: token.colorTextQuaternary }}>—</span>
          ),
      },
      {
        title: "Renews",
        dataIndex: "nextRenewal",
        key: "nextRenewal",
        width: 120,
        render: (v: string | null) =>
          v ? <span style={{ color: token.colorTextSecondary }}>{fmtDate(v)}</span> : <span style={{ color: token.colorTextQuaternary }}>—</span>,
      },
      {
        title: "",
        key: "chevron",
        width: 34,
        align: "center",
        render: () => <MIcon name="chevron_right" size={18} color={token.colorTextQuaternary} />,
      },
    ],
    [token, data?.currency],
  );

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
        <Spin />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div
        style={{
          padding: "28px 20px",
          textAlign: "center",
          borderRadius: 12,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
        }}
      >
        <MIcon name="error" size={26} color={token.colorTextQuaternary} />
        <div style={{ marginTop: 6, fontSize: 13, color: token.colorTextSecondary }}>
          {(error as Error)?.message || "Couldn't load platform analytics."}
        </div>
        <Button size="small" style={{ marginTop: 12 }} onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const t = data.totals;
  const r = data.revenue;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <MIcon name="corporate_fare" size={20} color={token.colorPrimary} />
            <span style={{ fontSize: 16, fontWeight: 700, color: token.colorText }}>Company overview</span>
          </div>
          <div style={{ fontSize: 12.5, color: token.colorTextTertiary, marginTop: 2 }}>
            Everything across Cubes — {t.owners} owners · {t.workspaces} workspaces · {t.users} users
          </div>
        </div>
        <Button
          size="small"
          icon={<MIcon name="refresh" size={15} />}
          loading={isFetching}
          onClick={() => refetch()}
        >
          Refresh
        </Button>
      </div>

      {/* Headline tiles */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <StatTile icon="person" label="Owners" value={t.owners} tone="brand" sub={`${t.users} total users`} />
        <StatTile icon="workspaces" label="Workspaces" value={t.workspaces} sub={`${t.spaces} spaces`} />
        <StatTile icon="group" label="Members" value={t.members} sub={t.guests ? `${t.guests} guests` : undefined} />
        <StatTile icon="folder" label="Projects" value={t.projects} />
        <StatTile icon="trending_up" label="New signups" value={t.signups7d} tone="success" sub={`${t.signups30d} in 30d`} />
        <StatTile icon="workspace_premium" label="Paid workspaces" value={t.paidWorkspaces} tone="warning" sub={`${t.freeWorkspaces} free`} />
      </div>

      {/* Revenue */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
          <MIcon name="payments" size={17} color={token.colorTextSecondary} />
          <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>Revenue</span>
          <Tooltip title="Subscription charges are billed through Dodo and aren't stored locally, so MRR and next-month figures are estimates from the app's pricing (base + seats + storage). 'Collected' is realized device pre-orders recorded in the database.">
            <span style={{ display: "inline-flex" }}>
              <MIcon name="info" size={15} color={token.colorTextQuaternary} />
            </span>
          </Tooltip>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatTile icon="autorenew" label="Est. MRR" value={money(r.estMrrCents, data.currency)} tone="success" sub="recurring, estimated" />
          <StatTile icon="event_upcoming" label="Next month (proj.)" value={money(r.nextMonthCents, data.currency)} tone="brand" />
          <StatTile icon="account_balance_wallet" label="Collected" value={money(r.deviceCollectedCents, data.currency)} sub={`${r.deviceOrders} device orders`} />
          <StatTile
            icon="donut_small"
            label="Subscriptions"
            value={data.statusBreakdown.cloud}
            tone="warning"
            sub={`${data.statusBreakdown.active} active · ${data.statusBreakdown.canceled} canceled`}
          />
        </div>
      </div>

      {/* Owner analytics table — click a row to drill into one owner */}
      <Panel title="Owners & workspaces" icon="table_rows" note="click a row for full details">
        <Table<OwnerRow>
          rowKey="orgId"
          size="small"
          columns={ownerColumns}
          dataSource={data.owners}
          pagination={data.owners.length > 12 ? { pageSize: 12, size: "small" } : false}
          scroll={{ x: 940 }}
          onRow={(record) => ({
            onClick: () => setSelectedOrgId(record.orgId),
            style: { cursor: "pointer" },
          })}
          locale={{ emptyText: <Empty description="No workspaces yet" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Panel>
      <OwnerDetailDrawer orgId={selectedOrgId} onClose={() => setSelectedOrgId(null)} />

      {/* Recent activity */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Panel title="Recent signups" icon="person_add">
          {data.recentSignups.length === 0 ? (
            <div style={{ padding: 20 }}>
              <Empty description="No signups" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <div>
              {data.recentSignups.map((s, i) => (
                <div
                  key={`${s.email}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 14px",
                    borderTop: i === 0 ? "none" : `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: token.colorFillTertiary,
                      color: token.colorTextSecondary,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 600,
                      flex: "none",
                    }}
                  >
                    {(s.name || s.email || "?").charAt(0).toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: token.colorText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.name || s.email}
                    </div>
                    {s.name ? (
                      <div style={{ fontSize: 11, color: token.colorTextTertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.email}
                      </div>
                    ) : null}
                  </div>
                  <span style={{ fontSize: 11, color: token.colorTextQuaternary, flex: "none" }}>{relDays(s.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent payments" icon="receipt_long" note="device orders">
          {data.recentPayments.length === 0 ? (
            <div style={{ padding: 20 }}>
              <Empty description="No payments recorded" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <div>
              {data.recentPayments.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 14px",
                    borderTop: i === 0 ? "none" : `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: token.colorSuccessBg,
                      color: token.colorSuccess,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                    }}
                  >
                    <MIcon name="check" size={16} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: token.colorText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.who}
                    </div>
                    <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{fmtDate(p.paidAt)}</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: token.colorText, flex: "none" }}>
                    {money(p.amountCents, data.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div style={{ fontSize: 11, color: token.colorTextQuaternary, textAlign: "right" }}>
        Updated {relDays(data.generatedAt)} · estimates exclude live Dodo balances
      </div>
    </div>
  );
}
