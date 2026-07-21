"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { registerServiceWorker } from "@/features/pwa/use-pwa";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** push_subscriptions is newer than the generated database types. */
function loose(s: ReturnType<typeof createClient>) {
  return s as unknown as SupabaseClient;
}

/** VAPID public key (URL-safe base64) -> the Uint8Array subscribe() expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Boolean(VAPID_PUBLIC)
  );
}

/**
 * OS-level Web Push for the current device: request permission, subscribe with
 * our VAPID key, and store the subscription so the server can push even when
 * the app is closed. Each device/browser is its own subscription row.
 */
export function usePushNotifications() {
  const supabase = useMemo(() => createClient(), []);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();

  useEffect(() => {
    if (!supported) return;
    // Resolve current permission + subscription after mount (async, so no
    // synchronous setState in the effect body and no SSR/hydration mismatch).
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setPermission(Notification.permission);
        setSubscribed(Boolean(sub));
      })
      .catch(() => setPermission(Notification.permission));
  }, [supported]);

  const enable = useCallback(async (): Promise<
    "subscribed" | "denied" | "unsupported"
  > => {
    if (!supported) return "unsupported";
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return "denied";

      const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast around the ArrayBufferLike/ArrayBuffer lib-dom mismatch.
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as unknown as BufferSource,
        });
      }
      const json = sub.toJSON();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return "unsupported";

      // Keyed on endpoint so re-enabling on the same device is idempotent.
      await loose(supabase)
        .from("push_subscriptions")
        .upsert(
          {
            user_id: user.id,
            endpoint: sub.endpoint,
            p256dh: json.keys?.p256dh ?? "",
            auth: json.keys?.auth ?? "",
            user_agent: navigator.userAgent.slice(0, 300),
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "endpoint" },
        );
      setSubscribed(true);
      return "subscribed";
    } finally {
      setBusy(false);
    }
  }, [supabase, supported]);

  const disable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await loose(supabase).from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, [supabase, supported]);

  return { supported, permission, subscribed, busy, enable, disable };
}
