import { createClient } from "@/lib/supabase/client";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupFileV1,
  type BackupFolderV1,
  type BackupProjectV1,
  type BackupStatusV1,
  type BackupTaskV1,
  type StatusBucket,
} from "./backup-format";

/**
 * Backup/restore engine. Everything runs client-side through the caller's
 * RLS-guarded session: the export can only read what the owner can see, and
 * the import replays through the same RPCs the app itself uses
 * (create_project / create_task) plus RLS-checked table writes.
 */

type Supabase = ReturnType<typeof createClient>;

/** Chunks `.in()` filters so request URLs stay well under length limits. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const lower = (s: string) => s.trim().toLowerCase();

const PAGE = 1000;

/**
 * Drains a query page by page. PostgREST caps un-ranged responses at
 * max_rows (1000) and returns 200 — WITHOUT this, large workspaces would
 * export silently-truncated backups. `build` must apply a stable ORDER BY
 * (callers order by id) so pages neither skip nor duplicate rows.
 */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return out;
  }
}

/* ------------------------------------------------------------- exporter --- */

export async function buildBackup(
  supabase: Supabase,
  teamId: string,
  teamName: string,
): Promise<BackupFileV1> {
  // Folders (team-scoped tree).
  const folderRows = await fetchAll((from, to) =>
    supabase
      .from("project_folders")
      .select("id, name, color_code, parent_folder_id")
      .eq("team_id", teamId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const folders: BackupFolderV1[] = folderRows.map((f) => ({
    lid: f.id,
    name: f.name,
    color: f.color_code,
    parentLid: f.parent_folder_id,
  }));

  // Label definitions (team-scoped).
  const labelRows = await fetchAll((from, to) =>
    supabase
      .from("team_labels")
      .select("id, name, color_code")
      .eq("team_id", teamId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const labelNameById = new Map(labelRows.map((l) => [l.id, l.name]));

  // Projects the caller can see (private projects of others are excluded by RLS).
  const projectRows = await fetchAll((from, to) =>
    supabase
      .from("projects")
      .select("id, name, color_code, notes, start_date, end_date, folder_id")
      .eq("team_id", teamId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const projectIds = projectRows.map((p) => p.id);

  // Global priority names (small lookup, but paginate on principle).
  const priorityRows = await fetchAll((from, to) =>
    supabase
      .from("task_priorities")
      .select("id, name")
      .order("id", { ascending: true })
      .range(from, to),
  );
  const priorityNameById = new Map(priorityRows.map((p) => [p.id, p.name]));

  // Member emails (for assignee references).
  const memberRows = await fetchAll((from, to) =>
    supabase
      .from("team_members")
      .select("id, user:users!team_members_user_id_fk ( email )")
      .eq("team_id", teamId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const emailByMemberId = new Map<string, string>();
  for (const m of memberRows) {
    const email = (m.user as { email: string } | null)?.email;
    if (email) emailByMemberId.set(m.id, email);
  }

  // Statuses and tasks — fetched per project-id chunk, each chunk paginated.
  type StatusRow = {
    id: string;
    project_id: string;
    name: string;
    sort_order: number | null;
    sys_task_status_categories: {
      is_todo: boolean | null;
      is_doing: boolean | null;
      is_done: boolean | null;
    } | null;
  };
  const statusRows: StatusRow[] = [];
  const taskRows: {
    id: string;
    project_id: string;
    name: string;
    description: string | null;
    start_date: string | null;
    end_date: string | null;
    completed_at: string | null;
    archived: boolean | null;
    sort_order: number;
    parent_task_id: string | null;
    status_id: string | null;
    priority_id: string | null;
  }[] = [];

  for (const ids of chunk(projectIds, 80)) {
    statusRows.push(
      ...(await fetchAll((from, to) =>
        supabase
          .from("task_statuses")
          .select(
            "id, project_id, name, sort_order, sys_task_status_categories(is_todo, is_doing, is_done)",
          )
          .in("project_id", ids)
          .order("id", { ascending: true })
          .range(from, to),
      )) as unknown as StatusRow[],
    );

    taskRows.push(
      ...(await fetchAll((from, to) =>
        supabase
          .from("tasks")
          .select(
            "id, project_id, name, description, start_date, end_date, completed_at, archived, sort_order, parent_task_id, status_id, priority_id",
          )
          .in("project_id", ids)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      )),
    );
  }

  const taskIds = taskRows.map((t) => t.id);
  const labelsByTask = new Map<string, string[]>();
  const assigneesByTask = new Map<string, string[]>();
  for (const ids of chunk(taskIds, 150)) {
    const tlRows = await fetchAll((from, to) =>
      supabase
        .from("task_labels")
        .select("task_id, label_id")
        .in("task_id", ids)
        .order("task_id", { ascending: true })
        .order("label_id", { ascending: true })
        .range(from, to),
    );
    for (const tl of tlRows) {
      const name = labelNameById.get(tl.label_id);
      if (!name) continue;
      labelsByTask.set(tl.task_id, [...(labelsByTask.get(tl.task_id) ?? []), name]);
    }

    const taRows = await fetchAll((from, to) =>
      supabase
        .from("tasks_assignees")
        .select("task_id, team_member_id")
        .in("task_id", ids)
        .order("task_id", { ascending: true })
        .order("team_member_id", { ascending: true })
        .range(from, to),
    );
    for (const ta of taRows) {
      const email = emailByMemberId.get(ta.team_member_id);
      if (!email) continue;
      assigneesByTask.set(ta.task_id, [
        ...(assigneesByTask.get(ta.task_id) ?? []),
        email,
      ]);
    }
  }

  const statusById = new Map(statusRows.map((s) => [s.id, s]));
  const bucketOf = (s: StatusRow): StatusBucket =>
    s.sys_task_status_categories?.is_done
      ? "done"
      : s.sys_task_status_categories?.is_doing
        ? "doing"
        : "todo";

  const projects: BackupProjectV1[] = projectRows.map((p) => {
    const statuses: BackupStatusV1[] = statusRows
      .filter((s) => s.project_id === p.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((s) => ({
        lid: s.id,
        name: s.name,
        bucket: bucketOf(s),
        sortOrder: s.sort_order ?? 0,
      }));

    const tasks: BackupTaskV1[] = taskRows
      .filter((t) => t.project_id === p.id)
      .map((t) => ({
        lid: t.id,
        name: t.name,
        description: t.description,
        status: t.status_id ? (statusById.get(t.status_id)?.name ?? null) : null,
        statusLid: t.status_id,
        priority: t.priority_id ? (priorityNameById.get(t.priority_id) ?? null) : null,
        startDate: t.start_date,
        endDate: t.end_date,
        completedAt: t.completed_at,
        archived: t.archived === true,
        sortOrder: Number(t.sort_order),
        parentLid: t.parent_task_id,
        labels: labelsByTask.get(t.id) ?? [],
        assignees: assigneesByTask.get(t.id) ?? [],
      }));

    return {
      name: p.name,
      color: p.color_code,
      notes: p.notes,
      startDate: p.start_date,
      endDate: p.end_date,
      folderLid: p.folder_id,
      statuses,
      tasks,
    };
  });

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: { id: teamId, name: teamName },
    folders,
    labels: labelRows.map((l) => ({ name: l.name, color: l.color_code })),
    projects,
  };
}

/* ------------------------------------------------------------- importer --- */

export interface ImportSummary {
  projects: number;
  tasks: number;
  folders: number;
  /** Folders matched to existing same-name folders instead of created. */
  foldersReused: number;
  labelsCreated: number;
  /** Assignee references whose email has no active member in this workspace. */
  assigneesDropped: number;
  /** Projects renamed to avoid clashing with existing project names. */
  renamed: string[];
}

export type ImportProgress = (done: number, total: number, label: string) => void;

/** Runs `fn` over items with bounded concurrency, preserving order of results. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function importBackup(
  supabase: Supabase,
  teamId: string,
  file: BackupFileV1,
  onProgress?: ImportProgress,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    projects: 0,
    tasks: 0,
    folders: 0,
    foldersReused: 0,
    labelsCreated: 0,
    assigneesDropped: 0,
    renamed: [],
  };
  const totalTasks = file.projects.reduce((n, p) => n + p.tasks.length, 0);
  let doneTasks = 0;
  const tick = (label: string) => onProgress?.(doneTasks, totalTasks, label);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Not authenticated");

  // --- Target-workspace lookups -------------------------------------------
  const { data: sysCategories, error: catErr } = await supabase
    .from("sys_task_status_categories")
    .select("id, is_todo, is_doing, is_done, sort_order")
    .order("sort_order", { ascending: true });
  if (catErr) throw catErr;
  const categoryIdFor = (bucket: StatusBucket): string | undefined =>
    (sysCategories ?? []).find((c) =>
      bucket === "done" ? c.is_done : bucket === "doing" ? c.is_doing : c.is_todo,
    )?.id;

  const { data: priorityRows, error: prioErr } = await supabase
    .from("task_priorities")
    .select("id, name");
  if (prioErr) throw prioErr;
  const priorityIdByName = new Map(
    (priorityRows ?? []).map((p) => [lower(p.name), p.id]),
  );

  const memberRows = await fetchAll((from, to) =>
    supabase
      .from("team_members")
      .select("id, active, user:users!team_members_user_id_fk ( email )")
      .eq("team_id", teamId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const memberIdByEmail = new Map<string, string>();
  for (const m of memberRows) {
    const email = (m.user as { email: string } | null)?.email;
    if (email && m.active !== false) memberIdByEmail.set(lower(email), m.id);
  }

  // --- Labels: reuse by name (case-insensitive), create the missing ones ---
  const existingLabels = await fetchAll((from, to) =>
    supabase
      .from("team_labels")
      .select("id, name")
      .eq("team_id", teamId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const labelIdByName = new Map(existingLabels.map((l) => [lower(l.name), l.id]));
  // Keyed by lowercased name for dedup, but the VALUE keeps the original
  // casing so created labels display exactly as they did in the source.
  const wantedLabels = new Map<string, { name: string; color: string | null }>();
  for (const l of file.labels)
    if (!wantedLabels.has(lower(l.name)))
      wantedLabels.set(lower(l.name), { name: l.name, color: l.color });
  // Labels referenced by tasks but absent from the definitions list —
  // hand-edited files may skip them.
  for (const p of file.projects)
    for (const t of p.tasks)
      for (const name of t.labels)
        if (name.trim() !== "" && !wantedLabels.has(lower(name)))
          wantedLabels.set(lower(name), { name: name.trim(), color: null });
  const missingLabels = [...wantedLabels.values()].filter(
    (l) => !labelIdByName.has(lower(l.name)),
  );
  if (missingLabels.length > 0) {
    const { data: created, error: createLabelErr } = await supabase
      .from("team_labels")
      .insert(
        missingLabels.map((l) => ({
          team_id: teamId,
          name: l.name,
          color_code: l.color ?? "#70a6f3",
        })),
      )
      .select("id, name");
    if (createLabelErr) throw createLabelErr;
    for (const l of created ?? []) labelIdByName.set(lower(l.name), l.id);
    summary.labelsCreated = created?.length ?? 0;
  }

  // --- Folders: reuse same-name folders (the DB enforces per-team unique
  // folder names), create the rest parents-first ----------------------------
  tick("Creating folders");
  const existingFolders = await fetchAll((from, to) =>
    supabase
      .from("project_folders")
      .select("id, name")
      .eq("team_id", teamId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const folderIdByName = new Map(existingFolders.map((f) => [lower(f.name), f.id]));
  const folderIdByLid = new Map<string, string>();
  let pendingFolders = [...file.folders];
  while (pendingFolders.length > 0) {
    const ready = pendingFolders.filter(
      (f) => f.parentLid === null || folderIdByLid.has(f.parentLid),
    );
    // Validation guarantees parents resolve, so `ready` is never empty here;
    // the guard keeps a corrupt file from looping forever.
    if (ready.length === 0) break;
    for (const f of ready) {
      const existing = folderIdByName.get(lower(f.name));
      if (existing) {
        folderIdByLid.set(f.lid, existing);
        summary.foldersReused += 1;
        continue;
      }
      const { data: created, error: folderErr } = await supabase
        .from("project_folders")
        .insert({
          team_id: teamId,
          name: f.name,
          color_code: f.color ?? "#70a6f3",
          parent_folder_id: f.parentLid ? (folderIdByLid.get(f.parentLid) ?? null) : null,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (folderErr) throw folderErr;
      folderIdByLid.set(f.lid, created.id);
      folderIdByName.set(lower(f.name), created.id);
      summary.folders += 1;
    }
    pendingFolders = pendingFolders.filter((f) => !folderIdByLid.has(f.lid));
  }

  // --- Existing project names (create_project rejects duplicates) ----------
  const existingProjects = await fetchAll((from, to) =>
    supabase
      .from("projects")
      .select("id, name")
      .eq("team_id", teamId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const takenNames = new Set(existingProjects.map((p) => lower(p.name)));
  const uniquify = (name: string): string => {
    if (!takenNames.has(lower(name))) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name.slice(0, 92)} (${n})`;
      if (!takenNames.has(lower(candidate))) return candidate;
    }
  };

  // --- Projects -------------------------------------------------------------
  for (const project of file.projects) {
    const name = uniquify(project.name);
    if (name !== project.name) summary.renamed.push(`${project.name} → ${name}`);
    takenNames.add(lower(name));
    tick(`Creating project "${name}"`);

    const { data: projectId, error: createErr } = await supabase.rpc(
      "create_project",
      {
        p_name: name,
        p_team_id: teamId,
        ...(project.color ? { p_color_code: project.color } : {}),
      },
    );
    if (createErr) throw createErr;
    const pid = projectId as string;
    summary.projects += 1;

    const folderId = project.folderLid
      ? (folderIdByLid.get(project.folderLid) ?? null)
      : null;
    if (project.notes || project.startDate || project.endDate || folderId) {
      const { error: updErr } = await supabase
        .from("projects")
        .update({
          notes: project.notes,
          start_date: project.startDate,
          end_date: project.endDate,
          folder_id: folderId,
        })
        .eq("id", pid);
      if (updErr) throw updErr;
    }

    // Statuses. create_project's trigger seeded To Do / Doing / Done. Each
    // backup status claims at most ONE seeded row by (case-insensitive) name —
    // duplicates get their own inserted rows — and claimed rows are updated to
    // the backup's bucket/sort so reuse doesn't corrupt categories.
    const { data: seeded, error: seededErr } = await supabase
      .from("task_statuses")
      .select("id, name")
      .eq("project_id", pid);
    if (seededErr) throw seededErr;
    const unclaimedSeeded = new Map(
      (seeded ?? []).map((s) => [lower(s.name), s.id]),
    );
    const statusIdByLid = new Map<string, string>();
    const statusIdByName = new Map<string, string>();

    for (const s of project.statuses) {
      const claimed = unclaimedSeeded.get(lower(s.name));
      let sid: string;
      if (claimed) {
        unclaimedSeeded.delete(lower(s.name));
        const categoryId = categoryIdFor(s.bucket);
        const { error: statusUpdErr } = await supabase
          .from("task_statuses")
          .update({
            sort_order: s.sortOrder,
            ...(categoryId ? { category_id: categoryId } : {}),
          })
          .eq("id", claimed);
        if (statusUpdErr) throw statusUpdErr;
        sid = claimed;
      } else {
        const categoryId = categoryIdFor(s.bucket);
        if (!categoryId) continue; // no matching category — skip this status
        const { data: createdStatus, error: statusErr } = await supabase
          .from("task_statuses")
          .insert({
            project_id: pid,
            team_id: teamId,
            name: s.name,
            category_id: categoryId,
            sort_order: s.sortOrder,
          })
          .select("id")
          .single();
        if (statusErr) throw statusErr;
        sid = createdStatus.id;
      }
      if (s.lid) statusIdByLid.set(s.lid, sid);
      if (!statusIdByName.has(lower(s.name))) statusIdByName.set(lower(s.name), sid);
    }

    // Tasks: parents before children (level by level), bounded concurrency.
    // Ordering fidelity comes from the unconditional sort_order write below —
    // create_task's own append counter races under concurrency, but it gets
    // overwritten with the backup's authoritative value.
    const taskIdByLid = new Map<string, string>();
    const labelPairs: { task_id: string; label_id: string }[] = [];
    let pending = [...project.tasks];
    while (pending.length > 0) {
      const ready = pending.filter(
        (t) => t.parentLid === null || taskIdByLid.has(t.parentLid),
      );
      if (ready.length === 0) break; // corrupt parent chain — validation prevents this
      await mapLimit(ready, 6, async (task) => {
        const assignees = task.assignees
          .map((email) => memberIdByEmail.get(lower(email)))
          .filter((id): id is string => Boolean(id));
        summary.assigneesDropped += task.assignees.length - assignees.length;

        const statusId =
          (task.statusLid ? statusIdByLid.get(task.statusLid) : undefined) ??
          (task.status ? statusIdByName.get(lower(task.status)) : undefined);
        const priorityId = task.priority
          ? priorityIdByName.get(lower(task.priority))
          : undefined;

        const { data: taskId, error: taskErr } = await supabase.rpc("create_task", {
          p_name: task.name,
          p_project_id: pid,
          ...(statusId ? { p_status_id: statusId } : {}),
          ...(priorityId ? { p_priority_id: priorityId } : {}),
          ...(task.parentLid
            ? { p_parent_task_id: taskIdByLid.get(task.parentLid) as string }
            : {}),
          ...(assignees.length > 0 ? { p_assignees: assignees } : {}),
        });
        if (taskErr) throw taskErr;
        const tid = taskId as string;
        taskIdByLid.set(task.lid, tid);

        const { error: updErr } = await supabase
          .from("tasks")
          .update({
            description: task.description,
            start_date: task.startDate,
            end_date: task.endDate,
            sort_order: task.sortOrder,
            // Preserve the original completion timestamp (the done-category
            // trigger stamped "now" on create); never null it out.
            ...(task.completedAt ? { completed_at: task.completedAt } : {}),
            ...(task.archived ? { archived: true } : {}),
          })
          .eq("id", tid);
        if (updErr) throw updErr;

        for (const labelName of task.labels) {
          const labelId = labelIdByName.get(lower(labelName));
          if (labelId) labelPairs.push({ task_id: tid, label_id: labelId });
        }

        doneTasks += 1;
        summary.tasks += 1;
        if (doneTasks % 5 === 0 || doneTasks === totalTasks)
          tick(`Importing tasks (${doneTasks}/${totalTasks})`);
      });
      pending = pending.filter((t) => !taskIdByLid.has(t.lid));
    }

    for (const rows of chunk(labelPairs, 200)) {
      const { error: tlErr } = await supabase.from("task_labels").insert(rows);
      if (tlErr) throw tlErr;
    }
  }

  tick("Done");
  return summary;
}
