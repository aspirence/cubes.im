"use client";

import { useMemo } from "react";
import { Alert, Col, Empty, Row, Skeleton, Tooltip, Typography, theme } from "antd";
import dayjs from "dayjs";
import { useOrgAnalytics } from "@/features/hr/use-analytics";
import { useUserOrg } from "@/features/admin/use-admin";
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
import {
  employmentTypeLabel,
  initials,
  statusColor,
  statusLabel,
} from "../_lib/labels";

const { Text } = Typography;

function MIcon({ name, size = 17, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/**
 * One accent for magnitude, per the app's restrained standard: colour is
 * reserved for status/meaning, so department bars all wear the brand accent
 * (the label carries identity) and the employment mix uses an ordinal
 * indigo ramp rather than a categorical rainbow.
 */
const BAR_COLOR = "#5a5ad6";
const TYPE_PALETTE = ["#4a4ad0", "#7b7bea", "#b3b3f1", "#d9d9f8", "#8a8d98"];

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

/* ------------------------------------------------------------- primitives */

function SectionCard({
  icon,
  title,
  extra,
  children,
  bodyPadding = "14px 16px 16px",
}: {
  icon: string;
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  bodyPadding?: string;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 12,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "12px 16px",
          borderBottom: `1px solid ${token.colorSplit}`,
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: token.colorPrimaryBg,
          }}
        >
          <MIcon name={icon} size={16} color="#4a4ad0" />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: token.colorText, flex: 1 }}>
          {title}
        </span>
        {extra}
      </div>
      <div style={{ flex: 1, padding: bodyPadding }}>{children}</div>
    </div>
  );
}

function PersonRow({
  name,
  meta,
  badge,
  tint,
}: {
  name: string;
  meta: React.ReactNode;
  badge?: React.ReactNode;
  tint: string;
}) {
  const { token } = theme.useToken();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          flex: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11.5,
          fontWeight: 700,
          color: tint,
          background: `color-mix(in srgb, ${tint} 13%, transparent)`,
        }}
      >
        {initials(name)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: token.colorText,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>{meta}</div>
      </div>
      {badge}
    </div>
  );
}

/** One horizontal stacked mix bar + dot legend (employment type, status). */
function MixBar({
  items,
  total,
}: {
  items: { label: string; count: number; color: string }[];
  total: number;
}) {
  const { token } = theme.useToken();
  if (total <= 0 || items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data" />;
  }
  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 2,
          height: 10,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        {items.map((it) => (
          <Tooltip key={it.label} title={`${it.label}: ${it.count}`}>
            <span
              style={{
                width: `${Math.max(2, (it.count / total) * 100)}%`,
                background: it.color,
              }}
            />
          </Tooltip>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
        {items.map((it) => (
          <span
            key={it.label}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: token.colorTextSecondary }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, background: it.color, flex: "none" }} />
            {it.label}
            <span style={{ fontWeight: 700, color: token.colorText }}>{it.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function HRDashboardPage() {
  const { token } = theme.useToken();
  const { data, isLoading, isError, error } = useOrgAnalytics();
  const { data: userOrg } = useUserOrg();

  const analytics = useMemo(() => asOrgAnalytics(data), [data]);
  const orgName = (userOrg as { organization_name?: string } | null | undefined)
    ?.organization_name;

  const headcount = formatCount(analytics?.headcount ?? analytics?.total_employees);
  const presentToday = formatCount(analytics?.present_today);
  const attendanceRate = toNumber(analytics?.attendance_rate_month);
  const joiners = formatCount(analytics?.new_joiners_30d);
  const exits = formatCount(analytics?.exits_30d);
  const probation = formatCount(analytics?.on_probation);
  const leavePending = formatCount(analytics?.leave_pending);

  const departments = useMemo<AnalyticsCount[]>(() => {
    const list = analytics?.by_department ?? [];
    return [...list].sort((a, b) => formatCount(b.count) - formatCount(a.count));
  }, [analytics]);

  const byStatus = analytics?.by_status ?? [];
  const byType = analytics?.by_type ?? [];
  const byLocation = analytics?.by_location ?? [];
  const birthdays = analytics?.upcoming_birthdays ?? [];
  const anniversaries = analytics?.upcoming_anniversaries ?? [];

  // Movement chips stay neutral; colour only where it means something
  // (people leaving is worth a warning tone, the rest is information).
  const deltaChips: { icon: string; label: string; tone?: string }[] = [
    { icon: "person_add", label: `${joiners} joined · 30d` },
    ...(exits > 0
      ? [{ icon: "person_remove", label: `${exits} left · 30d`, tone: "#c0453c" }]
      : []),
    ...(probation > 0 ? [{ icon: "hourglass_top", label: `${probation} on probation` }] : []),
  ];

  const statTiles = [
    {
      icon: "event_available",
      label: "Present today",
      value: `${presentToday}`,
      sub: headcount > 0 ? `of ${headcount} people` : undefined,
    },
    {
      icon: "schedule",
      label: "Attendance this month",
      value: typeof attendanceRate === "number" ? `${Math.round(attendanceRate)}%` : "—",
      sub: "across the company",
    },
    {
      icon: "pending_actions",
      label: "Leave awaiting decision",
      value: `${leavePending}`,
      sub: leavePending > 0 ? "requests to review" : "all clear",
    },
    {
      icon: "payments",
      label: "Last payroll",
      value:
        analytics?.payroll_last?.total_net != null
          ? `${formatMoney(analytics.payroll_last.total_net)}`
          : "—",
      sub: payrollPeriodLabel(analytics?.payroll_last) ?? undefined,
    },
  ];

  return (
    <div>
      {/* Company header */}
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
          People{orgName ? ` at ${orgName}` : ""}
        </h1>
        <div style={{ fontSize: 13, color: token.colorTextSecondary, margin: "4px 0 0" }}>
          How the company looks today — team, attendance, pay and the moments coming up.
        </div>
      </div>

      {isError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="Failed to load HR analytics"
          description={errorMessage(error)}
        />
      ) : isLoading ? (
        <div
          style={{
            marginTop: 16,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 12,
            padding: 20,
          }}
        >
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : (
        <>
          {/* Hero — the company in one line */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              flexWrap: "wrap",
              marginTop: 16,
              padding: "18px 20px",
              borderRadius: 12,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
            }}
          >
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: 15,
                flex: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: token.colorPrimaryBg,
              }}
            >
              <MIcon name="groups" size={28} color="#4a4ad0" />
            </span>
            <div style={{ minWidth: 120 }}>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 700,
                  letterSpacing: "-1.2px",
                  lineHeight: 1,
                  color: token.colorText,
                }}
              >
                {headcount}
              </div>
              <div style={{ marginTop: 4, fontSize: 12.5, color: token.colorTextTertiary }}>
                people in the company
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
              {deltaChips.map((c) => (
                <span
                  key={c.label}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 28,
                    padding: "0 11px",
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: c.tone ?? token.colorTextSecondary,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorFillQuaternary,
                  }}
                >
                  <MIcon name={c.icon} size={15} color={c.tone ?? token.colorTextTertiary} />
                  {c.label}
                </span>
              ))}
            </div>
          </div>

          {/* Company stat tiles */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            {statTiles.map((t) => (
              <Col key={t.label} xs={24} sm={12} xl={6}>
                <div
                  style={{
                    background: token.colorBgContainer,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 12,
                    padding: "14px 16px",
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      flex: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: token.colorPrimaryBg,
                    }}
                  >
                    <MIcon name={t.icon} size={18} color="#4a4ad0" />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 700,
                        letterSpacing: "-.6px",
                        lineHeight: 1.1,
                        color: token.colorText,
                      }}
                    >
                      {t.value}
                    </div>
                    <div style={{ marginTop: 3, fontSize: 12.5, fontWeight: 600, color: token.colorTextSecondary }}>
                      {t.label}
                    </div>
                    {t.sub ? (
                      <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>{t.sub}</div>
                    ) : null}
                  </div>
                </div>
              </Col>
            ))}
          </Row>

          {/* Team shape */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={12}>
              <SectionCard icon="account_tree" title="Departments">
                {departments.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No departments" />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {departments.map((d, i) => {
                      const count = formatCount(d.count);
                      const pct = sharePct(count, headcount);
                      return (
                        <div key={d.name ?? `dept-${i}`}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "baseline",
                              marginBottom: 4,
                            }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                              {d.name || "Unassigned"}
                            </span>
                            <Text type="secondary" style={{ fontSize: 12.5 }}>
                              <b style={{ color: token.colorText }}>{count}</b> · {pct}%
                            </Text>
                          </div>
                          <div
                            style={{
                              height: 6,
                              borderRadius: 999,
                              background: token.colorFillSecondary,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: "100%",
                                borderRadius: 999,
                                background: BAR_COLOR,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>
            </Col>

            <Col xs={24} lg={12}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
                <SectionCard icon="work" title="Employment mix">
                  <MixBar
                    total={byType.reduce((s, t) => s + formatCount(t.count), 0)}
                    items={byType.map((t, i) => ({
                      label: employmentTypeLabel(t.type),
                      count: formatCount(t.count),
                      color: TYPE_PALETTE[i % TYPE_PALETTE.length],
                    }))}
                  />
                </SectionCard>
                <SectionCard icon="how_to_reg" title="Status">
                  {byStatus.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data" />
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {byStatus.map((s, i) => {
                        const color = statusColor(s.status);
                        return (
                          <span
                            key={s.status ?? `status-${i}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 7,
                              height: 30,
                              padding: "0 12px",
                              borderRadius: 999,
                              fontSize: 13,
                              fontWeight: 600,
                              color: token.colorTextSecondary,
                              border: `1px solid ${token.colorBorderSecondary}`,
                              background: token.colorFillQuaternary,
                            }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 999,
                                // antd preset color names (green/gold/…) aren't CSS
                                // colours — approximate with the label tone.
                                background:
                                  color === "green"
                                    ? "#2f8f5f"
                                    : color === "gold"
                                      ? "#c98a1b"
                                      : color === "red"
                                        ? "#c0453c"
                                        : token.colorTextTertiary,
                              }}
                            />
                            {statusLabel(s.status)}
                            <b style={{ color: token.colorText }}>{formatCount(s.count)}</b>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </SectionCard>
              </div>
            </Col>
          </Row>

          {/* People moments + where people are */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={8}>
              <SectionCard icon="cake" title="Upcoming birthdays">
                {birthdays.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="None coming up" />
                ) : (
                  birthdays.map((b: AnalyticsBirthday, i) => (
                    <PersonRow
                      key={`${b.full_name ?? "bd"}-${i}`}
                      name={b.full_name || "—"}
                      meta={formatDay(b.day, b.date_of_birth)}
                      tint="#4a4ad0"
                      badge={<MIcon name="cake" size={16} color={token.colorTextTertiary} />}
                    />
                  ))
                )}
              </SectionCard>
            </Col>

            <Col xs={24} lg={8}>
              <SectionCard icon="celebration" title="Work anniversaries">
                {anniversaries.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="None coming up" />
                ) : (
                  anniversaries.map((a: AnalyticsAnniversary, i) => {
                    const years = formatCount(a.years);
                    return (
                      <PersonRow
                        key={`${a.full_name ?? "ann"}-${i}`}
                        name={a.full_name || "—"}
                        meta={formatDay(a.day, a.date_of_joining)}
                        tint="#4a4ad0"
                        badge={
                          years > 0 ? (
                            <span
                              style={{
                                fontSize: 11.5,
                                fontWeight: 700,
                                color: "#4a4ad0",
                                background: token.colorPrimaryBg,
                                borderRadius: 999,
                                padding: "2px 9px",
                                flex: "none",
                              }}
                            >
                              {years} {years === 1 ? "year" : "years"}
                            </span>
                          ) : undefined
                        }
                      />
                    );
                  })
                )}
              </SectionCard>
            </Col>

            <Col xs={24} lg={8}>
              <SectionCard icon="location_on" title="Where people are">
                {byLocation.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No locations" />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {byLocation.map((l, i) => (
                      <div
                        key={l.location ?? `loc-${i}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          padding: "7px 10px",
                          borderRadius: 10,
                          background: token.colorFillQuaternary,
                        }}
                      >
                        <MIcon name="location_on" size={15} color={token.colorTextTertiary} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: token.colorText }}>
                          {l.location || "Unspecified"}
                        </span>
                        <span style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
                          {formatCount(l.count)}{" "}
                          {formatCount(l.count) === 1 ? "person" : "people"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
