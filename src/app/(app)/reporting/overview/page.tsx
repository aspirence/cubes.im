"use client";

import { useMemo } from "react";
import {
  useTeamOverview,
  useReportMembers,
} from "@/features/reporting/use-reporting";
import { minutesToHours } from "../_lib/format-duration";
import { T, SEMANTIC, MONO } from "../_lib/tokens";
import {
  PageHeader,
  Panel,
  SectionTitle,
  KpiTile,
  BarRow,
  AvatarChip,
  ErrorBanner,
  Icon,
} from "../_lib/ui";

export default function ReportingOverviewPage() {
  const { data, isLoading, isError, error } = useTeamOverview();
  const {
    data: members,
    isLoading: membersLoading,
    isError: membersError,
  } = useReportMembers();

  const kpis = [
    {
      label: "Total projects",
      value: data?.total_projects ?? 0,
      icon: "folder",
    },
    {
      label: "Active projects",
      value: data?.active_projects ?? 0,
      icon: "bolt",
    },
    { label: "Total tasks", value: data?.total_tasks ?? 0, icon: "list_alt" },
    {
      label: "Completed tasks",
      value: data?.completed_tasks ?? 0,
      icon: "task_alt",
    },
    {
      label: "Overdue tasks",
      value: data?.overdue_tasks ?? 0,
      icon: "warning",
      danger: data ? data.overdue_tasks > 0 : false,
    },
    { label: "Members", value: data?.total_members ?? 0, icon: "group" },
    {
      label: "Logged hours",
      value: minutesToHours(data?.total_logged_minutes ?? 0),
      suffix: "h",
      icon: "schedule",
    },
  ];

  // Tasks-by-status buckets derived from the overview rollup.
  const statusRows = useMemo(() => {
    const total = data?.total_tasks ?? 0;
    const completed = data?.completed_tasks ?? 0;
    const overdue = data?.overdue_tasks ?? 0;
    const inProgress = Math.max(0, total - completed - overdue);
    const denom = total || 1;
    return [
      {
        key: "completed",
        label: "Completed",
        count: completed,
        color: SEMANTIC.green.fg,
      },
      {
        key: "in_progress",
        label: "In progress",
        count: inProgress,
        color: T.chart,
      },
      {
        key: "overdue",
        label: "Overdue",
        count: overdue,
        color: SEMANTIC.red.fg,
      },
    ].map((r) => ({ ...r, pct: (r.count / denom) * 100 }));
  }, [data]);

  const topMembers = useMemo(() => {
    return [...(members ?? [])]
      .filter((m) => m.logged_minutes > 0)
      .sort((a, b) => b.logged_minutes - a.logged_minutes)
      .slice(0, 6);
  }, [members]);

  const maxMemberMinutes = topMembers[0]?.logged_minutes ?? 0;

  return (
    <div>
      <PageHeader
        title="Team overview"
        subtitle="A snapshot of work and time across the active team."
      />

      {isError ? (
        <ErrorBanner
          title="Failed to load overview"
          message={error instanceof Error ? error.message : "Please try again."}
        />
      ) : (
        <>
          {/* KPI grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            {kpis.map((k) => (
              <KpiTile
                key={k.label}
                label={k.label}
                value={k.value}
                suffix={k.suffix}
                icon={k.icon}
                danger={k.danger}
                loading={isLoading}
              />
            ))}
          </div>

          {/* Two-column detail */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {/* Tasks by status */}
            <Panel padding={18}>
              <SectionTitle
                right={
                  <span
                    className="font-mono"
                    style={{ fontSize: 12, color: T.textTertiary }}
                  >
                    {isLoading ? "—" : `${data?.total_tasks ?? 0} total`}
                  </span>
                }
              >
                Tasks by status
              </SectionTitle>
              <div style={{ marginTop: 8 }}>
                {isLoading ? (
                  <BarSkeleton rows={3} />
                ) : (data?.total_tasks ?? 0) === 0 ? (
                  <EmptyHint icon="checklist" text="No tasks yet." />
                ) : (
                  statusRows.map((r) => (
                    <BarRow
                      key={r.key}
                      label={r.label}
                      value={r.count.toLocaleString()}
                      pct={r.pct}
                      color={r.color}
                      swatch
                    />
                  ))
                )}
              </div>
            </Panel>

            {/* Hours logged · top members */}
            <Panel padding={18}>
              <SectionTitle
                right={
                  <span
                    className="font-mono"
                    style={{ fontSize: 12, color: T.textTertiary }}
                  >
                    {membersLoading
                      ? "—"
                      : `${minutesToHours(data?.total_logged_minutes ?? 0)}h`}
                  </span>
                }
              >
                Hours logged · top members
              </SectionTitle>
              <div style={{ marginTop: 4 }}>
                {membersLoading ? (
                  <MemberSkeleton rows={4} />
                ) : membersError || topMembers.length === 0 ? (
                  <EmptyHint icon="schedule" text="No time logged yet." />
                ) : (
                  topMembers.map((m, i) => (
                    <div
                      key={m.team_member_id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 11,
                        padding: "10px 0",
                        borderTop:
                          i === 0 ? "none" : `1px solid ${T.dividerSoft}`,
                      }}
                    >
                      <AvatarChip
                        name={m.user_name}
                        colorKey={m.team_member_id}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 13,
                            color: T.textPrimary,
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.user_name}
                        </div>
                        <div
                          style={{
                            height: 5,
                            marginTop: 5,
                            borderRadius: 999,
                            background: T.divider,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${
                                maxMemberMinutes
                                  ? (m.logged_minutes / maxMemberMinutes) * 100
                                  : 0
                              }%`,
                              height: "100%",
                              borderRadius: 999,
                              background: T.chart,
                            }}
                          />
                        </div>
                      </div>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 13,
                          fontWeight: 600,
                          color: T.textPrimary,
                          flexShrink: 0,
                        }}
                      >
                        {minutesToHours(m.logged_minutes)}
                        <span
                          style={{ color: T.textTertiary, fontWeight: 400 }}
                        >
                          h
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function BarSkeleton({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ padding: "9px 0" }}>
          <div
            style={{
              width: "40%",
              height: 12,
              marginBottom: 7,
              borderRadius: 4,
              background: T.divider,
            }}
          />
          <div style={{ height: 8, borderRadius: 999, background: T.divider }} />
        </div>
      ))}
    </>
  );
}

function MemberSkeleton({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "10px 0",
            borderTop: i === 0 ? "none" : `1px solid ${T.dividerSoft}`,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: T.divider,
            }}
          />
          <div
            style={{ flex: 1, height: 12, borderRadius: 4, background: T.divider }}
          />
        </div>
      ))}
    </>
  );
}

function EmptyHint({ icon, text }: { icon: string; text: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "24px 0",
        color: T.textTertiary,
      }}
    >
      <Icon name={icon} size={26} color={T.textFaint} />
      <span style={{ fontSize: 13 }}>{text}</span>
    </div>
  );
}
