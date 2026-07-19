"use client";

import { useMemo } from "react";
import { App as AntdApp, Card, Empty, Skeleton, Switch, Tooltip, Typography, theme } from "antd";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import { useCapabilities, useSetCapability, type Capability } from "@/features/permissions/use-permissions";

const { Title, Text } = Typography;

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

export default function PermissionsSettingsPage() {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const isAdmin = useIsTeamAdmin();
  const { data: capabilities, isLoading } = useCapabilities();
  const setCapability = useSetCapability();

  // Group the flat capability list by category, preserving sort order.
  const groups = useMemo(() => {
    const map = new Map<string, Capability[]>();
    for (const c of capabilities ?? []) {
      map.set(c.category, [...(map.get(c.category) ?? []), c]);
    }
    return [...map.entries()];
  }, [capabilities]);

  const toggle = (capability: string, tier: "member" | "limited", allowed: boolean) => {
    setCapability.mutate(
      { capability, tier, allowed },
      { onError: (e) => message.error(e instanceof Error ? e.message : "Couldn't update.") },
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>Permissions</Title>
        <Text type="secondary">
          Choose what <b>Members</b> and <b>Limited members</b> can do in this workspace.
          Owners and admins always have full access; guests are limited to the client portal.
        </Text>
      </div>

      {/* Tier legend */}
      <Card styles={{ body: { padding: "12px 16px" } }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, fontSize: 12.5, color: token.colorTextSecondary }}>
          <span><b style={{ color: token.colorText }}>Owner / Admin</b> — everything</span>
          <span><b style={{ color: token.colorText }}>Member</b> — full internal, tuned below</span>
          <span><b style={{ color: token.colorText }}>Limited</b> — sees team projects &amp; spaces, but only tasks assigned to them</span>
          <span><b style={{ color: token.colorText }}>Guest</b> — client portal only</span>
        </div>
      </Card>

      <Card styles={{ body: { padding: 0 } }}>
        {isLoading ? (
          <div style={{ padding: 18 }}><Skeleton active paragraph={{ rows: 8 }} /></div>
        ) : !capabilities || capabilities.length === 0 ? (
          <div style={{ padding: 32 }}>
            <Empty description="No capabilities to configure." />
          </div>
        ) : (
          <>
            {/* Column header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 96px 96px",
                alignItems: "center",
                padding: "10px 16px",
                borderBottom: `1px solid ${token.colorSplit}`,
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: ".04em",
                textTransform: "uppercase",
                color: token.colorTextTertiary,
              }}
            >
              <span>Capability</span>
              <span style={{ textAlign: "center" }}>Member</span>
              <span style={{ textAlign: "center" }}>Limited</span>
            </div>

            {groups.map(([category, caps]) => (
              <div key={category}>
                <div
                  style={{
                    padding: "10px 16px 4px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    color: token.colorTextQuaternary,
                    background: token.colorFillQuaternary,
                  }}
                >
                  {category}
                </div>
                {caps.map((c) => (
                  <div
                    key={c.key}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 96px 96px",
                      alignItems: "center",
                      padding: "12px 16px",
                      borderBottom: `1px solid ${token.colorSplit}`,
                    }}
                  >
                    <div style={{ minWidth: 0, paddingRight: 12 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>
                        {c.label}
                      </div>
                      {c.description ? (
                        <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 1 }}>
                          {c.description}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <Tooltip title={isAdmin ? undefined : "Only admins can change this"}>
                        <Switch
                          size="small"
                          checked={c.member_allowed}
                          disabled={!isAdmin || setCapability.isPending}
                          onChange={(v) => toggle(c.key, "member", v)}
                        />
                      </Tooltip>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <Switch
                        size="small"
                        checked={c.limited_allowed}
                        disabled={!isAdmin || setCapability.isPending}
                        onChange={(v) => toggle(c.key, "limited", v)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </Card>

      {!isAdmin ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: token.colorTextTertiary }}>
          <MIcon name="info" size={15} />
          You can view these permissions. Only owners and admins can change them.
        </div>
      ) : null}
    </div>
  );
}
