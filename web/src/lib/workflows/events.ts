import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The workflow event bus, from the Node side.
 *
 * An event is a fact one app states about a team ("a client asked for
 * something", "a deal changed status"). wf_emit_event writes it;
 * wf_dispatch_events — called from the runner's tick — starts one run for
 * every enabled workflow whose trigger_config.event_key matches, exactly once
 * per (event, workflow). Emitting is fire-and-forget by design: a client
 * request must still be recorded when no workflow is listening, and it must
 * not fail because a workflow does.
 *
 * Most emitters are SQL (a SECURITY DEFINER RPC calling wf_emit_event in the
 * same transaction as the row it is about, so the event cannot outlive a
 * rolled-back write). This helper is for the ones that only exist in Node.
 */

/** The event keys v1 ships with. The list is documentation, not a gate — */
/** wf_emit_event accepts any `<app>.<thing_happened>` key. */
export const WORKFLOW_EVENT_KEYS = [
  "client.request_created",
  "client.approval_decided",
  "crm.deal_created",
  // AFTER UPDATE triggers on app_crm_deals (20261148000000): the lead status
  // (contacted → qualified → converted…) and the board column, separately.
  "crm.deal_status_changed",
  "crm.deal_stage_changed",
  "sheets.row_created",
  // Emitted from SQL (app_sheets_emit_changed) after a Drive push sync that
  // actually moved rows — see src/lib/google/sheet-watch.ts.
  "sheets.changed",
] as const;

export type WorkflowEventKey = (typeof WORKFLOW_EVENT_KEYS)[number] | (string & {});

/**
 * Records an event for this team. Returns the event id, or null when nothing
 * was written — either no workflow listens for that key (wf_emit_event skips
 * the row rather than filling the table) or the write failed, which is never
 * allowed to break the caller's own work.
 */
export async function emitWorkflowEvent(
  admin: SupabaseClient,
  teamId: string,
  key: WorkflowEventKey,
  payload: Record<string, unknown> = {},
): Promise<string | null> {
  try {
    const { data, error } = await admin.rpc("wf_emit_event", {
      p_team_id: teamId,
      p_key: key,
      p_payload: payload,
    });
    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}
