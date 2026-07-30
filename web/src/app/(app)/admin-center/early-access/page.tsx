"use client";

import { Card, Result, Skeleton, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useIsPlatformAdmin } from "@/features/billing/use-pricing";

const { Title, Text } = Typography;

type Row = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  team_size: string | null;
  note: string | null;
  payment_status: string;
  amount_cents: number;
  paid_at: string | null;
  created_at: string;
};

function useEarlyAccessRequests(enabled: boolean) {
  return useQuery({
    queryKey: ["early-access-requests"],
    enabled,
    queryFn: async (): Promise<Row[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("early_access_requests")
        .select(
          "id,name,email,company,team_size,note,payment_status,amount_cents,paid_at,created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
}

export default function EarlyAccessAdminPage() {
  const { data: isAdmin, isLoading: adminLoading } = useIsPlatformAdmin();
  const { data: rows, isLoading } = useEarlyAccessRequests(!!isAdmin);

  if (adminLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (!isAdmin) {
    return (
      <Result
        status="403"
        title="Super-admins only"
        subTitle="You need to be a platform super-admin to view this page."
      />
    );
  }

  const paidCount = (rows ?? []).filter((r) => r.payment_status === "paid").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>
          Early access requests
        </Title>
        <Text type="secondary">
          {rows ? `${rows.length} total · ${paidCount} paid` : "AT-Cubes v0.1 device orders"}
        </Text>
      </div>
      <Card styles={{ body: { padding: 0 } }}>
        <Table<Row>
          rowKey="id"
          loading={isLoading}
          dataSource={rows ?? []}
          size="middle"
          scroll={{ x: "max-content" }}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          columns={[
            {
              title: "Requested",
              dataIndex: "created_at",
              render: (v: string) => new Date(v).toLocaleString(),
            },
            { title: "Name", dataIndex: "name" },
            { title: "Email", dataIndex: "email" },
            { title: "Company", dataIndex: "company", render: (v: string | null) => v || "—" },
            { title: "Team", dataIndex: "team_size", render: (v: string | null) => v || "—" },
            {
              title: "Payment",
              dataIndex: "payment_status",
              render: (v: string, r: Row) => (
                <Tag color={v === "paid" ? "green" : v === "failed" ? "red" : "default"}>
                  {v === "paid" ? `Paid · $${(r.amount_cents / 100).toFixed(0)}` : v}
                </Tag>
              ),
            },
            {
              title: "Note",
              dataIndex: "note",
              ellipsis: true,
              render: (v: string | null) => v || "—",
            },
          ]}
        />
      </Card>
    </div>
  );
}
