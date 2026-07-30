/*
 * Cubes service worker.
 *
 * Kept deliberately small: it makes the app installable and delivers Web Push
 * notifications. It does NOT cache app HTML/data (the app is highly dynamic and
 * auth-gated — stale shells would do more harm than good); only a tiny offline
 * fallback is served when a navigation fails with no network.
 */

const OFFLINE_URL = "/offline.html";
const CACHE = "cubes-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL]).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop old shell caches.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Network-first for navigations, with the offline page as the last resort.
// Everything else goes straight to the network (no caching).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())),
    );
  }
});

/* ------------------------------------------------------------------ push */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Cubes", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Cubes";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || undefined,
    // Coalesce same-tag notifications instead of stacking duplicates.
    renotify: Boolean(payload.tag),
    data: { url: payload.url || "/home" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/home";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus an existing app window and route it; otherwise open one.
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              /* cross-origin or blocked — ignore */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })(),
  );
});
