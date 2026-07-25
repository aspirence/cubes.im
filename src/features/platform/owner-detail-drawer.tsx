"use client";

import { Drawer, Tag, Avatar, Spin, Empty, Tooltip, theme } from "antd";
import { useOwnerDetail, money, type OwnerDetail } from "@/features/platform/use-platform-analytics";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

const fmt = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
};
const rel = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
};

function Stat({ icon, label, value, tone }: { icon: string; label: string; value: string | number; tone?: string }) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        flex: "1 1 92px",
        minWidth: 92,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
      }}
    >
      <MIcon name={icon} size={16} color={tone ?? token.colorTextSecondary} />
      <div style={{ fontSize: 19, fontWeight: 700, color: token.colorText, marginTop: 3, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{label}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const { token } = theme.useToken();
  const empty = value === null || value === undefined || value === "";
  return (
    <div style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
      <span style={{ width: 130, flex: "none", fontSize: 12.5, color: token.colorTextTertiary }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: empty ? 400 : 600, color: empty ? token.colorTextQuaternary : token.colorText }}>
        {empty ? "Not provided" : value}
      </span>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, margin: "20px 0 10px" }}>
      <MIcon name={icon} size={17} color={token.colorTextSecondary} />
      <span style={{ fontSize: 13, fontWeight: 700, color: token.colorText }}>{children}</span>
    </div>
  );
}

function Body({ d }: { d: OwnerDetail }) {
  const { token } = theme.useToken();
  const b = d.business;
  const f = d.footprint;
  const donePct = f.tasks ? Math.round((f.tasksDone / f.tasks) * 100) : 0;

  return (
    <div>
      {/* Owner identity */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar size={48} src={d.owner.avatar || undefined} style={{ background: token.colorPrimaryBg, color: token.colorPrimary, fontWeight: 700 }}>
          {(d.owner.name || d.owner.email || "?").charAt(0).toUpperCase()}
        </Avatar>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: token.colorText }}>{d.owner.name || d.owner.email}</div>
          <div style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
            {d.owner.email} · joined {fmt(d.owner.joinedAt)}
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <Tooltip title={fmt(f.lastActive)}>
            <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
              <MIcon name="bolt" size={14} color={token.colorWarning} /> Active {rel(f.lastActive)}
            </div>
          </Tooltip>
        </div>
      </div>

      {/* Footprint stats */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
        <Stat icon="workspaces" label="Workspaces" value={f.workspaces} tone={token.colorPrimary} />
        <Stat icon="group" label="Members" value={f.members} />
        <Stat icon="folder_open" label="Spaces" value={f.spaces} />
        <Stat icon="folder" label="Projects" value={f.projects} />
        <Stat icon="task_alt" label="Tasks" value={f.tasks} tone={token.colorSuccess} />
        <Stat icon="donut_large" label={`${donePct}% done`} value={f.tasksDone} />
      </div>
      {f.estMonthlyCents > 0 ? (
        <div style={{ marginTop: 8, fontSize: 12.5, color: token.colorTextSecondary }}>
          Estimated billing: <b style={{ color: token.colorText }}>{money(f.estMonthlyCents, d.currency)}/mo</b>
        </div>
      ) : null}

      {/* Business details */}
      <SectionTitle icon="business">Business details</SectionTitle>
      <div>
        <Field label="Workspace / company" value={b.workspaceName} />
        <Field label="Contact number" value={b.contactNumber} />
        <Field label="Secondary contact" value={b.contactNumberSecondary} />
        <Field
          label="Address"
          value={[b.addressLine1, b.addressLine2, b.city, b.state, b.postalCode, b.country].filter(Boolean).join(", ") || null}
        />
        <Field label="Country" value={b.country} />
        <Field label="Working hours / day" value={b.workingHours != null ? String(b.workingHours) : null} />
        <Field
          label="Subscription"
          value={
            b.trialInProgress
              ? `Trial${b.trialExpireDate ? ` · ends ${fmt(b.trialExpireDate)}` : ""}`
              : b.subscriptionStatus
          }
        />
        <Field label="Registered" value={fmt(b.createdAt)} />
      </div>

      {/* Workspaces */}
      <SectionTitle icon="workspaces">Workspaces ({d.teams.length})</SectionTitle>
      {d.teams.length === 0 ? (
        <Empty description="No workspaces" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {d.teams.map((t) => (
            <div
              key={t.id}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, color: token.colorText, fontSize: 13 }}>{t.name}</span>
                {t.plan === "cloud" ? <Tag color="green">Cloud</Tag> : <Tag>Free</Tag>}
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: token.colorTextTertiary }}>
                  created {fmt(t.createdAt)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 5, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span><MIcon name="group" size={13} /> {t.members}{t.guests ? ` +${t.guests}g` : ""} members</span>
                <span><MIcon name="folder_open" size={13} /> {t.spaces} spaces</span>
                <span><MIcon name="folder" size={13} /> {t.projects} projects</span>
                <span><MIcon name="database" size={13} /> {t.storageGb} GB</span>
                {t.estMonthlyCents > 0 ? <span style={{ color: token.colorText, fontWeight: 600 }}>{money(t.estMonthlyCents, d.currency)}/mo</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Members */}
      <SectionTitle icon="group">Team members ({d.members.length})</SectionTitle>
      {d.members.length === 0 ? (
        <Empty description="No members" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {d.members.map((m, i) => (
            <div
              key={`${m.email}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
                borderTop: i === 0 ? "none" : `1px solid ${token.colorBorderSecondary}`,
                opacity: m.active ? 1 : 0.5,
              }}
            >
              <Avatar size={26} src={m.avatar || undefined} style={{ background: token.colorFillTertiary, color: token.colorTextSecondary, fontSize: 11 }}>
                {(m.name || m.email || "?").charAt(0).toUpperCase()}
              </Avatar>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: token.colorText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.name || m.email || "Pending invite"}
                </div>
                {m.name ? <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{m.email}</div> : null}
              </div>
              <Tag color={m.memberType === "owner" ? "gold" : m.memberType === "admin" ? "blue" : m.memberType === "guest" ? "default" : undefined}>
                {m.role || m.memberType}
              </Tag>
            </div>
          ))}
        </div>
      )}

      {/* Recent activity */}
      <SectionTitle icon="history">Recent activity</SectionTitle>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: token.colorTextTertiary, marginBottom: 4 }}>Latest projects</div>
      {d.recentProjects.length === 0 ? (
        <div style={{ fontSize: 12.5, color: token.colorTextQuaternary, marginBottom: 8 }}>No projects yet.</div>
      ) : (
        d.recentProjects.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12.5 }}>
            <MIcon name="folder" size={14} color={token.colorTextQuaternary} />
            <span style={{ color: token.colorText, fontWeight: 500 }}>{p.name}</span>
            <span style={{ color: token.colorTextQuaternary }}>· {p.team}{p.space ? ` / ${p.space}` : ""}</span>
            <span style={{ marginLeft: "auto", color: token.colorTextQuaternary, fontSize: 11 }}>{rel(p.createdAt)}</span>
          </div>
        ))
      )}
      <div style={{ fontSize: 11.5, fontWeight: 600, color: token.colorTextTertiary, margin: "12px 0 4px" }}>Latest tasks</div>
      {d.recentTasks.length === 0 ? (
        <div style={{ fontSize: 12.5, color: token.colorTextQuaternary }}>No tasks yet.</div>
      ) : (
        d.recentTasks.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12.5 }}>
            <MIcon name={t.done ? "check_circle" : "radio_button_unchecked"} size={14} color={t.done ? token.colorSuccess : token.colorTextQuaternary} />
            <span style={{ color: token.colorText, textDecoration: t.done ? "line-through" : "none" }}>{t.name}</span>
            <span style={{ color: token.colorTextQuaternary }}>· {t.project}</span>
            <span style={{ marginLeft: "auto", color: token.colorTextQuaternary, fontSize: 11 }}>{rel(t.updated_at)}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function OwnerDetailDrawer({ orgId, onClose }: { orgId: string | null; onClose: () => void }) {
  const { token } = theme.useToken();
  const { data, isLoading, isError, error } = useOwnerDetail(orgId);

  return (
    <Drawer
      open={orgId !== null}
      onClose={onClose}
      width={560}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <MIcon name="person_search" size={19} color={token.colorPrimary} />
          Owner details
        </span>
      }
    >
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Spin />
        </div>
      ) : isError || !data ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: token.colorTextSecondary }}>
          {(error as Error)?.message || "Couldn't load this owner."}
        </div>
      ) : (
        <Body d={data} />
      )}
    </Drawer>
  );
}
