"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  App,
  Button,
  Drawer,
  Input,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  useInstalledApps,
  useInstallApp,
  useToggleApp,
  useUninstallApp,
  useIsTeamAdmin,
} from "@/features/apps-platform/use-installed-apps";
import { useAppConnections, useIsOrgAdmin } from "@/features/apps/use-apps";
import { APP_CATALOG, type AppDescriptor } from "@/lib/apps-platform/catalog";
import {
  INTEGRATIONS,
  INTEGRATION_CATEGORIES,
  FEATURED_INTEGRATIONS,
  integrationsByCategory,
  type Integration,
} from "@/lib/apps-platform/integrations";
import { errMsg } from "@/lib/err";

const { Text, Title, Paragraph } = Typography;

function MIcon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}


/** A branded icon tile — monogram for integrations, glyph for apps. */
function Tile({ mono, glyph, color, size = 44 }: { mono?: string; glyph?: string; color: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        background: color,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        fontWeight: 700,
        fontSize: mono && mono.length > 1 ? size * 0.34 : size * 0.42,
      }}
    >
      {glyph ? <MIcon name={glyph} size={size * 0.52} color="#fff" /> : mono}
    </div>
  );
}

type CardItem =
  | { kind: "integration"; it: Integration }
  | { kind: "app"; app: AppDescriptor };

const CUBES_KEY = "cubes";

const catLabel = (key: string) =>
  INTEGRATION_CATEGORIES.find((c) => c.key === key)?.label ?? key;

export default function AppCenterPage() {
  return (
    <Suspense fallback={null}>
      <AppCenterInner />
    </Suspense>
  );
}

function AppCenterInner() {
  const router = useRouter();
  const { message } = App.useApp();
  const { token } = theme.useToken();

  const { data: installed } = useInstalledApps();
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const { data: connections } = useAppConnections();
  const { data: isOrgAdmin } = useIsOrgAdmin();
  const installApp = useInstallApp();
  const toggleApp = useToggleApp();
  const uninstallApp = useUninstallApp();

  // The active view is driven by the secondary sidebar via ?view=.
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "all"; // all / featured / cubes / <categoryKey>
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CardItem | null>(null);
  // Clear the search box when the rail switches views (render-time reset idiom).
  const [seenView, setSeenView] = useState(view);
  if (view !== seenView) {
    setSeenView(view);
    setQuery("");
  }

  const installedByKey = useMemo(
    () => new Map((installed ?? []).map((i) => [i.app_key, i])),
    [installed],
  );
  const availableApps = useMemo(
    () => APP_CATALOG.filter((app) => app.status === "available"),
    [],
  );
  const connectedProviders = useMemo(
    () => new Set((connections ?? []).filter((c) => c.enabled).map((c) => c.provider)),
    [connections],
  );

  const isConnected = (it: Integration) =>
    Boolean(it.connectionProvider && connectedProviders.has(it.connectionProvider));
  const isInstalled = (app: AppDescriptor) => installedByKey.has(app.key);

  // Search across integrations + first-party apps.
  const q = query.trim().toLowerCase();
  const searchResults: CardItem[] = useMemo(() => {
    if (!q) return [];
    const hits: CardItem[] = [];
    for (const it of INTEGRATIONS) {
      if (it.name.toLowerCase().includes(q) || it.description.toLowerCase().includes(q)) {
        hits.push({ kind: "integration", it });
      }
    }
    for (const app of availableApps) {
      if (app.name.toLowerCase().includes(q) || app.description.toLowerCase().includes(q)) {
        hits.push({ kind: "app", app });
      }
    }
    return hits;
  }, [availableApps, q]);

  /* ---------------------------------------------------------------- cards */

  const renderCard = (item: CardItem) => {
    const connected =
      item.kind === "integration" ? isConnected(item.it) : isInstalled(item.app);
    const name = item.kind === "integration" ? item.it.name : item.app.name;
    const desc = item.kind === "integration" ? item.it.description : item.app.tagline;
    const cardKey = item.kind === "integration" ? `i-${item.it.key}` : `a-${item.app.key}`;
    return (
      <button
        key={cardKey}
        type="button"
        onClick={() => setSelected(item)}
        className="wl-app-card"
        style={{
          textAlign: "left",
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 12,
          background: token.colorBgContainer,
          padding: 16,
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          cursor: "pointer",
          width: "100%",
        }}
      >
        {item.kind === "integration" ? (
          <Tile mono={item.it.mono} color={item.it.color} />
        ) : (
          <Tile glyph={item.app.icon} color={item.app.color} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Text strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name}
            </Text>
            {connected ? <MIcon name="check_circle" size={16} color="#22a06b" /> : null}
            {item.kind === "app" && item.app.status === "coming_soon" ? (
              <Tag style={{ marginInlineEnd: 0, fontSize: 10 }}>Soon</Tag>
            ) : null}
          </div>
          <Text
            type="secondary"
            style={{
              fontSize: 12.5,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {desc}
          </Text>
        </div>
      </button>
    );
  };

  const renderGrid = (items: CardItem[]) =>
    items.length === 0 ? (
      <div
        style={{
          margin: "32px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          textAlign: "center",
        }}
      >
        <MIcon name="search_off" size={28} color={token.colorTextQuaternary} />
        <div style={{ fontWeight: 600, color: token.colorText }}>No matching apps</div>
        <div style={{ fontSize: 12.5, color: token.colorTextTertiary }}>
          Try a different keyword or browse All Apps.
        </div>
      </div>
    ) : (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {items.map(renderCard)}
      </div>
    );

  const renderSection = (sectionKey: string, title: string, items: CardItem[], subtitle?: string) => (
    <div key={sectionKey} style={{ marginBottom: 28 }}>
      <Title level={4} style={{ margin: "0 0 2px" }}>
        {title}
      </Title>
      {subtitle ? (
        <Paragraph type="secondary" style={{ margin: "0 0 14px", fontSize: 13 }}>
          {subtitle}
        </Paragraph>
      ) : (
        <div style={{ height: 12 }} />
      )}
      {renderGrid(items)}
    </div>
  );

  /* --------------------------------------------------------------- content */

  const cubesCards: CardItem[] = availableApps.map((app) => ({ kind: "app", app }));
  // Featured = our first-party featured apps first, then popular integrations.
  const featuredCards: CardItem[] = [
    ...availableApps.filter((app) => app.featured).map((app) => ({ kind: "app" as const, app })),
    ...FEATURED_INTEGRATIONS.map((it) => ({ kind: "integration" as const, it })),
  ];

  let content: React.ReactNode;
  if (q) {
    content = renderSection("search", `Results for “${query.trim()}”`, searchResults);
  } else if (view === "featured") {
    content = renderSection("featured", "Featured", featuredCards, "Our favorite and most popular integrations.");
  } else if (view === CUBES_KEY) {
    content = renderSection(
      "cubes",
      "Cubes Apps",
      cubesCards,
      "First-party apps that install into your team and plug into your projects and tasks.",
    );
  } else if (view === "all") {
    content = (
      <>
        {renderSection("featured", "Featured", featuredCards, "Our favorite and most popular integrations.")}
        {renderSection("cubes", "Cubes Apps", cubesCards)}
        {INTEGRATION_CATEGORIES.map((c) =>
          renderSection(
            c.key,
            c.label,
            integrationsByCategory(c.key).map((it) => ({ kind: "integration", it })),
          ),
        )}
      </>
    );
  } else {
    content = renderSection(
      view,
      catLabel(view),
      integrationsByCategory(view).map((it) => ({ kind: "integration", it })),
    );
  }

  /* ----------------------------------------------------------------- detail */

  const detail = (() => {
    if (!selected) return null;
    if (selected.kind === "app") {
      const app = selected.app;
      const inst = installedByKey.get(app.key);
      const comingSoon = app.status === "coming_soon";
      const doInstall = async () => {
        try {
          await installApp.mutateAsync(app.key);
          message.success(`${app.name} installed.`);
        } catch (err) {
          message.error(errMsg(err, "Failed to install."));
        }
      };
      return (
        <>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
            <Tile glyph={app.icon} color={app.color} size={52} />
            <div>
              <Title level={4} style={{ margin: 0 }}>
                {app.name}
              </Title>
              <Text type="secondary">{app.tagline}</Text>
            </div>
          </div>
          <Space size={[4, 4]} wrap>
            <Tag>{app.category}</Tag>
            {inst ? <Tag color="green">Installed</Tag> : null}
            {comingSoon ? <Tag>Coming soon</Tag> : null}
          </Space>
          <Paragraph style={{ marginTop: 14 }}>{app.description}</Paragraph>
          <Text type="secondary" style={{ fontSize: 12 }}>Uses:</Text>{" "}
          <Space size={[4, 4]} wrap>
            {app.coreAccess.map((r) => (
              <Tag key={r} style={{ margin: 0 }}>{r}</Tag>
            ))}
          </Space>
          <div style={{ marginTop: 20, display: "flex", gap: 8, alignItems: "center" }}>
            {inst ? (
              <>
                <Tooltip title={inst.enabled ? "Enabled" : "Disabled"}>
                  <Switch
                    size="small"
                    checked={inst.enabled}
                    disabled={!isTeamAdmin || toggleApp.isPending}
                    loading={toggleApp.isPending}
                    onChange={(c) => toggleApp.mutate({ id: inst.id, enabled: c })}
                  />
                </Tooltip>
                <Button disabled={comingSoon || !inst.enabled} onClick={() => router.push(app.route)}>
                  Open
                </Button>
                <span style={{ flex: 1 }} />
                {isTeamAdmin ? (
                  <Popconfirm
                    title={`Uninstall ${app.name}?`}
                    description="Its data is removed. This cannot be undone."
                    okText="Uninstall"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => {
                      uninstallApp.mutate(inst.id);
                      setSelected(null);
                    }}
                  >
                    <Button type="text" danger>Uninstall</Button>
                  </Popconfirm>
                ) : null}
              </>
            ) : (
              <Button
                type="primary"
                disabled={!isTeamAdmin || comingSoon}
                loading={installApp.isPending}
                onClick={doInstall}
              >
                {comingSoon ? "Coming soon" : isTeamAdmin ? "Install" : "Admins only"}
              </Button>
            )}
          </div>
        </>
      );
    }

    const it = selected.it;
    const connected = isConnected(it);
    const backed = Boolean(it.connectionProvider);
    return (
      <>
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
          <Tile mono={it.mono} color={it.color} size={52} />
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {it.name}
            </Title>
            <Text type="secondary">{catLabel(it.category)}</Text>
          </div>
        </div>
        {connected ? <Tag color="green">Connected</Tag> : null}
        <Paragraph style={{ marginTop: 14 }}>{it.description}</Paragraph>
        <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
          {backed ? (
            <Button
              type={connected ? "default" : "primary"}
              disabled={!isOrgAdmin}
              onClick={() => router.push("/settings/apps")}
            >
              {connected ? "Manage connection" : isOrgAdmin ? "Connect" : "Admins only"}
            </Button>
          ) : (
            <Button
              onClick={() =>
                message.info(`We'll let your workspace know when ${it.name} is available to connect.`)
              }
            >
              Request access
            </Button>
          )}
        </div>
        {!backed ? (
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
            Directory listing — this integration isn&apos;t connectable in your workspace yet.
          </Paragraph>
        ) : null}
      </>
    );
  })();

  /* ------------------------------------------------------------------- view */

  return (
    <div>
      {/* Page header + search — the section headings (Featured / category) label content;
          the App Center rail lives in the shell's secondary sidebar. */}
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: "-.4px", color: token.colorText }}>
            App Center
          </h1>
          <div style={{ fontSize: 13, color: token.colorTextSecondary, margin: "4px 0 0" }}>
            Install Cubes apps and connect integrations.
          </div>
        </div>
        <Input.Search
          allowClear
          placeholder="Search apps…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 340 }}
        />
      </div>
      {content}

      <Drawer
        title={null}
        placement="right"
        width={440}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      >
        {detail}
      </Drawer>

      <style>{`
        .wl-app-card { transition: border-color .12s ease, box-shadow .12s ease; }
        .wl-app-card:hover { border-color: ${token.colorBorder}; box-shadow: 0 4px 14px -6px rgba(16,24,40,.12); }
      `}</style>
    </div>
  );
}
