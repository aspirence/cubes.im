import { safeErrorText } from "@/lib/apps/auth";
import { sheetsActions } from "@/lib/sheets/workflow-actions";
import { crmActions } from "@/lib/crm/workflow-actions";
import { appActionByKey, type AppActionKey } from "./app-action-catalog";
import { runHttpStep, type HttpStepConfig } from "./http-step";
import type { AppActionContext, AppActionHandler, AppActionResult } from "./app-action-types";

/**
 * The server registry behind workflow "app" steps: action key → handler. The
 * catalog (app-action-catalog.ts) says what exists and what the step form
 * shows; the handlers live with the app that owns the data, and this module
 * only routes to them. Server-only (the handlers use service_role and call
 * Google).
 */
const HANDLERS: Record<AppActionKey, AppActionHandler> = {
  ...sheetsActions,
  ...crmActions,
  // The outbound HTTP step belongs to no app — it is the engine's own escape
  // hatch — so its handler lives here rather than in an app's module. The
  // guards (https only, per-team host allowlist, no private addresses,
  // secrets by connection reference) are all in src/lib/workflows/http-step.ts.
  "http.request": (ctx, params) => runHttpStep(ctx.admin, ctx.teamId, params as HttpStepConfig),
};

/**
 * Fills in the catalog defaults for params the step config left out, so a
 * step saved before a param existed (or a template that only sets some) runs
 * with the same values the form would have shown.
 */
export function withParamDefaults(key: string, params: Record<string, unknown> | null | undefined) {
  const out: Record<string, unknown> = {};
  const descriptor = appActionByKey(key);
  for (const p of descriptor?.params ?? []) out[p.key] = p.default;
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/**
 * Runs one app action for a team. Never throws: every failure — unknown
 * action, app not installed or switched off, a handler blowing up — comes
 * back as `{ ok: false, error }` with member-safe text, because the error is
 * written into the run log that every team member can read.
 *
 * The install check happens here, at run time, rather than when the step was
 * saved: an admin can uninstall or disable an app long after a scheduled
 * workflow was built on it, and the step must then fail visibly instead of
 * quietly touching the app's data.
 */
export async function runAppAction(
  key: string,
  ctx: AppActionContext,
  params: Record<string, unknown> | null | undefined,
): Promise<AppActionResult> {
  const descriptor = appActionByKey(key);
  const handler = descriptor ? HANDLERS[descriptor.key] : undefined;
  if (!descriptor || !handler) {
    return { ok: false, output: {}, error: `Unknown app action "${key}".` };
  }

  try {
    // An action with no appKey is the platform's own (http.request), not an
    // app's: there is no installed_apps row to check, and requiring one would
    // make the HTTP step impossible to use in a workspace with no apps.
    if (!descriptor.appKey) {
      const result = await handler(ctx, withParamDefaults(key, params));
      if (!result || typeof result !== "object") {
        return { ok: false, output: {}, error: "The step returned nothing." };
      }
      return {
        ok: Boolean(result.ok),
        output: result.output && typeof result.output === "object" ? result.output : {},
        ...(result.ok ? {} : { error: safeErrorText(result.error ?? "The step failed.") }),
      };
    }

    const { data: install, error } = await ctx.admin
      .from("installed_apps")
      .select("enabled")
      .eq("team_id", ctx.teamId)
      .eq("app_key", descriptor.appKey)
      .maybeSingle();
    if (error) throw error;
    if (!install) {
      return {
        ok: false,
        output: {},
        error: `The ${descriptor.appKey} app is not installed in this workspace — install it from the App Center.`,
      };
    }
    if (!(install as { enabled: boolean }).enabled) {
      return {
        ok: false,
        output: {},
        error: `The ${descriptor.appKey} app is turned off in this workspace.`,
      };
    }

    const result = await handler(ctx, withParamDefaults(key, params));
    if (!result || typeof result !== "object") {
      return { ok: false, output: {}, error: "The app step returned nothing." };
    }
    return {
      ok: Boolean(result.ok),
      output: result.output && typeof result.output === "object" ? result.output : {},
      ...(result.ok ? {} : { error: safeErrorText(result.error ?? "The app step failed.") }),
    };
  } catch (err) {
    return { ok: false, output: {}, error: safeErrorText(err, "The app step failed.") };
  }
}
