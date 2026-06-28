/* MCM Storage — Web Push service worker (Play Store-grade UX) */
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

const FALLBACK_ICON = "/icon-512.png";

async function appAlreadyFocusedFor(conversationId) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of clients) {
    if (!c.focused) continue;
    try {
      const u = new URL(c.url);
      if (!conversationId) return true;
      if (u.pathname === `/chat/${conversationId}`) return true;
    } catch (_) {}
  }
  return false;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "Pesan baru", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Pesan baru";
  const isChat = !!data.conversationId;
  const actions = Array.isArray(data.actions) && data.actions.length
    ? data.actions
    : isChat
      ? [
          { action: "open", title: "Buka" },
          { action: "mark-read", title: "Tandai dibaca" },
        ]
      : [];

  const options = {
    body: data.body || "",
    icon: data.icon || FALLBACK_ICON,
    badge: data.badge || "/icon-192.png",
    image: data.image || undefined,
    tag: data.tag || undefined,
    renotify: !!data.tag,
    requireInteraction: data.requireInteraction ?? false,
    silent: data.silent ?? false,
    timestamp: data.timestamp || Date.now(),
    vibrate: data.vibrate || [80, 40, 80],
    actions,
    data: {
      url: data.url || "/chat",
      conversationId: data.conversationId,
      messageId: data.messageId,
      kind: data.kind || (isChat ? "chat" : "generic"),
    },
  };

  event.waitUntil(
    (async () => {
      // Jangan ganggu pengguna saat percakapan terkait sedang dibuka & difokuskan
      if (isChat && (await appAlreadyFocusedFor(data.conversationId))) return;
      await self.registration.showNotification(title, options);
    })(),
  );
});

async function focusOrOpen(url) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  // Cocokkan persis dulu
  for (const c of clients) {
    try {
      const u = new URL(c.url);
      if (u.pathname + u.search === url) {
        await c.focus();
        c.postMessage({ type: "navigate", url });
        return;
      }
    } catch (_) {}
  }
  // Lalu jendela aplikasi lain
  for (const c of clients) {
    try {
      const u = new URL(c.url);
      if (u.origin === self.location.origin) {
        await c.focus();
        c.postMessage({ type: "navigate", url });
        return;
      }
    } catch (_) {}
  }
  await self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  n.close();
  const d = n.data || {};
  const url = d.url || "/chat";
  if (event.action === "mark-read" && d.conversationId) {
    event.waitUntil(
      (async () => {
        // Minta klien aktif menandai dibaca; bila tidak ada, buka chat agar app menandai otomatis
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        if (clients.length > 0) {
          for (const c of clients) {
            c.postMessage({
              type: "mark-read",
              conversationId: d.conversationId,
              messageId: d.messageId,
            });
          }
          return;
        }
        await self.clients.openWindow(`/chat/${d.conversationId}?markRead=1`);
      })(),
    );
    return;
  }
  event.waitUntil(focusOrOpen(url));
});

self.addEventListener("notificationclose", () => {
  // Hook analitik bisa ditambahkan di sini bila diperlukan
});