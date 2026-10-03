import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getAccessToken } from "./tokens";

/**
 * Google Sheets v4 (plus one Drive v3 call) over raw fetch — the same style as
 * oauth.ts, no googleapis dependency. Server-only: it spends the stored tokens.
 *
 * Failure handling, and why:
 *   401  the cached access token died early (revoked session, clock skew). The
 *        cache is dropped and the token refreshed ONCE; a second 401 is real.
 *   403 / 404  with drive.file this means the file was deleted or Cubes lost
 *        access to it (the grant is per file). Retrying can't fix that — the
 *        person has to pick the sheet again — so it is its own error kind.
 *   429 / 5xx  Google's per-minute quotas and blips: exponential backoff.
 *
 * Messages on GoogleSheetsError are safe to store where members can read them:
 * no tokens, no URLs.
 */

const TIMEOUT_MS = 20_000;
const RETRIES = 3;

export type GoogleSheetsErrorKind = "auth" | "access_lost" | "rate_limited" | "server" | "bad_request" | "network";

export class GoogleSheetsError extends Error {
  readonly kind: GoogleSheetsErrorKind;
  readonly status: number;
  constructor(kind: GoogleSheetsErrorKind, message: string, status = 0) {
    super(message);
    this.name = "GoogleSheetsError";
    this.kind = kind;
    this.status = status;
  }
}

/** Test servers may stand in for Google, never in production. */
function base(envName: string, fallback: string): string {
  const override = process.env[envName];
  if (override && process.env.NODE_ENV !== "production") return override.replace(/\/$/, "");
  return fallback;
}

const sheetsBase = () => base("GOOGLE_SHEETS_BASE_URL", "https://sheets.googleapis.com");
const driveBase = () => base("GOOGLE_DRIVE_BASE_URL", "https://www.googleapis.com");

export type CellValue = string | number | boolean | null;

export interface SheetTabMeta {
  gid: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetMeta {
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  title: string;
  timeZone: string | null;
  sheets: SheetTabMeta[];
}

/** Sheets v4 Color. Google leaves a zero channel out of the JSON it returns. */
export interface GoogleRgb {
  red?: number;
  green?: number;
  blue?: number;
  alpha?: number;
}

/** Sheets v4 ConditionalFormatRule, as far as Cubes reads one back. */
export interface GoogleConditionalRule {
  ranges?: { sheetId?: number; startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number }[];
  booleanRule?: {
    condition?: { type?: string; values?: { userEnteredValue?: string }[] };
    format?: {
      backgroundColor?: GoogleRgb;
      backgroundColorStyle?: { rgbColor?: GoogleRgb };
      textFormat?: { foregroundColor?: GoogleRgb; foregroundColorStyle?: { rgbColor?: GoogleRgb } };
    };
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } };
    return body.error?.message || body.error?.status || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * A Sheets client bound to one Google connection. The token is fetched lazily
 * on the first call and reused for the life of the client (one sync run).
 */
export class SheetsClient {
  private readonly admin: SupabaseClient;
  private readonly connectionId: string;
  private token: string | null = null;

  constructor(admin: SupabaseClient, connectionId: string) {
    this.admin = admin;
    this.connectionId = connectionId;
  }

  private async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const res = await getAccessToken(this.admin as unknown as SupabaseClient<Database>, this.connectionId);
    if (!res.ok) throw new GoogleSheetsError("auth", res.message);
    this.token = res.token;
    return res.token;
  }

  /** Forget the cached token here AND in Postgres, so the next call refreshes. */
  private async dropToken(): Promise<void> {
    this.token = null;
    await this.admin
      .from("app_google_secrets")
      .update({ access_token: null, access_token_expires_at: null })
      .eq("connection_id", this.connectionId);
  }

  private async request<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: init.method ?? "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: controller.signal,
          redirect: "manual",
        });
      } catch {
        clearTimeout(timer);
        if (attempt < RETRIES) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new GoogleSheetsError("network", "Could not reach Google Sheets. Try again.");
      }
      clearTimeout(timer);

      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.dropToken();
        continue;
      }
      if (res.status === 401) {
        throw new GoogleSheetsError("auth", "Google refused the stored access. Reconnect Google to resume syncing.", 401);
      }
      if (res.status === 403 || res.status === 404) {
        const detail = await readError(res);
        // A 403 for quota reasons is a rate limit, not lost access.
        if (res.status === 403 && /quota|rate/i.test(detail) && attempt < RETRIES) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new GoogleSheetsError(
          "access_lost",
          "Cubes can no longer open this Google Sheet — it may have been deleted, or access was removed. Pick the sheet again or unlink it.",
          res.status,
        );
      }
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        await sleep(backoff(attempt, res.headers.get("retry-after")));
        continue;
      }
      const detail = await readError(res);
      if (res.status === 429) throw new GoogleSheetsError("rate_limited", "Google Sheets is rate limiting requests. The next sync will retry.", 429);
      if (res.status >= 500) throw new GoogleSheetsError("server", "Google Sheets had a problem. The next sync will retry.", res.status);
      throw new GoogleSheetsError("bad_request", `Google Sheets rejected the change: ${detail}`.slice(0, 500), res.status);
    }
  }

  /** New spreadsheet with one tab, the header row written, row 1 frozen. */
  async createSpreadsheet(
    title: string,
    tabTitle: string,
    headers: string[],
    timeZone?: string | null,
  ): Promise<{ spreadsheetId: string; spreadsheetUrl: string | null; sheetGid: number; sheetTitle: string }> {
    const created = await this.request<{
      spreadsheetId: string;
      spreadsheetUrl?: string;
      sheets?: { properties: { sheetId: number; title: string } }[];
    }>(`${sheetsBase()}/v4/spreadsheets`, {
      method: "POST",
      body: {
        properties: { title: title.slice(0, 200), ...(timeZone ? { timeZone } : {}) },
        sheets: [
          {
            properties: {
              title: tabTitle.slice(0, 100),
              gridProperties: { frozenRowCount: 1, columnCount: Math.max(26, headers.length + 5) },
            },
          },
        ],
      },
    });
    const tab = created.sheets?.[0]?.properties;
    const out = {
      spreadsheetId: created.spreadsheetId,
      spreadsheetUrl: created.spreadsheetUrl ?? null,
      sheetGid: tab?.sheetId ?? 0,
      sheetTitle: tab?.title ?? tabTitle,
    };
    if (headers.length > 0) {
      await this.writeValues(out.spreadsheetId, [{ range: `${quote(out.sheetTitle)}!A1`, values: [headers.map((h) => "'" + h)] }]);
    }
    return out;
  }

  async getSheetMeta(spreadsheetId: string): Promise<SpreadsheetMeta> {
    const fields = "spreadsheetId,spreadsheetUrl,properties(title,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))";
    const meta = await this.request<{
      spreadsheetId: string;
      spreadsheetUrl?: string;
      properties?: { title?: string; timeZone?: string };
      sheets?: { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
    }>(`${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`);
    return {
      spreadsheetId: meta.spreadsheetId,
      spreadsheetUrl: meta.spreadsheetUrl ?? null,
      title: meta.properties?.title ?? "",
      timeZone: meta.properties?.timeZone ?? null,
      sheets: (meta.sheets ?? []).map((s) => ({
        gid: s.properties.sheetId,
        title: s.properties.title,
        rowCount: s.properties.gridProperties?.rowCount ?? 1000,
        columnCount: s.properties.gridProperties?.columnCount ?? 26,
      })),
    };
  }

  /** Cell values of a range: raw numbers, serial-number dates, booleans. */
  async readValues(spreadsheetId: string, range: string): Promise<(string | number | boolean)[][]> {
    const q = new URLSearchParams({
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
      majorDimension: "ROWS",
    });
    const res = await this.request<{ values?: (string | number | boolean)[][] }>(
      `${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${q}`,
    );
    return res.values ?? [];
  }

  /**
   * Many ranges in one call. USER_ENTERED so ISO days become real dates; text
   * that must stay text carries Google's apostrophe prefix (values.ts).
   */
  async writeValues(
    spreadsheetId: string,
    data: { range: string; values: CellValue[][] }[],
    valueInputOption: "USER_ENTERED" | "RAW" = "USER_ENTERED",
  ): Promise<void> {
    // Keep each request comfortably under Google's payload limits.
    for (let i = 0; i < data.length; i += 1000) {
      await this.request(`${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
        method: "POST",
        body: { valueInputOption, data: data.slice(i, i + 1000) },
      });
    }
  }

  /** Appends rows after the table in `range`, inserting new grid rows. */
  async appendRows(spreadsheetId: string, range: string, rows: CellValue[][]): Promise<void> {
    for (let i = 0; i < rows.length; i += 2000) {
      const q = new URLSearchParams({ valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" });
      await this.request(
        `${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?${q}`,
        { method: "POST", body: { majorDimension: "ROWS", values: rows.slice(i, i + 2000) } },
      );
    }
  }

  async batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<void> {
    if (requests.length === 0) return;
    await this.request(`${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: "POST",
      body: { requests },
    });
  }

  /** The tab's conditional format rules, in priority order (index = position). */
  /**
   * The cell notes in ONE single-column range (A1, e.g. `'Tab'!A2:A40`), by
   * 0-based sheet row index; cells without a note are left out. Grid data is
   * asked for with a field mask of just the note, so the answer stays small
   * however wide the sheet is. Google leaves out startRow when it is 0 and
   * empty trailing rows entirely, and writes an empty row as {}.
   */
  async readNotes(spreadsheetId: string, range: string): Promise<Map<number, string>> {
    const q = new URLSearchParams({ ranges: range, fields: "sheets(data(startRow,rowData(values(note))))" });
    const res = await this.request<{
      sheets?: { data?: { startRow?: number; rowData?: { values?: { note?: string }[] }[] }[] }[];
    }>(`${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?${q}`);
    const out = new Map<number, string>();
    for (const sheet of res.sheets ?? []) {
      for (const block of sheet.data ?? []) {
        (block.rowData ?? []).forEach((row, i) => {
          const note = row.values?.[0]?.note;
          if (typeof note === "string" && note !== "") out.set((block.startRow ?? 0) + i, note);
        });
      }
    }
    return out;
  }

  /**
   * Sets (or, with "", clears) the note on single cells of one column: one
   * updateCells per cell with the field mask "note", so values and formatting
   * are never touched. A CellData without `note` under that mask is how the
   * Sheets API clears one.
   */
  async writeNotes(spreadsheetId: string, gid: number, column: number, notes: { row: number; note: string }[]): Promise<void> {
    await this.batchUpdate(
      spreadsheetId,
      notes.map(({ row, note }) => ({
        updateCells: {
          range: { sheetId: gid, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: column, endColumnIndex: column + 1 },
          rows: [{ values: [note ? { note } : {}] }],
          fields: "note",
        },
      })),
    );
  }

  async readConditionalFormats(spreadsheetId: string, gid: number): Promise<GoogleConditionalRule[]> {
    const fields = "sheets(properties(sheetId),conditionalFormats)";
    const res = await this.request<{ sheets?: { properties?: { sheetId?: number }; conditionalFormats?: GoogleConditionalRule[] }[] }>(
      `${sheetsBase()}/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`,
    );
    // sheetId 0 is omitted from Google's JSON like any other zero.
    const tab = (res.sheets ?? []).find((s) => (s.properties?.sheetId ?? 0) === gid);
    return tab?.conditionalFormats ?? [];
  }

  /**
   * Bold, frozen header row; the "Cubes ID" column narrow and protected with a
   * warning (not a lock: the connecting account owns the file anyway, and a
   * hard lock would also stop people sorting the sheet).
   *
   * `frozenColumns` (google-layout frozenColumnCount) also freezes the columns
   * that name a row, so date and title stay in view while scrolling right. It
   * is sent on its own: Google refuses a freeze that would cut a merged cell
   * in two, batchUpdate is all-or-nothing, and a refused convenience must not
   * take the header — and so every sync of that sheet — down with it.
   */
  async formatHeader(spreadsheetId: string, gid: number, idIndex: number, headerCount: number, frozenColumns = 0): Promise<void> {
    await this.batchUpdate(spreadsheetId, [
      {
        updateSheetProperties: {
          properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: Math.max(headerCount, idIndex + 1) },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: gid, dimension: "COLUMNS", startIndex: idIndex, endIndex: idIndex + 1 },
          properties: { pixelSize: 90 },
          fields: "pixelSize",
        },
      },
      {
        addProtectedRange: {
          protectedRange: {
            range: { sheetId: gid, startColumnIndex: idIndex, endColumnIndex: idIndex + 1 },
            description: "Cubes ID — links each row to its Cubes record. Editing it breaks the sync for that row.",
            warningOnly: true,
          },
        },
      },
    ]);
    if (frozenColumns <= 0) return;
    try {
      await this.batchUpdate(spreadsheetId, [
        {
          updateSheetProperties: {
            properties: { sheetId: gid, gridProperties: { frozenColumnCount: frozenColumns } },
            fields: "gridProperties.frozenColumnCount",
          },
        },
      ]);
    } catch (err) {
      if (!(err instanceof GoogleSheetsError && err.kind === "bad_request")) throw err;
    }
  }

  /** Deletes data rows (0-based sheet row indexes), bottom-up so indexes stay valid. */
  async deleteRows(spreadsheetId: string, gid: number, sheetRowIndexes: number[]): Promise<void> {
    const sorted = [...new Set(sheetRowIndexes)].sort((a, b) => b - a);
    await this.batchUpdate(
      spreadsheetId,
      sorted.map((i) => ({
        deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: i, endIndex: i + 1 } },
      })),
    );
  }

  /** Makes room for more columns (writing past the grid edge is an error). */
  async ensureColumns(spreadsheetId: string, gid: number, have: number, need: number): Promise<void> {
    if (need <= have) return;
    await this.batchUpdate(spreadsheetId, [
      { appendDimension: { sheetId: gid, dimension: "COLUMNS", length: need - have } },
    ]);
  }

  /** Inserts an empty column at `index` (for the Cubes ID column of a sheet
   *  that already had data). */
  async insertColumn(spreadsheetId: string, gid: number, index: number): Promise<void> {
    await this.batchUpdate(spreadsheetId, [
      { insertDimension: { range: { sheetId: gid, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 }, inheritFromBefore: false } },
    ]);
  }

  /** Drive modifiedTime of the file, for "newest wins"; null when unknown. */
  async getModifiedTime(spreadsheetId: string): Promise<string | null> {
    try {
      const res = await this.request<{ modifiedTime?: string; trashed?: boolean }>(
        `${driveBase()}/drive/v3/files/${encodeURIComponent(spreadsheetId)}?fields=modifiedTime,trashed&supportsAllDrives=true`,
      );
      if (res.trashed) {
        throw new GoogleSheetsError("access_lost", "This Google Sheet is in the Google Drive trash. Restore it or unlink it.", 404);
      }
      return res.modifiedTime ?? null;
    } catch (err) {
      if (err instanceof GoogleSheetsError && err.kind === "access_lost") throw err;
      // Only the conflict tie-break uses it; a sync can go on without.
      return null;
    }
  }
}

function backoff(attempt: number, retryAfter?: string | null): number {
  const hinted = retryAfter ? Number(retryAfter) * 1000 : NaN;
  if (Number.isFinite(hinted) && hinted > 0) return Math.min(hinted, 30_000);
  const scale = process.env.NODE_ENV === "test" || process.env.GOOGLE_SHEETS_BASE_URL ? 10 : 1000;
  return scale * 2 ** attempt + Math.floor(Math.random() * scale);
}

function quote(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function sheetsClient(admin: SupabaseClient, connectionId: string): SheetsClient {
  return new SheetsClient(admin, connectionId);
}
