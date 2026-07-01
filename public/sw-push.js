/* MCM Storage — Web Push service worker (Play Store-grade UX) */
// Ubah SW_VERSION untuk memaksa browser mengambil SW baru + memicu update
// asset (manifest, ikon) tanpa harus uninstall aplikasi.
const SW_VERSION = "2026-07-01-1";
const ASSET_CACHE = `mcm-assets-${SW_VERSION}`;
// Aset yang wajib selalu segar setelah SW baru aktif (manifest & ikon).
const FRESH_ASSETS = [
  "/manifest.webmanifest",
  "/favicon.ico",
  "/favicon-16.png",
  "/favicon-32.png",
  "/favicon-48.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/mask-icon.svg",
  "/og-image.jpg",
];
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Bersihkan cache aset versi lama supaya manifest/ikon baru tidak
    // "menyangkut" di cache lama.
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("mcm-assets-") && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      );
    } catch (_) {}
    await self.clients.claim();
    // Beri tahu semua klien bahwa SW baru sudah aktif — halaman bisa
    // menampilkan banner / reload lembut bila diperlukan.
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) {
      try { c.postMessage({ type: "sw-activated", version: SW_VERSION }); } catch (_) {}
    }
  })());
});

// Network-first untuk manifest & ikon: setiap request selalu coba jaringan
// dulu, fallback ke cache saat offline. Efeknya: perubahan manifest/ikon
// terambil segera tanpa uninstall.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  if (!FRESH_ASSETS.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    try {
      const fresh = await fetch(req, { cache: "no-cache" });
      if (fresh && fresh.ok) {
        try { await cache.put(req, fresh.clone()); } catch (_) {}
        return fresh;
      }
      const cached = await cache.match(req);
      return cached || fresh;
    } catch (_) {
      const cached = await cache.match(req);
      if (cached) return cached;
      return Response.error();
    }
  })());
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
  // Hanya tekan notifikasi bila percakapan yang SAMA sedang difokuskan.
  // Untuk notif non-chat (atau chat tanpa conversationId), selalu tampilkan.
  if (!conversationId) return false;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of clients) {
    if (!c.focused) continue;
    try {
      const u = new URL(c.url);
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

// Terima preferensi notifikasi dari klien (halaman pengaturan)
self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d && d.type === "notif-prefs" && d.prefs) {
    self.__notifPrefs = d.prefs;
  }
  if (d && d.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (d && d.type === "GET_VERSION") {
    try { event.source && event.source.postMessage({ type: "sw-version", version: SW_VERSION }); } catch (_) {}
  }
});