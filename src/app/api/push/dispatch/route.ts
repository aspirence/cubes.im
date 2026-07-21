import { NextResponse, type NextRequest } from "next/server";
import webpush from "web-push";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";

/**
 * Delivers a Web Push notification for a freshly-inserted user_notifications
 * row. Called by the DB (pg_net) with a shared secret — never by clients. Loads
 * the notification + the recipient's device subscriptions, signs each with our
 * VAPID key, and prunes any that have expired (404/410).
 */

export const runtime = "nodejs";

// Titles per notification category — the body is always the notification text.
const TITLE: Record<string, string> = {
  mention: "You were mentioned",
  comment: "New comment",
  assignment: "New assignment",
  status_change: "Status update",
  client_review: "Client review",
  join_request: "Join request",
  member_joined: "New member",
  project_shared: "Project shared",
  invitation: "Invitation",
  role_changed: "Role changed",
};

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-push-secret");
  if (!process.env.PUSH_DISPATCH_SECRET || secret !== process.env.PUSH_DISPATCH_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY ?? "";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!vapidPublic || !vapidPrivate || !url || !serviceRoleKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:hello@cubes.im",
    vapidPublic,
    vapidPrivate,
  );

  let notificationId: string | undefined;
  try {
    const body = await request.json();
    notificationId = body?.notification_id;
  } catch {
    /* fall through */
  }
  if (!notificationId) {
    return NextResponse.json({ error: "Missing notification_id" }, { status: 400 });
  }

  const admin = createSupabaseAdmin(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: notif } = await admin
    .from("user_notifications")
    .select("id, user_id, message, url, type")
    .eq("id", notificationId)
    .maybeSingle();
  if (!notif) {
    return NextResponse.json({ ok: true, skipped: "notification not found" });
  }

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", notif.user_id);
  const rows = (subs ?? []) as unknown as SubRow[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const payload = JSON.stringify({
    title: TITLE[notif.type as string] ?? "Cubes",
    body: notif.message,
    url: notif.url || "/home",
    // Coalesce a burst of the same category into one OS notification.
    tag: notif.type || "cubes",
  });

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    rows.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent += 1;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
      }
    }),
  );

  if (dead.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }

  return NextResponse.json({ ok: true, sent, pruned: dead.length });
}
