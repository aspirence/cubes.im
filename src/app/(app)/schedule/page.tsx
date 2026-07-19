"use client";

import { useMemo, useState } from "react";
import { Button, Result, Skeleton } from "antd";
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
import { useAuth } from "@/features/auth/use-auth";
import {
  useTeamAllocations,
  type AllocationWithRelations,
} from "@/features/schedule/use-allocations";
import {
  useTeamAvailability,
  buildAvailabilityIndex,
} from "@/features/schedule/use-availability";
import { useScheduleTasks } from "@/features/schedule/use-schedule-tasks";

import {
  ChipPill,
  DayOverflow,
  MIcon,
  MONO,
  colorForKey,
  formatHours,
  useScheduleTokens,
  type DayChip,
} from "./_components/schedule-ui";
import { AddAllocationModal } from "./_components/add-allocation-modal";
import {
  ScheduleHeader,
  type ScheduleView,
} from "./_components/schedule-header";
import { SummaryStrip, type SummaryTile } from "./_components/summary-strip";

/** An allocation row joined to its project + member, per the shared hook. */
type AllocationRow = AllocationWithRelations;

export default function SchedulePage() {
  const T = useScheduleTokens();
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
  const [view, setView] = useState<ScheduleView>("month");
  // Create-task-on-a-day (calendar hover "+").
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<Dayjs | null>(null);
  // null = "not chosen yet": admins default to Everyone, members to themselves.
  const [memberFilter, setMemberFilter] = useState<string | null>(null);

  const myTeamMemberId = useMemo(
    () => (members ?? []).find((m) => m.user?.id === user?.id)?.id,
    [members, user?.id],
  );
  // Only admins/owners may view other people's or the whole team's calendar.
  // Everyone else (members, limited members, guests) is locked to their own
  // schedule — never "Everyone" and never another member, even defensively when
  // their team-member id can't be resolved.
  const effectiveFilter = isAdmin
    ? (memberFilter ?? "all")
    : (myTeamMemberId ?? "none");
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
  const avatarUrlByTm = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const m of members ?? []) map.set(m.id, m.user?.avatar_url ?? null);
    return map;
  }, [members]);

  // Per-day chips: holiday + leave + allocations + due tasks, member-filtered.
  // Each chip carries person/project/hours context for the hover detail card.
  const chipsByDay = useMemo(() => {
    const map = new Map<string, DayChip[]>();
    const push = (iso: string, chip: DayChip) => {
      map.set(iso, [...(map.get(iso) ?? []), chip]);
    };
    const personFor = (tmId: string) => ({
      name: memberNameById.get(tmId) ?? "Member",
      avatarUrl: avatarUrlByTm.get(tmId) ?? null,
    });

    for (const day of gridDays) {
      const iso = day.format("YYYY-MM-DD");
      const holidayName = availability.holidays.get(iso);
      if (holidayName) {
        push(iso, {
          key: `hol-${iso}`,
          kind: "holiday",
          label: holidayName,
          dateIso: iso,
        });
      }
      for (const [tmId, dayMap] of availability.leaveByMember) {
        if (!matchesFilter(tmId)) continue;
        const label = dayMap.get(iso);
        if (!label) continue;
        push(iso, {
          key: `leave-${tmId}-${iso}`,
          kind: "leave",
          label,
          person: personFor(tmId),
          dateIso: iso,
        });
      }
    }

    for (const a of allocations) {
      if (!matchesFilter(a.team_member_id)) continue;
      const person = a.team_member?.user
        ? {
            name: a.team_member.user.name ?? a.team_member.user.email,
            avatarUrl: a.team_member.user.avatar_url,
          }
        : personFor(a.team_member_id);
      const color = a.project?.color_code ?? colorForKey(a.project_id);
      const hours = (a.seconds_per_day ?? 0) / 3600;
      const from = dayjs(a.allocated_from);
      const to = dayjs(a.allocated_to);
      for (
        let d = from.isBefore(gridStart) ? gridStart : from;
        (d.isBefore(to) || d.isSame(to, "day")) &&
        (d.isBefore(gridEnd) || d.isSame(gridEnd, "day"));
        d = d.add(1, "day")
      ) {
        const iso = d.format("YYYY-MM-DD");
        push(iso, {
          key: `alloc-${a.id}-${iso}`,
          kind: "allocation",
          label: a.project?.name ?? "Project",
          sub: hours > 0 ? formatHours(hours) : undefined,
          color,
          href: `/projects/${a.project_id}`,
          person,
          hours,
          dateIso: iso,
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
      // On a specific member's calendar, attribute the task to THAT member —
      // assignees[] is an unordered embed, so [0] can be a different person.
      const displayAssignee =
        effectiveFilter !== "all"
          ? effectiveFilter
          : t.assignees[0]?.team_member_id;
      push(iso, {
        key: `task-${t.id}`,
        kind: "task",
        label: t.name,
        color: t.project?.color_code ?? colorForKey(t.project_id),
        href: `/projects/${t.project_id}?task=${t.id}`,
        person: displayAssignee ? personFor(displayAssignee) : null,
        projectName: t.project?.name,
        dateIso: iso,
        detail:
          t.assignees.length > 1
            ? `${t.assignees.length} assignees`
            : undefined,
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
    avatarUrlByTm,
    effectiveFilter,
  ]);

  // Days the summary tiles aggregate over: the anchor month (month view — the
  // grid's leading/trailing filler days don't count) or the visible week.
  const scopeDays = useMemo(
    () =>
      view === "month"
        ? gridDays.filter((d) => d.month() === anchor.month())
        : gridDays,
    [gridDays, view, anchor],
  );

  // Compact stat tiles, computed from already-fetched data. Adapts to the
  // member filter: team-wide coverage stats for Everyone, personal ones else.
  const summaryTiles = useMemo<SummaryTile[]>(() => {
    if (view === "day") return [];
    const scopeIso = new Set(scopeDays.map((d) => d.format("YYYY-MM-DD")));

    let totalHours = 0;
    const hoursByDay = new Map<string, number>();
    const people = new Set<string>();
    const projects = new Set<string>();
    for (const a of allocations) {
      if (!matchesFilter(a.team_member_id)) continue;
      const hours = (a.seconds_per_day ?? 0) / 3600;
      const from = dayjs(a.allocated_from);
      const to = dayjs(a.allocated_to);
      for (
        let d = from.isBefore(gridStart) ? gridStart : from;
        (d.isBefore(to) || d.isSame(to, "day")) &&
        (d.isBefore(gridEnd) || d.isSame(gridEnd, "day"));
        d = d.add(1, "day")
      ) {
        const iso = d.format("YYYY-MM-DD");
        if (!scopeIso.has(iso)) continue;
        totalHours += hours;
        hoursByDay.set(iso, (hoursByDay.get(iso) ?? 0) + hours);
        people.add(a.team_member_id);
        projects.add(a.project_id);
      }
    }

    let leaveDays = 0;
    for (const [tmId, dayMap] of availability.leaveByMember) {
      if (!matchesFilter(tmId)) continue;
      for (const iso of dayMap.keys()) if (scopeIso.has(iso)) leaveDays++;
    }
    let tasksDue = 0;
    for (const t of dueTasks ?? []) {
      if (
        effectiveFilter !== "all" &&
        !t.assignees.some((x) => x.team_member_id === effectiveFilter)
      ) {
        continue;
      }
      if (scopeIso.has(dayjs(t.end_date).format("YYYY-MM-DD"))) tasksDue++;
    }
    let busiestIso: string | null = null;
    for (const [iso, h] of hoursByDay) {
      if (busiestIso === null || h > (hoursByDay.get(busiestIso) ?? 0)) {
        busiestIso = iso;
      }
    }

    const teamSize = (members ?? []).filter((m) => m.user).length;
    const scopeName = view === "month" ? "this month" : "this week";
    const tiles: SummaryTile[] = [
      {
        key: "hours",
        icon: "schedule",
        label: `Allocated ${scopeName}`,
        value: formatHours(totalHours),
      },
      effectiveFilter === "all"
        ? {
            key: "people",
            icon: "group",
            label: "People scheduled",
            value: String(people.size),
            suffix: teamSize ? `of ${teamSize}` : undefined,
          }
        : {
            key: "projects",
            icon: "folder",
            label: "Projects",
            value: String(projects.size),
          },
      {
        key: "busiest",
        icon: "local_fire_department",
        label: "Busiest day",
        value: busiestIso ? dayjs(busiestIso).format("MMM D") : "—",
        suffix: busiestIso
          ? formatHours(hoursByDay.get(busiestIso) ?? 0)
          : undefined,
      },
      effectiveFilter === "all"
        ? {
            key: "bench",
            icon: "person_off",
            label: "Unallocated people",
            value: String(Math.max(teamSize - people.size, 0)),
          }
        : {
            key: "leave",
            icon: "event_busy",
            label: "Days on leave",
            value: String(leaveDays),
          },
      {
        key: "tasks",
        icon: "task_alt",
        label: "Tasks due",
        value: String(tasksDue),
      },
    ];
    return tiles;
    // matchesFilter closes over effectiveFilter (already a dep).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view,
    scopeDays,
    allocations,
    availability,
    dueTasks,
    members,
    gridStart,
    gridEnd,
    effectiveFilter,
  ]);

  const memberFilterOptions = useMemo(
    () => [
      { value: "all", label: "Everyone", avatarUrl: null },
      ...(members ?? [])
        .filter((m) => m.user)
        .map((m) => ({
          value: m.id,
          label: m.user!.name,
          avatarUrl: m.user!.avatar_url,
        })),
    ],
    [members],
  );

  const scopeLabel =
    effectiveFilter === "all"
      ? activeTeam?.name
        ? `Calendar across ${activeTeam.name}`
        : "Team calendar"
      : `${memberNameById.get(effectiveFilter) ?? "Member"}'s calendar`;
  // "Today" / "Yesterday" / "Tomorrow" when the anchor is one of them.
  const relativeLabel = anchor.isSame(today, "day")
    ? "Today"
    : anchor.isSame(today.subtract(1, "day"), "day")
      ? "Yesterday"
      : anchor.isSame(today.add(1, "day"), "day")
        ? "Tomorrow"
        : null;

  // Whether anything at all is scheduled in the visible range.
  const gridHasChips = useMemo(
    () => [...chipsByDay.values()].some((list) => list.length > 0),
    [chipsByDay],
  );
  const showAvatars = effectiveFilter === "all";

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
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: T.accentSoft,
                  color: T.accent,
                }}
              >
                <MIcon name="event_available" size={26} />
              </span>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: T.textPrimary,
                }}
              >
                Nothing scheduled for this day
              </div>
              <div style={{ fontSize: 12.5, color: T.textTertiary }}>
                Tasks due, allocations and leave will show up here.
              </div>
              <Button
                size="small"
                icon={<PlusOutlined />}
                style={{ marginTop: 4, borderRadius: 8 }}
                onClick={() => {
                  setCreateDate(anchor);
                  setCreateOpen(true);
                }}
              >
                Add task
              </Button>
            </div>
          ) : (
            chips.map((chip) => (
              <ChipPill
                key={chip.key}
                chip={chip}
                showAvatar={showAvatars}
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
    // Which grid column "today" falls in (accent the weekday label) — only
    // when today is actually inside the visible range.
    const todayIdx = gridDays.findIndex((d) => d.isSame(today, "day"));
    const todayCol = todayIdx >= 0 ? todayIdx % 7 : -1;
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
          {weekdayLabels.map((w, i) => {
            const wd = gridStart.add(i, "day").day();
            const isWeekendCol = wd === 0 || wd === 6;
            return (
              <div
                key={w}
                style={{
                  padding: "8px 10px",
                  fontSize: 11.5,
                  fontWeight: i === todayCol ? 700 : 600,
                  letterSpacing: "0.5px",
                  color:
                    i === todayCol
                      ? T.accent
                      : isWeekendCol
                        ? T.textFaint
                        : T.textTertiary,
                  textAlign: "right",
                }}
              >
                {w}
              </div>
            );
          })}
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
            const isWeekend = day.day() === 0 || day.day() === 6;
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
                  background: isToday
                    ? T.accentSoft
                    : inMonth
                      ? isWeekend
                        ? T.weekendBg
                        : T.panel
                      : T.canvas,
                  // Today gets a primary ring on top of the tint.
                  boxShadow: isToday ? `inset 0 0 0 1.5px ${T.accent}` : undefined,
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
                    showAvatar={showAvatars}
                    onOpen={(href) => router.push(href)}
                  />
                ))}
                {overflow > 0 ? (
                  <DayOverflow
                    day={day}
                    chips={chips}
                    hiddenCount={overflow}
                    groupByPerson={showAvatars}
                    onOpen={(href) => router.push(href)}
                  />
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
      }}
    >
      <ScheduleHeader
        view={view}
        onViewChange={setView}
        anchor={anchor}
        onAnchorChange={setAnchor}
        scopeLabel={scopeLabel}
        isAdmin={isAdmin}
        filterValue={effectiveFilter}
        filterOptions={memberFilterOptions}
        onFilterChange={setMemberFilter}
        onAddAllocation={() => setModalOpen(true)}
      />
      {/* Summary tiles when there's data; a call-to-action banner when not. */}
      {view !== "day" && !teamLoading && !isLoading && !isError ? (
        gridHasChips ? (
          <SummaryStrip tiles={summaryTiles} />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              padding: "13px 16px",
              background: T.panel,
              border: `1px dashed ${T.hairline}`,
              borderRadius: 12,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 10,
                background: T.accentSoft,
                color: T.accent,
                flex: "none",
              }}
            >
              <MIcon name="event_upcoming" size={20} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{ fontSize: 13, fontWeight: 600, color: T.textPrimary }}
              >
                Nothing scheduled this {view}
              </div>
              <div style={{ fontSize: 12, color: T.textTertiary }}>
                Allocations, tasks due and approved leave will appear here.
              </div>
            </div>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Button
                icon={<PlusOutlined />}
                style={{ height: 30, borderRadius: 8 }}
                onClick={() => {
                  setCreateDate(anchor);
                  setCreateOpen(true);
                }}
              >
                Add task
              </Button>
              {isAdmin ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  style={{ height: 30, borderRadius: 8 }}
                  onClick={() => setModalOpen(true)}
                >
                  Add allocation
                </Button>
              ) : null}
            </div>
          </div>
        )
      ) : null}
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
        .wl-cal-cell:hover { background: ${T.cellHover} !important; }
        .wl-cal-cell:hover .wl-cal-add { opacity: 1; }
        .wl-cal-add:hover { filter: brightness(0.96); }
        .wl-cal-chip { transition: box-shadow .12s ease; }
        .wl-cal-chip:hover { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14); }
        .wl-cal-more:hover { background: ${T.chipBgHover} !important; }
      `}</style>
    </div>
  );
}
