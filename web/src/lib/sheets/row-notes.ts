/**
 * Notes the sync leaves on Google rows it could NOT turn into records.
 *
 * A row typed into the Google Sheet becomes a Cubes record on the next sync —
 * unless the source refuses it (a content-calendar row without a caption, a
 * task without a name…). That refusal used to be silent: the row simply never
 * got a Cubes ID, and nothing in Google said why. Now the reason is written as
 * a NOTE on the row's Cubes ID cell (the cell that is conspicuously empty), and
 * taken away again once the row gets in.
 *
 * Pure: google-sync.ts reads the notes, asks planRowNotes what should change,
 * and writes only that. Three rules shape it:
 *
 *   - A person's own note on that cell is never lost. Ours goes on top,
 *     separated by NOTE_SEPARATOR; clearing ours gives theirs back unchanged.
 *   - Our note is recognised by its first words (REFUSAL_MARK), so stale ones
 *     are found and cleared without Cubes having to remember row positions —
 *     notes travel with their row when people sort or insert rows in Google.
 *   - Nothing is written when nothing changed. Every write to the file shows
 *     up in Drive's change feed, which triggers a sync; rewriting the same note
 *     on every run would make a refused row tick forever.
 */

/** How our notes begin — and how we know a note is ours. */
export const REFUSAL_MARK = "Not in Cubes yet — ";
/** Between our note and a person's own note on the same cell. */
export const NOTE_SEPARATOR = "\n\n———\n";
const NOTE_MAX = 900;

/** Our note for a row the source refused, with `reason` as the source said it. */
export function refusalNote(reason: string): string {
  const why = reason.trim().replace(/\s+/g, " ").slice(0, 500) || "the row was refused.";
  return `${REFUSAL_MARK}${why}\nFix it in this row and the next sync adds it and gives it a Cubes ID.`.slice(0, NOTE_MAX);
}

/** A cell's note, split into our part (if any) and the person's part. */
export function splitNote(note: string): { ours: string | null; theirs: string } {
  if (!note.startsWith(REFUSAL_MARK)) return { ours: null, theirs: note };
  const at = note.indexOf(NOTE_SEPARATOR);
  return at < 0 ? { ours: note, theirs: "" } : { ours: note.slice(0, at), theirs: note.slice(at + NOTE_SEPARATOR.length) };
}

function compose(ours: string | null, theirs: string): string {
  if (!ours) return theirs;
  return theirs ? `${ours}${NOTE_SEPARATOR}${theirs}` : ours;
}

/**
 * The note writes that make Google say the right thing.
 *
 * `existing`: the notes on the Cubes ID cells now, by data-row index (only
 * non-empty ones). `refused`: the rows the source refused this run, by
 * data-row index, with the reason. Returns only the cells whose note must
 * change — `note: ""` clears one.
 */
export function planRowNotes(
  existing: ReadonlyMap<number, string>,
  refused: ReadonlyMap<number, string>,
): { row: number; note: string }[] {
  const rows = new Set<number>(refused.keys());
  for (const [row, note] of existing) if (splitNote(note).ours !== null) rows.add(row);
  const out: { row: number; note: string }[] = [];
  for (const row of [...rows].sort((a, b) => a - b)) {
    const now = existing.get(row) ?? "";
    const { theirs } = splitNote(now);
    const reason = refused.get(row);
    const want = compose(reason === undefined ? null : refusalNote(reason), theirs);
    if (want !== now) out.push({ row, note: want });
  }
  return out;
}
