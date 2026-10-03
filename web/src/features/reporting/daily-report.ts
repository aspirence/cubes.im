"use client";

/**
 * The daily company report — one window of time (a day by default, up to a
 * month) across the whole active team: what got done, who logged what, what
 * is slipping, and, where the team runs them, the CRM and HR sides of the day.
 *
 * Everything is read through the caller's RLS, the same scope the Reporting
 * pages use, so the report shows exactly what the caller could open by hand.
 * The window is the caller's local calendar days: [from 00:00, to+1 00:00).
 *
 * Sections whose app is not in use (no CRM installed, no HR org) come back
 * `null` and are left out of the preview and every download.
 */

import dayjs, { type Dayjs } from "dayjs";
import type { createClient } from "@/lib/supabase/client";
import { crmLeadStatusMeta } from "@/features/app-crm/types";

type Supabase = ReturnType<typeof createClient>;

/** Longest window a report may cover — keeps every query under the row cap. */
export const MAX_REPORT_DAYS = 31;

export interface ReportKpis {
  completed: number;
  created: number;
  minutes: number;
  billableMinutes: number;
  /** Members who completed a task, logged time or commented in the window. */
  activePeople: number;
  /** Open tasks whose due date fell before the window started. */
  overdue: number;
  /** Open tasks due inside the window. */
  dueInWindow: number;
  comments: number;
}

export interface ReportProjectRow {
  id: string;
  name: string;
  color: string;
  completed: number;
  created: number;
  minutes: number;
  overdue: number;
}

export interface ReportPersonRow {
  teamMemberId: string;
  userId: string;
  name: string;
  completed: number;
  minutes: number;
  billableMinutes: number;
  comments: number;
  /** Single-day reports only: that day's HR attendance, when the org has it. */
  attendance: string | null;
  clockIn: string | null;
  clockOut: string | null;
}

export interface ReportTaskRow {
  code: string;
  name: string;
  project: string;
  assignees: string;
  /** Completed-at for done tasks, created-at for new ones. */
  at: string;
  due: string | null;
  /** Whole days past due when it closed (done) or as of today (open). */
  daysLate: number | null;
}

export interface ReportTimeRow {
  at: string;
  person: string;
  code: string;
  task: string;
  project: string;
  minutes: number;
  billable: boolean;
  note: string;
}

export interface ReportCrm {
  newLeads: number;
  converted: number;
  junk: number;
  statusChanges: number;
  pipelineValue: number;
  currency: string;
  bySource: { label: string; count: number }[];
  byStatus: { label: string; count: number }[];
  leads: {
    name: string;
    company: string;
    source: string;
    status: string;
    amount: number | null;
    createdAt: string;
  }[];
}

export interface ReportAttendance {
  counts: { label: string; count: number }[];
  rows: {
    date: string;
    name: string;
    status: string;
    clockIn: string | null;
    clockOut: string | null;
    workMinutes: number | null;
  }[];
  leaves: {
    name: string;
    type: string;
    from: string;
    to: string;
    days: number;
    status: string;
  }[];
}

export interface DailyReport {
  teamName: string;
  generatedAt: string;
  generatedBy: string;
  /** Inclusive local dates, YYYY-MM-DD. */
  from: string;
  to: string;
  days: number;
  /** "Tuesday, 29 Sep 2026" or "22 Sep – 28 Sep 2026". */
  label: string;
  kpis: ReportKpis;
  /** The same counts for the equal-length window just before, for deltas. */
  previous: Pick<ReportKpis, "completed" | "created" | "minutes">;
  projects: ReportProjectRow[];
  people: ReportPersonRow[];
  completedTasks: ReportTaskRow[];
  createdTasks: ReportTaskRow[];
  attention: ReportTaskRow[];
  timeLogs: ReportTimeRow[];
  crm: ReportCrm | null;
  attendance: ReportAttendance | null;
}

/** Which sections a download includes; KPIs and the headline always do. */
export interface ReportSections {
  projects: boolean;
  people: boolean;
  completed: boolean;
  attention: boolean;
  created: boolean;
  time: boolean;
  crm: boolean;
  attendance: boolean;
}

export const REPORT_SECTIONS: { key: keyof ReportSections; label: string }[] = [
  { key: "projects", label: "Projects" },
  { key: "people", label: "People" },
  { key: "completed", label: "Completed tasks" },
  { key: "attention", label: "Needs attention" },
  { key: "created", label: "New tasks" },
  { key: "time", label: "Time log" },
  { key: "crm", label: "CRM" },
  { key: "attendance", label: "Attendance" },
];

export const ALL_SECTIONS: ReportSections = {
  projects: true,
  people: true,
  completed: true,
  attention: true,
  created: true,
  time: true,
  crm: true,
  attendance: true,
};

/* ------------------------------------------------------------ helpers */

/** "29 Sep 2026" for one day, "22 – 28 Sep 2026" style for a range. */
export function reportLabel(from: Dayjs, to: Dayjs): string {
  if (from.isSame(to, "day")) return from.format("dddd, D MMM YYYY");
  if (from.isSame(to, "year")) {
    return `${from.format("D MMM")} – ${to.format("D MMM YYYY")}`;
  }
  return `${from.format("D MMM YYYY")} – ${to.format("D MMM YYYY")}`;
}

/** Filename stem: `cubes-daily-report-acme-2026-09-29`. */
export function reportFileStem(report: DailyReport): string {
  const team = report.teamName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const span =
    report.from === report.to ? report.from : `${report.from}_to_${report.to}`;
  const kind = report.days === 1 ? "daily-report" : "report";
  return [team || "team", kind, span].join("-");
}

function taskCode(key: string | null | undefined, no: number | null) {
  return key && no != null ? `${key}-${no}` : no != null ? `#${no}` : "";
}

const titleCase = (s: string) =>
  s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function throwIf(error: { message: string } | null, what: string) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/* -------------------------------------------------------------- rows */

type ProjectEmbed = {
  id: string;
  name: string;
  key: string | null;
  color_code: string;
  team_id: string;
};

type TaskRow = {
  id: string;
  name: string;
  task_no: number | null;
  created_at: string;
  completed_at: string | null;
  end_date: string | null;
  project: ProjectEmbed;
  assignees: { team_member_id: string }[] | null;
};

type WorkLogRow = {
  id: string;
  created_at: string;
  time_spent: number;
  is_billable: boolean;
  description: string | null;
  user_id: string;
  task: {
    id: string;
    name: string;
    task_no: number | null;
    project: ProjectEmbed;
  };
};

type MemberRow = {
  id: string;
  user_id: string | null;
  user: { id: string; name: string } | null;
};

const PROJECT = "project:projects!tasks_project_id_fk!inner ( id, name, key, color_code, team_id )";
const TASK_SELECT = `id, name, task_no, created_at, completed_at, end_date, ${PROJECT},
  assignees:tasks_assignees!tasks_assignees_task_id_fk ( team_member_id )`;

/* ------------------------------------------------------------- fetch */

export interface FetchDailyReportArgs {
  teamId: string;
  teamName: string;
  from: Dayjs;
  to: Dayjs;
}

/**
 * Loads and assembles the report. Core work data (tasks, time, comments)
 * must load or the whole call fails; the CRM and HR sections are best-effort
 * and come back null when the team doesn't use them or the caller can't see
 * them.
 */
export async function fetchDailyReport(
  supabase: Supabase,
  { teamId, teamName, from, to }: FetchDailyReportArgs,
): Promise<DailyReport> {
  const start = from.startOf("day");
  const end = to.startOf("day").add(1, "day");
  const days = end.diff(start, "day");
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const prevStartIso = start.subtract(days, "day").toISOString();
  // "Overdue" is judged against the window's start, or now for a window that
  // is still running, so today's report doesn't flag tasks due later today.
  const now = dayjs();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    membersRes,
    completedRes,
    createdRes,
    openRes,
    logsRes,
    commentsRes,
    prevCompletedRes,
    prevCreatedRes,
    prevLogsRes,
  ] = await Promise.all([
    supabase
      .from("team_members")
      .select("id, user_id, user:users!team_members_user_id_fk ( id, name )")
      .eq("team_id", teamId)
      .eq("active", true),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("project.team_id", teamId)
      .eq("done", true)
      .gte("completed_at", startIso)
      .lt("completed_at", endIso)
      .order("completed_at", { ascending: true })
      .limit(1000),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("project.team_id", teamId)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true })
      .limit(1000),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("project.team_id", teamId)
      .eq("done", false)
      .eq("archived", false)
      .not("end_date", "is", null)
      .lt("end_date", endIso)
      .order("end_date", { ascending: true })
      .limit(1000),
    supabase
      .from("task_work_log")
      .select(
        `id, created_at, time_spent, is_billable, description, user_id,
         task:tasks!task_work_log_task_id_fk!inner ( id, name, task_no, ${PROJECT} )`,
      )
      .eq("task.project.team_id", teamId)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true })
      .limit(1000),
    supabase
      .from("task_comments")
      .select(
        `id, created_by,
         task:tasks!task_comments_task_id_fk!inner ( id, project:projects!tasks_project_id_fk!inner ( id, team_id ) )`,
      )
      .eq("task.project.team_id", teamId)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(1000),
    supabase
      .from("tasks")
      .select("id, project:projects!tasks_project_id_fk!inner ( team_id )", {
        count: "exact",
        head: true,
      })
      .eq("project.team_id", teamId)
      .eq("done", true)
      .gte("completed_at", prevStartIso)
      .lt("completed_at", startIso),
    supabase
      .from("tasks")
      .select("id, project:projects!tasks_project_id_fk!inner ( team_id )", {
        count: "exact",
        head: true,
      })
      .eq("project.team_id", teamId)
      .gte("created_at", prevStartIso)
      .lt("created_at", startIso),
    supabase
      .from("task_work_log")
      .select(
        `time_spent,
         task:tasks!task_work_log_task_id_fk!inner ( project:projects!tasks_project_id_fk!inner ( team_id ) )`,
      )
      .eq("task.project.team_id", teamId)
      .gte("created_at", prevStartIso)
      .lt("created_at", startIso)
      .limit(5000),
  ]);

  throwIf(membersRes.error, "Members");
  throwIf(completedRes.error, "Completed tasks");
  throwIf(createdRes.error, "New tasks");
  throwIf(openRes.error, "Open tasks");
  throwIf(logsRes.error, "Time logs");
  throwIf(commentsRes.error, "Comments");

  const members = (membersRes.data ?? []) as unknown as MemberRow[];
  const generatedBy =
    members.find((m) => m.user_id === user?.id)?.user?.name ??
    user?.email ??
    "Cubes";
  const completed = (completedRes.data ?? []) as unknown as TaskRow[];
  const created = (createdRes.data ?? []) as unknown as TaskRow[];
  const open = (openRes.data ?? []) as unknown as TaskRow[];
  const logs = (logsRes.data ?? []) as unknown as WorkLogRow[];
  const comments = (commentsRes.data ?? []) as unknown as {
    created_by: string | null;
  }[];

  /* ------------------------------------------------ people index */

  const memberName = new Map<string, string>();
  const userName = new Map<string, string>();
  const userToMember = new Map<string, string>();
  for (const m of members) {
    const name = m.user?.name ?? "Unknown";
    memberName.set(m.id, name);
    if (m.user_id) {
      userName.set(m.user_id, name);
      userToMember.set(m.user_id, m.id);
    }
  }
  const namesOf = (t: TaskRow) =>
    (t.assignees ?? [])
      .map((a) => memberName.get(a.team_member_id))
      .filter(Boolean)
      .join(", ");

  const lateDays = (due: string | null, at: Dayjs) => {
    if (!due) return null;
    const d = at.startOf("day").diff(dayjs(due).startOf("day"), "day");
    return d > 0 ? d : null;
  };

  const toTaskRow = (t: TaskRow, at: string, lateAt: Dayjs): ReportTaskRow => ({
    code: taskCode(t.project.key, t.task_no),
    name: t.name,
    project: t.project.name,
    assignees: namesOf(t),
    at,
    due: t.end_date,
    daysLate: lateDays(t.end_date, lateAt),
  });

  /* ------------------------------------------------- task lists */

  const completedTasks = completed.map((t) =>
    toTaskRow(t, t.completed_at ?? t.created_at, dayjs(t.completed_at)),
  );
  const createdTasks = created.map((t) => toTaskRow(t, t.created_at, now));

  const overdueCut = now.isBefore(end) ? now : start;
  const overdueTasks = open.filter((t) =>
    dayjs(t.end_date).isBefore(start),
  );
  const dueInWindow = open.filter(
    (t) => !dayjs(t.end_date).isBefore(start),
  );
  // What is due in the window first, then the most recently slipped: a task
  // that went overdue yesterday is news, one that is 200 days late is not.
  const attention = [
    ...dueInWindow.map((t) => toTaskRow(t, t.created_at, overdueCut)),
    ...overdueTasks
      .map((t) => toTaskRow(t, t.created_at, overdueCut))
      .sort((a, b) => (a.daysLate ?? 0) - (b.daysLate ?? 0)),
  ];

  /* -------------------------------------------------- time logs */

  const timeLogs: ReportTimeRow[] = logs.map((l) => ({
    at: l.created_at,
    person: userName.get(l.user_id) ?? "Former member",
    code: taskCode(l.task.project.key, l.task.task_no),
    task: l.task.name,
    project: l.task.project.name,
    minutes: Math.round(l.time_spent / 60),
    billable: l.is_billable,
    note: l.description ?? "",
  }));

  /* --------------------------------------------------- projects */

  const projects = new Map<string, ReportProjectRow>();
  const projectRow = (p: ProjectEmbed) => {
    let row = projects.get(p.id);
    if (!row) {
      row = {
        id: p.id,
        name: p.name,
        color: p.color_code,
        completed: 0,
        created: 0,
        minutes: 0,
        overdue: 0,
      };
      projects.set(p.id, row);
    }
    return row;
  };
  for (const t of completed) projectRow(t.project).completed++;
  for (const t of created) projectRow(t.project).created++;
  for (const t of overdueTasks) projectRow(t.project).overdue++;
  for (const l of logs) {
    projectRow(l.task.project).minutes += Math.round(l.time_spent / 60);
  }

  /* ----------------------------------------------------- people */

  const people = new Map<string, ReportPersonRow>();
  for (const m of members) {
    if (!m.user_id) continue;
    people.set(m.id, {
      teamMemberId: m.id,
      userId: m.user_id,
      name: m.user?.name ?? "Unknown",
      completed: 0,
      minutes: 0,
      billableMinutes: 0,
      comments: 0,
      attendance: null,
      clockIn: null,
      clockOut: null,
    });
  }
  for (const t of completed) {
    for (const a of t.assignees ?? []) {
      const p = people.get(a.team_member_id);
      if (p) p.completed++;
    }
  }
  for (const l of logs) {
    const p = people.get(userToMember.get(l.user_id) ?? "");
    if (!p) continue;
    const m = Math.round(l.time_spent / 60);
    p.minutes += m;
    if (l.is_billable) p.billableMinutes += m;
  }
  for (const c of comments) {
    const p = people.get(userToMember.get(c.created_by ?? "") ?? "");
    if (p) p.comments++;
  }

  /* ---------------------------------------------- CRM + HR, best effort */

  const [crm, attendance] = await Promise.all([
    fetchCrm(supabase, teamId, startIso, endIso).catch(() => null),
    fetchAttendance(supabase, teamId, from, to).catch(() => null),
  ]);

  if (attendance && days === 1) {
    const byUser = new Map(attendance.byUser);
    for (const p of people.values()) {
      const a = byUser.get(p.userId);
      if (!a) continue;
      p.attendance = a.status;
      p.clockIn = a.clockIn;
      p.clockOut = a.clockOut;
    }
  }

  /* ------------------------------------------------------ KPIs */

  const minutes = timeLogs.reduce((s, l) => s + l.minutes, 0);
  const billableMinutes = timeLogs
    .filter((l) => l.billable)
    .reduce((s, l) => s + l.minutes, 0);
  const peopleList = [...people.values()].sort(
    (a, b) =>
      b.minutes - a.minutes ||
      b.completed - a.completed ||
      a.name.localeCompare(b.name),
  );

  const prevMinutes = (
    (prevLogsRes.data ?? []) as unknown as { time_spent: number }[]
  ).reduce((s, l) => s + Math.round(l.time_spent / 60), 0);

  return {
    teamName,
    generatedAt: now.toISOString(),
    generatedBy,
    from: start.format("YYYY-MM-DD"),
    to: to.format("YYYY-MM-DD"),
    days,
    label: reportLabel(start, to),
    kpis: {
      completed: completed.length,
      created: created.length,
      minutes,
      billableMinutes,
      activePeople: peopleList.filter(
        (p) => p.completed > 0 || p.minutes > 0 || p.comments > 0,
      ).length,
      overdue: overdueTasks.length,
      dueInWindow: dueInWindow.length,
      comments: comments.length,
    },
    previous: {
      completed: prevCompletedRes.count ?? 0,
      created: prevCreatedRes.count ?? 0,
      minutes: prevMinutes,
    },
    projects: [...projects.values()].sort(
      (a, b) =>
        b.completed - a.completed ||
        b.minutes - a.minutes ||
        b.overdue - a.overdue ||
        a.name.localeCompare(b.name),
    ),
    people: peopleList,
    completedTasks,
    createdTasks,
    attention,
    timeLogs,
    crm,
    attendance: attendance?.report ?? null,
  };
}

/* --------------------------------------------------------------- CRM */

async function fetchCrm(
  supabase: Supabase,
  teamId: string,
  startIso: string,
  endIso: string,
): Promise<ReportCrm | null> {
  const { data: app } = await supabase
    .from("installed_apps")
    .select("enabled")
    .eq("team_id", teamId)
    .eq("app_key", "crm")
    .maybeSingle();
  if (!app?.enabled) return null;

  const [dealsRes, changesRes] = await Promise.all([
    supabase
      .from("app_crm_deals")
      .select(
        `id, name, source, status, amount, currency_code, created_at,
         company:app_crm_companies!app_crm_deals_company_id_fk ( name ),
         campaign:app_crm_campaigns!app_crm_deals_campaign_id_fkey ( name )`,
      )
      .eq("team_id", teamId)
      .is("deleted_at", null)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true })
      .limit(1000),
    supabase
      .from("app_crm_activities")
      .select("properties")
      .eq("team_id", teamId)
      .eq("event", "status_changed")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(2000),
  ]);
  if (dealsRes.error || changesRes.error) return null;

  const deals = (dealsRes.data ?? []) as unknown as {
    name: string;
    source: string | null;
    status: string;
    amount: number | null;
    currency_code: string;
    created_at: string;
    company: { name: string } | null;
    campaign: { name: string } | null;
  }[];
  const changes = (changesRes.data ?? []) as { properties: unknown }[];

  const tally = (values: string[]) => {
    const m = new Map<string, number>();
    for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  };
  const sourceOf = (d: (typeof deals)[number]) =>
    d.campaign?.name ?? (d.source ? titleCase(d.source) : "Direct");
  const toStatus = (p: unknown) =>
    p && typeof p === "object" && "to" in p ? String((p as { to: unknown }).to) : "";

  // "Converted" counts every move into converted during the window, whether
  // the lead is new today or weeks old.
  const converted = changes.filter((c) => toStatus(c.properties) === "converted").length;

  return {
    newLeads: deals.length,
    converted,
    junk: deals.filter((d) => d.status === "junk").length,
    statusChanges: changes.length,
    pipelineValue: deals
      .filter((d) => d.status !== "junk")
      .reduce((s, d) => s + (d.amount ?? 0), 0),
    currency: deals[0]?.currency_code ?? "INR",
    bySource: tally(deals.map(sourceOf)),
    byStatus: tally(deals.map((d) => crmLeadStatusMeta(d.status).label)),
    leads: deals.map((d) => ({
      name: d.name,
      company: d.company?.name ?? "",
      source: sourceOf(d),
      status: crmLeadStatusMeta(d.status).label,
      amount: d.amount,
      createdAt: d.created_at,
    })),
  };
}

/* ---------------------------------------------------------------- HR */

async function fetchAttendance(
  supabase: Supabase,
  teamId: string,
  from: Dayjs,
  to: Dayjs,
): Promise<{
  report: ReportAttendance;
  byUser: [string, { status: string; clockIn: string | null; clockOut: string | null }][];
} | null> {
  const { data: team } = await supabase
    .from("teams")
    .select("organization_id")
    .eq("id", teamId)
    .maybeSingle();
  const orgId = team?.organization_id;
  if (!orgId) return null;

  const fromDate = from.format("YYYY-MM-DD");
  const toDate = to.format("YYYY-MM-DD");

  const [attRes, leaveRes] = await Promise.all([
    supabase
      .from("hr_attendance")
      .select(
        `date, status, clock_in, clock_out, work_minutes,
         employee:hr_employees!hr_attendance_employee_id_fk ( full_name, user_id )`,
      )
      .eq("org_id", orgId)
      .gte("date", fromDate)
      .lte("date", toDate)
      .order("date", { ascending: true })
      .limit(2000),
    supabase
      .from("hr_leave_requests")
      .select(
        `from_date, to_date, days, status,
         employee:hr_employees!hr_leave_requests_employee_id_fk ( full_name ),
         type:hr_leave_types!hr_leave_requests_leave_type_id_fk ( name )`,
      )
      .eq("org_id", orgId)
      .lte("from_date", toDate)
      .gte("to_date", fromDate)
      .in("status", ["approved", "pending"])
      .limit(500),
  ]);
  if (attRes.error) return null;

  const att = (attRes.data ?? []) as unknown as {
    date: string;
    status: string;
    clock_in: string | null;
    clock_out: string | null;
    work_minutes: number | null;
    employee: { full_name: string; user_id: string | null } | null;
  }[];
  const leaves = (leaveRes.data ?? []) as unknown as {
    from_date: string;
    to_date: string;
    days: number;
    status: string;
    employee: { full_name: string } | null;
    type: { name: string } | null;
  }[];

  // Weekends are noise in a company report; keep every other status.
  const worked = att.filter((a) => a.status !== "weekend");
  if (worked.length === 0 && leaves.length === 0) return null;

  const counts = new Map<string, number>();
  for (const a of worked) {
    const label = titleCase(a.status);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return {
    report: {
      counts: [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      rows: worked
        .map((a) => ({
          date: a.date,
          name: a.employee?.full_name ?? "Unknown",
          status: titleCase(a.status),
          clockIn: a.clock_in,
          clockOut: a.clock_out,
          workMinutes: a.work_minutes,
        }))
        .sort(
          (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
        ),
      leaves: leaves.map((l) => ({
        name: l.employee?.full_name ?? "Unknown",
        type: l.type?.name ?? "Leave",
        from: l.from_date,
        to: l.to_date,
        days: l.days,
        status: titleCase(l.status),
      })),
    },
    byUser: worked
      .filter((a) => a.employee?.user_id)
      .map((a) => [
        a.employee!.user_id as string,
        {
          status: titleCase(a.status),
          clockIn: a.clock_in,
          clockOut: a.clock_out,
        },
      ]),
  };
}
