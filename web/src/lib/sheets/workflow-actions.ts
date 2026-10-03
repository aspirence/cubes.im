import type { AppActionHandler } from "@/lib/workflows/app-action-types";
import { safeErrorText } from "@/lib/apps/auth";
import { syncSheetLink } from "./google-sync";

/**
 * Workflow "app" step: run the Google Sheets sync for one linked sheet — the
 * way a user says "sync my Meta report to Google after the daily Meta fetch".
 *
 * The sheet id comes from the step's params (the builder's sheet picker), so
 * it is checked against the run's team here: a workflow may only sync its own
 * workspace's sheets, whatever its config says.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A running sync holds the lease for a few seconds; wait briefly for it
 *  rather than failing a scheduled workflow over a collision. */
const BUSY_RETRIES = 3;
const BUSY_WAIT_MS = 3000;

export const sheetsActions: Record<"sheets.sync", AppActionHandler> = {
  "sheets.sync": async (ctx, params) => {
    const sheetId = typeof params.sheet_id === "string" ? params.sheet_id : "";
    if (!UUID_RE.test(sheetId)) {
      return { ok: false, output: {}, error: "Pick the sheet to sync in this step's settings." };
    }
    try {
      const { data: sheet, error } = await ctx.admin
        .from("app_sheets")
        .select("id, archived")
        .eq("id", sheetId)
        .eq("team_id", ctx.teamId)
        .maybeSingle();
      if (error) return { ok: false, output: {}, error: safeErrorText(error.message) };
      if (!sheet) return { ok: false, output: {}, error: "That sheet no longer exists in this workspace." };

      for (let attempt = 0; ; attempt++) {
        const out = await syncSheetLink(ctx.admin, {
          teamId: ctx.teamId,
          sheetId,
          trigger: "workflow",
          actorUserId: ctx.actorUserId,
        });
        if (out.status === "busy" && attempt < BUSY_RETRIES) {
          await new Promise((r) => setTimeout(r, BUSY_WAIT_MS));
          continue;
        }
        const output = {
          pushed: out.pushed,
          pulled: out.pulled,
          created: out.created,
          deleted: out.deleted,
          conflicts: out.conflicts,
          skipped: out.skipped,
        };
        if (out.status === "ok") return { ok: true, output };
        return { ok: false, output, error: out.error ?? "The sync failed." };
      }
    } catch (err) {
      return { ok: false, output: {}, error: safeErrorText(err, "The sync failed.") };
    }
  },
};
