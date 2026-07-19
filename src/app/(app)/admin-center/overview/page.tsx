"use client";

import Link from "next/link";
import { Card, Progress, Skeleton, Space, Tag, Typography, theme } from "antd";
import {
  useAdminOverview,
  useAdminTeams,
  useAdminUsers,
  useAdminProjects,
} from "@/features/admin/use-admin";
import { AdminError, isForbiddenError } from "../_components/admin-error";

/** Material Symbols Rounded glyph. */
function MIcon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/* Deterministic tint per entity (same palette family as the member picker). */
const TINTS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#3b82f6",
];
function tintFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}
function monogram(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter((c) => c && /[\p{L}\p{N}]/u.test(c))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Small round monogram tile for teams/projects/people. */
function Mono({ name, seed, size = 30, radius = 9 }: { name: string; seed: string; size?: number; radius?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: radius,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 700,
        color: "#fff",
        background: tintFor(seed),
      }}
    >
      {monogram(name)}
    </span>
  );
}

const STATS = [
  { key: "total_teams", label: "Workspaces", icon: "groups", fg: "#4a4ad0", bg: "rgba(74, 74, 208, 0.10)" },
  { key: "total_members", label: "Members", icon: "person", fg: "#0284c7", bg: "rgba(14, 165, 233, 0.12)" },
  { key: "total_projects", label: "Projects", icon: "grid_view", fg: "#7c3aed", bg: "rgba(139, 92, 246, 0.12)" },
  { key: "total_tasks", label: "Tasks", icon: "checklist", fg: "#d97706", bg: "rgba(245, 158, 11, 0.14)" },
  { key: "completed_tasks", label: "Completed", icon: "task_alt", fg: "#059669", bg: "rgba(16, 185, 129, 0.13)" },
] as const;

export default function AdminOverviewPage() {
  const { token } = theme.useToken();
  const { data, isLoading, isError, error } = useAdminOverview();
  // Side lists enrich the page; if one fails it just hides (overview owns the
  // page-level error).
  const { data: teams } = useAdminTeams();
  const { data: users } = useAdminUsers();
  const { data: projects } = useAdminProjects();

  const showForbidden = isError && isForbiddenError(error);
  const totalTasks = data?.total_tasks ?? 0;
  const doneTasks = data?.completed_tasks ?? 0;
  const pct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const topTeams = (teams ?? []).slice(0, 5);
  const topProjects = [...(projects ?? [])]
    .sort((a, b) => b.task_count - a.task_count)
    .slice(0, 5);
  const people = (users ?? []).slice(0, 8);

  const sectionCardStyles = {
    body: { padding: 0 },
    header: { padding: "12px 16px", minHeight: 0 },
  };

  return (
    <div>
      {/* Header: org identity + plan status */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <span
          style={{
            width: 44,
            height: 44,
            flex: "none",
            borderRadius: 13,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 17,
            fontWeight: 700,
            background: "linear-gradient(135deg, #4a4ad0 0%, #7c6cff 100%)",
            boxShadow: "0 6px 16px rgba(74, 74, 208, 0.24)",
          }}
        >
          {monogram(data?.org_name ?? "O")}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {data?.org_name ?? "Organization overview"}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            A snapshot of teams, members and work across your organization.
          </Typography.Text>
        </div>
        {!isLoading && !showForbidden ? (
          <Space size={8} wrap>
            <SubscriptionTag status={data?.subscription_status} />
            {data?.trial_in_progress ? <Tag color="gold">Trial in progress</Tag> : null}
          </Space>
        ) : null}
      </div>

      {isError ? (
        <div style={{ marginTop: 16 }}>
          <AdminError error={error} title="Failed to load overview" />
        </div>
      ) : (
        <>
          {/* Stat band + completion ring */}
          <div
            style={{
              marginTop: 20,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 12,
            }}
          >
            {STATS.map((s) => (
              <Card key={s.key} styles={{ body: { padding: "14px 16px" } }}>
                {isLoading ? (
                  <Skeleton active paragraph={false} title={{ width: "70%" }} />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span
                      style={{
                        width: 38,
                        height: 38,
                        flex: "none",
                        borderRadius: 11,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: s.fg,
                        background: s.bg,
                      }}
                    >
                      <MIcon name={s.icon} size={20} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="tabular" style={{ fontSize: 22, fontWeight: 650, lineHeight: 1.1, color: token.colorText }}>
                        {data?.[s.key] ?? 0}
                      </div>
                      <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 2 }}>
                        {s.label}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            ))}
            <Card styles={{ body: { padding: "12px 16px" } }}>
              {isLoading ? (
                <Skeleton active paragraph={false} title={{ width: "70%" }} />
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <Progress
                    type="circle"
                    size={46}
                    percent={pct}
                    strokeColor="#4a4ad0"
                    strokeWidth={9}
                    format={(p) => (
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{p}%</span>
                    )}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>
                      Completion
                    </div>
                    <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 2 }}>
                      {doneTasks} of {totalTasks} tasks done
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Workspaces + top projects */}
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 12,
              alignItems: "start",
            }}
          >
            <Card
              title={<CardTitle icon="groups" text="Workspaces" />}
              extra={<ViewAll href="/admin-center/teams" />}
              styles={sectionCardStyles}
            >
              {topTeams.length ? (
                topTeams.map((t, i) => (
                  <div
                    key={t.team_id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "10px 16px",
                      borderTop: i ? `1px solid ${token.colorBorderSecondary}` : undefined,
                    }}
                  >
                    <Mono name={t.team_name} seed={t.team_id} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: token.colorText,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.team_name}
                      </div>
                    </div>
                    <MetricPill icon="person" value={t.member_count} />
                    <MetricPill icon="grid_view" value={t.project_count} />
                  </div>
                ))
              ) : (
                <EmptyHint text="No workspaces yet" loading={!teams} />
              )}
            </Card>

            <Card
              title={<CardTitle icon="grid_view" text="Projects by activity" />}
              extra={<ViewAll href="/admin-center/projects" />}
              styles={sectionCardStyles}
            >
              {topProjects.length ? (
                topProjects.map((p, i) => (
                  <div
                    key={p.project_id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "10px 16px",
                      borderTop: i ? `1px solid ${token.colorBorderSecondary}` : undefined,
                    }}
                  >
                    <Mono name={p.project_name} seed={p.project_id} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: token.colorText,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.project_name}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: token.colorTextTertiary,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.team_name}
                        {p.owner_name ? ` · ${p.owner_name}` : ""}
                      </div>
                    </div>
                    <MetricPill icon="checklist" value={p.task_count} />
                  </div>
                ))
              ) : (
                <EmptyHint text="No projects yet" loading={!projects} />
              )}
            </Card>
          </div>

          {/* People strip */}
          <Card
            style={{ marginTop: 12 }}
            styles={{ body: { padding: "14px 16px" } }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <CardTitle icon="diversity_3" text="People" />
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                {people.map((u, i) => (
                  <span
                    key={u.user_id}
                    title={u.name || u.email}
                    style={{
                      display: "inline-flex",
                      marginLeft: i ? -8 : 0,
                      borderRadius: "50%",
                      boxShadow: `0 0 0 2px ${token.colorBgContainer}`,
                    }}
                  >
                    <Mono name={u.name || u.email} seed={u.user_id} size={28} radius={999} />
                  </span>
                ))}
              </span>
              <span style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
                {data?.total_members ?? people.length} member
                {(data?.total_members ?? people.length) === 1 ? "" : "s"} across{" "}
                {data?.total_teams ?? 0} workspace
                {(data?.total_teams ?? 0) === 1 ? "" : "s"}
              </span>
              <span style={{ marginLeft: "auto" }}>
                <ViewAll href="/admin-center/users" />
              </span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function CardTitle({ icon, text }: { icon: string; text: string }) {
  const { token } = theme.useToken();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600 }}>
      <MIcon name={icon} size={17} color={token.colorTextTertiary} />
      {text}
    </span>
  );
}

function ViewAll({ href }: { href: string }) {
  return (
    <Link
      href={href}
      style={{
        fontSize: 12.5,
        fontWeight: 600,
        color: "#4a4ad0",
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
      }}
    >
      View all <MIcon name="arrow_forward" size={13} />
    </Link>
  );
}

function MetricPill({ icon, value }: { icon: string; value: number }) {
  const { token } = theme.useToken();
  return (
    <span
      className="tabular"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flex: "none",
        fontSize: 12,
        fontWeight: 600,
        color: token.colorTextSecondary,
        background: token.colorFillTertiary,
        borderRadius: 999,
        padding: "3px 9px",
      }}
    >
      <MIcon name={icon} size={13} />
      {value}
    </span>
  );
}

function EmptyHint({ text, loading }: { text: string; loading: boolean }) {
  const { token } = theme.useToken();
  return (
    <div style={{ padding: "18px 16px" }}>
      {loading ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : (
        <span style={{ fontSize: 12.5, color: token.colorTextTertiary }}>{text}</span>
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
