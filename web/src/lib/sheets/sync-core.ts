/**
 * Sheets ↔ Google Sheets — the three-way merge. Pure: it takes the state of
 * both sides plus the snapshot of what they agreed on at the last sync, and
 * returns a plan. google-sync.ts reads the inputs and applies the plan; nothing
 * here does I/O, so every decision below is covered by node tests.
 *
 * WHY three-way. Two copies alone cannot tell "Google changed this cell" from
 * "Cubes changed it" — both just differ. The snapshot (app_sheet_sync_state) is
 * the common ancestor: a side whose value differs from it is the side that
 * changed. Only when BOTH differ from it, and from each other, is there a real
 * conflict for the link's conflict policy to settle.
 *
 * The merge is per FIELD, not per row: Anna retitling a post in Google while
 * Ben reschedules it in Cubes is two non-conflicting edits, and both survive.
 *
 * Direction:
 *   both  three-way merge; conflicts settled by conflict_policy.
 *   push  Cubes is the source of truth: Google is made to match it. Google
 *         edits are overwritten (counted as skipped when they were edits).
 *   pull  Google is the source of truth for writable fields: its changes are
 *         applied to Cubes; Cubes edits are not sent to Google. The snapshot
 *         then tracks GOOGLE's values, so a later switch to "both" pushes the
 *         Cubes edits that were held back instead of reverting them.
 *
 * Read-only columns (source-owned fields such as a task number or Meta spend)
 * always flow Cubes → Google when the direction writes to Google; an edit to
 * one in Google is reverted and counted as skipped.
 *
 * Row identity is the "Cubes ID" column. A Google row without one is a new
 * record; a row whose id appears twice is resolved to the copy closest to the
 * snapshot, and the other copies are treated as new rows (people duplicate a
 * row to make a similar one).
 */
import type { ColumnType, ConflictPolicy, DeletePolicy, SyncCounts, SyncDirection } from "./types";
import { blankValue, equal, equalAfterGoogle, isBlank, normalize } from "./values";

export interface SyncColumn {
  id: string;
  type: ColumnType;
  /** Can a Google edit to this column be written to Cubes? */
  writable: boolean;
}

/** A parsed Google cell: the canonical value, or why it could not be read. */
export type CellInput = { ok: true; value: unknown } | { ok: false; error: string };

export interface CubesRecord {
  /** Canonical values keyed by column id. */
  values: Record<string, unknown>;
  /** The record's last change (source row and its custom-column row). */
  updatedAt: string | null;
  /** Column ids this record cannot change even though the column can (e.g. an
   *  admin-only link when the sync runs for a non-admin). Treated like a
   *  read-only column for this row. */
  readonly?: string[];
}

export interface GoogleRow {
  /** 0-based index among the data rows (sheet row = index + 2). */
  row: number;
  /** The Cubes ID cell, trimmed; null when empty. */
  key: string | null;
  /** Parsed cells for the columns that have a header in Google. */
  cells: Record<string, CellInput>;
}

export interface SnapshotEntry {
  values: Record<string, unknown>;
  /**
   * The record was deleted in Cubes but its Google row was kept (delete
   * policy "keep", or a pull-only link). The entry stays so the row is not
   * mistaken for a new one and re-created on the next run.
   */
  deleted?: boolean;
}

export interface SyncInput {
  /** Visible columns, in sheet order. */
  columns: SyncColumn[];
  /** Column ids that currently have a header in Google. A column without one
   *  gets its header (and values) written when the direction writes to Google. */
  googleColumns: Set<string>;
  cubes: Map<string, CubesRecord>;
  google: GoogleRow[];
  snapshot: Map<string, SnapshotEntry>;
  direction: SyncDirection;
  conflictPolicy: ConflictPolicy;
  deletePolicy: DeletePolicy;
  canCreate: boolean;
  canDelete: boolean;
  /** Drive modifiedTime of the file, for the "newest" policy. */
  googleModifiedAt: string | null;
}

export interface Conflict {
  key: string;
  columnId: string;
  cubes: unknown;
  google: unknown;
  winner: "cubes" | "google";
}

export interface SyncPlan {
  google: {
    /** Cell writes to existing rows, canonical values keyed by column id. */
    updates: { row: number; key: string; cells: Record<string, unknown> }[];
    /** New rows to append, in order. */
    appends: { key: string; values: Record<string, unknown> }[];
    /** Rows to delete (data-row indexes, ascending). */
    deletes: number[];
    /** Rows whose Cubes ID cell must be cleared (a duplicate that cannot become a record). */
    clearKeys: number[];
  };
  cubes: {
    /** Field writes, canonical values keyed by column id. */
    updates: { key: string; patch: Record<string, unknown> }[];
    /** Google rows to turn into records; the caller writes the new key back. */
    creates: { row: number; values: Record<string, unknown> }[];
    deletes: string[];
  };
  /**
   * The snapshot after the plan is applied. Created records are missing (their
   * keys do not exist yet); the caller adds them. If a Cubes update fails, the
   * caller restores those fields from the old snapshot so the edit is retried.
   */
  snapshot: { upserts: Map<string, SnapshotEntry>; deletes: string[] };
  counts: SyncCounts;
  conflicts: Conflict[];
}

function emptyCounts(): SyncCounts {
  return { pushed: 0, pulled: 0, created: 0, deleted: 0, conflicts: 0, skipped: 0 };
}

function isBlankRow(row: GoogleRow, columns: SyncColumn[]): boolean {
  for (const col of columns) {
    const cell = row.cells[col.id];
    if (!cell) continue;
    if (!cell.ok) return false;
    if (!isBlank(col.type, cell.value)) return false;
  }
  return true;
}

function sameValues(a: Record<string, unknown>, b: Record<string, unknown>, columns: SyncColumn[]): boolean {
  return columns.every((c) => equalAfterGoogle(c.type, a[c.id], b[c.id]));
}

function snapshotFieldsFrom(values: Record<string, unknown>, columns: SyncColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) out[c.id] = normalize(c.type, values[c.id] ?? blankValue(c.type));
  return out;
}

/** How far a Google row is from a snapshot — used to pick the original among
 *  rows that share one Cubes ID. */
function distance(row: GoogleRow, snap: SnapshotEntry | undefined, columns: SyncColumn[]): number {
  if (!snap) return 0;
  let d = 0;
  for (const c of columns) {
    const cell = row.cells[c.id];
    if (!cell) continue;
    if (!cell.ok || !equalAfterGoogle(c.type, snap.values[c.id], cell.value)) d++;
  }
  return d;
}

export function planSync(input: SyncInput): SyncPlan {
  const { columns, cubes, snapshot, direction } = input;
  const pushes = direction !== "pull";
  const pulls = direction !== "push";

  const plan: SyncPlan = {
    google: { updates: [], appends: [], deletes: [], clearKeys: [] },
    cubes: { updates: [], creates: [], deletes: [] },
    snapshot: { upserts: new Map(), deletes: [] },
    counts: emptyCounts(),
    conflicts: [],
  };
  const counts = plan.counts;

  // ---------------------------------------------------------------------------
  // 1. Resolve Google rows to keys. Blank rows are ignored outright (a sheet
  //    usually has hundreds of empty rows below the data).
  // ---------------------------------------------------------------------------
  const byKey = new Map<string, GoogleRow[]>();
  const newRows: GoogleRow[] = [];
  for (const row of input.google) {
    if (row.key === null) {
      if (!isBlankRow(row, columns)) newRows.push(row);
      continue;
    }
    const list = byKey.get(row.key);
    if (list) list.push(row);
    else byKey.set(row.key, [row]);
  }

  const googleByKey = new Map<string, GoogleRow>();
  for (const [key, rows] of byKey) {
    const snap = snapshot.get(key);
    // Unknown key (typed by hand, or pasted from another sheet): treat as new.
    if (!cubes.has(key) && !snap) {
      newRows.push(...rows);
      continue;
    }
    let original = rows[0];
    if (rows.length > 1) {
      let best = Infinity;
      for (const r of rows) {
        const d = distance(r, snap, columns);
        if (d < best) {
          best = d;
          original = r;
        }
      }
    }
    googleByKey.set(key, original);
    for (const r of rows) if (r !== original) newRows.push(r);
  }

  // ---------------------------------------------------------------------------
  // 2. New Google rows → new records (or skipped when the source can't create).
  // ---------------------------------------------------------------------------
  newRows.sort((a, b) => a.row - b.row);
  for (const row of newRows) {
    if (!pulls) {
      // Push-only: rows people add in Google are theirs; leave them alone. A
      // stray Cubes ID on one is cleared so it cannot shadow a real record.
      if (row.key !== null) plan.google.clearKeys.push(row.row);
      continue;
    }
    if (!input.canCreate) {
      counts.skipped++;
      if (row.key !== null) plan.google.clearKeys.push(row.row);
      continue;
    }
    const values: Record<string, unknown> = {};
    let invalid = false;
    for (const col of columns) {
      const cell = row.cells[col.id];
      if (!cell) continue;
      if (!cell.ok) {
        invalid = true;
        continue;
      }
      // Read-only fields are the source's to set; what was typed there is
      // replaced by the real value when the created row is written back.
      // Blank cells are passed on as blanks: the planner does not know a
      // source's defaults, so each adapter's create() drops blanks before
      // applying its own (adapters/content-studio.ts says why).
      if (col.writable) values[col.id] = cell.value;
    }
    if (invalid) counts.skipped++;
    plan.cubes.creates.push({ row: row.row, values });
  }

  // ---------------------------------------------------------------------------
  // 3. Every key either side (or the snapshot) knows.
  // ---------------------------------------------------------------------------
  const keys = new Set<string>([...cubes.keys(), ...googleByKey.keys(), ...snapshot.keys()]);
  const appendKeys: string[] = [];
  const deleteRows: number[] = [];

  for (const key of keys) {
    const c = cubes.get(key);
    const g = googleByKey.get(key);
    const rawSnap = snapshot.get(key);
    // A tombstone only means something while the record stays deleted.
    const s = rawSnap && !rawSnap.deleted ? rawSnap : undefined;

    if (c && g) {
      mergeRow(key, c, g, s, input, plan);
      continue;
    }

    if (c && !g) {
      if (!s) {
        // New in Cubes (or never reached Google).
        if (pushes) {
          appendKeys.push(key);
          plan.snapshot.upserts.set(key, { values: snapshotFieldsFrom(c.values, columns) });
          counts.created++;
        }
        continue;
      }
      // Deleted in Google since the last sync.
      const cubesChanged = !sameValues(c.values, s.values, columns);
      const mayDelete = pulls && input.deletePolicy === "delete";
      if (mayDelete && input.canDelete && !cubesChanged) {
        plan.cubes.deletes.push(key);
        plan.snapshot.deletes.push(key);
        counts.deleted++;
        continue;
      }
      if (mayDelete && !input.canDelete) counts.skipped++;
      if (mayDelete && input.canDelete && cubesChanged) counts.conflicts++;
      if (pushes) {
        // The record lives on, so the sheet shows it again.
        appendKeys.push(key);
        plan.snapshot.upserts.set(key, { values: snapshotFieldsFrom(c.values, columns) });
        counts.created++;
      } else {
        plan.snapshot.deletes.push(key);
      }
      continue;
    }

    if (!c && g) {
      if (rawSnap?.deleted || !s) {
        // Already handled: a kept row of a deleted record. Nothing to do.
        continue;
      }
      // Deleted in Cubes since the last sync.
      const googleChanged = columns.some((col) => {
        const cell = g.cells[col.id];
        return cell && (!cell.ok || !equalAfterGoogle(col.type, s.values[col.id], cell.value));
      });
      if (pushes && input.deletePolicy === "delete") {
        if (googleChanged && pulls && input.canCreate) {
          // Edited in Google after the record was deleted here: the edit wins
          // by becoming a new record, instead of being thrown away.
          counts.conflicts++;
          const values: Record<string, unknown> = {};
          for (const col of columns) {
            const cell = g.cells[col.id];
            if (cell?.ok && col.writable) values[col.id] = cell.value;
          }
          plan.cubes.creates.push({ row: g.row, values });
          plan.snapshot.deletes.push(key);
        } else {
          deleteRows.push(g.row);
          plan.snapshot.deletes.push(key);
          counts.deleted++;
        }
        continue;
      }
      // Keep: the Google row stays; remember that its record is gone.
      plan.snapshot.upserts.set(key, { values: s.values, deleted: true });
      continue;
    }

    // Neither side has it any more.
    if (rawSnap) plan.snapshot.deletes.push(key);
  }

  for (const key of appendKeys) {
    const c = cubes.get(key)!;
    const values: Record<string, unknown> = {};
    for (const col of columns) values[col.id] = normalize(col.type, c.values[col.id] ?? blankValue(col.type));
    plan.google.appends.push({ key, values });
  }
  plan.google.deletes = deleteRows.sort((a, b) => a - b);
  plan.google.clearKeys.sort((a, b) => a - b);
  plan.google.updates.sort((a, b) => a.row - b.row);
  return plan;
}

/** Field-level merge of one record that exists on both sides. */
function mergeRow(
  key: string,
  c: CubesRecord,
  g: GoogleRow,
  s: SnapshotEntry | undefined,
  input: SyncInput,
  plan: SyncPlan,
): void {
  const { columns, direction } = input;
  const pushes = direction !== "pull";
  const pulls = direction !== "push";
  const counts = plan.counts;

  const toGoogle: Record<string, unknown> = {};
  const toCubes: Record<string, unknown> = {};
  const nextSnap: Record<string, unknown> = {};

  for (const col of columns) {
    const cv = normalize(col.type, c.values[col.id] ?? blankValue(col.type));
    const sv = s ? normalize(col.type, s.values[col.id] ?? blankValue(col.type)) : undefined;

    // A column Google has no header for yet: Cubes fills it in.
    if (!input.googleColumns.has(col.id)) {
      if (pushes) {
        toGoogle[col.id] = cv;
        nextSnap[col.id] = cv;
      } else if (sv !== undefined) {
        nextSnap[col.id] = sv;
      }
      continue;
    }

    const cell = g.cells[col.id] ?? { ok: true, value: blankValue(col.type) };

    // Unreadable Google value: never written to Cubes. Counted, and left in
    // place for the person to fix unless Cubes has something newer to show.
    if (!cell.ok) {
      counts.skipped++;
      const cubesChanged = sv === undefined || !equalAfterGoogle(col.type, cv, sv);
      const rowWritable = col.writable && !c.readonly?.includes(col.id);
      if (pushes && (direction === "push" || !rowWritable || cubesChanged)) {
        toGoogle[col.id] = cv;
        nextSnap[col.id] = cv;
      } else if (sv !== undefined) {
        nextSnap[col.id] = sv;
      }
      continue;
    }
    const gv = cell.value;
    // A value Google had to shorten (its 50,000-character cell limit) is not
    // an edit on either side, so every comparison that crosses the boundary
    // goes through equalAfterGoogle.
    const same = equalAfterGoogle(col.type, cv, gv);
    const googleChanged = sv === undefined ? !same : !equalAfterGoogle(col.type, sv, gv);
    const cubesChanged = sv === undefined ? !same : !equalAfterGoogle(col.type, cv, sv);

    if (!col.writable || c.readonly?.includes(col.id)) {
      if (pushes) {
        if (!same) {
          toGoogle[col.id] = cv;
          if (googleChanged && sv !== undefined) counts.skipped++;
        }
        nextSnap[col.id] = cv;
      } else {
        if (!same && googleChanged && sv !== undefined) counts.skipped++;
        nextSnap[col.id] = gv;
      }
      continue;
    }

    if (same) {
      nextSnap[col.id] = cv;
      continue;
    }

    if (direction === "push") {
      // Google is made to match; an edit made there is overwritten.
      toGoogle[col.id] = cv;
      if (googleChanged && sv !== undefined) counts.skipped++;
      nextSnap[col.id] = cv;
      continue;
    }

    if (direction === "pull") {
      if (googleChanged || sv === undefined) {
        toCubes[col.id] = gv;
        if (cubesChanged && sv !== undefined) {
          counts.conflicts++;
          plan.conflicts.push({ key, columnId: col.id, cubes: cv, google: gv, winner: "google" });
        }
      }
      // Pull tracks Google's values: a Cubes-only edit stays pending.
      nextSnap[col.id] = gv;
      continue;
    }

    // both
    if (cubesChanged && !googleChanged) {
      toGoogle[col.id] = cv;
      nextSnap[col.id] = cv;
    } else if (googleChanged && !cubesChanged) {
      toCubes[col.id] = gv;
      nextSnap[col.id] = gv;
    } else {
      const winner = resolveConflict(input, c);
      counts.conflicts++;
      plan.conflicts.push({ key, columnId: col.id, cubes: cv, google: gv, winner });
      if (winner === "cubes") {
        toGoogle[col.id] = cv;
        nextSnap[col.id] = cv;
      } else {
        toCubes[col.id] = gv;
        nextSnap[col.id] = gv;
      }
    }
  }

  const pushed = Object.keys(toGoogle).length;
  const pulled = Object.keys(toCubes).length;
  if (pushed > 0 && pushes) {
    plan.google.updates.push({ row: g.row, key, cells: toGoogle });
    counts.pushed += pushed;
  }
  if (pulled > 0 && pulls) {
    plan.cubes.updates.push({ key, patch: toCubes });
    counts.pulled += pulled;
  }
  // Columns the merge did not touch keep their old snapshot value.
  if (s) {
    for (const col of columns) {
      if (!(col.id in nextSnap) && col.id in s.values) nextSnap[col.id] = s.values[col.id];
    }
  }
  // Only write the snapshot row when it actually moved — a quiet sheet of
  // 5,000 rows should cost no snapshot writes at all.
  const snapMoved =
    !s ||
    columns.some(
      (col) => (col.id in nextSnap) !== (col.id in s.values) || !equal(col.type, nextSnap[col.id], s.values[col.id]),
    );
  if (snapMoved) plan.snapshot.upserts.set(key, { values: nextSnap });
}

function resolveConflict(input: SyncInput, c: CubesRecord): "cubes" | "google" {
  if (input.conflictPolicy === "cubes") return "cubes";
  if (input.conflictPolicy === "google") return "google";
  // newest: the record's own change time against the file's. The file time is
  // coarse (any cell edit bumps it), so an unknown side loses to a known one,
  // and a tie keeps Cubes — the system of record.
  const ct = c.updatedAt ? Date.parse(c.updatedAt) : NaN;
  const gt = input.googleModifiedAt ? Date.parse(input.googleModifiedAt) : NaN;
  if (!Number.isFinite(gt)) return "cubes";
  if (!Number.isFinite(ct)) return "google";
  return gt > ct ? "google" : "cubes";
}
