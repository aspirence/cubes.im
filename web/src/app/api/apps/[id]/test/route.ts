import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { authorizeConnectionAdmin, serviceClient } from "@/lib/apps/server";
import { assertPublicHttpUrl } from "@/lib/apps/net";

const TIMEOUT_MS = 10_000;

/**
 * POST a string body with a bounded timeout and no redirect-following. Never
 * throws and never returns provider-supplied text — only a coarse outcome — so
 * a secret target URL can never leak through an error message.
 */
async function timedPost(
  url: string,
  bodyStr: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status?: number; failure?: "timeout" | "network" }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: bodyStr,
      // Don't follow redirects — a public host must not 3xx into internal space.
      redirect: "manual",
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return {
      ok: false,
      failure: (err as Error)?.name === "AbortError" ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Maps a coarse delivery outcome to a message that never contains the URL. */
function outcomeDetail(
  r: { ok: boolean; status?: number; failure?: "timeout" | "network" },
  target: string,
  success: string,
): string {
  if (r.ok) return success;
  if (r.failure === "timeout") return "Request timed out.";
  if (r.failure === "network") return `Could not reach the ${target}.`;
  return `${target} returned HTTP ${r.status}.`;
}

/**
 * Provider-specific connection test (org admin only). Reads credentials with
 * the service role, attempts a real delivery, and records the outcome onto the
 * connection's health columns. Returns / persists only sanitized text — never a
 * credential value, a target URL, or a raw exception message (last_test_error is
 * readable by every org member, so a leaked webhook URL would be a real breach).
 *
 *  - slack:   POST a "connection test" message to the stored incoming-webhook URL
 *             (pinned to https://hooks.slack.com).
 *  - webhook: POST {test:true,...} to the configured URL; if a signing secret is
 *             stored, add an X-Signature (HMAC-SHA256 over "<timestamp>.<body>").
 */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const auth = await authorizeConnectionAdmin(id);
  if (!auth.ok) return auth.response;
  const { connection } = auth;

  const admin = serviceClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Connection testing is not configured." },
      { status: 500 },
    );
  }

  const { data: secretRow } = await admin
    .from("app_connection_secrets")
    .select("credentials")
    .eq("connection_id", id)
    .maybeSingle();
  const creds =
    (secretRow?.credentials as Record<string, string> | undefined) ?? {};
  const config = (connection.config as Record<string, unknown>) ?? {};

  let ok = false;
  let detail = "";

  if (connection.provider === "slack") {
    const webhookUrl = creds.webhook_url;
    if (!webhookUrl) {
      detail =
        "No Slack incoming-webhook URL saved. Add it to the connection's credentials.";
    } else {
      const check = await assertPublicHttpUrl(webhookUrl, {
        requireHttps: true,
        host: "hooks.slack.com",
      });
      if (!check.ok) {
        detail = check.reason;
      } else {
        const r = await timedPost(
          webhookUrl,
          JSON.stringify({
            text: `:white_check_mark: *${connection.name}* connection test from Cubes.`,
          }),
          {},
        );
        ok = r.ok;
        detail = outcomeDetail(r, "Slack webhook", "Test message delivered to Slack.");
      }
    }
  } else if (connection.provider === "webhook") {
    const url = typeof config.url === "string" ? config.url : "";
    if (!url) {
      detail = "No webhook URL is configured for this connection.";
    } else {
      const check = await assertPublicHttpUrl(url);
      if (!check.ok) {
        detail = check.reason;
      } else {
        const bodyStr = JSON.stringify({
          test: true,
          connection: connection.name,
          sent_at: new Date().toISOString(),
        });
        const headers: Record<string, string> = {};
        const signingSecret = creds.signing_secret;
        if (signingSecret) {
          const ts = Math.floor(Date.now() / 1000).toString();
          const sig = createHmac("sha256", signingSecret)
            .update(`${ts}.${bodyStr}`)
            .digest("hex");
          headers["X-Signature"] = `sha256=${sig}`;
          headers["X-Signature-Timestamp"] = ts;
        }
        const r = await timedPost(url, bodyStr, headers);
        ok = r.ok;
        detail = outcomeDetail(
          r,
          "endpoint",
          signingSecret ? "Signed test POST delivered." : "Test POST delivered.",
        );
      }
    }
  } else {
    detail = `Testing for "${connection.provider}" is not available yet.`;
  }

  // Record health so the App Center dot reflects a real attempt. `detail` here
  // is always one of the sanitized strings above — safe to store in the
  // member-readable last_test_error column.
  await admin
    .from("app_connections")
    .update({
      last_test_status: ok ? "ok" : "failed",
      last_tested_at: new Date().toISOString(),
      last_test_error: ok ? null : detail.slice(0, 1000),
    })
    .eq("id", id);

  return NextResponse.json({ ok, detail }, { status: 200 });
}
