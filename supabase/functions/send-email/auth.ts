// Caller authentication + team authorization for the send-email function.

import { jsonResponse } from "../_shared/cors.ts";
import { userClient, type SupabaseClient } from "../_shared/supabase.ts";

/**
 * Resolves the caller from the request's JWT (the gateway's verify_jwt already
 * validated the signature). Returns the user id + email, or a ready error
 * Response.
 */
export async function authenticateCaller(
  admin: SupabaseClient,
  req: Request,
): Promise<{ userId: string; email: string; authHeader: string } | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(jwt);
  if (error || !user) return jsonResponse({ error: "Unauthorized" }, 401);
  return {
    userId: user.id,
    email: (user.email ?? "").toLowerCase(),
    authHeader,
  };
}

/**
 * Team gate AS THE CALLER — the RLS helpers key off auth.uid(), so they must
 * run through a user-scoped client, never the service role. Test mode needs a
 * team admin; a normal dispatch needs membership. Returns null when allowed,
 * or a ready error Response.
 */
export async function authorizeTeam(
  authHeader: string,
  teamId: string,
  isTest: boolean,
): Promise<Response | null> {
  const asUser = userClient(authHeader);
  if (!asUser) return jsonResponse({ error: "Function is not configured." }, 500);

  const gate = isTest ? "is_team_admin" : "is_team_member";
  const { data: allowed, error } = await asUser.rpc(gate, { _team_id: teamId });
  if (error) return jsonResponse({ error: error.message }, 500);
  if (!allowed) {
    return jsonResponse(
      {
        error: isTest
          ? "Only workspace admins can send a test email."
          : "You are not a member of this workspace.",
      },
      403,
    );
  }
  return null;
}

/**
 * Platform-scope gate. Tests need a platform admin. A dispatch is allowed for
 * a platform admin to any recipient, or for ANY signed-in user to their OWN
 * address only (the signup-welcome path) — so the platform sender can never be
 * used to mail arbitrary strangers.
 */
export async function authorizePlatform(
  authHeader: string,
  callerEmail: string,
  to: string,
  isTest: boolean,
): Promise<Response | null> {
  const asUser = userClient(authHeader);
  if (!asUser) return jsonResponse({ error: "Function is not configured." }, 500);

  const { data: isPlatformAdmin, error } = await asUser.rpc("is_platform_admin");
  if (error) return jsonResponse({ error: error.message }, 500);
  if (isPlatformAdmin) return null;

  if (isTest) {
    return jsonResponse(
      { error: "Only platform admins can test the platform sender." },
      403,
    );
  }
  if (!callerEmail || to !== callerEmail) {
    return jsonResponse(
      { error: "Platform emails can only be sent to your own address." },
      403,
    );
  }
  return null;
}

/**
 * Exception to the self-address rule for account.invitation_sent: the send is
 * legitimate when a pending email_invitations row addressed to `to` exists in
 * a team the CALLER belongs to — i.e. someone in that workspace actually
 * invited this address. Returns null when allowed.
 */
export async function authorizeInvitationSend(
  admin: SupabaseClient,
  authHeader: string,
  to: string,
): Promise<Response | null> {
  const asUser = userClient(authHeader);
  if (!asUser) return jsonResponse({ error: "Function is not configured." }, 500);

  const { data: invitations, error } = await admin
    .from("email_invitations")
    .select("team_id")
    .eq("email", to)
    .limit(10);
  if (error) return jsonResponse({ error: error.message }, 500);

  for (const invitation of invitations ?? []) {
    const { data: member } = await asUser.rpc("is_team_member", {
      _team_id: invitation.team_id,
    });
    if (member) return null;
  }
  return jsonResponse(
    { error: "No pending invitation to this address in your workspaces." },
    403,
  );
}
