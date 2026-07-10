"use client";

import { Card, Col, Row, Skeleton, Space, Statistic, Tag, Typography } from "antd";
import {
  TeamOutlined,
  UserOutlined,
  ProjectOutlined,
  UnorderedListOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import { useAdminOverview } from "@/features/admin/use-admin";
import { AdminError, isForbiddenError } from "../_components/admin-error";

export default function AdminOverviewPage() {
  const { data, isLoading, isError, error } = useAdminOverview();

  const cards = [
    {
      title: "Workspaces",
      value: data?.total_teams ?? 0,
      icon: <TeamOutlined />,
    },
    {
      title: "Members",
      value: data?.total_members ?? 0,
      icon: <UserOutlined />,
    },
    {
      title: "Projects",
      value: data?.total_projects ?? 0,
      icon: <ProjectOutlined />,
    },
    {
      title: "Tasks",
      value: data?.total_tasks ?? 0,
      icon: <UnorderedListOutlined />,
    },
    {
      title: "Completed tasks",
      value: data?.completed_tasks ?? 0,
      icon: <CheckCircleOutlined />,
    },
  ];

  const showForbidden = isError && isForbiddenError(error);

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {data?.org_name ?? "Organization overview"}
      </Typography.Title>
      <Typography.Text type="secondary">
        A snapshot of teams, members and work across your organization.
      </Typography.Text>

      {isError ? (
        <div style={{ marginTop: 16 }}>
          <AdminError error={error} title="Failed to load overview" />
        </div>
      ) : (
        <>
          {!showForbidden ? (
            <div style={{ marginTop: 16 }}>
              {isLoading ? (
                <Skeleton.Button active size="small" style={{ width: 220 }} />
              ) : (
                <Space size={8} wrap>
                  <SubscriptionTag status={data?.subscription_status} />
                  {data?.trial_in_progress ? (
                    <Tag color="gold">Trial in progress</Tag>
                  ) : null}
                </Space>
              )}
            </div>
          ) : null}

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            {cards.map((card) => (
              <Col key={card.title} xs={24} sm={12} md={8} xl={6}>
                <Card>
                  {isLoading ? (
                    <Skeleton
                      active
                      paragraph={false}
                      title={{ width: "60%" }}
                    />
                  ) : (
                    <Statistic
                      title={card.title}
                      value={card.value}
                      prefix={card.icon}
                    />
                  )}
                </Card>
              </Col>
            ))}
          </Row>
        </>
      )}
    </div>
  );
}

function SubscriptionTag({ status }: { status?: string }) {
  if (!status) return null;
  const normalized = status.toLowerCase();
  const color =
    normalized === "active" || normalized === "paid"
      ? "green"
      : normalized === "trialing" || normalized === "trial"
        ? "gold"
        : normalized === "cancelled" ||
            normalized === "canceled" ||
            normalized === "past_due"
          ? "red"
          : "default";
  return <Tag color={color}>{status}</Tag>;
}
