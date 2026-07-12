"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Avatar, Input, Segmented, Skeleton, Typography, theme } from "antd";
import { useTeamMembers, useIsTeamAdmin, type TeamMember } from "@/features/team-members/use-team-members";
import { useActiveTeam } from "@/features/teams/use-teams";
import { memberTypeMeta, MEMBER_TYPES } from "@/features/permissions/use-permissions";

const { Title, Text } = Typography;

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function name(m: TeamMember): string {
  return m.user?.name ?? m.user?.email ?? "Unknown";
}

/** Read-only directory of everyone in the workspace, grouped-searchable by tier. */
export default function PeoplePage() {
  const { token } = theme.useToken();
  const { data: activeTeam } = useActiveTeam();
  const { data: membersData, isLoading } = useTeamMembers();
  const isAdmin = useIsTeamAdmin();

  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<string>("all");

  const members = useMemo(
    () => (membersData ?? []).filter((m) => m.user && m.active !== false),
    [membersData],
  );

  // Tier filter options only show tiers that actually have someone.
  const tierFilters = useMemo(() => {
    const present = new Set(members.map((m) => m.member_type));
    return [
      { label: `All · ${members.length}`, value: "all" },
      ...MEMBER_TYPES.filter((t) => present.has(t.value)).map((t) => ({
        label: `${t.label} · ${members.filter((m) => m.member_type === t.value).length}`,
        value: t.value,
      })),
    ];
  }, [members]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => tier === "all" || m.member_type === tier)
      .filter(
        (m) =>
          !q ||
          name(m).toLowerCase().includes(q) ||
          (m.user?.email ?? "").toLowerCase().includes(q) ||
          (m.job_title?.name ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => name(a).localeCompare(name(b)));
  }, [members, tier, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>Teams</Title>
          <Text type="secondary">
            {activeTeam?.name ? `Everyone in ${activeTeam.name}` : "Everyone in this workspace"}
            {members.length ? ` · ${members.length}` : ""}
          </Text>
        </div>
        {isAdmin ? (
          <Link href="/settings/members" style={{ fontSize: 13, color: "#4a4ad0", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <MIcon name="settings" size={16} /> Manage members
          </Link>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Input
          allowClear
          prefix={<MIcon name="search" size={16} color={token.colorTextTertiary} />}
          placeholder="Search people…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <Segmented value={tier} onChange={(v) => setTier(String(v))} options={tierFilters} />
      </div>

      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 12, padding: 16 }}>
              <Skeleton active avatar paragraph={{ rows: 1 }} />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div
          style={{
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 12,
            padding: 48,
            textAlign: "center",
            color: token.colorTextTertiary,
          }}
        >
          <MIcon name="group" size={30} color={token.colorTextQuaternary} />
          <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText, marginTop: 10 }}>No people match</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>Try a different search or tier.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {visible.map((m) => {
            const meta = memberTypeMeta(m.member_type);
            return (
              <div
                key={m.id}
                style={{
                  background: token.colorBgContainer,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 12,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <Avatar size={44} src={m.user?.avatar_url ?? undefined} style={{ flex: "none", fontSize: 16 }}>
                  {initials(name(m))}
                </Avatar>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: token.colorText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name(m)}
                  </div>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.job_title?.name ? `${m.job_title.name} · ` : ""}{m.user?.email}
                  </div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      marginTop: 6,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: meta.tone,
                      background: token.colorFillTertiary,
                      borderRadius: 999,
                      padding: "2px 9px",
                    }}
                  >
                    <MIcon name={meta.icon} size={13} color={meta.tone} />
                    {meta.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
