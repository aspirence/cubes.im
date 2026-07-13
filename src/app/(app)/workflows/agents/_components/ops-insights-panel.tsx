"use client";

import { useMemo, useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  Select,
  Skeleton,
  Tag,
  theme,
  Tooltip,
} from "antd";
import {
  useOpsInsights,
  useRunOpsScan,
  useOpsNudge,
  useOpsPostDigest,
  useSetInsightStatus,
  useUpdateOpsConfig,
  type OpsAgent,
  type OpsInsight,
  type OpsInsightKind,
  type OpsPulseRow,
} from "@/features/workflows/use-ops-manager";
import { useChatChannels } from "@/features/chat/use-chat";

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

const KIND_META: Record<
  OpsInsightKind,
  { label: string; icon: string; accent: string }
> = {
  overdue: { label: "Overdue", icon: "event_busy", accent: "#e5484d" },
  at_risk: { label: "Due soon", icon: "hourglass_top", accent: "#e0a93e" },
  stalled: { label: "Stalled", icon: "pause_circle", accent: "#8a5cf6" },
  heavy_revisions: { label: "Client revisions", icon: "autorenew", accent: "#e0559b" },
  overloaded: { label: "Overloaded", icon: "weight", accent: "#2bb3a3" },
  quality_flag: { label: "Quality", icon: "flag", accent: "#6a6d78" },
};

const KIND_ORDER: OpsInsightKind[] = [
  "overdue",
  "heavy_revisions",
  "stalled",
  "at_risk",
  "overloaded",
  "quality_flag",
];

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function sevTone(s: OpsInsight["severity"]): { bg: string; fg: string; label: string } {
  if (s === "high") return { bg: "rgba(229,72,77,.14)", fg: "#e5484d", label: "High" };
  if (s === "med") return { bg: "rgba(224,169,62,.16)", fg: "#b7791f", label: "Medium" };
  return { bg: "rgba(138,141,152,.16)", fg: "#6a6d78", label: "Low" };
}

/**
 * The command surface for an Operations Manager agent: run the deterministic
 * scan, review findings grouped by kind, nudge owners in a chat channel, post a
 * digest, and see a weekly team pulse.
 */
export function OpsInsightsPanel({ agent }: { agent: OpsAgent }) {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();

  const insightsQuery = useOpsInsights(agent.id);
  const runScan = useRunOpsScan();
  const nudge = useOpsNudge();
  const digest = useOpsPostDigest();
  const setStatus = useSetInsightStatus();
  const updateConfig = useUpdateOpsConfig();
  const { data: channels } = useChatChannels();

  const channelOptions = useMemo(
    () =>
      (channels ?? [])
        .filter((c) => c.kind === "channel")
        .map((c) => ({ value: c.id, label: `# ${c.name ?? "channel"}` })),
    [channels],
  );

  const [channelId, setChannelId] = useState<string | undefined>(
    agent.ops_config?.channel_id ?? undefined,
  );
  const [pulse, setPulse] = useState<OpsPulseRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const insights = useMemo(() => insightsQuery.data ?? [], [insightsQuery.data]);
  const grouped = useMemo(() => {
    const map = new Map<OpsInsightKind, OpsInsight[]>();
    for (const it of insights) {
      map.set(it.kind, [...(map.get(it.kind) ?? []), it]);
    }
    return map;
  }, [insights]);

  const handleChannel = (id: string | undefined) => {
    setChannelId(id);
    updateConfig.mutate({
      agentId: agent.id,
      opsConfig: { ...(agent.ops_config ?? {}), channel_id: id ?? null },
    });
  };

  const handleScan = async () => {
    try {
      const res = await runScan.mutateAsync({ agentId: agent.id });
      setPulse(res.pulse ?? []);
      const total = Object.values(res.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0);
      message.success(total > 0 ? `Scan complete — ${total} finding(s).` : "Scan complete — all clear.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Scan failed.");
    }
  };

  const requireChannel = (): string | null => {
    if (!channelId) {
      message.warning("Pick a chat channel first.");
      return null;
    }
    return channelId;
  };

  const handleNudge = async (it: OpsInsight) => {
    const ch = requireChannel();
    if (!ch) return;
    setBusyId(it.id);
    try {
      await nudge.mutateAsync({ insightId: it.id, channelId: ch, agentId: agent.id });
      message.success("Nudge posted to chat.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to nudge.");
    } finally {
      setBusyId(null);
    }
  };

  const handleResolve = async (it: OpsInsight, status: "resolved" | "dismissed") => {
    setBusyId(it.id);
    try {
      await setStatus.mutateAsync({ insightId: it.id, status, agentId: agent.id });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDigest = async () => {
    const ch = requireChannel();
    if (!ch) return;
    try {
      await digest.mutateAsync({ agentId: agent.id, channelId: ch });
      message.success("Digest posted to chat.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to post digest.");
    }
  };

  const hair = token.colorBorderSecondary;

  return (
    <Card
      styles={{ body: { padding: 0 } }}
      style={{ marginBottom: 16, overflow: "hidden" }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "16px 18px",
          borderBottom: `1px solid ${hair}`,
          background: token.colorFillQuaternary,
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MIcon name="insights" size={20} color="#4a4ad0" />
            <span style={{ fontSize: 15.5, fontWeight: 700, color: token.colorText }}>
              Operations command
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: token.colorTextTertiary, marginTop: 2 }}>
            Last scan {relativeTime(agent.ops_last_scan_at)} · deterministic, no AI tokens
          </div>
        </div>
        <Button
          type="primary"
          icon={<MIcon name="radar" size={16} />}
          loading={runScan.isPending}
          onClick={handleScan}
        >
          Run scan
        </Button>
      </div>

      {/* Channel + digest controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "12px 18px",
          borderBottom: `1px solid ${hair}`,
        }}
      >
        <span style={{ fontSize: 12.5, color: token.colorTextSecondary }}>
          Post to
        </span>
        <Select
          size="small"
          placeholder="Choose a channel…"
          value={channelId}
          onChange={handleChannel}
          options={channelOptions}
          style={{ minWidth: 200 }}
          notFoundContent="No channels — create one in Chat"
          allowClear
        />
        <Tooltip title={channelId ? "Post a delivery digest to this channel" : "Pick a channel first"}>
          <Button
            icon={<MIcon name="campaign" size={16} />}
            loading={digest.isPending}
            onClick={handleDigest}
            disabled={!channelId}
          >
            Post digest
          </Button>
        </Tooltip>
      </div>

      {/* Team pulse (after a scan) */}
      {pulse.length > 0 ? (
        <div style={{ padding: "12px 18px", borderBottom: `1px solid ${hair}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: token.colorTextTertiary, marginBottom: 8 }}>
            Team pulse · last 7 days
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pulse.slice(0, 8).map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
                <span style={{ flex: 1, minWidth: 0, color: token.colorText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </span>
                <span style={{ color: token.colorTextSecondary }}>{p.open} open</span>
                {p.overdue > 0 ? <Tag color="error" style={{ margin: 0 }}>{p.overdue} overdue</Tag> : null}
                <span style={{ color: "#2bb3a3" }}>{p.completed_7d} done</span>
                <span style={{ color: token.colorTextTertiary, fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(p.logged_min_7d / 60)}h
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Findings */}
      <div style={{ padding: "8px 10px 12px" }}>
        {insightsQuery.isLoading ? (
          <div style={{ padding: 12 }}>
            <Skeleton active paragraph={{ rows: 4 }} />
          </div>
        ) : insights.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span style={{ color: token.colorTextTertiary }}>
                No open findings. Run a scan to check delivery health.
              </span>
            }
            style={{ padding: "20px 0" }}
          />
        ) : (
          KIND_ORDER.filter((k) => grouped.has(k)).map((kind) => {
            const meta = KIND_META[kind];
            const rows = grouped.get(kind)!;
            return (
              <div key={kind} style={{ marginBottom: 6 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "8px 8px 4px",
                  }}
                >
                  <MIcon name={meta.icon} size={16} color={meta.accent} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: token.colorText }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: 11.5, color: token.colorTextTertiary }}>
                    {rows.length}
                  </span>
                </div>
                {rows.map((it) => {
                  const tone = sevTone(it.severity);
                  const busy = busyId === it.id;
                  return (
                    <div
                      key={it.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "9px 10px",
                        borderRadius: 9,
                        border: `1px solid ${hair}`,
                        marginBottom: 6,
                        background: token.colorBgContainer,
                        opacity: it.status === "nudged" ? 0.7 : 1,
                      }}
                    >
                      <span
                        style={{
                          flex: "none",
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 999,
                          background: tone.bg,
                          color: tone.fg,
                          marginTop: 1,
                        }}
                      >
                        {tone.label}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                          {it.title}
                        </div>
                        {it.detail ? (
                          <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 1 }}>
                            {it.detail}
                          </div>
                        ) : null}
                        {it.status === "nudged" ? (
                          <div style={{ fontSize: 11.5, color: "#4a4ad0", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <MIcon name="check" size={13} /> Nudged
                          </div>
                        ) : null}
                      </div>
                      <div style={{ flex: "none", display: "flex", gap: 4 }}>
                        <Tooltip title={it.suggested_ask ?? "Ask the owner in chat"}>
                          <Button
                            size="small"
                            type="text"
                            loading={busy && nudge.isPending}
                            icon={<MIcon name="forum" size={15} color="#4a4ad0" />}
                            onClick={() => void handleNudge(it)}
                          />
                        </Tooltip>
                        <Tooltip title="Mark resolved">
                          <Button
                            size="small"
                            type="text"
                            loading={busy && setStatus.isPending}
                            icon={<MIcon name="task_alt" size={15} color="#2bb3a3" />}
                            onClick={() => void handleResolve(it, "resolved")}
                          />
                        </Tooltip>
                        <Tooltip title="Dismiss">
                          <Button
                            size="small"
                            type="text"
                            icon={<MIcon name="close" size={15} color={token.colorTextTertiary} />}
                            onClick={() => void handleResolve(it, "dismissed")}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

export default OpsInsightsPanel;
