"use client";

import { useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Modal,
  Skeleton,
  Switch,
  Tag,
  Typography,
  theme,
} from "antd";
import {
  useCubeRules,
  useSetCubeRule,
  useCubeLeaderboard,
  useAwardCubesManual,
  type CubeLeaderRow,
} from "@/features/cubes/use-cubes";
import { useIsTeamAdmin } from "@/features/team-members/use-team-members";
import {
  useCelebrationRules,
  useSetCelebrationRule,
  type CelebrationTemplate,
} from "@/features/celebrations/use-celebrations";
import { useCelebrationStore } from "@/store/celebration-store";
import {
  useNotificationSettings,
  useUpdateNotificationSettings,
} from "@/features/settings/use-notification-settings";
import { Select } from "antd";

const { Title, Text } = Typography;

function MIcon({ name, size = 16, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

/** Performance tier from a cubes score — same scale as the org chart. */
function tier(cubes: number): { color: string; label: string } {
  if (cubes >= 80) return { color: "#2bb36e", label: "Excelling" };
  if (cubes >= 50) return { color: "#4a63f6", label: "On track" };
  if (cubes >= 25) return { color: "#f0883e", label: "Needs a push" };
  return { color: "#e5484d", label: "At risk" };
}

function initials(name: string): string {
  return (name || "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function CubesSettingsPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const isAdmin = useIsTeamAdmin();
  const { data: rules, isLoading: rulesLoading } = useCubeRules();
  const { data: board, isLoading: boardLoading } = useCubeLeaderboard();
  const setRule = useSetCubeRule();
  const award = useAwardCubesManual();
  const { data: celebrationRules, isLoading: celebrationsLoading } = useCelebrationRules();
  const setCelebrationRule = useSetCelebrationRule();
  const enqueueCelebration = useCelebrationStore((st) => st.enqueue);
  const { data: notifSettings } = useNotificationSettings();
  const updateNotifSettings = useUpdateNotificationSettings();

  // Local edits for the celebrations card (admins) — same buffer pattern as
  // the point rules above.
  const [celebrationEdits, setCelebrationEdits] = useState<
    Record<string, { enabled: boolean; template: CelebrationTemplate }>
  >({});
  const celebrationView = useMemo(
    () =>
      (celebrationRules ?? []).map((r) => ({
        ...r,
        enabled: celebrationEdits[r.event_key]?.enabled ?? r.enabled,
        template: celebrationEdits[r.event_key]?.template ?? r.template,
      })),
    [celebrationRules, celebrationEdits],
  );
  const celebrationsDirty = Object.keys(celebrationEdits).length > 0;

  const patchCelebration = (
    key: string,
    patch: Partial<{ enabled: boolean; template: CelebrationTemplate }>,
  ) => {
    setCelebrationEdits((prev) => {
      const rule = celebrationRules?.find((r) => r.event_key === key);
      const base = prev[key] ?? {
        enabled: rule?.enabled ?? true,
        template: rule?.template ?? ("burst" as CelebrationTemplate),
      };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  };

  const saveCelebrations = async () => {
    try {
      for (const [eventKey, v] of Object.entries(celebrationEdits)) {
        await setCelebrationRule.mutateAsync({
          eventKey,
          enabled: v.enabled,
          template: v.template,
        });
      }
      setCelebrationEdits({});
      message.success("Celebrations updated.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't save celebrations.");
    }
  };

  const previewTemplate = (template: CelebrationTemplate) => {
    enqueueCelebration({
      kind: "task_done",
      taskId: "preview",
      taskName: "Design the launch banner",
      at: Date.now(),
      preview: template,
    });
  };

  // Local edits for the rules table (admins).
  const [edits, setEdits] = useState<Record<string, { points: number; enabled: boolean }>>({});
  const ruleView = useMemo(
    () =>
      (rules ?? []).map((r) => ({
        ...r,
        points: edits[r.event_key]?.points ?? r.points,
        enabled: edits[r.event_key]?.enabled ?? r.enabled,
      })),
    [rules, edits],
  );
  const dirty = Object.keys(edits).length > 0;

  const [awardTarget, setAwardTarget] = useState<CubeLeaderRow | null>(null);
  const [awardPoints, setAwardPoints] = useState<number>(10);
  const [awardReason, setAwardReason] = useState("");

  const patchEdit = (key: string, patch: Partial<{ points: number; enabled: boolean }>) => {
    setEdits((prev) => {
      const base = prev[key] ?? {
        points: rules?.find((r) => r.event_key === key)?.points ?? 0,
        enabled: rules?.find((r) => r.event_key === key)?.enabled ?? true,
      };
      return { ...prev, [key]: { ...base, ...patch } };
    });
  };

  const saveRules = async () => {
    try {
      for (const [eventKey, v] of Object.entries(edits)) {
        await setRule.mutateAsync({ eventKey, points: v.points, enabled: v.enabled });
      }
      setEdits({});
      message.success("Point rules updated.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't save rules.");
    }
  };

  const submitAward = async () => {
    if (!awardTarget) return;
    try {
      await award.mutateAsync({
        userId: awardTarget.user_id,
        points: awardPoints,
        reason: awardReason,
      });
      message.success(`${awardPoints >= 0 ? "Awarded" : "Deducted"} ${Math.abs(awardPoints)} cubes.`);
      setAwardTarget(null);
      setAwardReason("");
      setAwardPoints(10);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Couldn't update cubes.");
    }
  };

  const rows = board ?? [];
  const maxCubes = Math.max(1, ...rows.map((r) => r.cubes));

  const medal = (i: number) =>
    i === 0 ? "#f5b301" : i === 1 ? "#9aa4b6" : i === 2 ? "#cd7f32" : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Title level={4} style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <MIcon name="deployed_code" size={22} color="#4a4ad0" /> Cubes
        </Title>
        <Text type="secondary">
          Gamify your workspace — members earn cubes for the work they do. Set how
          much each event is worth, and see who&apos;s leading.
        </Text>
      </div>

      {/* Leaderboard */}
      <Card title="Leaderboard" styles={{ body: { padding: 0 } }}>
        {boardLoading ? (
          <div style={{ padding: 20 }}>
            <Skeleton active paragraph={{ rows: 5 }} />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 20 }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No members yet" />
          </div>
        ) : (
          <div>
            {rows.map((r, i) => {
              const t = tier(r.cubes);
              const m = medal(i);
              return (
                <div
                  key={r.user_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 18px",
                    borderTop: i === 0 ? "none" : `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      textAlign: "center",
                      fontWeight: 800,
                      fontSize: 14,
                      color: m ?? token.colorTextTertiary,
                    }}
                  >
                    {m ? <MIcon name="workspace_premium" size={20} color={m} /> : i + 1}
                  </span>
                  <Avatar src={r.avatar_url ?? undefined} size={34} style={{ flex: "none" }}>
                    {initials(r.name)}
                  </Avatar>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText, display: "flex", alignItems: "center", gap: 6 }}>
                      {r.name}
                      <Tag
                        color={t.color}
                        style={{ margin: 0, fontSize: 10.5, lineHeight: "16px", border: "none", color: "#fff" }}
                      >
                        {t.label}
                      </Tag>
                    </div>
                    {/* Progress bar relative to the leader */}
                    <div style={{ height: 6, borderRadius: 999, background: token.colorFillTertiary, marginTop: 5, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.max(3, (Math.max(0, r.cubes) / maxCubes) * 100)}%`,
                          height: "100%",
                          background: t.color,
                          borderRadius: 999,
                        }}
                      />
                    </div>
                  </div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontWeight: 800,
                      fontSize: 15,
                      color: t.color,
                      minWidth: 62,
                      justifyContent: "flex-end",
                    }}
                  >
                    <MIcon name="deployed_code" size={15} color={t.color} />
                    {r.cubes}
                  </span>
                  {isAdmin ? (
                    <Button
                      size="small"
                      onClick={() => {
                        setAwardTarget(r);
                        setAwardPoints(10);
                        setAwardReason("");
                      }}
                    >
                      Give cubes
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Point rules */}
      <Card
        title="Point rules"
        extra={
          isAdmin ? (
            <Button
              type="primary"
              size="small"
              disabled={!dirty}
              loading={setRule.isPending}
              onClick={() => void saveRules()}
            >
              Save changes
            </Button>
          ) : null
        }
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 14 }}>
          How many cubes each event is worth. Completing tasks awards cubes
          automatically; on-time/late apply when a task has a due date.
        </Text>
        {rulesLoading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ruleView.map((r) => (
              <div
                key={r.event_key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                  opacity: r.enabled ? 1 : 0.55,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>{r.label}</div>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary, fontFamily: "var(--font-geist-mono)" }}>
                    {r.event_key}
                  </div>
                </div>
                <InputNumber
                  value={r.points}
                  onChange={(v) => patchEdit(r.event_key, { points: typeof v === "number" ? v : 0 })}
                  disabled={!isAdmin}
                  style={{ width: 96 }}
                  addonAfter="cubes"
                />
                <Switch
                  checked={r.enabled}
                  disabled={!isAdmin}
                  onChange={(v) => patchEdit(r.event_key, { enabled: v })}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Celebrations */}
      <Card
        title="Celebrations"
        extra={
          isAdmin ? (
            <Button
              type="primary"
              size="small"
              disabled={!celebrationsDirty}
              loading={setCelebrationRule.isPending}
              onClick={() => void saveCelebrations()}
            >
              Save changes
            </Button>
          ) : null
        }
        style={{ marginTop: 16 }}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 14 }}>
          Success dialogs with confetti. Pick which events celebrate and how
          they look — points come from the rules above. Everyone can mute
          celebrations for themselves below.
        </Text>
        {celebrationsLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {celebrationView.map((r) => {
              const pointsRule = (rules ?? []).find((cr) => cr.event_key === r.event_key);
              return (
                <div
                  key={r.event_key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                    opacity: r.enabled ? 1 : 0.55,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>{r.label}</div>
                    <div style={{ fontSize: 12, color: token.colorTextTertiary, fontFamily: "var(--font-geist-mono)" }}>
                      {r.event_key}
                    </div>
                  </div>
                  <Tag style={{ margin: 0 }}>
                    {pointsRule
                      ? `${pointsRule.points > 0 ? "+" : ""}${pointsRule.points} cubes`
                      : "no cubes (v1)"}
                  </Tag>
                  <Select<CelebrationTemplate>
                    size="small"
                    value={r.template}
                    disabled={!isAdmin}
                    onChange={(v) => patchCelebration(r.event_key, { template: v })}
                    style={{ width: 132 }}
                    popupMatchSelectWidth={false}
                    options={[
                      { value: "burst" as const, label: "Burst" },
                      { value: "glow" as const, label: "Glow" },
                      { value: "stats" as const, label: "Stats" },
                    ]}
                    optionRender={(opt) => (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        {/* Pure-CSS mini thumbnails per template */}
                        {opt.value === "glow" ? (
                          <span style={{ width: 30, height: 18, borderRadius: 4, background: "linear-gradient(135deg,#4a4ad0,#7b5cf0 55%,#f0883e)", flex: "none" }} />
                        ) : opt.value === "stats" ? (
                          <span style={{ width: 30, height: 18, borderRadius: 4, border: `1px solid ${token.colorBorder}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, padding: 2, flex: "none" }}>
                            {[0, 1, 2, 3].map((i) => (
                              <span key={i} style={{ background: token.colorFillSecondary, borderRadius: 1 }} />
                            ))}
                          </span>
                        ) : (
                          <span style={{ width: 30, height: 18, borderRadius: 4, border: `1px solid ${token.colorBorder}`, position: "relative", flex: "none" }}>
                            <span style={{ position: "absolute", left: 5, top: 5, width: 4, height: 4, borderRadius: 99, background: "#4a4ad0" }} />
                            <span style={{ position: "absolute", right: 6, top: 3, width: 3, height: 3, borderRadius: 99, background: "#f5b301" }} />
                            <span style={{ position: "absolute", left: 13, bottom: 3, width: 3, height: 3, borderRadius: 99, background: "#2bb36e" }} />
                          </span>
                        )}
                        {opt.label}
                      </span>
                    )}
                  />
                  <Button size="small" onClick={() => previewTemplate(r.template)}>
                    Preview
                  </Button>
                  <Switch
                    checked={r.enabled}
                    disabled={!isAdmin}
                    onChange={(v) => patchCelebration(r.event_key, { enabled: v })}
                  />
                </div>
              );
            })}

            {/* Personal mute — every member controls their own. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: token.colorFillQuaternary,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: token.colorText }}>
                  Mute celebrations for me
                </div>
                <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                  Only affects you — team settings stay as configured.
                </div>
              </div>
              <Switch
                checked={Boolean(notifSettings?.celebrations_muted)}
                loading={updateNotifSettings.isPending}
                onChange={(v) => {
                  updateNotifSettings.mutate(
                    { celebrations_muted: v },
                    {
                      onError: (err) =>
                        message.error(
                          err instanceof Error ? err.message : "Couldn't update preference.",
                        ),
                    },
                  );
                }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Manual award modal */}
      <Modal
        open={awardTarget !== null}
        title={awardTarget ? `Give cubes — ${awardTarget.name}` : "Give cubes"}
        onCancel={() => setAwardTarget(null)}
        onOk={() => void submitAward()}
        okText="Apply"
        confirmLoading={award.isPending}
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
              Points (use a negative number to deduct)
            </Text>
            <InputNumber
              value={awardPoints}
              onChange={(v) => setAwardPoints(typeof v === "number" ? v : 0)}
              style={{ width: "100%" }}
              addonBefore={<MIcon name="deployed_code" size={15} />}
            />
          </div>
          <div>
            <Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
              Reason (optional)
            </Text>
            <Input
              value={awardReason}
              onChange={(e) => setAwardReason(e.target.value)}
              placeholder="e.g. Great client save"
              maxLength={200}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
