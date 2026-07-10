"use client";

import { useMemo } from "react";
import {
  Alert,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ApartmentOutlined,
  TeamOutlined,
  EnvironmentOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  DollarOutlined,
} from "@ant-design/icons";
import { useOrgAnalytics } from "@/features/hr/use-analytics";
import { useHrEmployees } from "@/features/hr/use-hr";
import {
  asOrgAnalytics,
  formatCount,
  formatMoney,
  payrollPeriodLabel,
  sharePct,
  toNumber,
} from "../_lib/analytics";
import { employmentTypeLabel, statusColor, statusLabel } from "../_lib/labels";

const { Text, Title } = Typography;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again.";
}

/** A normalized breakdown row: a label, a count, and a % of headcount. */
interface BreakdownRow {
  key: string;
  label: string;
  count: number;
  pct: number;
}

/** Renders a count/% breakdown Table with a footer total. */
function BreakdownTable({
  rows,
  labelTitle,
  total,
  loading,
  renderLabel,
}: {
  rows: BreakdownRow[];
  labelTitle: string;
  total: number;
  loading: boolean;
  renderLabel?: (row: BreakdownRow) => React.ReactNode;
}) {
  const columns: ColumnsType<BreakdownRow> = [
    {
      title: labelTitle,
      dataIndex: "label",
      key: "label",
      render: (_, row) => (renderLabel ? renderLabel(row) : row.label),
    },
    {
      title: "Count",
      dataIndex: "count",
      key: "count",
      width: 100,
      align: "right",
      sorter: (a, b) => a.count - b.count,
      defaultSortOrder: "descend",
    },
    {
      title: "Share",
      key: "pct",
      width: 200,
      render: (_, row) => (
        <Space style={{ width: "100%" }}>
          <Progress
            percent={row.pct}
            size="small"
            style={{ width: 120, margin: 0 }}
          />
          <Text type="secondary">{row.pct}%</Text>
        </Space>
      ),
    },
  ];

  return (
    <Table<BreakdownRow>
      rowKey="key"
      size="small"
      loading={loading}
      columns={columns}
      dataSource={rows}
      pagination={false}
      locale={{ emptyText: <Empty description="No data" /> }}
      summary={() =>
        rows.length > 0 ? (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}>
              <Text strong>Total</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <Text strong>{total}</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2}>
              <Text type="secondary">100%</Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        ) : null
      }
    />
  );
}

/* ========================================================================== */
/* Headcount tab                                                               */
/* ========================================================================== */

function HeadcountTab({
  loading,
  headcount,
  byDepartment,
  byStatus,
  byType,
  byLocation,
}: {
  loading: boolean;
  headcount: number;
  byDepartment: BreakdownRow[];
  byStatus: BreakdownRow[];
  byType: BreakdownRow[];
  byLocation: BreakdownRow[];
}) {
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                <ApartmentOutlined style={{ marginInlineEnd: 8 }} />
                By department
              </span>
            }
          >
            <BreakdownTable
              rows={byDepartment}
              labelTitle="Department"
              total={headcount}
              loading={loading}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                <TeamOutlined style={{ marginInlineEnd: 8 }} />
                By status
              </span>
            }
          >
            <BreakdownTable
              rows={byStatus}
              labelTitle="Status"
              total={headcount}
              loading={loading}
              renderLabel={(row) => (
                <Tag color={statusColor(row.key)}>{row.label}</Tag>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                <ApartmentOutlined style={{ marginInlineEnd: 8 }} />
                By employment type
              </span>
            }
          >
            <BreakdownTable
              rows={byType}
              labelTitle="Type"
              total={headcount}
              loading={loading}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span>
                <EnvironmentOutlined style={{ marginInlineEnd: 8 }} />
                By location
              </span>
            }
          >
            <BreakdownTable
              rows={byLocation}
              labelTitle="Location"
              total={headcount}
              loading={loading}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

/* ========================================================================== */
/* Page                                                                        */
/* ========================================================================== */

export default function HrReportsPage() {
  const {
    data,
    isLoading: analyticsLoading,
    isError,
    error,
  } = useOrgAnalytics();
  const { data: employees, isLoading: employeesLoading } = useHrEmployees();

  const analytics = useMemo(() => asOrgAnalytics(data), [data]);
  const loading = analyticsLoading || employeesLoading;

  // Prefer the RPC headcount; fall back to the employee directory length.
  const headcount =
    formatCount(analytics?.headcount ?? analytics?.total_employees) ||
    (employees?.length ?? 0);

  const byDepartment = useMemo<BreakdownRow[]>(() => {
    const list = analytics?.by_department ?? [];
    return list
      .map((d, i) => {
        const count = formatCount(d.count);
        return {
          key: d.name ?? `dept-${i}`,
          label: d.name || "Unassigned",
          count,
          pct: sharePct(count, headcount),
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [analytics, headcount]);

  const byStatus = useMemo<BreakdownRow[]>(() => {
    const list = analytics?.by_status ?? [];
    return list
      .map((s, i) => {
        const count = formatCount(s.count);
        return {
          key: s.status ?? `status-${i}`,
          label: statusLabel(s.status),
          count,
          pct: sharePct(count, headcount),
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [analytics, headcount]);

  const byType = useMemo<BreakdownRow[]>(() => {
    const list = analytics?.by_type ?? [];
    return list
      .map((t, i) => {
        const count = formatCount(t.count);
        return {
          key: t.type ?? `type-${i}`,
          label: employmentTypeLabel(t.type),
          count,
          pct: sharePct(count, headcount),
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [analytics, headcount]);

  const byLocation = useMemo<BreakdownRow[]>(() => {
    const list = analytics?.by_location ?? [];
    return list
      .map((l, i) => {
        const count = formatCount(l.count);
        return {
          key: l.location ?? `loc-${i}`,
          label: l.location || "Unspecified",
          count,
          pct: sharePct(count, headcount),
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [analytics, headcount]);

  const attendanceRate = toNumber(analytics?.attendance_rate_month);
  const payroll = analytics?.payroll_last;

  const items = [
    {
      key: "headcount",
      label: "Headcount",
      children: (
        <HeadcountTab
          loading={loading}
          headcount={headcount}
          byDepartment={byDepartment}
          byStatus={byStatus}
          byType={byType}
          byLocation={byLocation}
        />
      ),
    },
    {
      key: "attendance",
      label: "Attendance",
      children: (
        <Card>
          {loading ? (
            <Skeleton active />
          ) : (
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={8}>
                <Statistic
                  title="Present today"
                  value={formatCount(analytics?.present_today)}
                  prefix={<CheckPrefix />}
                />
              </Col>
              <Col xs={24} sm={8}>
                <Statistic
                  title="Attendance rate (month)"
                  value={
                    typeof attendanceRate === "number"
                      ? Math.round(attendanceRate)
                      : "—"
                  }
                  suffix={typeof attendanceRate === "number" ? "%" : undefined}
                  prefix={<ClockCircleOutlined />}
                />
                {typeof attendanceRate === "number" ? (
                  <Progress
                    percent={Math.round(attendanceRate)}
                    style={{ marginTop: 8, maxWidth: 240 }}
                  />
                ) : null}
              </Col>
              <Col xs={24} sm={8}>
                <Statistic
                  title="Headcount"
                  value={headcount}
                  prefix={<TeamOutlined />}
                />
              </Col>
            </Row>
          )}
        </Card>
      ),
    },
    {
      key: "leave",
      label: "Leave",
      children: (
        <Card>
          {loading ? (
            <Skeleton active />
          ) : (
            <Statistic
              title="Pending leave requests"
              value={formatCount(analytics?.leave_pending)}
              prefix={<CalendarOutlined />}
            />
          )}
        </Card>
      ),
    },
    {
      key: "payroll",
      label: "Payroll",
      children: (
        <Card
          title={
            <span>
              <DollarOutlined style={{ marginInlineEnd: 8 }} />
              Last payroll run
            </span>
          }
        >
          {loading ? (
            <Skeleton active />
          ) : !payroll ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No payroll runs yet"
            />
          ) : (
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} md={6}>
                <Statistic
                  title="Period"
                  value={payrollPeriodLabel(payroll) ?? "—"}
                />
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Statistic
                  title="Total net cost"
                  value={formatMoney(payroll.total_net)}
                />
              </Col>
              <Col xs={24} sm={12} md={6}>
                <Statistic
                  title="Employees paid"
                  value={formatCount(payroll.employee_count)}
                />
              </Col>
              <Col xs={24} sm={12} md={6}>
                <div>
                  <Text
                    type="secondary"
                    style={{ display: "block", marginBottom: 4 }}
                  >
                    Status
                  </Text>
                  {payroll.status ? (
                    <Tag color="blue">{payroll.status.toUpperCase()}</Tag>
                  ) : (
                    <Text type="secondary">—</Text>
                  )}
                </div>
              </Col>
            </Row>
          )}
        </Card>
      ),
    },
  ];

  return (
    <Card>
      <Title level={4} style={{ marginTop: 0 }}>
        HR reports
      </Title>
      <Text type="secondary">
        Read-only headcount, attendance, leave and payroll breakdowns for the
        organization.
      </Text>

      {isError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="Failed to load HR reports"
          description={errorMessage(error)}
        />
      ) : (
        <Tabs defaultActiveKey="headcount" items={items} style={{ marginTop: 8 }} />
      )}
    </Card>
  );
}

/** A green check prefix for the "present today" statistic. */
function CheckPrefix() {
  return <TeamOutlined style={{ color: "#52c41a" }} />;
}
