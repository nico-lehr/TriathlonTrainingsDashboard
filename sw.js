// Service Worker nur für Mitteilungen (Morgenbericht, backend/morning.py).
// Speichert bewusst nichts zwischen (kein Offline-Cache): das Dashboard lädt
// immer frisch vom Server, genau wie ohne diese Datei.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "TriDashboard";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: data.tag || "morgen",
    data: { url: data.url || "./" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        c.postMessage({ type: "morning-open" });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
