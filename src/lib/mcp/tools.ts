import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * MCP tool definitions + handlers for the Cubes MCP server (/api/mcp).
 *
 * SECURITY MODEL: handlers run on the service-role client (RLS bypassed), so
 * EVERY query here must be explicitly scoped to the token's workspace.
 * The rules:
 *   - reads on team-scoped tables filter by `ctx.teamId`;
 *   - any task-level operation first verifies the task's project belongs to
 *     the token's team via `assertTaskInTeam`;
 *   - writes stamp the token's user as the author (reporter/creator).
 * Never widen a query beyond the team, and never interpolate user input into
 * anything but bound filter values.
 */

type Admin = SupabaseClient<Database>;

export interface McpContext {
  admin: Admin;
  teamId: string;
  userId: string;
}

/** Thrown by handlers for user-facing tool errors (bad refs, not found). */
export class McpToolError extends Error {}

/* ----------------------------------------------------------------- utils --- */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clampLimit = (v: unknown, dflt: number, max: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : dflt;
  return Math.max(1, Math.min(max, n));
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/** Resolves a project reference (uuid or name, case-insensitive) in the team. */
async function resolveProject(
  ctx: McpContext,
  ref: string,
): Promise<{ id: string; name: string }> {
  if (UUID_RE.test(ref)) {
    const { data, error } = await ctx.admin
      .from("projects")
      .select("id, name")
      .eq("team_id", ctx.teamId)
      .eq("id", ref)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new McpToolError(`No project with id "${ref}" in this workspace.`);
    return data;
  }
  const { data, error } = await ctx.admin
    .from("projects")
    .select("id, name")
    .eq("team_id", ctx.teamId)
    .ilike("name", ref);
  if (error) throw error;
  const exact = (data ?? []).find((p) => p.name.toLowerCase() === ref.toLowerCase());
  if (exact) return exact;
  if ((data ?? []).length === 1) return data![0];
  const { data: fuzzy, error: fuzzyErr } = await ctx.admin
    .from("projects")
    .select("id, name")
    .eq("team_id", ctx.teamId)
    .ilike("name", `%${ref}%`)
    .limit(6);
  if (fuzzyErr) throw fuzzyErr;
  if ((fuzzy ?? []).length === 1) return fuzzy![0];
  if ((fuzzy ?? []).length > 1)
    throw new McpToolError(
      `Project "${ref}" is ambiguous. Matches: ${fuzzy!.map((p) => p.name).join(", ")}. Use the exact name or id.`,
    );
  throw new McpToolError(`No project matching "${ref}" in this workspace. Use list_projects first.`);
}

/** Verifies a task id belongs to the token's team; returns core columns. */
async function assertTaskInTeam(ctx: McpContext, taskId: string) {
  if (!UUID_RE.test(taskId)) throw new McpToolError("task_id must be a task UUID.");
  const { data, error } = await ctx.admin
    .from("tasks")
    .select("id, name, project_id, status_id, projects!tasks_project_id_fk!inner ( team_id, name )")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  const team = (data?.projects as { team_id: string; name: string } | null)?.team_id;
  if (!data || team !== ctx.teamId)
    throw new McpToolError(`No task with id "${taskId}" in this workspace.`);
  return {
    id: data.id,
    name: data.name,
    projectId: data.project_id,
    projectName: (data.projects as unknown as { name: string }).name,
  };
}

type StatusRow = {
  id: string;
  name: string;
  sort_order: number | null;
  sys_task_status_categories: {
    is_todo: boolean | null;
    is_doing: boolean | null;
    is_done: boolean | null;
  } | null;
};

async function projectStatuses(ctx: McpContext, projectId: string): Promise<StatusRow[]> {
  const { data, error } = await ctx.admin
    .from("task_statuses")
    .select("id, name, sort_order, sys_task_status_categories(is_todo, is_doing, is_done)")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as StatusRow[];
}

function bucketOf(s: StatusRow): "todo" | "doing" | "done" {
  if (s.sys_task_status_categories?.is_done) return "done";
  if (s.sys_task_status_categories?.is_doing) return "doing";
  return "todo";
}

/** Resolves a status by name or bucket keyword within a project. */
function pickStatus(statuses: StatusRow[], want: string): StatusRow {
  const w = want.trim().toLowerCase();
  const byName = statuses.find((s) => s.name.toLowerCase() === w);
  if (byName) return byName;
  if (w === "todo" || w === "to do") return statuses.find((s) => bucketOf(s) === "todo") ?? statuses[0];
  if (w === "doing" || w === "in progress") {
    const m = statuses.find((s) => bucketOf(s) === "doing");
    if (m) return m;
  }
  if (w === "done" || w === "complete" || w === "completed") {
    const m = statuses.find((s) => bucketOf(s) === "done");
    if (m) return m;
  }
  throw new McpToolError(
    `Unknown status "${want}". This project's statuses: ${statuses.map((s) => s.name).join(", ")}.`,
  );
}

async function priorityId(ctx: McpContext, want: string): Promise<string> {
  const { data, error } = await ctx.admin
    .from("task_priorities")
    .select("id, name, value")
    .order("value", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  const w = want.trim().toLowerCase();
  const byName = rows.find((p) => p.name.toLowerCase() === w);
  if (byName) return byName.id;
  if (w === "low" && rows[0]) return rows[0].id;
  if (w === "high" && rows.length > 0) return rows[rows.length - 1].id;
  if (w === "medium" && rows.length > 0) return rows[Math.floor(rows.length / 2)].id;
  throw new McpToolError(
    `Unknown priority "${want}". Available: ${rows.map((p) => p.name).join(", ")} (or low/medium/high).`,
  );
}

/** email -> active team_members row id for the token's team. */
async function membersByEmail(ctx: McpContext): Promise<Map<string, string>> {
  const { data, error } = await ctx.admin
    .from("team_members")
    .select("id, active, user:users!team_members_user_id_fk ( email )")
    .eq("team_id", ctx.teamId);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const m of data ?? []) {
    const email = (m.user as { email: string } | null)?.email;
    if (email && m.active !== false) map.set(email.toLowerCase(), m.id);
  }
  return map;
}

/** id -> email for rendering assignees. */
async function memberEmails(ctx: McpContext): Promise<Map<string, string>> {
  const byEmail = await membersByEmail(ctx);
  const inverse = new Map<string, string>();
  for (const [email, id] of byEmail) inverse.set(id, email);
  return inverse;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDueDate(v: string): string {
  if (!DATE_RE.test(v)) throw new McpToolError('Dates must be "YYYY-MM-DD".');
  return v;
}

/* ------------------------------------------------------------ tool specs --- */

export const TOOL_DEFINITIONS = [
  {
    name: "list_projects",
    description:
      "List the projects in the connected Cubes workspace with ids, names, and timelines.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_tasks",
    description:
      "List tasks in the workspace. Optionally filter by project (name or id), status bucket (todo/doing/done), or due window. Excludes completed tasks unless include_done is true.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name or id (omit for all projects)" },
        bucket: { type: "string", enum: ["todo", "doing", "done"] },
        due: { type: "string", enum: ["overdue", "today", "this_week"] },
        include_done: { type: "boolean", default: false },
        limit: { type: "number", description: "Max rows (default 50, max 200)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_task",
    description:
      "Get a task's full details: description, dates, status, priority, assignees, subtasks, and recent comments.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_task",
    description:
      "Create a task in a project. Supports description, due date, priority (low/medium/high or a name), status (project status name or todo/doing/done), and assignees by member email.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name or id" },
        name: { type: "string" },
        description: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        priority: { type: "string" },
        status: { type: "string" },
        assignee_emails: { type: "array", items: { type: "string" } },
      },
      required: ["project", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task",
    description:
      "Update a task: rename, edit description, change status (name or todo/doing/done), due date (YYYY-MM-DD, or \"none\" to clear), or priority.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        due_date: { type: "string" },
        priority: { type: "string" },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_task",
    description: "Mark a task as done (moves it to the project's Done status).",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a task (posted as the token's owner).",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        content: { type: "string" },
      },
      required: ["task_id", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "my_tasks",
    description:
      "List open tasks assigned to the token's owner in this workspace.",
    inputSchema: {
      type: "object",
      properties: {
        include_done: { type: "boolean", default: false },
        limit: { type: "number", description: "Max rows (default 50, max 200)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search",
    description: "Search projects and tasks in the workspace by name.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Max rows per kind (default 20, max 50)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "create_project",
    description: "Create a new project in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
] as const;

/* -------------------------------------------------------------- handlers --- */

type TaskListRow = {
  id: string;
  name: string;
  project_id: string;
  done: boolean | null;
  end_date: string | null;
  status_id: string | null;
  priority_id: string | null;
};

async function renderTasks(ctx: McpContext, rows: TaskListRow[]) {
  const projectIds = [...new Set(rows.map((t) => t.project_id))];
  const projectNames = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data } = await ctx.admin
      .from("projects")
      .select("id, name")
      .eq("team_id", ctx.teamId)
      .in("id", projectIds);
    for (const p of data ?? []) projectNames.set(p.id, p.name);
  }

  const statusNames = new Map<string, { name: string; bucket: string }>();
  if (projectIds.length > 0) {
    const { data } = await ctx.admin
      .from("task_statuses")
      .select("id, name, project_id, sys_task_status_categories(is_todo, is_doing, is_done)")
      .in("project_id", projectIds);
    for (const s of (data ?? []) as unknown as (StatusRow & { project_id: string })[]) {
      statusNames.set(s.id, { name: s.name, bucket: bucketOf(s) });
    }
  }

  const { data: priorities } = await ctx.admin
    .from("task_priorities")
    .select("id, name");
  const priorityNames = new Map((priorities ?? []).map((p) => [p.id, p.name]));

  const emails = await memberEmails(ctx);
  const assignees = new Map<string, string[]>();
  const taskIds = rows.map((t) => t.id);
  for (let i = 0; i < taskIds.length; i += 150) {
    const { data } = await ctx.admin
      .from("tasks_assignees")
      .select("task_id, team_member_id")
      .in("task_id", taskIds.slice(i, i + 150));
    for (const a of data ?? []) {
      const email = emails.get(a.team_member_id);
      if (email) assignees.set(a.task_id, [...(assignees.get(a.task_id) ?? []), email]);
    }
  }

  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    project: projectNames.get(t.project_id) ?? null,
    status: t.status_id ? (statusNames.get(t.status_id)?.name ?? null) : null,
    bucket: t.status_id ? (statusNames.get(t.status_id)?.bucket ?? null) : null,
    priority: t.priority_id ? (priorityNames.get(t.priority_id) ?? null) : null,
    due_date: t.end_date ? t.end_date.slice(0, 10) : null,
    done: t.done === true,
    assignees: assignees.get(t.id) ?? [],
  }));
}

export async function callTool(
  ctx: McpContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_projects": {
      const { data, error } = await ctx.admin
        .from("projects")
        .select("id, name, color_code, notes, start_date, end_date")
        .eq("team_id", ctx.teamId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return {
        workspace_scoped: true,
        projects: (data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          notes: p.notes,
          start_date: p.start_date,
          end_date: p.end_date,
        })),
      };
    }

    case "list_tasks": {
      const limit = clampLimit(args.limit, 50, 200);
      let projectIds: string[];
      if (str(args.project)) {
        projectIds = [(await resolveProject(ctx, str(args.project)!)).id];
      } else {
        const { data, error } = await ctx.admin
          .from("projects")
          .select("id")
          .eq("team_id", ctx.teamId);
        if (error) throw error;
        projectIds = (data ?? []).map((p) => p.id);
      }
      if (projectIds.length === 0) return { tasks: [] };

      const bucket = str(args.bucket);
      // Push the bucket into the query as a status_id filter, so `limit` counts
      // matching rows — filtering in JS after limiting would return an
      // arbitrary/short slice.
      let bucketStatusIds: string[] | null = null;
      if (bucket) {
        const { data: statuses, error: sErr } = await ctx.admin
          .from("task_statuses")
          .select("id, sys_task_status_categories(is_todo, is_doing, is_done)")
          .in("project_id", projectIds);
        if (sErr) throw sErr;
        bucketStatusIds = (statuses ?? [])
          .filter((s) => bucketOf(s as unknown as StatusRow) === bucket)
          .map((s) => s.id);
        if (bucketStatusIds.length === 0) return { tasks: [] };
      }

      // `bucket: "done"` implies completed tasks, so don't also require done=false.
      const wantDone = args.include_done === true || bucket === "done";

      let q = ctx.admin
        .from("tasks")
        .select("id, name, project_id, done, end_date, status_id, priority_id")
        .in("project_id", projectIds)
        .eq("archived", false)
        .order("end_date", { ascending: true, nullsFirst: false })
        .limit(limit);
      if (!wantDone) q = q.eq("done", false);
      if (bucketStatusIds) q = q.in("status_id", bucketStatusIds);

      const today = new Date().toISOString().slice(0, 10);
      if (args.due === "overdue") q = q.lt("end_date", today).eq("done", false);
      if (args.due === "today") q = q.gte("end_date", today).lte("end_date", `${today}T23:59:59`);
      if (args.due === "this_week") {
        const week = new Date();
        week.setDate(week.getDate() + 7);
        q = q.gte("end_date", today).lte("end_date", week.toISOString().slice(0, 10));
      }

      const { data, error } = await q;
      if (error) throw error;
      return { tasks: await renderTasks(ctx, (data ?? []) as TaskListRow[]) };
    }

    case "get_task": {
      const taskRef = str(args.task_id);
      if (!taskRef) throw new McpToolError("task_id is required.");
      const core = await assertTaskInTeam(ctx, taskRef);

      const { data: task, error } = await ctx.admin
        .from("tasks")
        .select(
          "id, name, description, done, completed_at, start_date, end_date, status_id, priority_id, project_id, created_at",
        )
        .eq("id", core.id)
        .single();
      if (error) throw error;

      const [rendered] = await renderTasks(ctx, [task as TaskListRow]);

      const { data: subtasks } = await ctx.admin
        .from("tasks")
        .select("id, name, done")
        .eq("parent_task_id", core.id)
        .limit(50);

      const { data: comments } = await ctx.admin
        .from("task_comments")
        .select("content, created_at, created_by")
        .eq("task_id", core.id)
        .order("created_at", { ascending: false })
        .limit(10);
      const authorIds = [...new Set((comments ?? []).map((c) => c.created_by).filter(Boolean))] as string[];
      const authorNames = new Map<string, string>();
      if (authorIds.length > 0) {
        const { data: authors } = await ctx.admin
          .from("users")
          .select("id, name")
          .in("id", authorIds);
        for (const a of authors ?? []) authorNames.set(a.id, a.name);
      }

      return {
        ...rendered,
        description: (task as { description: string | null }).description,
        start_date: (task as { start_date: string | null }).start_date,
        completed_at: (task as { completed_at: string | null }).completed_at,
        subtasks: (subtasks ?? []).map((s) => ({ id: s.id, name: s.name, done: s.done === true })),
        recent_comments: (comments ?? []).map((c) => ({
          author: c.created_by ? (authorNames.get(c.created_by) ?? "Unknown") : "Unknown",
          content: c.content,
          created_at: c.created_at,
        })),
      };
    }

    case "create_task": {
      const projectRef = str(args.project);
      const name = str(args.name);
      if (!projectRef || !name) throw new McpToolError("project and name are required.");
      const project = await resolveProject(ctx, projectRef);
      const statuses = await projectStatuses(ctx, project.id);
      const status = str(args.status)
        ? pickStatus(statuses, str(args.status)!)
        : (statuses.find((s) => bucketOf(s) === "todo") ?? statuses[0]);
      const prio = str(args.priority) ? await priorityId(ctx, str(args.priority)!) : null;
      const due = str(args.due_date) ? parseDueDate(str(args.due_date)!) : null;

      const { data: maxRow } = await ctx.admin
        .from("tasks")
        .select("sort_order")
        .eq("project_id", project.id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const sortOrder = Number(maxRow?.sort_order ?? 0) + 1;

      const { data: created, error } = await ctx.admin
        .from("tasks")
        .insert({
          project_id: project.id,
          name: name.slice(0, 500),
          description: str(args.description) ?? null,
          status_id: status?.id ?? null,
          priority_id: prio,
          end_date: due,
          reporter_id: ctx.userId,
          sort_order: sortOrder,
        })
        .select("id, name")
        .single();
      if (error) throw error;

      const skipped: string[] = [];
      const emails = Array.isArray(args.assignee_emails)
        ? args.assignee_emails.filter((e): e is string => typeof e === "string")
        : [];
      if (emails.length > 0) {
        const byEmail = await membersByEmail(ctx);
        const memberIds = new Set<string>();
        for (const e of emails) {
          const id = byEmail.get(e.toLowerCase());
          if (id) memberIds.add(id);
          else skipped.push(e);
        }
        // De-dup by member (two emails can map to the same member, or a caller
        // may repeat one) — the PK is (task_id, team_member_id).
        const rows = [...memberIds].map((team_member_id) => ({
          task_id: created.id,
          team_member_id,
          assigned_by: ctx.userId,
        }));
        if (rows.length > 0) {
          const { error: aErr } = await ctx.admin
            .from("tasks_assignees")
            .upsert(rows, { onConflict: "task_id,team_member_id", ignoreDuplicates: true });
          if (aErr) throw aErr;
        }
      }

      return {
        created: true,
        task_id: created.id,
        name: created.name,
        project: project.name,
        status: status?.name ?? null,
        due_date: due,
        skipped_assignees: skipped,
        url: `/projects/${project.id}?task=${created.id}`,
      };
    }

    case "update_task": {
      const taskRef = str(args.task_id);
      if (!taskRef) throw new McpToolError("task_id is required.");
      const core = await assertTaskInTeam(ctx, taskRef);

      const patch: Database["public"]["Tables"]["tasks"]["Update"] = {};
      if (str(args.name)) patch.name = str(args.name)!.slice(0, 500);
      if (typeof args.description === "string") patch.description = args.description;
      if (str(args.status)) {
        const statuses = await projectStatuses(ctx, core.projectId);
        patch.status_id = pickStatus(statuses, str(args.status)!).id;
      }
      if (str(args.priority)) patch.priority_id = await priorityId(ctx, str(args.priority)!);
      if (str(args.due_date)) {
        const v = str(args.due_date)!;
        patch.end_date = v.toLowerCase() === "none" ? null : parseDueDate(v);
      }
      if (Object.keys(patch).length === 0)
        throw new McpToolError("Nothing to update — pass at least one field.");

      const { error } = await ctx.admin.from("tasks").update(patch).eq("id", core.id);
      if (error) throw error;
      return { updated: true, task_id: core.id, changes: Object.keys(patch) };
    }

    case "complete_task": {
      const taskRef = str(args.task_id);
      if (!taskRef) throw new McpToolError("task_id is required.");
      const core = await assertTaskInTeam(ctx, taskRef);
      const statuses = await projectStatuses(ctx, core.projectId);
      const done = statuses.find((s) => bucketOf(s) === "done");
      if (!done) throw new McpToolError("This project has no Done-category status.");
      const { error } = await ctx.admin
        .from("tasks")
        .update({ status_id: done.id })
        .eq("id", core.id);
      if (error) throw error;
      return { completed: true, task_id: core.id, name: core.name, status: done.name };
    }

    case "add_comment": {
      const taskRef = str(args.task_id);
      const content = str(args.content);
      if (!taskRef || !content) throw new McpToolError("task_id and content are required.");
      const core = await assertTaskInTeam(ctx, taskRef);
      const { error } = await ctx.admin.from("task_comments").insert({
        task_id: core.id,
        content: content.slice(0, 5000),
        created_by: ctx.userId,
        mentions: [],
      });
      if (error) throw error;
      return { commented: true, task_id: core.id, task: core.name };
    }

    case "my_tasks": {
      const limit = clampLimit(args.limit, 50, 200);
      const { data: me, error: meErr } = await ctx.admin
        .from("team_members")
        .select("id")
        .eq("team_id", ctx.teamId)
        .eq("user_id", ctx.userId)
        .eq("active", true)
        .maybeSingle();
      if (meErr) throw meErr;
      if (!me) return { tasks: [], note: "Token owner is not an active member of this workspace." };

      // Filter (assignee + team + open/archived) and order server-side, THEN
      // cap — capping the assignee links first would drop tasks arbitrarily.
      let q = ctx.admin
        .from("tasks")
        .select(
          "id, name, project_id, done, end_date, status_id, priority_id, projects!tasks_project_id_fk!inner ( team_id ), tasks_assignees!inner ( team_member_id )",
        )
        .eq("projects.team_id", ctx.teamId)
        .eq("tasks_assignees.team_member_id", me.id)
        .eq("archived", false)
        .order("end_date", { ascending: true, nullsFirst: false })
        .limit(limit);
      if (args.include_done !== true) q = q.eq("done", false);
      const { data, error } = await q;
      if (error) throw error;
      return { tasks: await renderTasks(ctx, (data ?? []) as unknown as TaskListRow[]) };
    }

    case "search": {
      const query = str(args.query);
      if (!query) throw new McpToolError("query is required.");
      const limit = clampLimit(args.limit, 20, 50);
      // Escape LIKE wildcards in user input so it can't widen the pattern.
      const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

      const { data: projects, error: pErr } = await ctx.admin
        .from("projects")
        .select("id, name")
        .eq("team_id", ctx.teamId)
        .ilike("name", like)
        .limit(limit);
      if (pErr) throw pErr;

      const { data: teamProjects, error: tpErr } = await ctx.admin
        .from("projects")
        .select("id")
        .eq("team_id", ctx.teamId);
      if (tpErr) throw tpErr;
      const teamProjectIds = (teamProjects ?? []).map((p) => p.id);

      let tasks: TaskListRow[] = [];
      if (teamProjectIds.length > 0) {
        const { data, error } = await ctx.admin
          .from("tasks")
          .select("id, name, project_id, done, end_date, status_id, priority_id")
          .in("project_id", teamProjectIds)
          .ilike("name", like)
          .limit(limit);
        if (error) throw error;
        tasks = (data ?? []) as TaskListRow[];
      }

      return {
        projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name })),
        tasks: await renderTasks(ctx, tasks),
      };
    }

    case "create_project": {
      const name = str(args.name);
      if (!name) throw new McpToolError("name is required.");
      const trimmed = name.slice(0, 100);

      const { data: existing, error: exErr } = await ctx.admin
        .from("projects")
        .select("name, key")
        .eq("team_id", ctx.teamId);
      if (exErr) throw exErr;
      if ((existing ?? []).some((p) => p.name.toLowerCase() === trimmed.toLowerCase()))
        throw new McpToolError(`A project named "${trimmed}" already exists.`);

      const takenKeys = new Set(
        (existing ?? []).map((p) => (p.key ?? "").toLowerCase()).filter(Boolean),
      );
      let key = trimmed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase() || "PRJ";
      const base = key;
      for (let n = 2; takenKeys.has(key.toLowerCase()); n++) key = `${base}${n}`;

      const { data: created, error } = await ctx.admin
        .from("projects")
        .insert({
          team_id: ctx.teamId,
          name: trimmed,
          key,
          notes: str(args.notes) ?? null,
          owner_id: ctx.userId,
        })
        .select("id, name")
        .single();
      if (error) throw error;
      return {
        created: true,
        project_id: created.id,
        name: created.name,
        url: `/projects/${created.id}`,
      };
    }

    default:
      throw new McpToolError(`Unknown tool "${name}".`);
  }
}
