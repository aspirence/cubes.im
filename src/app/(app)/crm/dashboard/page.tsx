"use client";

import { useMemo, useState } from "react";
import {
  Card,
  Col,
  Empty,
  List,
  Row,
  Tag,
  Typography,
  theme,
} from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { EChart, CHART_FONT } from "@/features/home/echart";
import { useAuth } from "@/features/auth/use-auth";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useCrmCompanies } from "@/features/app-crm/use-crm-companies";
import { useCrmDeals } from "@/features/app-crm/use-crm-deals";
import { useCrmPeople } from "@/features/app-crm/use-crm-people";
import { useCrmStages } from "@/features/app-crm/use-crm-stages";
import { useCrmTasks } from "@/features/app-crm/use-crm-tasks";
import { useCrmRecentActivities } from "@/features/app-crm/use-crm-activities";
import {
  crmMoney,
  crmPersonName,
  type CrmActivity,
  type CrmTargetRef,
} from "@/features/app-crm/types";
import { MIcon } from "../_components/m-icon";
import { RecordDrawer } from "../_components/record-drawer";

dayjs.extend(relativeTime);

function activityLine(a: CrmActivity, recordName: string): string {
  const props = (a.properties ?? {}) as Record<string, unknown>;
  switch (a.event) {
    case "created":
      return `created ${recordName}`;
    case "updated":
      return `updated ${recordName}`;
    case "stage_changed":
      return `moved ${recordName} to ${String(props.to ?? "no stage")}`;
    case "deleted":
      return `deleted ${recordName}`;
    case "restored":
      return `restored ${recordName}`;
    case "note_added":
      return `added a note on ${recordName}`;
    case "task_added":
      return `added a task on ${recordName}`;
    default:
      return `${a.event} — ${recordName}`;
  }
}

function StatCard({
  icon,
  color,
  title,
  value,
  hint,
}: {
  icon: string;
  color: string;
  title: string;
  value: React.ReactNode;
  hint?: string;
}) {
  const { token } = theme.useToken();
  return (
    <Card size="small" styles={{ body: { padding: 14 } }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: `${color}1f`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <MIcon name={icon} size={20} color={color} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
            {title}
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 650,
              color: token.colorText,
              lineHeight: 1.25,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {value}
          </div>
          {hint ? (
            <div style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
              {hint}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export default function CrmDashboardPage() {
  const { token } = theme.useToken();
  const { user } = useAuth();
  const { data: people } = useCrmPeople();
  const { data: companies } = useCrmCompanies();
  const { data: deals } = useCrmDeals();
  const { data: stages } = useCrmStages();
  const { data: tasks } = useCrmTasks();
  const { data: activities } = useCrmRecentActivities(12);
  const { data: members } = useTeamMembers();
  const [drawerTarget, setDrawerTarget] = useState<CrmTargetRef | null>(null);

  const livePeople = useMemo(
    () => (people ?? []).filter((p) => !p.deleted_at),
    [people],
  );
  const liveCompanies = useMemo(
    () => (companies ?? []).filter((c) => !c.deleted_at),
    [companies],
  );
  const liveDeals = useMemo(
    () => (deals ?? []).filter((d) => !d.deleted_at),
    [deals],
  );

  const monthStart = dayjs().startOf("month");
  const addedThisMonth = (rows: { created_at: string }[]) =>
    rows.filter((r) => dayjs(r.created_at).isAfter(monthStart)).length;

  const pipelineValue = useMemo(
    () => liveDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0),
    [liveDeals],
  );
  const mainCurrency = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of liveDeals) {
      counts.set(d.currency_code, (counts.get(d.currency_code) ?? 0) + 1);
    }
    let best = "USD";
    let bestCount = 0;
    for (const [code, count] of counts) {
      if (count > bestCount) {
        best = code;
        bestCount = count;
      }
    }
    return best;
  }, [liveDeals]);
  const avgDealSize = useMemo(() => {
    const withAmount = liveDeals.filter((d) => (d.amount ?? 0) > 0);
    if (withAmount.length === 0) return 0;
    return (
      withAmount.reduce((sum, d) => sum + (d.amount ?? 0), 0) /
      withAmount.length
    );
  }, [liveDeals]);

  // One row per stage (board order), plus "No stage" only when needed.
  const stageRows = useMemo(() => {
    const rows = (stages ?? []).map((s) => {
      const stageDeals = liveDeals.filter((d) => d.stage_id === s.id);
      return {
        name: s.name,
        color: s.color,
        count: stageDeals.length,
        value: stageDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0),
      };
    });
    const orphans = liveDeals.filter(
      (d) => !d.stage_id || !(stages ?? []).some((s) => s.id === d.stage_id),
    );
    if (orphans.length > 0) {
      rows.push({
        name: "No stage",
        color: "#8a8d98",
        count: orphans.length,
        value: orphans.reduce((sum, d) => sum + (d.amount ?? 0), 0),
      });
    }
    return rows;
  }, [stages, liveDeals]);

  const userName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.user.id, m.user.name);
    return (id: string | null | undefined) => (id && map.get(id)) || "Someone";
  }, [members]);

  const recordName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people ?? [])
      map.set(`person:${p.id}`, crmPersonName(p) || "Unnamed person");
    for (const c of companies ?? []) map.set(`company:${c.id}`, c.name);
    for (const d of deals ?? []) map.set(`deal:${d.id}`, d.name);
    return (type: string, id: string) =>
      map.get(`${type}:${id}`) ?? "a deleted record";
  }, [people, companies, deals]);

  const myOpenTasks = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => t.assignee_id === user?.id && t.status !== "DONE")
        .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"))
        .slice(0, 8),
    [tasks, user?.id],
  );

  // Overdue first, then the next closes — the "what needs attention" list.
  const upcomingCloses = useMemo(
    () =>
      liveDeals
        .filter((d) => d.close_date)
        .sort((a, b) => (a.close_date ?? "").localeCompare(b.close_date ?? ""))
        .slice(0, 8),
    [liveDeals],
  );

  // Horizontal bars: stage identity comes from the axis label (color is the
  // stage's own entity color, mirrored from the board); values direct-labeled.
  const chartOption = useMemo(
    () => ({
      grid: { left: 8, right: 90, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value" as const,
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: "category" as const,
        inverse: true,
        data: stageRows.map((r) => r.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: token.colorTextSecondary,
          fontFamily: CHART_FONT,
        },
      },
      tooltip: {
        trigger: "item" as const,
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : params;
          const idx = (p as { dataIndex?: number }).dataIndex ?? 0;
          const row = stageRows[idx];
          if (!row) return "";
          return `${row.name}: ${crmMoney(row.value, mainCurrency)} · ${row.count} deal${row.count === 1 ? "" : "s"}`;
        },
      },
      series: [
        {
          type: "bar" as const,
          data: stageRows.map((r) => ({
            value: r.value,
            itemStyle: { color: r.color, borderRadius: [0, 4, 4, 0] },
          })),
          barWidth: 16,
          label: {
            show: true,
            position: "right" as const,
            color: token.colorTextSecondary,
            fontFamily: CHART_FONT,
            formatter: (params: unknown) => {
              const idx = (params as { dataIndex?: number }).dataIndex ?? 0;
              const row = stageRows[idx];
              if (!row) return "";
              return `${crmMoney(row.value, mainCurrency)} (${row.count})`;
            },
          },
        },
      ],
    }),
    [stageRows, mainCurrency, token.colorTextSecondary],
  );

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <Typography.Title level={3} style={{ marginBottom: 16 }}>
        CRM Dashboard
      </Typography.Title>

      <Row gutter={[16, 16]}>
        <Col xs={12} xl={6}>
          <StatCard
            icon="person"
            color="#0ea5e9"
            title="People"
            value={livePeople.length}
            hint={`+${addedThisMonth(livePeople)} this month`}
          />
        </Col>
        <Col xs={12} xl={6}>
          <StatCard
            icon="domain"
            color="#6366f1"
            title="Companies"
            value={liveCompanies.length}
            hint={`+${addedThisMonth(liveCompanies)} this month`}
          />
        </Col>
        <Col xs={12} xl={6}>
          <StatCard
            icon="target"
            color="#14b8a6"
            title="Open deals"
            value={liveDeals.length}
            hint={`+${addedThisMonth(liveDeals)} this month`}
          />
        </Col>
        <Col xs={12} xl={6}>
          <StatCard
            icon="payments"
            color="#5a5ad6"
            title="Pipeline value"
            value={crmMoney(pipelineValue, mainCurrency)}
            hint={
              avgDealSize > 0
                ? `avg ${crmMoney(avgDealSize, mainCurrency)} per deal`
                : undefined
            }
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title="Pipeline by stage"
            styles={{ body: { paddingTop: 8 } }}
          >
            {stageRows.length === 0 ? (
              <Empty description="No stages yet — set up the pipeline in CRM Settings." />
            ) : (
              <EChart
                option={chartOption}
                height={Math.max(180, stageRows.length * 44)}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Upcoming closes">
            <List
              dataSource={upcomingCloses}
              locale={{
                emptyText: "No close dates set — add them on your deals.",
              }}
              renderItem={(d) => {
                const overdue = dayjs(d.close_date).isBefore(dayjs(), "day");
                return (
                  <List.Item
                    style={{ paddingInline: 0, cursor: "pointer" }}
                    onClick={() => setDrawerTarget({ type: "deal", id: d.id })}
                    actions={[
                      <Typography.Text
                        key="amt"
                        strong
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {crmMoney(d.amount, d.currency_code)}
                      </Typography.Text>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={
                        <MIcon
                          name="event"
                          size={18}
                          color={
                            overdue ? token.colorError : token.colorTextTertiary
                          }
                        />
                      }
                      title={d.name}
                      description={
                        <span>
                          {d.company?.name ? `${d.company.name} · ` : ""}
                          <Typography.Text
                            type={overdue ? "danger" : "secondary"}
                            style={{ fontSize: 12 }}
                          >
                            {overdue
                              ? `was due ${dayjs(d.close_date).format("DD MMM")}`
                              : dayjs(d.close_date).format("DD MMM YYYY")}
                          </Typography.Text>
                          {overdue ? (
                            <Tag color="red" style={{ marginLeft: 8 }}>
                              Overdue
                            </Tag>
                          ) : null}
                        </span>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="My open tasks">
            <List
              dataSource={myOpenTasks}
              locale={{ emptyText: "Nothing assigned to you. Enjoy the calm." }}
              renderItem={(t) => (
                <List.Item style={{ paddingInline: 0 }}>
                  <List.Item.Meta
                    avatar={
                      <MIcon
                        name="task_alt"
                        size={18}
                        color={token.colorTextTertiary}
                      />
                    }
                    title={t.title}
                    description={
                      t.due_at
                        ? `Due ${dayjs(t.due_at).format("DD MMM")}`
                        : "No due date"
                    }
                  />
                  {t.due_at && dayjs(t.due_at).isBefore(dayjs()) ? (
                    <Tag color="red">Overdue</Tag>
                  ) : null}
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Recent activity">
            <List
              dataSource={activities ?? []}
              locale={{ emptyText: "No CRM activity yet." }}
              renderItem={(a) => {
                const name = recordName(a.target_type, a.target_id);
                const exists = name !== "a deleted record";
                return (
                  <List.Item
                    style={{
                      paddingInline: 0,
                      cursor: exists ? "pointer" : undefined,
                    }}
                    onClick={() => {
                      if (exists) {
                        setDrawerTarget({
                          type: a.target_type as CrmTargetRef["type"],
                          id: a.target_id,
                        });
                      }
                    }}
                  >
                    <List.Item.Meta
                      avatar={
                        <MIcon
                          name="history"
                          size={18}
                          color={token.colorTextTertiary}
                        />
                      }
                      title={
                        <span>
                          <b>{userName(a.actor_id)}</b>{" "}
                          <Typography.Text type="secondary">
                            {activityLine(a, name)}
                          </Typography.Text>
                        </span>
                      }
                      description={dayjs(a.created_at).fromNow()}
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </Col>
      </Row>

      <RecordDrawer
        target={drawerTarget}
        onClose={() => setDrawerTarget(null)}
      />
    </div>
  );
}
