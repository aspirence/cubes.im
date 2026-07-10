/**
 * The portable workspace backup format (v1).
 *
 * Design rules:
 *  - Self-contained and human-readable JSON — no internal UUIDs are required
 *    to import. Cross-references inside the file use local ids ("lid") so a
 *    backup can be restored into ANY workspace (or another Cubes install).
 *  - References to people are by email, to labels/statuses/priorities by name;
 *    the importer re-resolves them against the target workspace and silently
 *    drops what doesn't exist there (reported in the import summary).
 *  - `format` + `version` gate importability; future versions must keep
 *    reading v1.
 */

export const BACKUP_FORMAT = "cubes-backup" as const;
export const BACKUP_VERSION = 1 as const;

export type StatusBucket = "todo" | "doing" | "done";

export interface BackupTaskV1 {
  /** Local id, unique within the file (the exporter uses the source task id). */
  lid: string;
  name: string;
  description: string | null;
  /** Status name within the project's status list (fallback resolution). */
  status: string | null;
  /** Status lid (preferred resolution — survives duplicate status names). */
  statusLid: string | null;
  /** Priority name (resolved by name against the target's global list). */
  priority: string | null;
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  archived: boolean;
  sortOrder: number;
  /** Parent task's lid for subtasks (any depth). */
  parentLid: string | null;
  /** Label names. */
  labels: string[];
  /** Assignee emails. */
  assignees: string[];
}

export interface BackupStatusV1 {
  /** Local id (optional for hand-edited files; falls back to name matching). */
  lid: string | null;
  name: string;
  bucket: StatusBucket;
  sortOrder: number;
}

export interface BackupFolderV1 {
  lid: string;
  name: string;
  color: string | null;
  parentLid: string | null;
}

export interface BackupLabelV1 {
  name: string;
  color: string | null;
}

export interface BackupProjectV1 {
  name: string;
  color: string | null;
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Containing folder's lid. */
  folderLid: string | null;
  statuses: BackupStatusV1[];
  tasks: BackupTaskV1[];
}

export interface BackupFileV1 {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  workspace: { id: string; name: string };
  folders: BackupFolderV1[];
  labels: BackupLabelV1[];
  projects: BackupProjectV1[];
}

/** Counts shown in the pre-import preview and the post-action summaries. */
export interface BackupCounts {
  projects: number;
  tasks: number;
  folders: number;
  labels: number;
}

export function backupCounts(file: BackupFileV1): BackupCounts {
  return {
    projects: file.projects.length,
    tasks: file.projects.reduce((n, p) => n + p.tasks.length, 0),
    folders: file.folders.length,
    labels: file.labels.length,
  };
}

/* ----------------------------------------------------------- validation --- */

type Result = { ok: true; data: BackupFileV1 } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const optStr = (v: unknown): v is string | null =>
  v === null || typeof v === "string";

function fail(error: string): Result {
  return { ok: false, error };
}

/**
 * Validates (and lightly normalizes) a parsed JSON value into a BackupFileV1.
 * Returns a readable error naming the first offending element — the file may
 * be hand-edited, so errors must be actionable.
 */
export function validateBackup(raw: unknown): Result {
  if (!isObj(raw)) return fail("The file is not a JSON object.");
  if (raw.format !== BACKUP_FORMAT)
    return fail('Not a Cubes backup (missing "format": "cubes-backup").');
  if (raw.version !== BACKUP_VERSION)
    return fail(
      `Unsupported backup version ${JSON.stringify(raw.version)} — this build imports version ${BACKUP_VERSION}.`,
    );
  if (!isObj(raw.workspace) || typeof raw.workspace.name !== "string")
    return fail("Missing workspace metadata.");
  if (!Array.isArray(raw.folders)) return fail('"folders" must be an array.');
  if (!Array.isArray(raw.labels)) return fail('"labels" must be an array.');
  if (!Array.isArray(raw.projects)) return fail('"projects" must be an array.');

  const folders: BackupFolderV1[] = [];
  const folderLids = new Set<string>();
  for (const [i, f] of raw.folders.entries()) {
    if (!isObj(f) || typeof f.lid !== "string" || typeof f.name !== "string" || f.name.trim() === "")
      return fail(`folders[${i}] needs string "lid" and non-empty "name".`);
    if (folderLids.has(f.lid)) return fail(`folders[${i}] has a duplicate lid "${f.lid}".`);
    folderLids.add(f.lid);
    folders.push({
      lid: f.lid,
      name: f.name.trim().slice(0, 100),
      color: optStr(f.color) ? f.color : null,
      parentLid: optStr(f.parentLid) ? f.parentLid : null,
    });
  }
  for (const [i, f] of folders.entries()) {
    if (f.parentLid !== null && !folderLids.has(f.parentLid))
      return fail(`folders[${i}] points at unknown parent "${f.parentLid}".`);
  }

  const labels: BackupLabelV1[] = [];
  for (const [i, l] of raw.labels.entries()) {
    if (!isObj(l) || typeof l.name !== "string" || l.name.trim() === "")
      return fail(`labels[${i}] needs a non-empty "name".`);
    labels.push({
      name: l.name.trim().slice(0, 60),
      color: optStr(l.color) ? l.color : null,
    });
  }

  const projects: BackupProjectV1[] = [];
  for (const [i, p] of raw.projects.entries()) {
    if (!isObj(p) || typeof p.name !== "string" || p.name.trim() === "")
      return fail(`projects[${i}] needs a non-empty "name".`);
    if (!Array.isArray(p.statuses)) return fail(`projects[${i}].statuses must be an array.`);
    if (!Array.isArray(p.tasks)) return fail(`projects[${i}].tasks must be an array.`);
    if (p.folderLid !== null && p.folderLid !== undefined && typeof p.folderLid !== "string")
      return fail(`projects[${i}].folderLid must be a string or null.`);
    if (typeof p.folderLid === "string" && !folderLids.has(p.folderLid))
      return fail(`projects[${i}] points at unknown folder "${p.folderLid}".`);

    const statuses: BackupStatusV1[] = [];
    const statusLids = new Set<string>();
    for (const [j, s] of p.statuses.entries()) {
      if (!isObj(s) || typeof s.name !== "string" || s.name.trim() === "")
        return fail(`projects[${i}].statuses[${j}] needs a non-empty "name".`);
      const bucket = s.bucket === "doing" || s.bucket === "done" ? s.bucket : "todo";
      const lid = typeof s.lid === "string" ? s.lid : null;
      if (lid !== null) {
        if (statusLids.has(lid))
          return fail(`projects[${i}].statuses[${j}] has a duplicate lid "${lid}".`);
        statusLids.add(lid);
      }
      statuses.push({
        lid,
        name: s.name.trim().slice(0, 60),
        bucket,
        sortOrder: typeof s.sortOrder === "number" ? s.sortOrder : j,
      });
    }

    const tasks: BackupTaskV1[] = [];
    const taskLids = new Set<string>();
    for (const [j, t] of p.tasks.entries()) {
      if (!isObj(t) || typeof t.lid !== "string" || typeof t.name !== "string" || t.name.trim() === "")
        return fail(`projects[${i}].tasks[${j}] needs string "lid" and non-empty "name".`);
      if (taskLids.has(t.lid))
        return fail(`projects[${i}].tasks[${j}] has a duplicate lid "${t.lid}".`);
      taskLids.add(t.lid);
      const statusLid = optStr(t.statusLid) ? t.statusLid : null;
      if (statusLid !== null && !statusLids.has(statusLid))
        return fail(`projects[${i}].tasks[${j}] points at unknown status "${statusLid}".`);
      tasks.push({
        lid: t.lid,
        name: t.name.trim().slice(0, 500),
        description: optStr(t.description) ? t.description : null,
        status: optStr(t.status) ? t.status : null,
        statusLid,
        priority: optStr(t.priority) ? t.priority : null,
        startDate: optStr(t.startDate) ? t.startDate : null,
        endDate: optStr(t.endDate) ? t.endDate : null,
        completedAt: optStr(t.completedAt) ? t.completedAt : null,
        archived: t.archived === true,
        sortOrder: typeof t.sortOrder === "number" ? t.sortOrder : j,
        parentLid: optStr(t.parentLid) ? t.parentLid : null,
        labels: Array.isArray(t.labels)
          ? t.labels.filter((x): x is string => typeof x === "string")
          : [],
        assignees: Array.isArray(t.assignees)
          ? t.assignees.filter((x): x is string => typeof x === "string")
          : [],
      });
    }
    // Parent references must resolve within the same project, and must not
    // form a cycle (walk each chain; a chain longer than the task count is
    // impossible without a loop).
    for (const [j, t] of tasks.entries()) {
      if (t.parentLid === null) continue;
      if (!taskLids.has(t.parentLid))
        return fail(`projects[${i}].tasks[${j}] points at unknown parent "${t.parentLid}".`);
      let cur: BackupTaskV1 | undefined = t;
      let hops = 0;
      while (cur && cur.parentLid !== null) {
        if (++hops > tasks.length)
          return fail(`projects[${i}] contains a subtask cycle involving "${t.name}".`);
        cur = tasks.find((x) => x.lid === cur!.parentLid);
      }
    }

    projects.push({
      name: p.name.trim().slice(0, 100),
      color: optStr(p.color) ? p.color : null,
      notes: optStr(p.notes) ? p.notes : null,
      startDate: optStr(p.startDate) ? p.startDate : null,
      endDate: optStr(p.endDate) ? p.endDate : null,
      folderLid: typeof p.folderLid === "string" ? p.folderLid : null,
      statuses,
      tasks,
    });
  }

  return {
    ok: true,
    data: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
      workspace: {
        id: typeof raw.workspace.id === "string" ? raw.workspace.id : "",
        name: raw.workspace.name,
      },
      folders,
      labels,
      projects,
    },
  };
}
