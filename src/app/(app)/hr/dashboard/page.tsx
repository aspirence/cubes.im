"use client";

import { useMemo } from "react";
import {
  Alert,
  Card,
  Col,
  Empty,
  List,
  Progress,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
  theme,
} from "antd";
import {
  TeamOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  UserAddOutlined,
  DollarOutlined,
  GiftOutlined,
  TrophyOutlined,
  EnvironmentOutlined,
  ApartmentOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useOrgAnalytics } from "@/features/hr/use-analytics";
import {
  asOrgAnalytics,
  formatCount,
  formatMoney,
  payrollPeriodLabel,
  sharePct,
  toNumber,
  type AnalyticsBirthday,
  type AnalyticsAnniversary,
  type AnalyticsCount,
} from "../_lib/analytics";
import { employmentTypeLabel, statusColor, statusLabel } from "../_lib/labels";

const { Text } = Typography;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Please try again.";
}

/** Formats an upcoming birthday/anniversary "day" or falls back to a date. */
function formatDay(day: string | null | undefined, fallback?: string | null) {
  if (day) {
    const parsed = dayjs(day);
    if (parsed.isValid()) return parsed.format("ddd, MMM D");
    return day;
  }
  if (fallback) {
    const parsed = dayjs(fallback);
    if (parsed.isValid()) return parsed.format("MMM D");
  }
  return "—";
}

export default function HRDashboardPage() {
  const { token } = theme.useToken();
  const { data, isLoading, isError, error } = useOrgAnalytics();

  const analytics = useMemo(() => asOrgAnalytics(data), [data]);

  const headcount = formatCount(
    analytics?.headcount ?? analytics?.total_employees,
  );

  const attendanceRate = toNumber(analytics?.attendance_rate_month);

  const departments = useMemo<AnalyticsCount[]>(() => {
    const list = analytics?.by_department ?? [];
    return [...list].sort(
      (a, b) => formatCount(b.count) - formatCount(a.count),
    );
  }, [analytics]);

  const byStatus = analytics?.by_status ?? [];
  const byType = analytics?.by_type ?? [];
  const byLocation = analytics?.by_location ?? [];
  const birthdays = analytics?.upcoming_birthdays ?? [];
  const anniversaries = analytics?.upcoming_anniversaries ?? [];

  const kpis = [
    {
      title: "Headcount",
      value: headcount,
      icon: <TeamOutlined />,
    },
    {
      title: "Present today",
      value: formatCount(analytics?.present_today),
      icon: <CheckCircleOutlined />,
    },
    {
      title: "Attendance rate (month)",
      value:
        typeof attendanceRate === "number"
          ? Math.round(attendanceRate)
          : null,
      suffix: typeof attendanceRate === "number" ? "%" : undefined,
      icon: <ClockCircleOutlined />,
    },
    {
      title: "Leave pending",
      value: formatCount(analytics?.leave_pending),
      icon: <CalendarOutlined />,
    },
    {
      title: "New joiners (30d)",
      value: formatCount(analytics?.new_joiners_30d),
      icon: <UserAddOutlined />,
    },
    {
      title: "Last payroll net",
      value:
        analytics?.payroll_last?.total_net != null
          ? formatMoney(analytics.payroll_last.total_net)
          : null,
      suffix: payrollPeriodLabel(analytics?.payroll_last) ?? undefined,
      icon: <DollarOutlined />,
    },
  ];

  return (
    <div>
      <h1
        style={{
          fontSize: 21,
          fontWeight: 600,
          letterSpacing: "-.4px",
          color: token.colorText,
          margin: 0,
        }}
      >
        HR dashboard
      </h1>
      <div
        style={{
          fontSize: 13,
          color: token.colorTextSecondary,
          margin: "4px 0 0",
        }}
      >
        A snapshot of your people across the organization.
      </div>

      {isError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="Failed to load HR analytics"
          description={errorMessage(error)}
        />
      ) : (
        <>
          {/* KPI cards */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            {kpis.map((card) => (
              <Col key={card.title} xs={24} sm={12} xl={8}>
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
                      value={card.value ?? "—"}
                      suffix={card.value != null ? card.suffix : undefined}
                      prefix={card.icon}
                    />
                  )}
                </Card>
              </Col>
            ))}
          </Row>

          {/* By department + by status / type */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={12}>
              <Card
                title={
                  <span>
                    <ApartmentOutlined style={{ marginInlineEnd: 8 }} />
                    By department
                  </span>
                }
              >
                {isLoading ? (
                  <Skeleton active />
                ) : departments.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No departments"
                  />
                ) : (
                  <Space
                    direction="vertical"
                    size={12}
                    style={{ width: "100%" }}
                  >
                    {departments.map((d, i) => {
                      const count = formatCount(d.count);
                      const pct = sharePct(count, headcount);
                      return (
                        <div key={d.name ?? `dept-${i}`}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 2,
                            }}
                          >
                            <Text>{d.name || "Unassigned"}</Text>
                            <Text type="secondary">
                              {count} · {pct}%
                            </Text>
                          </div>
                          <Progress percent={pct} showInfo={false} />
                        </div>
                      );
                    })}
                  </Space>
                )}
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Space
                direction="vertical"
                size={16}
                style={{ width: "100%" }}
              >
                <Card
                  title={
                    <span>
                      <TeamOutlined style={{ marginInlineEnd: 8 }} />
                      By status
                    </span>
                  }
                  styles={{ body: { paddingBottom: 8 } }}
                >
                  {isLoading ? (
                    <Skeleton active paragraph={{ rows: 2 }} />
                  ) : byStatus.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="No data"
                    />
                  ) : (
                    <Space size={[8, 8]} wrap>
                      {byStatus.map((s, i) => (
                        <Tag
                          key={s.status ?? `status-${i}`}
                          color={statusColor(s.status)}
                          style={{ fontSize: 13, padding: "2px 8px" }}
                        >
                          {statusLabel(s.status)}: {formatCount(s.count)}
                        </Tag>
                      ))}
                    </Space>
                  )}
                </Card>

                <Card
                  title={
                    <span>
                      <ApartmentOutlined style={{ marginInlineEnd: 8 }} />
                      By employment type
                    </span>
                  }
                  styles={{ body: { paddingBottom: 8 } }}
                >
                  {isLoading ? (
                    <Skeleton active paragraph={{ rows: 2 }} />
                  ) : byType.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="No data"
                    />
                  ) : (
                    <Space size={[8, 8]} wrap>
                      {byType.map((t, i) => (
                        <Tag
                          key={t.type ?? `type-${i}`}
                          style={{ fontSize: 13, padding: "2px 8px" }}
                        >
                          {employmentTypeLabel(t.type)}: {formatCount(t.count)}
                        </Tag>
                      ))}
                    </Space>
                  )}
                </Card>
              </Space>
            </Col>
          </Row>

          {/* By location + birthdays + anniversaries */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={8}>
              <Card
                title={
                  <span>
                    <EnvironmentOutlined style={{ marginInlineEnd: 8 }} />
                    By location
                  </span>
                }
              >
                {isLoading ? (
                  <Skeleton active />
                ) : byLocation.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No locations"
                  />
                ) : (
                  <List
                    size="small"
                    dataSource={byLocation}
                    renderItem={(l, i) => (
                      <List.Item key={l.location ?? `loc-${i}`}>
                        <Text>{l.location || "Unspecified"}</Text>
                        <Text type="secondary">{formatCount(l.count)}</Text>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>

            <Col xs={24} lg={8}>
              <Card
                title={
                  <span>
                    <GiftOutlined style={{ marginInlineEnd: 8 }} />
                    Upcoming birthdays
                  </span>
                }
              >
                {isLoading ? (
                  <Skeleton active />
                ) : birthdays.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="None coming up"
                  />
                ) : (
                  <List
                    size="small"
                    dataSource={birthdays}
                    renderItem={(b: AnalyticsBirthday, i) => (
                      <List.Item key={`${b.full_name ?? "bd"}-${i}`}>
                        <List.Item.Meta
                          title={b.full_name || "—"}
                          description={formatDay(b.day, b.date_of_birth)}
                        />
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>

            <Col xs={24} lg={8}>
              <Card
                title={
                  <span>
                    <TrophyOutlined style={{ marginInlineEnd: 8 }} />
                    Work anniversaries
                  </span>
                }
              >
                {isLoading ? (
                  <Skeleton active />
                ) : anniversaries.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="None coming up"
                  />
                ) : (
                  <List
                    size="small"
                    dataSource={anniversaries}
                    renderItem={(a: AnalyticsAnniversary, i) => {
                      const years = formatCount(a.years);
                      return (
                        <List.Item key={`${a.full_name ?? "ann"}-${i}`}>
                          <List.Item.Meta
                            title={a.full_name || "—"}
                            description={
                              <span>
                                {years > 0
                                  ? `${years} year${years === 1 ? "" : "s"} · `
                                  : ""}
                                {formatDay(a.day, a.date_of_joining)}
                              </span>
                            }
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
