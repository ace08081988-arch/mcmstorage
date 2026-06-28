/* MCM Storage — Web Push service worker (Play Store-grade UX) */
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

const FALLBACK_ICON = "/icon-512.png";

// Cache preferensi notifikasi dari klien (di-broadcast via postMessage)
self.__notifPrefs = {
  enabledKinds: { chat: true, tugas: true, order: true, system: true },
  vibrate: true,
  dnd: { enabled: false, start: "22:00", end: "06:00", allowUrgent: true },
};

function isInDndWindow(now, start, end) {
  const [sh, sm] = String(start || "22:00").split(":").map((n) => parseInt(n, 10) || 0);
  const [eh, em] = String(end || "06:00").split(":").map((n) => parseInt(n, 10) || 0);
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s === e) return false;
  if (s < e) return cur >= s && cur < e;
  return cur >= s || cur < e;
}

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
  const kind = data.kind || (isChat ? "chat" : "system");
  const prefs = self.__notifPrefs || {};
  // Filter jenis: jika user mematikan kategori ini, abaikan push
  if (prefs.enabledKinds && prefs.enabledKinds[kind] === false) return;
  // Jangan ganggu: hening total kecuali payload.urgent dan user mengizinkan urgent
  const dnd = prefs.dnd || {};
  const inDnd = dnd.enabled && isInDndWindow(new Date(), dnd.start, dnd.end);
  const allowUrgent = inDnd && dnd.allowUrgent && !!data.urgent;
  if (inDnd && !allowUrgent) return;
  const vibrateOn = prefs.vibrate !== false && !inDnd;
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
    silent: inDnd ? true : (data.silent ?? false),
    timestamp: data.timestamp || Date.now(),
    vibrate: vibrateOn ? (data.vibrate || [80, 40, 80]) : [0],
    actions,
    data: {
      url: data.url || "/chat",
      conversationId: data.conversationId,
      messageId: data.messageId,
      kind,
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