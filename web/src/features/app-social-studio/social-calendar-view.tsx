"use client";

import { useMemo, useState } from "react";
import { Button, Popover, Segmented, Select, Spin, Tooltip } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useTeamMembers } from "@/features/team-members/use-team-members";
import { useTaskDrawer } from "@/store/task-drawer-store";
import { MIcon, useC } from "./ui";
import {
  dayKey,
  useSocialCalendarTasks,
  type SocialCalendarTask,
} from "./use-social-calendar";
import {
  SOCIAL_POST_STATUS_META,
  type SocialPostStatus,
  type SocialPostWithRelations,
} from "./use-social-studio";
import { PLATFORM_BRANDS } from "./platform-icons";

type TypeFilter = "all" | "tasks" | "posts";

/** Monday-first weekday headers, matching the rest of the product's calendars. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** How many items a day cell shows before it collapses into "+N more". */
const PER_DAY_CAP = 4;

/**
 * The month grid the social desk is actually planned on.
 *
 * Two kinds of thing share it on purpose: the TASK (who is making the post, who
 * is publishing it, by when) and the POST itself (the deliverable, at its
 * scheduled time). They are the same piece of work seen from two ends, and
 * splitting them across two screens is what made the old 7-day Planner strip
 * hard to plan from.
 *
 * Tasks are real tasks — the same rows /schedule and the project boards read —
 * so clicking one opens the product's own TaskDrawer rather than a private
 * imitation of it. Subtasks, dependencies, assignees and comments all come
 * along for free, and anything edited here is edited everywhere.
 */
export function SocialCalendarView({
  posts,
  projectIds,
  renderPostCard,
  onNewPost,
}: {
  posts: SocialPostWithRelations[];
  /** Projects Social Studio is activated for — the definition of "social". */
  projectIds: string[];
  /**
   * The workspace's own PostCard, shown in a popover when a chip is clicked.
   * Passed in rather than imported so the calendar reuses the real card —
   * status action and all — instead of growing a second, thinner one.
   */
  renderPostCard: (post: SocialPostWithRelations) => React.ReactNode;
  onNewPost: () => void;
}) {
  const C = useC();
  const { open: openTask } = useTaskDrawer();
  const { data: members } = useTeamMembers();

  const [cursor, setCursor] = useState<Dayjs>(() => dayjs().startOf("month"));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("ALL");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /**
   * The grid always shows whole weeks, so it reaches into the neighbouring
   * months — and the query window below is derived from these same days, or the
   * first and last rows would render empty while clearly holding dates.
   *
   * Monday-first is derived by hand: dayjs only does ISO weeks with a plugin
   * this project doesn't load.
   */
  const days = useMemo(() => {
    const first = cursor.startOf("month");
    const offset = (first.day() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0
    const start = first.subtract(offset, "day");
    const last = cursor.endOf("month");
    const tailOffset = (7 - ((last.day() + 6) % 7) - 1 + 7) % 7;
    const end = last.add(tailOffset, "day");
    const out: Dayjs[] = [];
    for (let d = start; !d.isAfter(end, "day"); d = d.add(1, "day")) out.push(d);
    return out;
  }, [cursor]);

  const from = days[0]?.format("YYYY-MM-DD");
  const to = days[days.length - 1]?.format("YYYY-MM-DD");

  const {
    data: tasks,
    isLoading,
    isError,
    refetch,
  } = useSocialCalendarTasks(projectIds, from, to);

  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) if (m.user) map.set(m.id, m.user.name);
    return (id: string) => map.get(id) ?? "Someone";
  }, [members]);

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks ?? []) if (t.project) map.set(t.project.id, t.project.name);
    for (const p of posts) if (p.project) map.set(p.project.id, p.project.name);
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [tasks, posts]);

  const visibleTasks = useMemo(() => {
    if (typeFilter === "posts") return [];
    return (tasks ?? []).filter((t) => {
      if (projectFilter !== "ALL" && t.project_id !== projectFilter) return false;
      if (assigneeFilter !== "ALL") {
        return t.assignees.some((a) => a.team_member_id === assigneeFilter);
      }
      return true;
    });
  }, [tasks, typeFilter, projectFilter, assigneeFilter]);

  const visiblePosts = useMemo(() => {
    // A post has no assignee, so an assignee filter is a question it cannot
    // answer — hide posts rather than pretend they matched.
    if (typeFilter === "tasks" || assigneeFilter !== "ALL") return [];
    return posts.filter(
      (p) =>
        p.scheduled_for &&
        (projectFilter === "ALL" || p.project_id === projectFilter),
    );
  }, [posts, typeFilter, projectFilter, assigneeFilter]);

  /** One bucket per day, tasks first — the work comes before the deliverable. */
  const byDay = useMemo(() => {
    const map = new Map<
      string,
      { tasks: SocialCalendarTask[]; posts: SocialPostWithRelations[] }
    >();
    for (const d of days) map.set(d.format("YYYY-MM-DD"), { tasks: [], posts: [] });
    for (const t of visibleTasks) {
      map.get(dayKey(t.end_date))?.tasks.push(t);
    }
    for (const p of visiblePosts) {
      map.get(dayKey(p.scheduled_for as string))?.posts.push(p);
    }
    for (const bucket of map.values()) {
      bucket.posts.sort((a, b) =>
        (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""),
      );
    }
    return map;
  }, [days, visibleTasks, visiblePosts]);

  const total = visibleTasks.length + visiblePosts.length;
  const today = dayjs();

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const chipBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "4px 6px",
    border: "none",
    borderRadius: 7,
    background: "transparent",
    font: "inherit",
    fontSize: 11.5,
    lineHeight: 1.35,
    textAlign: "left",
    cursor: "pointer",
    minWidth: 0,
  };

  const ellipsis: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
    flex: 1,
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Toolbar: where you are, then what you're looking at, then what you can add. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Button
            aria-label="Previous month"
            icon={<MIcon name="chevron_left" size={18} />}
            onClick={() => setCursor((c) => c.subtract(1, "month"))}
          />
          <Button onClick={() => setCursor(dayjs().startOf("month"))}>
            Today
          </Button>
          <Button
            aria-label="Next month"
            icon={<MIcon name="chevron_right" size={18} />}
            onClick={() => setCursor((c) => c.add(1, "month"))}
          />
        </div>

        <div style={{ fontSize: 19, fontWeight: 800, color: C.text, minWidth: 168 }}>
          {cursor.format("MMMM YYYY")}
        </div>

        <Segmented
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as TypeFilter)}
          options={[
            { value: "all", label: "All" },
            { value: "tasks", label: "Tasks" },
            { value: "posts", label: "Posts" },
          ]}
        />

        <Select
          value={projectFilter}
          onChange={setProjectFilter}
          style={{ minWidth: 160 }}
          options={[{ value: "ALL", label: "All projects" }, ...projectOptions]}
        />

        <Select
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          showSearch
          optionFilterProp="label"
          style={{ minWidth: 170 }}
          options={[
            { value: "ALL", label: "Anyone" },
            ...(members ?? [])
              .filter((m) => m.user)
              .map((m) => ({ value: m.id, label: m.user!.name })),
          ]}
        />

        <span style={{ flex: 1 }} />

        <span style={{ fontSize: 12.5, color: C.textSecondary }}>
          {isLoading ? "…" : `${total} this month`}
        </span>
        <Button type="primary" onClick={onNewPost}>
          New post
        </Button>
      </div>

      {projectIds.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${C.hair}`,
            borderRadius: 16,
            padding: 40,
            textAlign: "center",
            color: C.textSecondary,
          }}
        >
          <div style={{ fontWeight: 700, color: C.text, marginBottom: 6 }}>
            Social Studio isn’t on any project yet
          </div>
          <div style={{ fontSize: 12.5, maxWidth: 460, margin: "0 auto" }}>
            {`This calendar shows the tasks from the projects Social Studio is added to. Add it to a project — or switch it to "all projects" in App Center — and the work shows up here.`}
          </div>
        </div>
      ) : isError ? (
        <div
          style={{
            border: `1px solid ${C.hair}`,
            borderRadius: 16,
            padding: 40,
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 700, color: C.text, marginBottom: 6 }}>
            Couldn’t load the calendar
          </div>
          <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 14 }}>
            The scheduled posts below may also be out of date.
          </div>
          <Button onClick={() => void refetch()}>Try again</Button>
        </div>
      ) : (
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.hair}`,
            borderRadius: 18,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              borderBottom: `1px solid ${C.hair}`,
            }}
          >
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                style={{
                  padding: "8px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: C.textTertiary,
                }}
              >
                {d}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              position: "relative",
            }}
          >
            {isLoading ? (
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "grid",
                  placeItems: "center",
                  padding: 80,
                }}
              >
                <Spin />
              </div>
            ) : (
              days.map((day) => {
                const key = day.format("YYYY-MM-DD");
                const bucket = byDay.get(key) ?? { tasks: [], posts: [] };
                const items = bucket.tasks.length + bucket.posts.length;
                const outside = day.month() !== cursor.month();
                const isToday = day.isSame(today, "day");
                const isOpen = expanded.has(key);
                const shownTasks = isOpen
                  ? bucket.tasks
                  : bucket.tasks.slice(0, PER_DAY_CAP);
                const roomLeft = Math.max(0, PER_DAY_CAP - shownTasks.length);
                const shownPosts = isOpen
                  ? bucket.posts
                  : bucket.posts.slice(0, roomLeft);
                const hidden = items - shownTasks.length - shownPosts.length;

                return (
                  <div
                    key={key}
                    style={{
                      minHeight: 132,
                      minWidth: 0,
                      padding: 8,
                      borderRight: `1px solid ${C.hair}`,
                      borderBottom: `1px solid ${C.hair}`,
                      // Days outside the month stay legible but recede, so the
                      // month you asked for is the one you read.
                      background: outside ? C.panelSoft : "transparent",
                      opacity: outside ? 0.65 : 1,
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 2,
                      }}
                    >
                      <span
                        style={{
                          display: "grid",
                          placeItems: "center",
                          minWidth: 22,
                          height: 22,
                          paddingInline: 6,
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: isToday ? 800 : 600,
                          background: isToday ? C.accent : "transparent",
                          color: isToday ? "#fff" : C.textSecondary,
                        }}
                      >
                        {day.date()}
                      </span>
                    </div>

                    {shownTasks.map((t) => {
                      const who = t.assignees
                        .map((a) => memberName(a.team_member_id))
                        .join(", ");
                      return (
                        <Tooltip
                          key={t.id}
                          title={`${t.name}${who ? ` · ${who}` : ""}${
                            t.status ? ` · ${t.status.name}` : ""
                          }`}
                        >
                          <button
                            type="button"
                            style={{
                              ...chipBase,
                              background: C.accentSoft,
                              color: C.text,
                              textDecoration: t.done ? "line-through" : "none",
                              opacity: t.done ? 0.55 : 1,
                            }}
                            onClick={() => openTask(t.id)}
                          >
                            <MIcon
                              name={
                                t.done
                                  ? "check_circle"
                                  : t.parent_task_id
                                    ? "subdirectory_arrow_right"
                                    : "radio_button_unchecked"
                              }
                              size={13}
                              color={C.accent}
                            />
                            <span style={ellipsis}>{t.name}</span>
                          </button>
                        </Tooltip>
                      );
                    })}

                    {shownPosts.map((p) => {
                      const meta =
                        SOCIAL_POST_STATUS_META[p.status as SocialPostStatus] ??
                        SOCIAL_POST_STATUS_META.draft;
                      const platform = p.channels[0]?.channel?.platform;
                      const brand = platform
                        ? PLATFORM_BRANDS[platform]
                        : undefined;
                      return (
                        <Popover
                          key={p.id}
                          trigger="click"
                          placement="right"
                          content={
                            <div style={{ width: 320 }}>{renderPostCard(p)}</div>
                          }
                        >
                          <button
                            type="button"
                            title={`${p.title} · ${meta.label} · ${dayjs(
                              p.scheduled_for as string,
                            ).format("h:mm A")}`}
                            style={{
                              ...chipBase,
                              background: meta.soft,
                              color: C.text,
                            }}
                          >
                            <span
                              aria-hidden
                              style={{
                                width: 7,
                                height: 7,
                                flex: "none",
                                borderRadius: 999,
                                background: brand?.color ?? meta.tone,
                              }}
                            />
                            <span style={ellipsis}>{p.title}</span>
                            <span
                              style={{
                                flex: "none",
                                fontSize: 10.5,
                                color: C.textTertiary,
                              }}
                            >
                              {dayjs(p.scheduled_for as string).format("h:mm")}
                            </span>
                          </button>
                        </Popover>
                      );
                    })}

                    {hidden > 0 || (isOpen && items > PER_DAY_CAP) ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(key)}
                        style={{
                          ...chipBase,
                          justifyContent: "center",
                          color: C.textSecondary,
                          fontWeight: 600,
                        }}
                      >
                        {isOpen ? "Show less" : `+${hidden} more`}
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
