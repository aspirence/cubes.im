"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  App as AntdApp,
  Avatar,
  Button,
  DatePicker,
  Form,
  InputNumber,
  Modal,
  Popover,
  Result,
  Segmented,
  Select,
  Skeleton,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { CreateTaskModal } from "@/features/tasks/create-task-modal";
import { useActiveTeam } from "@/features/teams/use-teams";
import {
  useTeamMembers,
  useIsTeamAdmin,
} from "@/features/team-members/use-team-members";
import { MemberSingleSelect } from "@/features/team-members/member-select";
import { useAuth } from "@/features/auth/use-auth";
import { useProjects } from "@/features/projects/use-projects";
import {
  useTeamAllocations,
  useCreateAllocation,
  type AllocationWithRelations,
} from "@/features/schedule/use-allocations";
import {
  useTeamAvailability,
  buildAvailabilityIndex,
  formatLeaveDays,
} from "@/features/schedule/use-availability";
import { useScheduleTasks } from "@/features/schedule/use-schedule-tasks";

/* ------------------------------------------------------------------ tokens */

const T = {
  accent: "#4a4ad0",
  accentBar: "#5a5ad6",
  accentSoft: "#eceefb",
  canvas: "#f6f7f9",
  panel: "#ffffff",
  hairline: "#ececf0",
  divider: "#f0f0f3",
  chipBg: "#f2f3f5",
  rowHover: "#fafafb",
  eventBg: "#fafafb",
  textPrimary: "#17171c",
  textSecondary: "#6a6d78",
  textTertiary: "#9a9da8",
  textFaint: "#a2a5af",
  warnFg: "#b8842a",
  warnBg: "#fdf5e6",
} as const;

const MONO = "var(--font-geist-mono)";

/** Solid category palette (white text), matching the handoff. */
const CATEGORY_COLORS = [
  "#5a5ad6",
  "#e0a83e",
  "#3a9d6e",
  "#8b6fd6",
  "#2f9c9c",
  "#d96a8f",
  "#e0663f",
  "#8a8d98",
];

function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}

/** An allocation row joined to its project + member, per the shared hook. */
type AllocationRow = AllocationWithRelations;

/* -------------------------------------------------------------- add modal */

interface AllocationFormValues {
  team_member_id: string;
  project_id: string;
  range: [Dayjs, Dayjs];
  hours_per_day: number;
}

function AddAllocationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<AllocationFormValues>();

  const { data: members } = useTeamMembers();
  const { data: projects } = useProjects();
  const createAllocation = useCreateAllocation();

  // Warn (without blocking) when the picked member has approved HR leave
  // inside the picked period.
  const watchedMemberId = Form.useWatch("team_member_id", form);
  const watchedRange = Form.useWatch("range", form);
  const rangeFrom = watchedRange?.[0]?.format("YYYY-MM-DD");
  const rangeTo = watchedRange?.[1]?.format("YYYY-MM-DD");
  const { data: rangeAvailabilityRaw } = useTeamAvailability(
    rangeFrom,
    rangeTo,
  );
  const leaveConflictDays = useMemo(() => {
    if (!watchedMemberId) return [];
    const idx = buildAvailabilityIndex(rangeAvailabilityRaw);
    const days = idx.leaveByMember.get(watchedMemberId);
    return days ? [...days.keys()] : [];
  }, [rangeAvailabilityRaw, watchedMemberId]);

  const memberOptions = (members ?? [])
    .filter((m) => m.user)
    .map((m) => ({
      value: m.id,
      label: m.user?.name ?? m.user?.email ?? "Unknown",
      avatarUrl: m.user?.avatar_url,
      email: m.user?.email,
    }));

  const watchedMemberName =
    memberOptions.find((o) => o.value === watchedMemberId)?.label ??
    "This member";

  const projectOptions = (projects ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }));

  const handleOk = async () => {
    let values: AllocationFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const [from, to] = values.range;
    createAllocation.mutate(
      {
        teamMemberId: values.team_member_id,
        projectId: values.project_id,
        allocatedFrom: from.format("YYYY-MM-DD"),
        allocatedTo: to.format("YYYY-MM-DD"),
        secondsPerDay: Math.round((values.hours_per_day ?? 8) * 3600),
      },
      {
        onSuccess: () => {
          message.success("Allocation added");
          form.resetFields();
          onClose();
        },
        onError: (err) => {
          message.error(
            err instanceof Error ? err.message : "Failed to add allocation",
          );
        },
      },
    );
  };

  return (
    <Modal
      title="Add allocation"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={createAllocation.isPending}
      okText="Add"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ hours_per_day: 8 }}
        preserve={false}
      >
        <Form.Item
          name="team_member_id"
          label="Team member"
          rules={[{ required: true, message: "Select a team member" }]}
        >
          <MemberSingleSelect options={memberOptions} placeholder="Select member" allowClear={false} />
        </Form.Item>
        <Form.Item
          name="project_id"
          label="Project"
          rules={[{ required: true, message: "Select a project" }]}
        >
          <Select
            options={projectOptions}
            placeholder="Select project"
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item
          name="range"
          label="Allocated period"
          rules={[{ required: true, message: "Pick a date range" }]}
        >
          <DatePicker.RangePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="hours_per_day" label="Hours per day">
          <InputNumber min={0} max={24} step={0.5} style={{ width: "100%" }} />
        </Form.Item>
        {leaveConflictDays.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 4 }}
            message={`${watchedMemberName} is on approved leave ${formatLeaveDays(
              leaveConflictDays,
            )} — ${leaveConflictDays.length} working day${
              leaveConflictDays.length === 1 ? "" : "s"
            } of this allocation.`}
          />
        )}
      </Form>
    </Modal>
  );
}

/* ------------------------------------------------------ calendar helpers */

function NavButton({
  children,
  onClick,
  ariaLabel,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel?: string;
  /** Highlighted state (e.g. the Yesterday/Today/Tomorrow jump that matches). */
  active?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        height: 32,
        minWidth: 32,
        padding: "0 10px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        border: `1px solid ${active ? T.accent : T.hairline}`,
        borderRadius: 8,
        background: active ? T.accentSoft : hover ? T.rowHover : T.panel,
        color: active ? T.accent : T.textPrimary,
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** One pill inside a day cell. */
interface DayChip {
  key: string;
  kind: "task" | "allocation" | "leave" | "holiday";
  label: string;
  sub?: string;
  color?: string;
  href?: string;
}

function ChipPill({
  chip,
  onOpen,
}: {
  chip: DayChip;
  onOpen: (href: string) => void;
}) {
  const clickable = Boolean(chip.href);
  const tone =
    chip.kind === "leave" || chip.kind === "holiday"
      ? { bg: T.warnBg, fg: T.warnFg, bar: T.warnFg }
      : { bg: T.eventBg, fg: T.textPrimary, bar: chip.color ?? T.accentBar };
  return (
    <div
      role={clickable ? "button" : undefined}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              onOpen(chip.href as string);
            }
          : undefined
      }
      title={chip.sub ? `${chip.label} — ${chip.sub}` : chip.label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 6px",
        borderRadius: 5,
        background: tone.bg,
        borderLeft: `3px solid ${tone.bar}`,
        fontSize: 11.5,
        lineHeight: "16px",
        color: tone.fg,
        cursor: clickable ? "pointer" : "default",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {chip.label}
      </span>
      {chip.sub ? (
        <span style={{ color: T.textTertiary, flex: "none" }}>{chip.sub}</span>
      ) : null}
    </div>
  );
}

function memberInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* ------------------------------------------------------------------ page */

export default function SchedulePage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = useIsTeamAdmin();
  const { data: activeTeam, isLoading: teamLoading } = useActiveTeam();
  const { data: members } = useTeamMembers();
  const {
    data: allocationsData,
    isLoading,
    isError,
    error,
  } = useTeamAllocations();

  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [anchor, setAnchor] = useState<Dayjs>(() => dayjs());
  // Calendar scope: focused day, single week row, or full month grid.
  const [view, setView] = useState<"day" | "week" | "month">("month");
  // Create-task-on-a-day (calendar hover "+").
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<Dayjs | null>(null);
  // null = "not chosen yet": admins default to Everyone, members to themselves.
  const [memberFilter, setMemberFilter] = useState<string | null>(null);

  const myTeamMemberId = useMemo(
    () => (members ?? []).find((m) => m.user?.id === user?.id)?.id,
    [members, user?.id],
  );
  const effectiveFilter =
    memberFilter ?? (isAdmin ? "all" : (myTeamMemberId ?? "all"));
  const matchesFilter = (teamMemberId: string) =>
    effectiveFilter === "all" || teamMemberId === effectiveFilter;

  // The visible range: whole weeks covering the anchor month (month view),
  // the anchor's week (week view), or the anchor day itself (day view).
  const gridStart = useMemo(
    () =>
      view === "month"
        ? anchor.startOf("month").startOf("week")
        : view === "week"
          ? anchor.startOf("week")
          : anchor.startOf("day"),
    [anchor, view],
  );
  const gridEnd = useMemo(
    () =>
      view === "month"
        ? anchor.endOf("month").endOf("week")
        : view === "week"
          ? anchor.endOf("week")
          : anchor.endOf("day"),
    [anchor, view],
  );
  const gridDays = useMemo(() => {
    const days: Dayjs[] = [];
    let d = gridStart;
    while (d.isBefore(gridEnd) || d.isSame(gridEnd, "day")) {
      days.push(d);
      d = d.add(1, "day");
    }
    return days;
  }, [gridStart, gridEnd]);
  const today = dayjs();

  const allocations: AllocationRow[] = useMemo(
    () => allocationsData ?? [],
    [allocationsData],
  );
  const { data: availabilityRaw } = useTeamAvailability(
    gridStart.format("YYYY-MM-DD"),
    gridEnd.format("YYYY-MM-DD"),
  );
  const availability = useMemo(
    () => buildAvailabilityIndex(availabilityRaw),
    [availabilityRaw],
  );
  const { data: dueTasks } = useScheduleTasks(
    gridStart.format("YYYY-MM-DD"),
    gridEnd.format("YYYY-MM-DD"),
  );

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) {
      map.set(m.id, m.user?.name ?? m.user?.email ?? "Unknown");
    }
    return map;
  }, [members]);

  // Per-day chips: holiday + leave + allocations + due tasks, member-filtered.
  const chipsByDay = useMemo(() => {
    const map = new Map<string, DayChip[]>();
    const push = (iso: string, chip: DayChip) => {
      map.set(iso, [...(map.get(iso) ?? []), chip]);
    };

    for (const day of gridDays) {
      const iso = day.format("YYYY-MM-DD");
      const holidayName = availability.holidays.get(iso);
      if (holidayName) {
        push(iso, {
          key: `hol-${iso}`,
          kind: "holiday",
          label: holidayName,
        });
      }
      for (const [tmId, dayMap] of availability.leaveByMember) {
        if (!matchesFilter(tmId)) continue;
        const label = dayMap.get(iso);
        if (!label) continue;
        push(iso, {
          key: `leave-${tmId}-${iso}`,
          kind: "leave",
          label: `${memberNameById.get(tmId) ?? "Member"} · ${label}`,
        });
      }
    }

    for (const a of allocations) {
      if (!matchesFilter(a.team_member_id)) continue;
      const from = dayjs(a.allocated_from);
      const to = dayjs(a.allocated_to);
      for (
        let d = from.isBefore(gridStart) ? gridStart : from;
        (d.isBefore(to) || d.isSame(to, "day")) &&
        (d.isBefore(gridEnd) || d.isSame(gridEnd, "day"));
        d = d.add(1, "day")
      ) {
        const iso = d.format("YYYY-MM-DD");
        const hours = (a.seconds_per_day ?? 0) / 3600;
        push(iso, {
          key: `alloc-${a.id}-${iso}`,
          kind: "allocation",
          label: a.project?.name ?? "Project",
          sub:
            effectiveFilter === "all"
              ? memberNameById.get(a.team_member_id)
              : hours > 0
                ? `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
                : undefined,
          color: a.project?.color_code ?? colorForKey(a.project_id),
          href: `/projects/${a.project_id}`,
        });
      }
    }

    for (const t of dueTasks ?? []) {
      if (
        effectiveFilter !== "all" &&
        !t.assignees.some((x) => x.team_member_id === effectiveFilter)
      ) {
        continue;
      }
      const iso = dayjs(t.end_date).format("YYYY-MM-DD");
      push(iso, {
        key: `task-${t.id}`,
        kind: "task",
        label: t.name,
        color: t.project?.color_code ?? colorForKey(t.project_id),
        href: `/projects/${t.project_id}?task=${t.id}`,
      });
    }
    return map;
    // matchesFilter closes over effectiveFilter (already a dep).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gridDays,
    gridStart,
    gridEnd,
    availability,
    allocations,
    dueTasks,
    memberNameById,
    effectiveFilter,
  ]);

  const memberFilterOptions = useMemo(
    () => [
      { value: "all", label: "Everyone" },
      ...(members ?? [])
        .filter((m) => m.user)
        .map((m) => ({ value: m.id, label: m.user!.name })),
    ],
    [members],
  );
  const avatarUrlByTm = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of members ?? []) map.set(m.id, m.user?.avatar_url ?? null);
    return map;
  }, [members]);

  const renderMemberOption = (value: string, label: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {value === "all" ? (
        <Avatar size={20} style={{ fontSize: 10, flex: "none" }}>
          ∗
        </Avatar>
      ) : (
        <Avatar
          size={20}
          src={avatarUrlByTm.get(value) ?? undefined}
          style={{ fontSize: 10, flex: "none" }}
        >
          {memberInitials(label)}
        </Avatar>
      )}
      <span>{label}</span>
    </span>
  );

  const rangeLabel =
    view === "month"
      ? anchor.format("MMMM YYYY")
      : view === "week"
        ? `${gridStart.format("MMM D")} – ${gridEnd.format("MMM D, YYYY")}`
        : anchor.format("dddd, MMMM D, YYYY");
  // "Today" / "Yesterday" / "Tomorrow" when the anchor is one of them.
  const relativeLabel = anchor.isSame(today, "day")
    ? "Today"
    : anchor.isSame(today.subtract(1, "day"), "day")
      ? "Yesterday"
      : anchor.isSame(today.add(1, "day"), "day")
        ? "Tomorrow"
        : null;

  /* ---------------------------------------------------------- header */

  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: 21,
            fontWeight: 600,
            letterSpacing: "-0.4px",
            color: T.textPrimary,
            lineHeight: 1.2,
          }}
        >
          Schedule
        </h1>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: T.textSecondary,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontFamily: MONO }}>{rangeLabel}</span>
          <span style={{ color: T.textTertiary }}>·</span>
          <span>
            {effectiveFilter === "all"
              ? activeTeam?.name
                ? `Calendar across ${activeTeam.name}`
                : "Team calendar"
              : `${memberNameById.get(effectiveFilter) ?? "Member"}'s calendar`}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", rowGap: 8 }}>
        <Select
          value={effectiveFilter}
          onChange={(v) => setMemberFilter(v)}
          options={memberFilterOptions}
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 180 }}
          optionRender={(o) =>
            renderMemberOption(o.value as string, String(o.label))
          }
          labelRender={(p) =>
            renderMemberOption(p.value as string, String(p.label))
          }
          aria-label="Whose calendar"
        />
        <div style={{ width: 1, height: 22, background: T.hairline }} />
        <Segmented
          value={view}
          onChange={(v) => setView(v as "day" | "week" | "month")}
          options={[
            { label: "Day", value: "day" },
            { label: "Week", value: "week" },
            { label: "Month", value: "month" },
          ]}
          aria-label="Calendar view"
        />
        <div style={{ width: 1, height: 22, background: T.hairline }} />
        <NavButton
          ariaLabel={`Previous ${view}`}
          onClick={() => setAnchor((a) => a.subtract(1, view))}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
            chevron_left
          </span>
        </NavButton>
        {view === "day" ? (
          <>
            <NavButton
              active={relativeLabel === "Yesterday"}
              onClick={() => setAnchor(dayjs().subtract(1, "day"))}
            >
              Yesterday
            </NavButton>
            <NavButton
              active={relativeLabel === "Today"}
              onClick={() => setAnchor(dayjs())}
            >
              Today
            </NavButton>
            <NavButton
              active={relativeLabel === "Tomorrow"}
              onClick={() => setAnchor(dayjs().add(1, "day"))}
            >
              Tomorrow
            </NavButton>
          </>
        ) : (
          <NavButton onClick={() => setAnchor(dayjs())}>Today</NavButton>
        )}
        <NavButton
          ariaLabel={`Next ${view}`}
          onClick={() => setAnchor((a) => a.add(1, view))}
        >
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
            chevron_right
          </span>
        </NavButton>
        <div style={{ width: 1, height: 22, background: T.hairline }} />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
          style={{ height: 32, borderRadius: 8 }}
        >
          Add allocation
        </Button>
      </div>
    </div>
  );

  /* ------------------------------------------------------------ body */

  // Week cells are a full row tall, so they can show far more before "+N more".
  const MAX_VISIBLE = view === "week" ? 10 : 3;

  let body: React.ReactNode;
  if (teamLoading || isLoading) {
    body = (
      <div
        style={{
          background: T.panel,
          border: `1px solid ${T.hairline}`,
          borderRadius: 12,
          padding: 18,
        }}
      >
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  } else if (isError) {
    body = (
      <div
        style={{
          background: T.panel,
          border: `1px solid ${T.hairline}`,
          borderRadius: 12,
        }}
      >
        <Result
          status="error"
          title="Couldn't load the schedule"
          subTitle={
            error instanceof Error
              ? error.message
              : "Something went wrong while loading allocations."
          }
        />
      </div>
    );
  } else if (view === "day") {
    const iso = anchor.format("YYYY-MM-DD");
    const chips = chipsByDay.get(iso) ?? [];
    body = (
      <div
        style={{
          background: T.panel,
          border: `1px solid ${T.hairline}`,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            padding: "14px 18px",
            borderBottom: `1px solid ${T.divider}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 15,
                fontWeight: 700,
                color: T.textPrimary,
              }}
            >
              {anchor.format("dddd, MMMM D")}
            </span>
            {relativeLabel ? (
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: T.accent,
                  background: T.accentSoft,
                  borderRadius: 999,
                  padding: "2px 10px",
                }}
              >
                {relativeLabel}
              </span>
            ) : null}
          </div>
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              setCreateDate(anchor);
              setCreateOpen(true);
            }}
            style={{ height: 30, borderRadius: 8 }}
          >
            Add task
          </Button>
        </div>
        <div
          style={{
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {chips.length === 0 ? (
            <div
              style={{
                padding: "36px 0",
                textAlign: "center",
                color: T.textTertiary,
                fontSize: 13,
              }}
            >
              Nothing scheduled for this day.
            </div>
          ) : (
            chips.map((chip) => (
              <ChipPill
                key={chip.key}
                chip={chip}
                onOpen={(href) => router.push(href)}
              />
            ))
          )}
        </div>
      </div>
    );
  } else {
    const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
      gridStart
        .add(i, "day")
        .format(view === "week" ? "ddd D" : "ddd")
        .toUpperCase(),
    );
    body = (
      <div
        style={{
          background: T.panel,
          border: `1px solid ${T.hairline}`,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {/* weekday header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            borderBottom: `1px solid ${T.divider}`,
          }}
        >
          {weekdayLabels.map((w) => (
            <div
              key={w}
              style={{
                padding: "8px 10px",
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: "0.5px",
                color: T.textTertiary,
                textAlign: "right",
              }}
            >
              {w}
            </div>
          ))}
        </div>
        {/* month grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
          }}
        >
          {gridDays.map((day, i) => {
            const iso = day.format("YYYY-MM-DD");
            const inMonth =
              view === "week" || day.month() === anchor.month();
            const isToday = day.isSame(today, "day");
            const chips = chipsByDay.get(iso) ?? [];
            const visible = chips.slice(0, MAX_VISIBLE);
            const overflow = chips.length - visible.length;
            return (
              <div
                key={iso}
                className="wl-cal-cell"
                style={{
                  minHeight: view === "week" ? 320 : 118,
                  padding: "6px 8px",
                  borderRight: (i + 1) % 7 === 0 ? "none" : `1px solid ${T.divider}`,
                  borderBottom:
                    i >= gridDays.length - 7 ? "none" : `1px solid ${T.divider}`,
                  background: inMonth ? T.panel : T.canvas,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <button
                    type="button"
                    className="wl-cal-add"
                    title={`Add task on ${day.format("MMM D")}`}
                    aria-label={`Add task on ${day.format("MMM D")}`}
                    onClick={() => {
                      setCreateDate(day);
                      setCreateOpen(true);
                    }}
                    style={{
                      border: "none",
                      background: T.accentSoft,
                      color: T.accent,
                      borderRadius: 6,
                      width: 20,
                      height: 20,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      opacity: 0,
                      transition: "opacity .12s ease",
                    }}
                  >
                    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 16 }}>
                      add
                    </span>
                  </button>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 12.5,
                      fontWeight: isToday ? 700 : 500,
                      color: isToday
                        ? "#fff"
                        : inMonth
                          ? T.textPrimary
                          : T.textFaint,
                      background: isToday ? T.accent : "transparent",
                      borderRadius: 10,
                      minWidth: 20,
                      height: 20,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 5px",
                    }}
                  >
                    {day.date()}
                  </span>
                </div>
                {visible.map((chip) => (
                  <ChipPill
                    key={chip.key}
                    chip={chip}
                    onOpen={(href) => router.push(href)}
                  />
                ))}
                {overflow > 0 ? (
                  <Popover
                    trigger="click"
                    placement="bottom"
                    content={
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          maxWidth: 280,
                        }}
                      >
                        {chips.map((chip) => (
                          <ChipPill
                            key={chip.key}
                            chip={chip}
                            onOpen={(href) => router.push(href)}
                          />
                        ))}
                      </div>
                    }
                  >
                    <button
                      type="button"
                      style={{
                        border: "none",
                        background: "transparent",
                        color: T.textSecondary,
                        fontSize: 11.5,
                        textAlign: "left",
                        padding: "0 6px",
                        cursor: "pointer",
                      }}
                    >
                      +{overflow} more
                    </button>
                  </Popover>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 4,
      }}
    >
      {header}
      {body}
      <AddAllocationModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <CreateTaskModal
        open={createOpen}
        defaultDue={createDate}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          // Reflect the new task on the calendar immediately.
          queryClient.invalidateQueries({ queryKey: ["schedule-tasks"] });
          setCreateOpen(false);
        }}
      />
      <style>{`
        .wl-cal-cell:hover { background: ${T.rowHover} !important; }
        .wl-cal-cell:hover .wl-cal-add { opacity: 1; }
        .wl-cal-add:hover { filter: brightness(0.96); }
      `}</style>
    </div>
  );
}
