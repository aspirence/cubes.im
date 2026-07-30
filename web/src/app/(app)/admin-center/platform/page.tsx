"use client";

import { Card, Result, Skeleton, Table, Tag, Typography, theme } from "antd";
import dayjs from "dayjs";
import { useIsPlatformAdmin } from "@/features/billing/use-pricing";
import { usePlatformOverview, type PlatformOrg } from "@/features/platform/use-platform";

const { Title, Text } = Typography;

function MIcon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: string;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: string;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          background: token.colorPrimaryBg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MIcon name={icon} size={19} color={tone ?? "#4a4ad0"} />
      </span>
      <div>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", color: token.colorText, lineHeight: 1.1 }}>
          {value}
        </div>
        <div style={{ fontSize: 12.5, color: token.colorTextTertiary, marginTop: 2 }}>
          {label}
          {sub ? <span style={{ color: token.colorTextQuaternary }}> · {sub}</span> : null}
        </div>
      </div>
    </div>
  );
}

export default function PlatformConsolePage() {
  const { token } = theme.useToken();
  const { data: isAdmin, isLoading: adminLoading } = useIsPlatformAdmin();
  const { data, isLoading } = usePlatformOverview(Boolean(isAdmin));

  if (adminLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (!isAdmin) {
    return (
      <Result
        status="403"
        title="Superadmins only"
        subTitle="This platform console is for Cubes platform administrators."
      />
    );
  }

  const nf = (n: number | undefined) => (n ?? 0).toLocaleString();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>Platform</Title>
        <Text type="secondary">Global analytics across every organization on Cubes.</Text>
      </div>

      {isLoading || !data ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <>
          {/* Headline stats */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 12,
            }}
          >
            <Stat icon="apartment" label="Organizations" value={nf(data.orgs)} />
            <Stat icon="group" label="Users" value={nf(data.users)} sub={`+${nf(data.signups_7d)} this week`} tone="#3a9d6e" />
            <Stat icon="workspaces" label="Workspaces" value={nf(data.workspaces)} />
            <Stat icon="layers" label="Projects" value={nf(data.projects)} />
            <Stat icon="check_circle" label="Tasks" value={nf(data.tasks)} />
            <Stat icon="handshake" label="Guests" value={nf(data.guests)} sub={`${nf(data.members)} members`} tone="#8a8d98" />
          </div>

          {/* Plan + growth row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <Card styles={{ body: { padding: "14px 18px" } }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>Plans</Text>
              <div style={{ display: "flex", gap: 20, marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: token.colorText }}>{nf(data.plan_cloud)}</div>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary }}>Paid workspaces</div>
                </div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: token.colorTextSecondary }}>{nf(data.plan_free)}</div>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary }}>Free workspaces</div>
                </div>
              </div>
            </Card>
            <Card styles={{ body: { padding: "14px 18px" } }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>Signups</Text>
              <div style={{ display: "flex", gap: 20, marginTop: 8 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: token.colorText }}>{nf(data.signups_7d)}</div>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary }}>Last 7 days</div>
                </div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: token.colorText }}>{nf(data.signups_30d)}</div>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary }}>Last 30 days</div>
                </div>
              </div>
            </Card>
            <Card styles={{ body: { padding: "14px 18px" } }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>Platform admins</Text>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: token.colorText }}>{nf(data.superadmins)}</div>
                <div style={{ fontSize: 12, color: token.colorTextTertiary }}>Superadmins</div>
              </div>
            </Card>
          </div>

          {/* Recent organizations */}
          <Card
            title="Recent organizations"
            styles={{ body: { padding: 0 }, header: { border: "none" } }}
          >
            <Table<PlatformOrg>
              rowKey={(r) => r.owner_email + r.created_at}
              size="middle"
              dataSource={data.recent_orgs}
              pagination={false}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "Organization", dataIndex: "name", render: (v) => <Text strong>{v || "—"}</Text> },
                { title: "Owner", dataIndex: "owner_email" },
                { title: "Workspaces", dataIndex: "workspaces", align: "right", width: 110 },
                { title: "Members", dataIndex: "members", align: "right", width: 100 },
                {
                  title: "Status",
                  dataIndex: "status",
                  width: 120,
                  render: (s: string) => (
                    <Tag color={s === "active" ? "green" : s === "trialing" ? "blue" : "default"}>{s}</Tag>
                  ),
                },
                {
                  title: "Created",
                  dataIndex: "created_at",
                  width: 130,
                  render: (v: string) => (v ? dayjs(v).format("MMM D, YYYY") : "—"),
                },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
