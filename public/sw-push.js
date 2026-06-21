/* MCM Storage — Web Push service worker */
self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "Pesan baru", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Pesan baru";
  const options = {
    body: data.body || "",
    icon: "/icon-512.png",
    badge: "/icon-512.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/chat", conversationId: data.conversationId },
    renotify: !!data.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/chat";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of allClients) {
        try {
          const u = new URL(c.url);
          if (u.pathname.startsWith("/chat")) {
            await c.focus();
            c.postMessage({ type: "navigate", url });
            return;
          }
        } catch (_) {}
      }
      if (allClients[0]) {
        await allClients[0].focus();
        allClients[0].postMessage({ type: "navigate", url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});