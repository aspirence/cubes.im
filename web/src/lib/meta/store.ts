import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaAdAccount } from "./graph";

/**
 * Reads and writes for the Meta connection tables (migration 20261151). Every
 * function takes the service-role client: members can only SELECT these tables,
 * and app_meta_secrets is invisible to them altogether.
 *
 * The tables are newer than the generated database types, hence the untyped
 * client — the same `loose` cast the Sheets and Client apps use.
 */

const db = (admin: SupabaseClient) => admin as unknown as SupabaseClient;

export interface MetaConnectionRow {
  id: string;
  team_id: string;
  meta_user_id: string;
  meta_user_name: string | null;
  token_kind: "user" | "system_user";
  token_expires_at: string | null;
  enabled: boolean;
  revoked_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
}

export interface MetaAccountRow {
  id: string;
  team_id: string;
  connection_id: string;
  external_id: string;
  name: string;
  currency: string | null;
  timezone_name: string | null;
  account_status: number | null;
  business_name: string | null;
  enabled: boolean;
}

/**
 * Saves a connection after a successful login: the identity row (one per
 * Facebook identity per workspace, so a reconnect updates it), its token, and
 * the ad accounts it can see. Accounts the admin had switched off stay off;
 * accounts the login no longer reaches are removed.
 */
export async function saveMetaConnection(
  adminClient: SupabaseClient,
  input: {
    teamId: string;
    userId: string;
    metaUserId: string;
    metaUserName: string | null;
    tokenKind: "user" | "system_user";
    tokenExpiresAt: string | null;
    scopes: string[];
    token: string;
    accounts: MetaAdAccount[];
  },
): Promise<{ ok: true; connectionId: string } | { ok: false; error: string }> {
  const admin = db(adminClient);
  const now = new Date().toISOString();
  const { data: conn, error } = await admin
    .from("app_meta_connections")
    .upsert(
      {
        team_id: input.teamId,
        meta_user_id: input.metaUserId.slice(0, 100),
        meta_user_name: input.metaUserName?.slice(0, 300) ?? null,
        token_kind: input.tokenKind,
        token_expires_at: input.tokenExpiresAt,
        scopes: input.scopes.join(",").slice(0, 2000),
        enabled: true,
        revoked_at: null,
        last_test_at: now,
        last_test_ok: true,
        last_test_error: null,
        connected_by: input.userId,
      },
      { onConflict: "team_id,meta_user_id" },
    )
    .select("id")
    .single();
  if (error || !conn) return { ok: false, error: "save_failed" };
  const connectionId = (conn as { id: string }).id;

  const { error: secretError } = await admin
    .from("app_meta_secrets")
    .upsert({ connection_id: connectionId, access_token: input.token, updated_at: now }, { onConflict: "connection_id" });
  if (secretError) {
    await admin.from("app_meta_connections").update({ last_test_ok: false }).eq("id", connectionId);
    return { ok: false, error: "save_failed" };
  }

  const synced = await syncMetaAccounts(adminClient, input.teamId, connectionId, input.accounts);
  return synced.ok ? { ok: true, connectionId } : synced;
}

/** Brings a connection's account list in line with what the token can see now. */
export async function syncMetaAccounts(
  adminClient: SupabaseClient,
  teamId: string,
  connectionId: string,
  accounts: MetaAdAccount[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = db(adminClient);
  if (accounts.length) {
    // `enabled` is left out of the upsert, so an existing row keeps the
    // admin's choice and a new one takes the column default (on).
    const { error } = await admin.from("app_meta_ad_accounts").upsert(
      accounts.map((a) => ({
        team_id: teamId,
        connection_id: connectionId,
        external_id: a.external_id,
        name: a.name.slice(0, 300),
        currency: a.currency,
        timezone_name: a.timezone_name,
        account_status: a.account_status,
        business_name: a.business_name,
      })),
      { onConflict: "connection_id,external_id" },
    );
    if (error) return { ok: false, error: "save_failed" };
  }
  const keep = accounts.map((a) => a.external_id);
  let remove = admin.from("app_meta_ad_accounts").delete().eq("connection_id", connectionId);
  if (keep.length) remove = remove.not("external_id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  const { error: pruneError } = await remove;
  if (pruneError) return { ok: false, error: "save_failed" };
  return { ok: true };
}

export async function metaToken(adminClient: SupabaseClient, connectionId: string): Promise<string | null> {
  const { data } = await db(adminClient)
    .from("app_meta_secrets")
    .select("access_token")
    .eq("connection_id", connectionId)
    .maybeSingle();
  const token = (data as { access_token?: string } | null)?.access_token;
  return token || null;
}

/** Records the outcome of using a connection, so the settings screen can show it. */
export async function markMetaConnection(
  adminClient: SupabaseClient,
  connectionId: string,
  outcome: { ok: true } | { ok: false; error: string; revoked?: boolean },
): Promise<void> {
  const now = new Date().toISOString();
  await db(adminClient)
    .from("app_meta_connections")
    .update(
      outcome.ok
        ? { last_test_at: now, last_test_ok: true, last_test_error: null }
        : {
            last_test_at: now,
            last_test_ok: false,
            last_test_error: outcome.error.slice(0, 1000),
            ...(outcome.revoked ? { revoked_at: now } : {}),
          },
    )
    .eq("id", connectionId);
}

/**
 * The ad accounts a run should read: enabled accounts on enabled, unrevoked
 * connections, optionally narrowed to the ids the step picked.
 */
export async function accountsForRun(
  adminClient: SupabaseClient,
  teamId: string,
  accountIds: string[],
): Promise<MetaAccountRow[]> {
  let query = db(adminClient)
    .from("app_meta_ad_accounts")
    .select(
      "id, team_id, connection_id, external_id, name, currency, timezone_name, account_status, business_name, enabled, connection:app_meta_connections!inner(enabled, revoked_at)",
    )
    .eq("team_id", teamId)
    .eq("enabled", true)
    .eq("connection.enabled", true)
    .is("connection.revoked_at", null)
    .order("name", { ascending: true });
  if (accountIds.length) query = query.in("id", accountIds);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as (MetaAccountRow & { connection?: unknown })[]).map((r) => {
    const { connection: _connection, ...rest } = r;
    void _connection;
    return rest;
  });
}
