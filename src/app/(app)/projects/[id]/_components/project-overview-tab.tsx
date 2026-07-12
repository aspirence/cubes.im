"use client";

import { useEffect, useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Collapse,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
  theme,
} from "antd";
import dayjs from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  useUpdateProject,
  useProjectStatuses,
  useProjectHealths,
  type ProjectWithRelations,
} from "@/features/projects/use-projects";
import { useTasks } from "@/features/tasks/use-tasks";
import { useTaskStatuses } from "@/features/tasks/use-task-statuses";
import { useProjectMembers } from "@/features/projects/use-project-members";

const { Text, Title } = Typography;

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

interface OverviewFormValues {
  status_id: string | null;
  health_id: string | null;
  dates: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null;
  notes: string;
  use_manual_progress: boolean;
  use_weighted_progress: boolean;
  use_time_progress: boolean;
}

/** Colored-dot option labels for a status/health lookup list. */
function dotOptions(
  list: { id: string; name: string; color_code: string }[] | undefined,
) {
  return (list ?? []).map((o) => ({
    value: o.id,
    label: (
      <Space size={6}>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: o.color_code,
          }}
        />
        {o.name}
      </Space>
    ),
  }));
}

function useProjectOwner(ownerId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  return useQuery({
    queryKey: ["project-owner", ownerId],
    enabled: Boolean(ownerId),
    queryFn: async (): Promise<{ name: string; email: string } | null> => {
      const { data, error } = await supabase
        .from("users")
        .select("name, email")
        .eq("id", ownerId ?? "")
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

export function ProjectOverviewTab({ project }: { project: ProjectWithRelations }) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const updateProject = useUpdateProject();
  const { data: owner } = useProjectOwner(project.owner_id);
  const { data: tasks } = useTasks(project.id);
  const { data: statuses } = useTaskStatuses(project.id);
  const { data: members } = useProjectMembers(project.id);
  const { data: projectStatuses } = useProjectStatuses();
  const { data: projectHealths } = useProjectHealths();

  const [form] = Form.useForm<OverviewFormValues>();

  const initialValues: OverviewFormValues = useMemo(
    () => ({
      status_id: project.status_id ?? null,
      health_id: project.health_id ?? null,
      dates: [
        project.start_date ? dayjs(project.start_date) : null,
        project.end_date ? dayjs(project.end_date) : null,
      ],
      notes: project.notes ?? "",
      use_manual_progress: project.use_manual_progress,
      use_weighted_progress: project.use_weighted_progress,
      use_time_progress: project.use_time_progress,
    }),
    [project],
  );

  useEffect(() => {
    form.setFieldsValue(
      initialValues as unknown as Parameters<typeof form.setFieldsValue>[0],
    );
  }, [form, initialValues]);

  const [saving, setSaving] = useState(false);

  const stats = useMemo(() => {
    const list = tasks ?? [];
    const byId = new Map((statuses ?? []).map((s) => [s.id, s]));
    const today = dayjs().startOf("day");
    let done = 0;
    let doing = 0;
    let todo = 0;
    let overdue = 0;
    const perStatus = new Map<string, number>();
    for (const t of list) {
      if (t.status_id) perStatus.set(t.status_id, (perStatus.get(t.status_id) ?? 0) + 1);
      const cat = t.status_id ? byId.get(t.status_id)?.category : null;
      if (t.done || cat?.is_done) done += 1;
      else if (cat?.is_doing) doing += 1;
      else todo += 1;
      if (!t.done && t.end_date && dayjs(t.end_date).isBefore(today)) overdue += 1;
    }
    const total = list.length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { total, done, doing, todo, overdue, pct, perStatus };
  }, [tasks, statuses]);

  const daysLeft = useMemo(() => {
    if (!project.end_date) return null;
    return dayjs(project.end_date).startOf("day").diff(dayjs().startOf("day"), "day");
  }, [project.end_date]);

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const [start, end] = values.dates ?? [null, null];
      await updateProject.mutateAsync({
        id: project.id,
        status_id: values.status_id ?? null,
        health_id: values.health_id ?? null,
        start_date: start ? start.toISOString() : null,
        end_date: end ? end.toISOString() : null,
        notes: values.notes.trim() ? values.notes.trim() : null,
        use_manual_progress: values.use_manual_progress,
        use_weighted_progress: values.use_weighted_progress,
        use_time_progress: values.use_time_progress,
      });
      message.success("Project updated.");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to update project.");
    } finally {
      setSaving(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: token.colorBgContainer,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: 12,
    padding: 18,
  };

  const tiles: { label: string; value: number | string; icon: string; tone: string }[] = [
    { label: "Total tasks", value: stats.total, icon: "task_alt", tone: token.colorPrimary },
    { label: "Completed", value: stats.done, icon: "check_circle", tone: "#2f8f5f" },
    { label: "In progress", value: stats.doing, icon: "autorenew", tone: "#3d7de0" },
    { label: "Overdue", value: stats.overdue, icon: "warning", tone: "#c0453c" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {tiles.map((s) => (
          <div key={s.label} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  display: "inline-flex",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  alignItems: "center",
                  justifyContent: "center",
                  background: `${s.tone}1a`,
                  color: s.tone,
                }}
              >
                <MIcon name={s.icon} size={18} />
              </span>
              <Text type="secondary" style={{ fontSize: 12.5 }}>{s.label}</Text>
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: token.colorText, lineHeight: 1 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Completion + breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }} className="ov-grid">
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
            <Title level={5} style={{ margin: 0 }}>Completion</Title>
            <Text style={{ fontSize: 22, fontWeight: 700, color: token.colorText }}>{stats.pct}%</Text>
          </div>
          {stats.total > 0 ? (
            <>
              <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: token.colorFillSecondary }}>
                <div style={{ width: `${(stats.done / stats.total) * 100}%`, background: "#2f8f5f" }} />
                <div style={{ width: `${(stats.doing / stats.total) * 100}%`, background: "#3d7de0" }} />
                <div style={{ width: `${(stats.todo / stats.total) * 100}%`, background: token.colorFillTertiary }} />
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
                {[
                  { c: "#2f8f5f", l: "Done", n: stats.done },
                  { c: "#3d7de0", l: "In progress", n: stats.doing },
                  { c: token.colorFillTertiary, l: "To do", n: stats.todo },
                ].map((x) => (
                  <span key={x.l} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: token.colorTextSecondary }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: x.c }} />
                    {x.l} <b style={{ color: token.colorText }}>{x.n}</b>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <Text type="secondary">No tasks yet.</Text>
          )}

          {(statuses ?? []).length > 0 && stats.total > 0 ? (
            <div style={{ marginTop: 18 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>By status</Text>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {(statuses ?? []).map((s) => {
                  const n = stats.perStatus.get(s.id) ?? 0;
                  const w = stats.total ? (n / stats.total) * 100 : 0;
                  return (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 120, fontSize: 12.5, color: token.colorTextSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.name}
                      </span>
                      <div style={{ flex: 1, height: 8, borderRadius: 999, background: token.colorFillQuaternary, overflow: "hidden" }}>
                        <div style={{ width: `${w}%`, height: "100%", background: s.category?.color_code ?? token.colorPrimary }} />
                      </div>
                      <span style={{ width: 24, textAlign: "right", fontSize: 12, color: token.colorText }}>{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div style={cardStyle}>
          <Title level={5} style={{ margin: "0 0 12px" }}>Details</Title>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { l: "Key", v: project.key ?? "—" },
              { l: "Owner", v: owner ? (owner.name ?? owner.email) : "—" },
              { l: "Timeline", v: project.start_date || project.end_date
                  ? `${project.start_date ? dayjs(project.start_date).format("MMM D") : "—"} → ${project.end_date ? dayjs(project.end_date).format("MMM D, YYYY") : "—"}`
                  : "Not set" },
              { l: "Created", v: dayjs(project.created_at).format("MMM D, YYYY") },
            ].map((r) => (
              <div key={r.l} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <Text type="secondary" style={{ fontSize: 12.5 }}>{r.l}</Text>
                <Text style={{ fontSize: 12.5, textAlign: "right" }}>{r.v}</Text>
              </div>
            ))}
            {daysLeft !== null ? (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <Text type="secondary" style={{ fontSize: 12.5 }}>Time left</Text>
                <Text style={{ fontSize: 12.5, color: daysLeft < 0 ? "#c0453c" : token.colorText }}>
                  {daysLeft < 0 ? `${-daysLeft}d overdue` : `${daysLeft}d remaining`}
                </Text>
              </div>
            ) : null}

            <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 12 }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>Members</Text>
              <div style={{ marginTop: 8 }}>
                {(members ?? []).length > 0 ? (
                  <Avatar.Group max={{ count: 8 }} size={30}>
                    {(members ?? []).map((m) => (
                      <Tooltip key={m.id} title={m.team_member?.user?.name ?? m.team_member?.user?.email}>
                        <Avatar
                          size={30}
                          src={m.team_member?.user?.avatar_url ?? undefined}
                          style={{ fontSize: 12 }}
                        >
                          {initials(m.team_member?.user?.name ?? "?")}
                        </Avatar>
                      </Tooltip>
                    ))}
                  </Avatar.Group>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>No members yet.</Text>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Editable settings — tucked into a collapse so the overview reads as a dashboard */}
      <Collapse
        style={{ background: token.colorBgContainer, borderRadius: 12 }}
        items={[
          {
            key: "settings",
            label: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                <MIcon name="tune" size={17} /> Project settings
              </span>
            ),
            children: (
              <Form<OverviewFormValues>
                form={form}
                layout="vertical"
                initialValues={initialValues}
                requiredMark={false}
              >
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <Form.Item label="Status" name="status_id" style={{ flex: "1 1 200px" }}>
                    <Select
                      allowClear
                      placeholder="Set status"
                      options={dotOptions(projectStatuses)}
                    />
                  </Form.Item>
                  <Form.Item label="Health" name="health_id" style={{ flex: "1 1 200px" }}>
                    <Select
                      allowClear
                      placeholder="Set health"
                      options={dotOptions(projectHealths)}
                    />
                  </Form.Item>
                </div>
                <Form.Item label="Dates" name="dates">
                  <DatePicker.RangePicker allowEmpty={[true, true]} style={{ maxWidth: 360 }} />
                </Form.Item>
                <Form.Item
                  label="Notes"
                  name="notes"
                  rules={[{ max: 500, message: "Notes must be 500 characters or fewer." }]}
                >
                  <Input.TextArea rows={4} placeholder="Project notes" maxLength={500} showCount />
                </Form.Item>
                <Text type="secondary">Progress calculation</Text>
                <div style={{ marginTop: 8, display: "flex", gap: 20, flexWrap: "wrap" }}>
                  <Form.Item name="use_manual_progress" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch checkedChildren="Manual" unCheckedChildren="Manual" />
                  </Form.Item>
                  <Form.Item name="use_weighted_progress" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch checkedChildren="Weighted" unCheckedChildren="Weighted" />
                  </Form.Item>
                  <Form.Item name="use_time_progress" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch checkedChildren="Time-based" unCheckedChildren="Time-based" />
                  </Form.Item>
                </div>
                <div style={{ marginTop: 16 }}>
                  <Button type="primary" onClick={handleSave} loading={saving}>
                    Save changes
                  </Button>
                </div>
              </Form>
            ),
          },
        ]}
      />

      <style>{`@media (max-width: 720px){ .ov-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
