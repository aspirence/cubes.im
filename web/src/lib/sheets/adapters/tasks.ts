import { descriptionToText } from "@/features/tasks/description-text";
import { dayToInstant, instantToDay, normalize } from "../values";
import { limitedMemberIds } from "./limited";
import {
  AdapterError,
  chunks,
  fetchAll,
  type AdapterCtx,
  type AdapterRecord,
  type ListOptions,
  type SheetAdapter,
} from "./types";

/**
 * Tasks sheets: one row per task of the sheet's project. Writes go to the same
 * columns the task drawer writes — status_id, priority_id, start_date /
 * end_date as the local midnight of the picked day, the tasks_assignees and
 * task_labels link tables reconciled to the wanted set — so a change made in
 * a sheet (or in Google) is indistinguishable from one made in the drawer, and
 * the same triggers (activity log, done/completed_at, notifications) fire.
 */

interface TaskRow {
  id: string;
  task_no: number | null;
  name: string;
  description: string | null;
  status_id: string | null;
  priority_id: string | null;
  start_date: string | null;
  end_date: string | null;
  done: boolean;
  parent_task_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  tasks_assignees: { team_member_id: string }[] | null;
  task_labels: { label_id: string }[] | null;
  parent: { task_no: number | null; name: string } | null;
}

const SELECT =
  "id, task_no, name, description, status_id, priority_id, start_date, end_date, done, parent_task_id, sort_order, created_at, updated_at, " +
  "tasks_assignees!tasks_assignees_task_id_fk(team_member_id), task_labels!task_labels_task_id_fk(label_id)";

function projectOf(ctx: AdapterCtx): string {
  if (!ctx.projectId) throw new AdapterError("A tasks sheet belongs to a project.");
  return ctx.projectId;
}

function toRecord(t: TaskRow, ctx: AdapterCtx): AdapterRecord {
  return {
    key: t.id,
    fields: {
      task_no: t.task_no,
      name: t.name,
      status: t.status_id,
      priority: t.priority_id,
      assignees: (t.tasks_assignees ?? []).map((a) => a.team_member_id),
      start_date: instantToDay(t.start_date, ctx.timeZone),
      due_date: instantToDay(t.end_date, ctx.timeZone),
      labels: (t.task_labels ?? []).map((l) => l.label_id),
      description: t.description ? descriptionToText(t.description) || null : null,
      done: t.done,
      parent: t.parent ? `#${t.parent.task_no ?? "?"} ${t.parent.name}` : null,
      created_at: t.created_at,
      updated_at: t.updated_at,
    },
    updatedAt: t.updated_at,
    position: t.sort_order,
  };
}

/** Task ids a limited member may see: the ones assigned to them (can_view_task).
 *  The house rule this is one case of is written out in ./limited.ts. */
async function visibleTaskIds(ctx: AdapterCtx, projectId: string): Promise<Set<string> | null> {
  if (!ctx.limitToUserId) return null;
  const memberIds = await limitedMemberIds(ctx);
  if (memberIds.length === 0) return new Set();
  const rows = await fetchAll<{ task_id: string; tasks: { project_id: string } | null }>((from, to) =>
    ctx.admin
      .from("tasks_assignees")
      .select("task_id, tasks!tasks_assignees_task_id_fk!inner(project_id)")
      .in("team_member_id", memberIds)
      .eq("tasks.project_id", projectId)
      .range(from, to) as never,
  );
  return new Set(rows.map((r) => r.task_id));
}

async function loadTasks(ctx: AdapterCtx, keys?: string[]): Promise<TaskRow[]> {
  const projectId = projectOf(ctx);
  const cfg = ctx.sheet.source_config ?? {};
  const includeSubtasks = cfg.include_subtasks === true;
  const includeDone = cfg.include_done !== false;
  const build = (from: number, to: number, ids?: string[]) => {
    let q = ctx.admin.from("tasks").select(SELECT).eq("project_id", projectId).eq("archived", false);
    if (!includeSubtasks) q = q.is("parent_task_id", null);
    if (!includeDone) q = q.eq("done", false);
    if (ids) q = q.in("id", ids);
    return q.order("sort_order", { ascending: true }).order("created_at", { ascending: true }).range(from, to);
  };
  let rows: TaskRow[];
  if (keys) {
    rows = [];
    for (const part of chunks(keys)) {
      rows.push(...(await fetchAll<TaskRow>((from, to) => build(from, to, part) as never)));
    }
  } else {
    rows = await fetchAll<TaskRow>((from, to) => build(from, to) as never);
  }
  const visible = await visibleTaskIds(ctx, projectId);
  if (visible) rows = rows.filter((r) => visible.has(r.id));

  // Parent names for subtasks, in one query (PostgREST can't embed a table's
  // self-reference by constraint name, and the list is small anyway).
  const parentIds = [...new Set(rows.map((r) => r.parent_task_id).filter((id): id is string => Boolean(id)))];
  const parents = new Map<string, { task_no: number | null; name: string }>();
  for (const part of chunks(parentIds)) {
    const { data } = await ctx.admin.from("tasks").select("id, task_no, name").eq("project_id", projectId).in("id", part);
    for (const p of (data ?? []) as { id: string; task_no: number | null; name: string }[]) parents.set(p.id, p);
  }
  return rows.map((r) => ({ ...r, parent: r.parent_task_id ? parents.get(r.parent_task_id) ?? null : null }));
}

/** Loads one task of THIS project, or throws "not found" — every write starts
 *  here, so a key from another project can never be written. */
async function ownTask(ctx: AdapterCtx, key: string): Promise<{ id: string; name: string }> {
  const { data, error } = await ctx.admin
    .from("tasks")
    .select("id, name")
    .eq("id", key)
    .eq("project_id", projectOf(ctx))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new AdapterError("That task no longer exists in this project.", 404);
  if (ctx.limitToUserId) {
    const visible = await visibleTaskIds(ctx, projectOf(ctx));
    if (!visible?.has(key)) throw new AdapterError("That task no longer exists in this project.", 404);
  }
  return data as { id: string; name: string };
}

async function checkStatus(ctx: AdapterCtx, statusId: string): Promise<void> {
  const { data } = await ctx.admin
    .from("task_statuses")
    .select("id")
    .eq("id", statusId)
    .eq("project_id", projectOf(ctx))
    .maybeSingle();
  if (!data) throw new AdapterError("That status is not one of this project's statuses.");
}

async function checkPriority(ctx: AdapterCtx, priorityId: string): Promise<void> {
  const { data } = await ctx.admin.from("task_priorities").select("id").eq("id", priorityId).maybeSingle();
  if (!data) throw new AdapterError("Unknown priority.");
}

async function setAssignees(ctx: AdapterCtx, taskId: string, wanted: string[]): Promise<boolean> {
  if (wanted.length > 0) {
    const { data } = await ctx.admin
      .from("team_members")
      .select("id")
      .eq("team_id", ctx.teamId)
      .eq("active", true)
      .in("id", wanted);
    const ok = new Set((data ?? []).map((m: { id: string }) => m.id));
    const bad = wanted.find((id) => !ok.has(id));
    if (bad) throw new AdapterError("An assignee is not an active member of this workspace.");
  }
  const { data: current, error } = await ctx.admin
    .from("tasks_assignees")
    .select("team_member_id")
    .eq("task_id", taskId);
  if (error) throw new Error(error.message);
  const have = new Set((current ?? []).map((r: { team_member_id: string }) => r.team_member_id));
  const want = new Set(wanted);
  const add = wanted.filter((id) => !have.has(id));
  const drop = [...have].filter((id) => !want.has(id));
  if (add.length > 0) {
    const { data: pms } = await ctx.admin
      .from("project_members")
      .select("id, team_member_id")
      .eq("project_id", projectOf(ctx))
      .in("team_member_id", add);
    const pmBy = new Map((pms ?? []).map((p: { id: string; team_member_id: string }) => [p.team_member_id, p.id]));
    const { error: insErr } = await ctx.admin.from("tasks_assignees").insert(
      add.map((id) => ({
        task_id: taskId,
        team_member_id: id,
        project_member_id: pmBy.get(id) ?? null,
        assigned_by: ctx.actorUserId,
      })),
    );
    if (insErr) throw new Error(insErr.message);
  }
  if (drop.length > 0) {
    const { error: delErr } = await ctx.admin
      .from("tasks_assignees")
      .delete()
      .eq("task_id", taskId)
      .in("team_member_id", drop);
    if (delErr) throw new Error(delErr.message);
  }
  return add.length > 0 || drop.length > 0;
}

async function setLabels(ctx: AdapterCtx, taskId: string, wanted: string[]): Promise<boolean> {
  if (wanted.length > 0) {
    const { data } = await ctx.admin.from("team_labels").select("id").eq("team_id", ctx.teamId).in("id", wanted);
    const ok = new Set((data ?? []).map((l: { id: string }) => l.id));
    if (wanted.some((id) => !ok.has(id))) throw new AdapterError("A label is not one of this workspace's labels.");
  }
  const { data: current, error } = await ctx.admin.from("task_labels").select("label_id").eq("task_id", taskId);
  if (error) throw new Error(error.message);
  const have = new Set((current ?? []).map((r: { label_id: string }) => r.label_id));
  const want = new Set(wanted);
  const add = wanted.filter((id) => !have.has(id));
  const drop = [...have].filter((id) => !want.has(id));
  if (add.length > 0) {
    const { error: insErr } = await ctx.admin.from("task_labels").insert(add.map((id) => ({ task_id: taskId, label_id: id })));
    if (insErr) throw new Error(insErr.message);
  }
  if (drop.length > 0) {
    const { error: delErr } = await ctx.admin.from("task_labels").delete().eq("task_id", taskId).in("label_id", drop);
    if (delErr) throw new Error(delErr.message);
  }
  return add.length > 0 || drop.length > 0;
}

/** Field patch → tasks columns, validated. Link-table fields are returned
 *  separately because they are written after the row. */
async function toColumns(ctx: AdapterCtx, patch: Record<string, unknown>) {
  const cols: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(patch)) {
    switch (field) {
      case "name": {
        const name = (normalize("text", raw) as string | null) ?? "";
        if (!name) throw new AdapterError("A task needs a name.");
        if (name.length > 500) throw new AdapterError("Task names are at most 500 characters.");
        cols.name = name;
        break;
      }
      case "status": {
        const id = normalize("select", raw) as string | null;
        if (!id) throw new AdapterError("A task needs a status.");
        await checkStatus(ctx, id);
        cols.status_id = id;
        break;
      }
      case "priority": {
        const id = normalize("select", raw) as string | null;
        if (id) await checkPriority(ctx, id);
        cols.priority_id = id;
        break;
      }
      case "start_date":
      case "due_date": {
        const day = normalize("date", raw) as string | null;
        if (raw !== null && raw !== undefined && raw !== "" && !day) throw new AdapterError("Dates are YYYY-MM-DD.");
        cols[field === "start_date" ? "start_date" : "end_date"] = dayToInstant(day, ctx.timeZone);
        break;
      }
      case "description": {
        const text = normalize("long_text", raw) as string | null;
        if (text && text.length > 500_000) throw new AdapterError("The description is too long.");
        cols.description = text;
        break;
      }
      case "assignees":
      case "labels":
        break;
      default:
        throw new AdapterError(`“${field}” cannot be changed from a sheet.`);
    }
  }
  return cols;
}

export const tasksAdapter: SheetAdapter = {
  async list(ctx: AdapterCtx, opts?: ListOptions) {
    const rows = await loadTasks(ctx, opts?.keys);
    return rows.map((t) => toRecord(t, ctx));
  },

  async update(ctx, key, patch) {
    const task = await ownTask(ctx, key);
    const cols = await toColumns(ctx, patch);
    let linksChanged = false;
    if ("assignees" in patch) linksChanged = (await setAssignees(ctx, task.id, normalize("people", patch.assignees) as string[])) || linksChanged;
    if ("labels" in patch) linksChanged = (await setLabels(ctx, task.id, normalize("multi_select", patch.labels) as string[])) || linksChanged;
    // Assignee and label changes live in link tables that don't touch the
    // task's updated_at; touch it so "newest wins" sees the change.
    if (Object.keys(cols).length > 0 || linksChanged) {
      const { error } = await ctx.admin
        .from("tasks")
        .update(Object.keys(cols).length > 0 ? cols : { updated_at: new Date().toISOString() })
        .eq("id", task.id)
        .eq("project_id", projectOf(ctx));
      if (error) throw new AdapterError(error.message);
    }
  },

  async create(ctx, values) {
    const projectId = projectOf(ctx);
    const name = (normalize("text", values.name) as string | null) ?? "";
    if (!name) throw new AdapterError("A task needs a name.");
    // Same defaults as create_task(): the project's first To-Do status and the
    // bottom of the list. (create_task itself needs a session, which a sync
    // from Google doesn't have.)
    let statusId = normalize("select", values.status) as string | null;
    if (statusId) await checkStatus(ctx, statusId);
    else {
      const { data: todo } = await ctx.admin
        .from("task_statuses")
        .select("id, sort_order, sys_task_status_categories!task_statuses_category_id_fk(is_todo)")
        .eq("project_id", projectId)
        .order("sort_order", { ascending: true });
      const list = (todo ?? []) as unknown as { id: string; sys_task_status_categories: { is_todo: boolean } | null }[];
      statusId = (list.find((s) => s.sys_task_status_categories?.is_todo) ?? list[0])?.id ?? null;
    }
    const { data: last } = await ctx.admin
      .from("tasks")
      .select("sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rest = { ...values };
    delete rest.name;
    delete rest.status;
    const cols = await toColumns(ctx, rest);
    const { data, error } = await ctx.admin
      .from("tasks")
      .insert({
        ...cols,
        name: name.slice(0, 500),
        project_id: projectId,
        status_id: statusId,
        reporter_id: ctx.actorUserId,
        sort_order: (typeof last?.sort_order === "number" ? last.sort_order : -1) + 1,
      })
      .select("id")
      .single();
    if (error) throw new AdapterError(error.message);
    const id = (data as { id: string }).id;
    const assignees = normalize("people", values.assignees) as string[];
    if (assignees.length > 0) await setAssignees(ctx, id, assignees);
    const labels = normalize("multi_select", values.labels) as string[];
    if (labels.length > 0) await setLabels(ctx, id, labels);
    return id;
  },
};
