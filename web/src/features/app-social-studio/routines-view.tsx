"use client";

import { useMemo, useState } from "react";
import {
  App,
  Button,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Spin,
  Switch,
  Tooltip,
} from "antd";
import dayjs from "dayjs";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { MIcon, useC } from "./ui";
import { SOCIAL_PLATFORMS } from "./use-social-studio";
import { PLATFORM_BRANDS } from "./platform-icons";
import {
  previewOccurrences,
  useDeleteSocialRoutine,
  useSaveSocialRoutine,
  useSetSocialRoutineActive,
  useSocialRoutines,
  type SocialRoutineStepInput,
  type SocialRoutineWithSteps,
  type SocialScheduleType,
  type SocialStepKind,
} from "./use-social-routines";

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

const KIND_OPTIONS: { value: SocialStepKind; label: string; icon: string }[] = [
  { value: "creation", label: "Create", icon: "draw" },
  { value: "publish", label: "Publish", icon: "send" },
  { value: "generic", label: "Other", icon: "check_circle" },
];

type Draft = {
  id?: string;
  name: string;
  projectId: string | undefined;
  scheduleType: SocialScheduleType;
  intervalValue: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  startsOn: string;
  endsOn: string | null;
  steps: SocialRoutineStepInput[];
};

const BLANK_DRAFT = (projectId?: string): Draft => ({
  name: "",
  projectId,
  // Alternate-day posting is the case this was built for, so it is the default
  // the form opens on.
  scheduleType: "daily",
  intervalValue: 2,
  dayOfWeek: null,
  dayOfMonth: null,
  startsOn: dayjs().format("YYYY-MM-DD"),
  endsOn: null,
  steps: [
    { title: "Create the post", dueOffsetDays: 0, kind: "creation", dependsOnIndex: null },
    { title: "Publish", dueOffsetDays: 0, kind: "publish", dependsOnIndex: 0 },
  ],
});

/** Human sentence for a cadence — the thing people actually check before saving. */
function cadenceText(d: Draft): string {
  if (d.scheduleType === "daily") {
    return d.intervalValue === 1
      ? "Every day"
      : d.intervalValue === 2
        ? "Every other day"
        : `Every ${d.intervalValue} days`;
  }
  if (d.scheduleType === "weekly") {
    const day = WEEKDAY_OPTIONS.find((w) => w.value === d.dayOfWeek)?.label;
    const every = d.intervalValue === 1 ? "Every week" : `Every ${d.intervalValue} weeks`;
    return day ? `${every} on ${day}` : every;
  }
  const every = d.intervalValue === 1 ? "Every month" : `Every ${d.intervalValue} months`;
  return d.dayOfMonth ? `${every} on day ${d.dayOfMonth}` : every;
}

/**
 * Recurring posting routines — the "set it once" screen.
 *
 * A routine is a BLUEPRINT, not a task that gets copied: it says what to make
 * each cycle, who makes it, and what waits on what. The cron job turns it into
 * real tasks with real subtasks, assignees and dependencies, which then live on
 * the calendar and every other task surface like anything else.
 *
 * That distinction is the point. Editing a routine changes what happens NEXT
 * time; it never rewrites the tasks someone is already working on.
 */
export function SocialRoutinesView({
  projects,
  defaultProjectId,
}: {
  projects: { id: string; name: string }[];
  defaultProjectId?: string;
}) {
  const C = useC();
  const { message } = App.useApp();
  const { data: members } = useTeamMembers();
  const { data: routines, isLoading, isError, refetch } = useSocialRoutines();
  const saveRoutine = useSaveSocialRoutine();
  const setActive = useSetSocialRoutineActive();
  const deleteRoutine = useDeleteSocialRoutine();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => BLANK_DRAFT(defaultProjectId));

  const memberOptions = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.user)
        .map((m) => ({ value: m.id, label: m.user!.name })),
    [members],
  );
  const memberName = useMemo(() => {
    const map = new Map(memberOptions.map((m) => [m.value, m.label]));
    return (id: string | null) => (id ? (map.get(id) ?? "Unknown") : "Unassigned");
  }, [memberOptions]);

  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? "Unknown project";
  }, [projects]);

  const openCreate = () => {
    setDraft(BLANK_DRAFT(defaultProjectId ?? projects[0]?.id));
    setOpen(true);
  };

  const openEdit = (r: SocialRoutineWithSteps) => {
    const stepIndexById = new Map(r.steps.map((s, i) => [s.id, i]));
    setDraft({
      id: r.id,
      name: r.name,
      projectId: r.project_id,
      scheduleType: r.schedule_type as SocialScheduleType,
      intervalValue: r.interval_value,
      dayOfWeek: r.day_of_week,
      dayOfMonth: r.day_of_month,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      steps: r.steps.map((s) => ({
        title: s.title,
        platform: s.platform,
        assigneeTeamMemberId: s.assignee_team_member_id,
        dueOffsetDays: s.due_offset_days,
        kind: s.kind as SocialStepKind,
        dependsOnIndex: s.depends_on_step_id
          ? (stepIndexById.get(s.depends_on_step_id) ?? null)
          : null,
      })),
    });
    setOpen(true);
  };

  const patchStep = (index: number, patch: Partial<SocialRoutineStepInput>) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));

  const removeStep = (index: number) =>
    setDraft((d) => ({
      ...d,
      steps: d.steps
        .filter((_, i) => i !== index)
        .map((s) => ({
          ...s,
          // A step that waited on the removed one now waits on nothing; one
          // that waited on a LATER step keeps waiting on the same step, which
          // has shifted down by one.
          dependsOnIndex:
            s.dependsOnIndex === null || s.dependsOnIndex === undefined
              ? null
              : s.dependsOnIndex === index
                ? null
                : s.dependsOnIndex > index
                  ? s.dependsOnIndex - 1
                  : s.dependsOnIndex,
        })),
    }));

  const handleSave = async () => {
    if (!draft.name.trim()) {
      message.warning("Give the routine a name.");
      return;
    }
    if (!draft.projectId) {
      message.warning("Pick the project its tasks should land in.");
      return;
    }
    if (draft.steps.some((s) => !s.title.trim())) {
      message.warning("Every step needs a title.");
      return;
    }
    try {
      await saveRoutine.mutateAsync({
        id: draft.id,
        routine: {
          name: draft.name.trim(),
          projectId: draft.projectId,
          scheduleType: draft.scheduleType,
          intervalValue: draft.intervalValue,
          dayOfWeek: draft.scheduleType === "weekly" ? draft.dayOfWeek : null,
          dayOfMonth: draft.scheduleType === "monthly" ? draft.dayOfMonth : null,
          startsOn: draft.startsOn,
          endsOn: draft.endsOn,
        },
        steps: draft.steps.map((s) => ({ ...s, title: s.title.trim() })),
      });
      setOpen(false);
      message.success(draft.id ? "Routine updated." : "Routine created.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to save the routine.",
      );
    }
  };

  const preview = useMemo(
    () =>
      previewOccurrences(
        {
          scheduleType: draft.scheduleType,
          intervalValue: draft.intervalValue,
          dayOfWeek: draft.dayOfWeek,
          dayOfMonth: draft.dayOfMonth,
          startsOn: draft.startsOn,
          endsOn: draft.endsOn,
        },
        3,
      ),
    [draft],
  );

  const card: React.CSSProperties = {
    background: C.panel,
    border: `1px solid ${C.hair}`,
    borderRadius: 18,
    padding: 16,
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>
            Recurring routines
          </div>
          <div style={{ fontSize: 12.5, color: C.textSecondary, maxWidth: 620 }}>
            Set the shape of a posting cycle once — who creates, who publishes,
            what waits on what — and it keeps producing real tasks on the
            calendar without anyone re-typing it.
          </div>
        </div>
        <Button
          type="primary"
          disabled={projects.length === 0}
          onClick={openCreate}
        >
          New routine
        </Button>
      </div>

      {isLoading ? (
        <div style={{ ...card, display: "grid", placeItems: "center", padding: 60 }}>
          <Spin />
        </div>
      ) : isError ? (
        <div style={{ ...card, textAlign: "center", padding: 40 }}>
          <div style={{ fontWeight: 700, color: C.text, marginBottom: 6 }}>
            Couldn’t load your routines
          </div>
          <Button onClick={() => void refetch()}>Try again</Button>
        </div>
      ) : (routines ?? []).length === 0 ? (
        <div
          style={{
            ...card,
            borderStyle: "dashed",
            textAlign: "center",
            padding: 44,
          }}
        >
          <div style={{ fontWeight: 700, color: C.text, marginBottom: 6 }}>
            No routines yet
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: C.textSecondary,
              maxWidth: 480,
              margin: "0 auto 16px",
            }}
          >
            {`A routine is the "every other day, Ravi makes the reel and Sneha publishes it the next morning" part — written down once.`}
          </div>
          <Button type="primary" disabled={projects.length === 0} onClick={openCreate}>
            Create the first one
          </Button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {(routines ?? []).map((r) => (
            <div key={r.id} style={card}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                      {r.name}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: r.active ? "rgba(47,143,95,0.14)" : C.panelSoft,
                        color: r.active ? C.green : C.textTertiary,
                      }}
                    >
                      {r.active ? "Active" : "Paused"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 4 }}>
                    {cadenceText({
                      ...BLANK_DRAFT(),
                      scheduleType: r.schedule_type as SocialScheduleType,
                      intervalValue: r.interval_value,
                      dayOfWeek: r.day_of_week,
                      dayOfMonth: r.day_of_month,
                    })}
                    {" · "}
                    {projectName(r.project_id)}
                    {r.next_run_at && r.active
                      ? ` · next ${dayjs(r.next_run_at).format("D MMM")}`
                      : ""}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Tooltip title={r.active ? "Pause the series" : "Resume the series"}>
                    <Switch
                      size="small"
                      checked={r.active}
                      loading={setActive.isPending}
                      onChange={(next) =>
                        void setActive
                          .mutateAsync({ id: r.id, active: next })
                          .catch(() => message.error("Couldn’t change that."))
                      }
                    />
                  </Tooltip>
                  <Button
                    size="small"
                    icon={<MIcon name="edit" size={15} />}
                    onClick={() => openEdit(r)}
                  />
                  <Popconfirm
                    title={`Delete "${r.name}"?`}
                    description="The tasks it already created stay — only the schedule goes."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={() =>
                      void deleteRoutine
                        .mutateAsync(r.id)
                        .then(() => message.success("Routine deleted."))
                        .catch(() => message.error("Couldn’t delete that."))
                    }
                  >
                    <Button size="small" danger icon={<MIcon name="delete" size={15} />} />
                  </Popconfirm>
                </div>
              </div>

              {/* The chain, read left to right: this is what one cycle produces. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  marginTop: 12,
                }}
              >
                {r.steps.map((s, i) => (
                  <span
                    key={s.id}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                  >
                    {i > 0 ? (
                      <MIcon
                        name={s.depends_on_step_id ? "arrow_forward" : "add"}
                        size={14}
                        color={C.textTertiary}
                      />
                    ) : null}
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 10px",
                        borderRadius: 999,
                        background: C.panelSoft,
                        border: `1px solid ${C.hair}`,
                        fontSize: 12,
                        color: C.text,
                      }}
                    >
                      <MIcon
                        name={
                          KIND_OPTIONS.find((k) => k.value === s.kind)?.icon ??
                          "check_circle"
                        }
                        size={14}
                        color={
                          s.platform
                            ? (PLATFORM_BRANDS[s.platform]?.color ?? C.accent)
                            : C.accent
                        }
                      />
                      {s.title}
                      <span style={{ color: C.textTertiary }}>
                        · {memberName(s.assignee_team_member_id)}
                        {s.due_offset_days > 0 ? ` · +${s.due_offset_days}d` : ""}
                      </span>
                    </span>
                  </span>
                ))}
                {r.steps.length === 0 ? (
                  <span style={{ fontSize: 12.5, color: C.textTertiary }}>
                    No steps yet — this routine would create an empty task.
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        okText={draft.id ? "Save routine" : "Create routine"}
        confirmLoading={saveRoutine.isPending}
        width={720}
        title={draft.id ? "Edit routine" : "New routine"}
        destroyOnHidden
      >
        <div style={{ display: "grid", gap: 12, paddingTop: 6 }}>
          <Input
            placeholder="Routine name (e.g. Alternate-day posting)"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            maxLength={160}
          />

          <Select
            placeholder="Project the tasks land in"
            value={draft.projectId}
            onChange={(v) => setDraft((d) => ({ ...d, projectId: v }))}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Segmented
              value={draft.scheduleType}
              onChange={(v) =>
                setDraft((d) => ({ ...d, scheduleType: v as SocialScheduleType }))
              }
              options={[
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            />
            <InputNumber
              min={1}
              max={365}
              value={draft.intervalValue}
              onChange={(v) => setDraft((d) => ({ ...d, intervalValue: v ?? 1 }))}
              addonBefore="Every"
              addonAfter={
                draft.scheduleType === "daily"
                  ? "days"
                  : draft.scheduleType === "weekly"
                    ? "weeks"
                    : "months"
              }
              style={{ width: 190 }}
            />
            {draft.scheduleType === "weekly" ? (
              <Select
                placeholder="On"
                value={draft.dayOfWeek ?? undefined}
                onChange={(v) => setDraft((d) => ({ ...d, dayOfWeek: v }))}
                options={WEEKDAY_OPTIONS}
                style={{ width: 140 }}
              />
            ) : null}
            {draft.scheduleType === "monthly" ? (
              <InputNumber
                min={1}
                max={31}
                placeholder="Day"
                value={draft.dayOfMonth ?? undefined}
                onChange={(v) => setDraft((d) => ({ ...d, dayOfMonth: v }))}
                addonBefore="Day"
                style={{ width: 130 }}
              />
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <DatePicker
              value={dayjs(draft.startsOn)}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  startsOn: (v ?? dayjs()).format("YYYY-MM-DD"),
                }))
              }
              allowClear={false}
              format="DD MMM YYYY"
              placeholder="Starts"
            />
            <DatePicker
              value={draft.endsOn ? dayjs(draft.endsOn) : null}
              onChange={(v) =>
                setDraft((d) => ({
                  ...d,
                  endsOn: v ? v.format("YYYY-MM-DD") : null,
                }))
              }
              format="DD MMM YYYY"
              placeholder="Ends (optional)"
            />
          </div>

          {/* What it will actually do, before it does it. */}
          <div
            style={{
              background: C.panelSoft,
              border: `1px solid ${C.hair}`,
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 12.5,
              color: C.textSecondary,
            }}
          >
            <strong style={{ color: C.text }}>{cadenceText(draft)}</strong>
            {preview.length > 0 ? (
              <>
                {" — next: "}
                {preview.map((d) => dayjs(d).format("ddd D MMM")).join(" · ")}
              </>
            ) : (
              " — the end date is before the first run, so nothing would be created."
            )}
          </div>

          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: C.textTertiary,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              marginTop: 4,
            }}
          >
            Steps — each becomes a subtask
          </div>

          {draft.steps.map((s, index) => (
            <div
              key={index}
              style={{
                border: `1px solid ${C.hair}`,
                borderRadius: 12,
                padding: 10,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <Input
                  placeholder="Step title (e.g. Instagram reel — creation)"
                  value={s.title}
                  onChange={(e) => patchStep(index, { title: e.target.value })}
                  maxLength={200}
                />
                <Tooltip title="Remove step">
                  <Button
                    danger
                    icon={<MIcon name="close" size={15} />}
                    onClick={() => removeStep(index)}
                  />
                </Tooltip>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Select
                  placeholder="Assignee"
                  value={s.assigneeTeamMemberId ?? undefined}
                  onChange={(v) => patchStep(index, { assigneeTeamMemberId: v ?? null })}
                  options={memberOptions}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ minWidth: 170 }}
                />
                <Select
                  placeholder="Platform"
                  value={s.platform ?? undefined}
                  onChange={(v) => patchStep(index, { platform: v ?? null })}
                  options={SOCIAL_PLATFORMS.map((p) => ({
                    value: p,
                    label: PLATFORM_BRANDS[p]?.label ?? p,
                  }))}
                  allowClear
                  style={{ minWidth: 140 }}
                />
                <Select
                  value={s.kind ?? "generic"}
                  onChange={(v) => patchStep(index, { kind: v })}
                  options={KIND_OPTIONS.map((k) => ({
                    value: k.value,
                    label: k.label,
                  }))}
                  style={{ width: 120 }}
                />
                <InputNumber
                  min={0}
                  max={60}
                  value={s.dueOffsetDays}
                  onChange={(v) => patchStep(index, { dueOffsetDays: v ?? 0 })}
                  addonBefore="Due +"
                  addonAfter="d"
                  style={{ width: 150 }}
                />
                <Select
                  placeholder="Waits for…"
                  value={s.dependsOnIndex ?? undefined}
                  onChange={(v) => patchStep(index, { dependsOnIndex: v ?? null })}
                  allowClear
                  // Only earlier steps: a step waiting on a later one is a loop
                  // the materializer could never satisfy.
                  options={draft.steps
                    .map((other, i) => ({ value: i, label: other.title || `Step ${i + 1}` }))
                    .filter((_, i) => i < index)}
                  style={{ minWidth: 170 }}
                />
              </div>
            </div>
          ))}

          <Button
            icon={<MIcon name="add" size={15} />}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                steps: [
                  ...d.steps,
                  {
                    title: "",
                    dueOffsetDays: 0,
                    kind: "generic",
                    dependsOnIndex: null,
                  },
                ],
              }))
            }
          >
            Add step
          </Button>
        </div>
      </Modal>
    </div>
  );
}
