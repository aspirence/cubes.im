"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  App as AntdApp,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useClients } from "@/features/settings/use-clients";
import { useAppActivatedProjects } from "@/features/apps-platform/app-scope";
import {
  useInstalledApp,
  useInstallApp,
  useIsTeamAdmin,
} from "@/features/apps-platform/use-installed-apps";
import {
  usePortals,
  usePortalProjects,
  usePortalUpdates,
  useCreatePortal,
  useUpdatePortal,
  useDeletePortal,
  useSetPortalProjects,
  useAddPortalUpdate,
  useDeletePortalUpdate,
  usePortalInvoices,
  useSaveInvoice,
  useDeleteInvoice,
  usePortalRequests,
  useUpdateRequestStatus,
  type PortalWithMeta,
  type PortalTemplate,
  type PortalInvoice,
  type PortalRequest,
} from "@/features/app-client-portal/use-client-portal";

const { Text, Paragraph, Title } = Typography;

const C = {
  bg: "#fbfbfc",
  panel: "#ffffff",
  panelSoft: "#f5f5f8",
  hairline: "#ececf0",
  accent: "#4a4ad0",
  accentSoft: "#eeeefb",
  text: "#17171c",
  textSecondary: "#6a6d78",
  textTertiary: "#9a9da8",
} as const;

const ACCENTS = [
  "#4a4ad0",
  "#2f9c9c",
  "#e0559b",
  "#ff7a45",
  "#3fbf7f",
  "#4ba3f5",
  "#e0a83e",
  "#7a5af5",
] as const;

/** The client-facing layouts the admin can choose from. */
const TEMPLATES: { key: PortalTemplate; label: string; icon: string; desc: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard", desc: "Cards, stats & progress bars" },
  { key: "sheet", label: "Sheet", icon: "table_chart", desc: "A spreadsheet of every task" },
  { key: "board", label: "Board", icon: "view_kanban", desc: "Kanban columns by status" },
  { key: "timeline", label: "Timeline", icon: "timeline", desc: "Grouped by due date" },
  { key: "minimal", label: "Minimal", icon: "notes", desc: "Clean, quiet reading view" },
];

function MIcon({
  name,
  size = 18,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1, color }}
    >
      {name}
    </span>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ------------------------------------------------------------ install gate */

function InstallPrompt({
  admin,
  installing,
  onInstall,
  onManage,
}: {
  admin: boolean;
  installing: boolean;
  onInstall: () => void;
  onManage: () => void;
}) {
  return (
    <div
      style={{
        minHeight: 420,
        background: "linear-gradient(180deg,#f3f3fd 0%, #f7f6f4 100%)",
        border: `1px solid ${C.hairline}`,
        borderRadius: 26,
        padding: 28,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ maxWidth: 560, textAlign: "center" }}>
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: 22,
            margin: "0 auto 18px",
            background: "linear-gradient(135deg,#6a6ae4,#4a4ad0)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 16px 40px rgba(74,74,208,0.24)",
          }}
        >
          <MIcon name="handshake" size={34} color="#fff" />
        </div>
        <Title level={2} style={{ marginBottom: 8 }}>
          Client Portal
        </Title>
        <Paragraph style={{ color: C.textSecondary, fontSize: 15 }}>
          Give each client a scoped, read-only window into the projects tied to
          them — status, milestones, and the updates you choose to share, behind
          one private link.
        </Paragraph>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 18,
          }}
        >
          {admin ? (
            <Button
              type="primary"
              size="large"
              loading={installing}
              onClick={onInstall}
            >
              Install Client Portal
            </Button>
          ) : null}
          <Button size="large" onClick={onManage}>
            Open App Center
          </Button>
        </div>
        {!admin ? (
          <Paragraph
            style={{ color: C.textTertiary, fontSize: 13, marginTop: 14 }}
          >
            Only a team admin can install apps for this workspace.
          </Paragraph>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- manager */

function PortalManager({ portal }: { portal: PortalWithMeta }) {
  const { message } = AntdApp.useApp();
  const { data: projects } = useAppActivatedProjects("client_portal");
  const { data: exposed } = usePortalProjects(portal.id);
  const { data: updates } = usePortalUpdates(portal.id);
  const updatePortal = useUpdatePortal();
  const setProjects = useSetPortalProjects();
  const addUpdate = useAddPortalUpdate();
  const deleteUpdate = useDeletePortalUpdate();

  const [intro, setIntro] = useState(portal.intro ?? "");
  const [title, setTitle] = useState(portal.title);
  const [updateTitle, setUpdateTitle] = useState("");
  const [updateBody, setUpdateBody] = useState("");
  const [introKey, setIntroKey] = useState(portal.id);
  // Re-seed the local branding editors when the selected portal changes.
  if (introKey !== portal.id) {
    setIntroKey(portal.id);
    setIntro(portal.intro ?? "");
    setTitle(portal.title);
    setUpdateTitle("");
    setUpdateBody("");
  }

  const isLive = portal.status === "live";
  const publicLink =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/portal/${portal.share_token}`;

  const exposedIds = useMemo(
    () => (exposed ?? []).map((row) => row.project_id),
    [exposed],
  );

  // The client's own projects sort first, then the rest of the team's.
  const projectOptions = useMemo(() => {
    const list = projects ?? [];
    return [...list]
      .sort((a, b) => {
        const aOwn = a.client_id === portal.client_id ? 0 : 1;
        const bOwn = b.client_id === portal.client_id ? 0 : 1;
        return aOwn - bOwn || a.name.localeCompare(b.name);
      })
      .map((p) => ({
        value: p.id,
        label: p.name,
        isClients: p.client_id === portal.client_id,
      }));
  }, [projects, portal.client_id]);

  const savePortal = async (
    patch: Parameters<typeof updatePortal.mutateAsync>[0],
  ) => {
    try {
      await updatePortal.mutateAsync(patch);
    } catch {
      message.error("Couldn't save — you may not have access.");
    }
  };

  const setExposed = async (ids: string[]) => {
    try {
      await setProjects.mutateAsync({
        portalId: portal.id,
        projectIds: ids,
        existing: exposedIds,
      });
    } catch {
      message.error("Couldn't update projects.");
    }
  };

  const toggleLive = async () => {
    if (!isLive && exposedIds.length === 0) {
      message.warning("Add at least one project before going live.");
      return;
    }
    await savePortal({ id: portal.id, status: isLive ? "draft" : "live" });
    message.success(
      isLive ? "Portal is now a private draft." : "Portal is live.",
    );
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      message.success("Public link copied.");
    } catch {
      message.error("Could not copy the link.");
    }
  };

  const postUpdate = async () => {
    const t = updateTitle.trim();
    if (!t) return;
    try {
      await addUpdate.mutateAsync({
        portalId: portal.id,
        title: t,
        body: updateBody.trim() || null,
      });
      setUpdateTitle("");
      setUpdateBody("");
      message.success("Update posted.");
    } catch {
      message.error("Couldn't post the update.");
    }
  };

  const sectionStyle: React.CSSProperties = {
    background: C.panel,
    border: `1px solid ${C.hairline}`,
    borderRadius: 14,
    padding: 18,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          aria-hidden
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            background: portal.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <MIcon name="handshake" size={22} color="#fff" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 700,
                color: C.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {portal.title}
            </h2>
            <Tag color={isLive ? "green" : "default"}>
              {isLive ? "Live" : "Draft"}
            </Tag>
          </div>
          <Text style={{ color: C.textTertiary, fontSize: 13 }}>
            {portal.client?.name ?? "Client"} · {exposedIds.length} project
            {exposedIds.length === 1 ? "" : "s"}
          </Text>
        </div>
        <Switch
          checkedChildren="Live"
          unCheckedChildren="Draft"
          checked={isLive}
          loading={updatePortal.isPending}
          onChange={() => void toggleLive()}
        />
      </div>

      {/* Public link */}
      {isLive ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: 12,
            borderRadius: 10,
            background: C.accentSoft,
          }}
        >
          <MIcon name="link" size={18} color={C.accent} />
          <input
            readOnly
            value={publicLink}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              flex: 1,
              minWidth: 0,
              height: 32,
              padding: "0 10px",
              borderRadius: 6,
              border: `1px solid ${C.hairline}`,
              background: "#fff",
              fontSize: 12.5,
              color: C.textSecondary,
            }}
          />
          <Button onClick={() => void copyLink()}>Copy</Button>
          <Button onClick={() => window.open(publicLink, "_blank")}>
            Preview
          </Button>
        </div>
      ) : (
        <Text style={{ color: C.textTertiary, fontSize: 13 }}>
          This portal is a private draft. Flip it to <b>Live</b> to publish a
          read-only link you can send to the client.
        </Text>
      )}

      {/* Branding */}
      {/* Template */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, color: C.text, marginBottom: 4 }}>Template</div>
        <Text style={{ fontSize: 12.5, color: C.textTertiary }}>
          The layout your client sees — whatever you pick here is what gets shared.
        </Text>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 10,
            marginTop: 12,
          }}
        >
          {TEMPLATES.map((t) => {
            const on = (portal.template ?? "dashboard") === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => void savePortal({ id: portal.id, template: t.key })}
                style={{
                  textAlign: "left",
                  padding: 12,
                  borderRadius: 12,
                  cursor: "pointer",
                  background: on ? C.accentSoft : C.panel,
                  border: `1.5px solid ${on ? C.accent : C.hairline}`,
                  transition: "all .15s",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    alignItems: "center",
                    justifyContent: "center",
                    background: on ? C.accent : C.panelSoft,
                    color: on ? "#fff" : C.textSecondary,
                    marginBottom: 8,
                  }}
                >
                  <MIcon name={t.icon} size={18} />
                </span>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: C.text }}>{t.label}</div>
                <div style={{ fontSize: 11.5, color: C.textTertiary }}>{t.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Branding */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, color: C.text, marginBottom: 12 }}>
          Branding
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <Text style={{ fontSize: 12.5, color: C.textSecondary }}>
              Portal title
            </Text>
            <Input
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                const next = title.trim();
                if (next && next !== portal.title) {
                  void savePortal({ id: portal.id, title: next });
                } else {
                  setTitle(portal.title);
                }
              }}
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Text style={{ fontSize: 12.5, color: C.textSecondary }}>
              Intro message
            </Text>
            <Input.TextArea
              value={intro}
              maxLength={4000}
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder="A short welcome for the client — what this portal shows and how to reach you."
              onChange={(e) => setIntro(e.target.value)}
              onBlur={() => {
                if ((intro ?? "") !== (portal.intro ?? "")) {
                  void savePortal({ id: portal.id, intro: intro.trim() || null });
                }
              }}
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Text style={{ fontSize: 12.5, color: C.textSecondary }}>
              Accent
            </Text>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {ACCENTS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Accent ${color}`}
                  onClick={() => void savePortal({ id: portal.id, accent: color })}
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: color,
                    cursor: "pointer",
                    border:
                      portal.accent === color
                        ? "2px solid #17171c"
                        : "2px solid transparent",
                    outline:
                      portal.accent === color
                        ? `2px solid ${color}`
                        : "none",
                    outlineOffset: 1,
                  }}
                />
              ))}
            </div>
          </div>
          <div>
            <Text style={{ fontSize: 12.5, color: C.textSecondary }}>
              Logo URL (optional)
            </Text>
            <Input
              key={`logo-${portal.id}`}
              defaultValue={portal.logo_url ?? ""}
              placeholder="https://…/logo.png"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (portal.logo_url ?? "")) {
                  void savePortal({ id: portal.id, logo_url: v || null });
                }
              }}
              style={{ marginTop: 4 }}
            />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px", marginTop: 4 }}>
            {(
              [
                { key: "show_progress", label: "Show progress", val: portal.show_progress },
                { key: "show_tasks", label: "Show task milestones", val: portal.show_tasks },
                { key: "show_reviews", label: "Show reviews", val: portal.show_reviews ?? true },
                { key: "show_billing", label: "Show billing", val: portal.show_billing ?? true },
                { key: "allow_requests", label: "Allow work requests", val: portal.allow_requests ?? true },
              ] as const
            ).map((tg) => (
              <label
                key={tg.key}
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
              >
                <Switch
                  size="small"
                  checked={tg.val}
                  onChange={(v) =>
                    void savePortal({ id: portal.id, [tg.key]: v } as Parameters<typeof savePortal>[0])
                  }
                />
                <Text style={{ fontSize: 13, color: C.textSecondary }}>{tg.label}</Text>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Projects */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, color: C.text, marginBottom: 6 }}>
          Projects shared with the client
        </div>
        <Text style={{ fontSize: 12.5, color: C.textTertiary }}>
          Only the projects you pick here are visible in the portal.
        </Text>
        <Select
          mode="multiple"
          value={exposedIds}
          onChange={(ids) => void setExposed(ids as string[])}
          placeholder="Add projects to this portal…"
          style={{ width: "100%", marginTop: 10 }}
          optionFilterProp="label"
          loading={setProjects.isPending}
          options={projectOptions.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
          optionRender={(opt) => {
            const meta = projectOptions.find((o) => o.value === opt.value);
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>{opt.label}</span>
                {meta?.isClients ? (
                  <Tag color="blue" style={{ margin: 0 }}>
                    this client
                  </Tag>
                ) : null}
              </div>
            );
          }}
        />
      </div>

      {/* Client work requests */}
      <RequestsSection portalId={portal.id} />

      {/* Billing / invoices */}
      <InvoicesSection portalId={portal.id} />

      {/* Updates */}
      <div style={sectionStyle}>
        <div style={{ fontWeight: 700, color: C.text, marginBottom: 12 }}>
          Shared updates
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Input
            value={updateTitle}
            maxLength={200}
            placeholder="Update title — e.g. “Milestone 2 delivered”"
            onChange={(e) => setUpdateTitle(e.target.value)}
          />
          <Input.TextArea
            value={updateBody}
            maxLength={8000}
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder="Optional details for the client…"
            onChange={(e) => setUpdateBody(e.target.value)}
          />
          <div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!updateTitle.trim()}
              loading={addUpdate.isPending}
              onClick={() => void postUpdate()}
            >
              Post update
            </Button>
          </div>
        </div>

        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {(updates ?? []).length === 0 ? (
            <Text style={{ color: C.textTertiary, fontSize: 13 }}>
              No updates yet.
            </Text>
          ) : (
            (updates ?? []).map((u) => (
              <div
                key={u.id}
                style={{
                  border: `1px solid ${C.hairline}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: C.text, flex: 1 }}>
                    {u.title}
                  </span>
                  <span style={{ fontSize: 12, color: C.textTertiary }}>
                    {formatDate(u.created_at)}
                  </span>
                  <Popconfirm
                    title="Delete this update?"
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() =>
                      void deleteUpdate
                        .mutateAsync({ id: u.id, portalId: portal.id })
                        .catch(() => message.error("Couldn't delete."))
                    }
                  >
                    <Button
                      type="text"
                      size="small"
                      aria-label="Delete update"
                      icon={<MIcon name="close" size={15} color={C.textTertiary} />}
                    />
                  </Popconfirm>
                </div>
                {u.body ? (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 13,
                      color: C.textSecondary,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {u.body}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function ClientPortalPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { data: activeTeam } = useActiveTeam();
  const { data: isTeamAdmin } = useIsTeamAdmin();
  const { installed, enabled, isLoading: appLoading } =
    useInstalledApp("client_portal");
  const installApp = useInstallApp();

  const { data: portals, isLoading } = usePortals();
  const { data: clients } = useClients();
  const createPortal = useCreatePortal();
  const deletePortal = useDeletePortal();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newClientId, setNewClientId] = useState<string | undefined>();
  const [newTitle, setNewTitle] = useState("");

  const list = useMemo(() => portals ?? [], [portals]);
  const selected = useMemo(
    () => list.find((p) => p.id === selectedId) ?? null,
    [list, selectedId],
  );
  // Keep a valid selection as the list loads / changes.
  if (!selected && list.length > 0 && selectedId === null) {
    setSelectedId(list[0].id);
  }

  // Clients that don't already have a portal (one portal per client).
  const availableClients = useMemo(() => {
    const taken = new Set(list.map((p) => p.client_id));
    return (clients ?? []).filter((c) => !taken.has(c.id));
  }, [clients, list]);

  const handleInstall = async () => {
    try {
      await installApp.mutateAsync("client_portal");
      message.success("Client Portal installed.");
    } catch {
      message.error("Couldn't install the app.");
    }
  };

  const handleCreate = async () => {
    if (!newClientId) return;
    const client = availableClients.find((c) => c.id === newClientId);
    const title = newTitle.trim() || client?.name || "Client portal";
    try {
      const portal = await createPortal.mutateAsync({
        clientId: newClientId,
        title,
      });
      setSelectedId(portal.id);
      setCreateOpen(false);
      setNewClientId(undefined);
      setNewTitle("");
      message.success("Portal created.");
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : "";
      message.error(
        code === "23505"
          ? "That client already has a portal."
          : "Couldn't create the portal.",
      );
    }
  };

  if (!appLoading && (!installed || !enabled)) {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "8px 0" }}>
        <InstallPrompt
          admin={Boolean(isTeamAdmin)}
          installing={installApp.isPending}
          onInstall={handleInstall}
          onManage={() => router.push("/apps?view=cubes")}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 58px)",
        margin: "-22px -24px -48px",
        background: C.bg,
        overflow: "hidden",
      }}
    >
      {/* Rail — portals per client */}
      <aside
        style={{
          width: 260,
          flex: "none",
          borderRight: `1px solid ${C.hairline}`,
          padding: "16px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 8px 8px",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "linear-gradient(135deg,#6a6ae4,#4a4ad0)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MIcon name="handshake" size={18} color="#fff" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>
              Client Portal
            </div>
            <div
              style={{
                fontSize: 11,
                color: C.textTertiary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeTeam?.name ?? "Workspace"}
            </div>
          </div>
        </div>

        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateOpen(true)}
          style={{ margin: "0 4px 6px" }}
        >
          New portal
        </Button>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {list.length === 0 && !isLoading ? (
            <Text
              style={{
                color: C.textTertiary,
                fontSize: 12.5,
                padding: "8px 10px",
              }}
            >
              No portals yet.
            </Text>
          ) : (
            list.map((p) => {
              const on = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    background: on ? C.accentSoft : "transparent",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: p.accent,
                      flex: "none",
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 13.5,
                        fontWeight: on ? 600 : 500,
                        color: on ? C.accent : C.text,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.client?.name ?? p.title}
                    </span>
                    <span style={{ fontSize: 11, color: C.textTertiary }}>
                      {p.status === "live" ? "Live" : "Draft"} ·{" "}
                      {p.project_count} project
                      {p.project_count === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
          padding: "24px 28px 48px",
        }}
      >
        {selected ? (
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: 8,
              }}
            >
              <Popconfirm
                title={`Delete the portal for ${selected.client?.name ?? "this client"}?`}
                description="Its shared projects and updates are removed. This cannot be undone."
                okText="Delete"
                okButtonProps={{ danger: true }}
                onConfirm={() =>
                  void deletePortal
                    .mutateAsync(selected.id)
                    .then(() => {
                      setSelectedId(null);
                      message.success("Portal deleted.");
                    })
                    .catch(() => message.error("Couldn't delete the portal."))
                }
              >
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<MIcon name="delete" size={16} />}
                >
                  Delete portal
                </Button>
              </Popconfirm>
            </div>
            <PortalManager portal={selected} />
          </div>
        ) : (
          <div style={{ maxWidth: 520, margin: "60px auto 0" }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ color: C.textTertiary }}>
                  Create a portal to give a client a read-only window into their
                  projects.
                </span>
              }
            >
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setCreateOpen(true)}
              >
                New portal
              </Button>
            </Empty>
          </div>
        )}
      </main>

      {/* Create modal */}
      <Modal
        title="New client portal"
        open={createOpen}
        okText="Create portal"
        okButtonProps={{ disabled: !newClientId }}
        confirmLoading={createPortal.isPending}
        onOk={() => void handleCreate()}
        onCancel={() => setCreateOpen(false)}
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
          <div>
            <Text style={{ fontSize: 12.5, color: C.textSecondary }}>Client</Text>
            {availableClients.length === 0 ? (
              <Paragraph style={{ marginTop: 6, color: C.textTertiary }}>
                Every client already has a portal. Add clients in{" "}
                <a onClick={() => router.push("/settings/clients")}>
                  Settings → Clients
                </a>
                .
              </Paragraph>
            ) : (
              <Select
                showSearch
                optionFilterProp="label"
                value={newClientId}
                onChange={(v) => {
                  setNewClientId(v);
                  const c = availableClients.find((x) => x.id === v);
                  if (c && !newTitle.trim()) setNewTitle(c.name);
                }}
                placeholder="Pick a client"
                style={{ width: "100%", marginTop: 4 }}
                options={availableClients.map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            )}
          </div>
          <div>
            <Text style={{ fontSize: 12.5, color: C.textSecondary }}>
              Portal title
            </Text>
            <Input
              value={newTitle}
              maxLength={200}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Defaults to the client's name"
              style={{ marginTop: 4 }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------- requests + invoices (v2) */

const panelStyle: React.CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.hairline}`,
  borderRadius: 14,
  padding: 18,
};

const REQ_META: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "#3d7de0" },
  accepted: { label: "Accepted", color: "#2f8f5f" },
  declined: { label: "Declined", color: "#c0453c" },
  done: { label: "Done", color: "#6a6d78" },
};
const INV_META: Record<string, { label: string; color: string }> = {
  paid: { label: "Paid", color: "#2f8f5f" },
  sent: { label: "Sent", color: "#3d7de0" },
  overdue: { label: "Overdue", color: "#c0453c" },
  draft: { label: "Draft", color: "#8b90a4" },
};
function fmtMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function StatusChip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, color, background: `${color}18`, padding: "2px 9px", borderRadius: 999, flex: "none" }}>
      {label}
    </span>
  );
}

function RequestsSection({ portalId }: { portalId: string }) {
  const { message } = AntdApp.useApp();
  const { data: requests } = usePortalRequests(portalId);
  const updateStatus = useUpdateRequestStatus();
  const list = requests ?? [];
  const setStatus = (id: string, status: PortalRequest["status"]) =>
    updateStatus.mutateAsync({ id, portalId, status }).catch(() => message.error("Couldn't update."));

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontWeight: 700, color: C.text }}>Work requests</div>
        {list.length ? <Tag>{list.length}</Tag> : null}
      </div>
      {list.length === 0 ? (
        <Text style={{ fontSize: 13, color: C.textTertiary }}>
          Requests your client submits from the portal show up here.
        </Text>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {list.map((r) => {
            const meta = REQ_META[r.status] ?? { label: r.status, color: "#8b90a4" };
            return (
              <div key={r.id} style={{ border: `1px solid ${C.hairline}`, borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 600, color: C.text }}>{r.title}</div>
                  <StatusChip label={meta.label} color={meta.color} />
                </div>
                {r.details ? <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 4 }}>{r.details}</div> : null}
                <div style={{ fontSize: 11.5, color: C.textTertiary, marginTop: 6 }}>
                  {new Date(r.created_at).toLocaleDateString()} · {r.priority} priority
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Button size="small" onClick={() => void setStatus(r.id, "accepted")}>Accept</Button>
                  <Button size="small" onClick={() => void setStatus(r.id, "declined")}>Decline</Button>
                  <Button size="small" type="text" onClick={() => void setStatus(r.id, "done")}>Mark done</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const EMPTY_INVOICE = {
  number: "",
  title: "",
  amount: "",
  currency: "USD",
  status: "draft",
  issued_on: "",
  due_on: "",
  note: "",
};

function InvoicesSection({ portalId }: { portalId: string }) {
  const { message } = AntdApp.useApp();
  const { data: invoices } = usePortalInvoices(portalId);
  const save = useSaveInvoice();
  const del = useDeleteInvoice();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_INVOICE });
  const list = invoices ?? [];

  const submit = async () => {
    const amount = Math.round(parseFloat(form.amount || "0") * 100);
    if (!form.number.trim() || Number.isNaN(amount) || amount < 0) {
      message.warning("Add an invoice number and a valid amount.");
      return;
    }
    try {
      await save.mutateAsync({
        portalId,
        number: form.number.trim(),
        title: form.title.trim() || null,
        amount_cents: amount,
        currency: form.currency,
        status: form.status as PortalInvoice["status"],
        issued_on: form.issued_on || null,
        due_on: form.due_on || null,
        note: form.note.trim() || null,
      });
      setOpen(false);
      setForm({ ...EMPTY_INVOICE });
    } catch {
      message.error("Couldn't save the invoice.");
    }
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, color: C.text }}>Billing</div>
        <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Add invoice</Button>
      </div>
      {list.length === 0 ? (
        <Text style={{ fontSize: 13, color: C.textTertiary }}>
          Add invoices your client can view (and track) inside their portal.
        </Text>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {list.map((inv) => {
            const meta = INV_META[inv.status] ?? { label: inv.status, color: "#8b90a4" };
            return (
              <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 12, border: `1px solid ${C.hairline}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: C.text }}>{inv.number}{inv.title ? ` · ${inv.title}` : ""}</div>
                  <div style={{ fontSize: 11.5, color: C.textTertiary }}>{inv.issued_on ?? "—"} → {inv.due_on ?? "—"}</div>
                </div>
                <div style={{ fontFamily: "var(--font-geist-mono)", fontWeight: 700, color: C.text }}>{fmtMoney(inv.amount_cents, inv.currency)}</div>
                <StatusChip label={meta.label} color={meta.color} />
                <Popconfirm
                  title="Delete invoice?"
                  onConfirm={() => void del.mutateAsync({ id: inv.id, portalId }).catch(() => message.error("Couldn't delete."))}
                >
                  <Button size="small" type="text" danger icon={<MIcon name="delete" size={16} />} />
                </Popconfirm>
              </div>
            );
          })}
        </div>
      )}
      <Modal open={open} onCancel={() => setOpen(false)} onOk={() => void submit()} okText="Save invoice" confirmLoading={save.isPending} title="Add invoice" destroyOnHidden>
        <div style={{ display: "grid", gap: 10 }}>
          <Input placeholder="Invoice number (e.g. INV-001)" value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} />
          <Input placeholder="Title (optional)" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <div style={{ display: "flex", gap: 10 }}>
            <Input placeholder="Amount (e.g. 1200.00)" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} style={{ flex: 2 }} />
            <Select value={form.currency} onChange={(currency) => setForm((f) => ({ ...f, currency }))} style={{ flex: 1 }} options={["USD", "EUR", "GBP", "INR", "AUD", "CAD"].map((v) => ({ value: v, label: v }))} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>Issued</div>
              <Input type="date" value={form.issued_on} onChange={(e) => setForm((f) => ({ ...f, issued_on: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>Due</div>
              <Input type="date" value={form.due_on} onChange={(e) => setForm((f) => ({ ...f, due_on: e.target.value }))} />
            </div>
          </div>
          <Select
            value={form.status}
            onChange={(status) => setForm((f) => ({ ...f, status }))}
            options={[{ value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }, { value: "paid", label: "Paid" }, { value: "overdue", label: "Overdue" }]}
          />
          <Input.TextArea placeholder="Note (optional)" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} autoSize={{ minRows: 2, maxRows: 4 }} />
        </div>
      </Modal>
    </div>
  );
}
