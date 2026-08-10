/* Ace Storage — Web Push service worker (Play Store-grade UX) */
// Ubah SW_VERSION untuk memaksa browser mengambil SW baru + memicu update
// asset (manifest, ikon) tanpa harus uninstall aplikasi.
const SW_VERSION = "2026-08-07-2";
const ASSET_CACHE = `mcm-assets-${SW_VERSION}`;
// Aset yang wajib selalu segar setelah SW baru aktif (manifest & ikon).
const FRESH_ASSETS = [
  "/manifest.webmanifest",
  "/manifest-chat.webmanifest",
  "/favicon.ico",
  "/favicon-16.png",
  "/favicon-32.png",
  "/favicon-48.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/mcm-chat-icon.png",
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

// ---------------------------------------------------------------------------
// Dedup + prioritas notifikasi.
// Saat langganan dipulihkan (pushsubscriptionchange) atau perangkat kembali
// online, push provider bisa mengirim ulang payload yang sama beberapa kali.
// Kita simpan sidik jari notifikasi yang sudah tampil di Cache Storage (tahan
// restart service worker) dan menolak duplikat dalam jendela waktu tertentu.
// ---------------------------------------------------------------------------
const DEDUP_CACHE = "mcm-notif-dedup";
const DEDUP_URL = "https://sw-notif-dedup.local/seen";
const DEDUP_TTL_MS = 10 * 60 * 1000; // duplikat dalam 10 menit ditolak
const DEDUP_MAX = 200;

// Prioritas: makin besar makin penting. Notifikasi dengan tag sama hanya
// digantikan oleh notifikasi berprioritas >= yang sedang tampil.
const PRIORITY = { chat: 30, order: 25, tugas: 20, system: 10 };
function priorityOf(kind, urgent) {
  return (PRIORITY[kind] ?? 10) + (urgent ? 100 : 0);
}

function dedupKeyFor(data, kind) {
  if (data.dedupKey) return String(data.dedupKey);
  if (data.messageId) return `msg:${data.messageId}`;
  return `${kind}:${data.conversationId || ""}:${data.title || ""}:${data.body || ""}`;
}

async function readSeen() {
  try {
    const cache = await caches.open(DEDUP_CACHE);
    const res = await cache.match(DEDUP_URL);
    if (!res) return {};
    const json = await res.json();
    return json && typeof json === "object" ? json : {};
  } catch (_) {
    return {};
  }
}

async function writeSeen(map) {
  try {
    const cache = await caches.open(DEDUP_CACHE);
    await cache.put(
      DEDUP_URL,
      new Response(JSON.stringify(map), { headers: { "content-type": "application/json" } }),
    );
  } catch (_) {}
}

/**
 * Kembalikan true bila notifikasi ini duplikat (sudah pernah tampil dalam
 * jendela TTL) — sekaligus mencatat sidik jarinya bila belum ada.
 */
async function isDuplicateNotification(key, priority) {
  const now = Date.now();
  const seen = await readSeen();
  const prev = seen[key];
  if (prev && now - prev.at < DEDUP_TTL_MS && priority <= (prev.p ?? 0)) return true;
  seen[key] = { at: now, p: priority };
  // Buang entri kedaluwarsa & batasi ukuran.
  const entries = Object.entries(seen)
    .filter(([, v]) => now - (v?.at ?? 0) < DEDUP_TTL_MS)
    .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
    .slice(0, DEDUP_MAX);
  await writeSeen(Object.fromEntries(entries));
  return false;
}

/**
 * Aturan prioritas untuk tag yang sama: notifikasi baru hanya boleh
 * menggantikan yang sedang tampil bila prioritasnya tidak lebih rendah.
 */
async function blockedByHigherPriority(tag, priority) {
  if (!tag) return false;
  try {
    const existing = await self.registration.getNotifications({ tag });
    for (const n of existing) {
      const p = (n.data && n.data.priority) ?? 0;
      if (p > priority) return true;
    }
  } catch (_) {}
  return false;
}

// Cache preferensi notifikasi dari klien (di-broadcast via postMessage)
self.__notifPrefs = {
  enabledKinds: { chat: true, tugas: true, order: true, system: true },
  vibrate: true,
  dnd: { enabled: false, start: "22:00", end: "06:00", allowUrgent: true },
};

// C7: Cache daftar percakapan yang di-mute (id → mutedUntil ms epoch).
// Diperbarui via postMessage `muted-conversations` dari halaman utama.
self.__mutedConversations = {};

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
    // M3: `Client.focused` tidak reliable di iOS Safari — pada PWA yang
    // sedang aktif nilainya bisa `false` walau aplikasi terlihat di layar.
    // Fallback ke `Client.visibilityState === "visible"` supaya deteksi
    // "app sedang dibuka" tetap benar; jika keduanya menandai tidak
    // aktif, lewati klien tersebut.
    const focused = c.focused === true || c.visibilityState === "visible";
    if (!focused) continue;
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
  // C7: Jika conversation ini sedang di-mute, jangan tampilkan notifikasi.
  if (isChat && data.conversationId) {
    const until = (self.__mutedConversations || {})[data.conversationId];
    if (typeof until === "number" && until > Date.now()) return;
  }
  // Jangan ganggu: hening total kecuali payload.urgent dan user mengizinkan urgent
  const dnd = prefs.dnd || {};
  const inDnd = dnd.enabled && isInDndWindow(new Date(), dnd.start, dnd.end);
  const allowUrgent = inDnd && dnd.allowUrgent && !!data.urgent;
  if (inDnd && !allowUrgent) return;
  const vibrateOn = prefs.vibrate !== false && !inDnd;
  const priority = priorityOf(kind, data.urgent);
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
      priority,
      dedupKey: dedupKeyFor(data, kind),
    },
  };

  event.waitUntil(
    (async () => {
      // Jangan ganggu pengguna saat percakapan terkait sedang dibuka & difokuskan
      if (isChat && (await appAlreadyFocusedFor(data.conversationId))) return;
      // Tolak kiriman ulang yang identik (pemulihan langganan / kembali online).
      if (await isDuplicateNotification(options.data.dedupKey, priority)) return;
      // Jangan turunkan kualitas: tag yang sama tidak boleh ditimpa notifikasi
      // berprioritas lebih rendah.
      if (await blockedByHigherPriority(options.tag, priority)) return;
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
  if (d && d.type === "muted-conversations" && d.muted && typeof d.muted === "object") {
    self.__mutedConversations = d.muted;
  }
  if (d && d.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (d && d.type === "GET_VERSION") {
    try { event.source && event.source.postMessage({ type: "sw-version", version: SW_VERSION }); } catch (_) {}
  }
  if (d && d.type === "INVALIDATE_ASSETS" && Array.isArray(d.paths)) {
    // Hapus entri cache yang cocok agar fetch berikutnya wajib jaringan.
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(ASSET_CACHE);
        await Promise.allSettled(
          d.paths.map((p) => cache.delete(new Request(p, { method: "GET" })))
            .concat(d.paths.map((p) => cache.delete(p))),
        );
      } catch (_) {}
      try { event.source && event.source.postMessage({ type: "assets-invalidated", paths: d.paths }); } catch (_) {}
    })());
  }
  if (d && d.type === "PURGE_ALL_CACHES") {
    // Dipicu klien saat mendeteksi BUILD_ID berubah (bundle JS baru).
    // Semua cache milik SW ini dikosongkan sehingga request berikutnya
    // wajib mengambil dari jaringan; hindari mencampur aset lama+baru.
    event.waitUntil((async () => {
      let deleted = [];
      try {
        if ("caches" in self) {
          const names = await caches.keys();
          const results = await Promise.allSettled(names.map((n) => caches.delete(n)));
          deleted = names.filter((_, i) => results[i].status === "fulfilled");
        }
      } catch (_) {}
      try {
        event.source && event.source.postMessage({
          type: "caches-purged",
          buildId: d.buildId || null,
          deleted,
        });
      } catch (_) {}
    })());
  }
});
// ---------------------------------------------------------------------------
// Pemulihan langganan otomatis.
// Browser sesekali merotasi/mencabut langganan push (update aplikasi, storage
// dibersihkan, kunci kedaluwarsa). Tanpa penanganan, notifikasi berhenti diam-
// diam saat aplikasi tidak dibuka. Handler ini langsung berlangganan ulang dan
// melaporkan endpoint baru ke server memakai endpoint lama sebagai bukti.
// ---------------------------------------------------------------------------
const VAPID_PUBLIC_KEY_SW =
  "BPu9dnY_SQKEYY_G9tz1YjsBWMuoYZbHPa0lDz0oSsH35dtczBKPIPCxXEF4UuMnDHH_ln-agOhpJwQLmcgNEHw";

function swUrlB64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function swKeyToBase64(buf) {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function resubscribePush(oldSubscription) {
  const fresh = await self.registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: swUrlB64ToUint8Array(VAPID_PUBLIC_KEY_SW),
  });
  const oldEndpoint = oldSubscription && oldSubscription.endpoint;
  if (!oldEndpoint) return;
  // Token kepemilikan bertanda tangan disimpan aplikasi saat login; tanpa itu
  // server menolak rotasi (fail-closed) dan klien akan memperbaiki saat dibuka.
  let ownershipToken = null;
  try {
    const cache = await caches.open("mcm-push-owner");
    const res = await cache.match("https://push-owner.local/token");
    if (res) ownershipToken = (await res.json()).token || null;
  } catch (_) {}
  if (!ownershipToken) return;
  await fetch("/api/public/push-resubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      oldEndpoint,
      endpoint: fresh.endpoint,
      p256dh: swKeyToBase64(fresh.getKey("p256dh")),
      auth: swKeyToBase64(fresh.getKey("auth")),
      ownershipToken,
    }),
  });
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await resubscribePush(event.oldSubscription);
      } catch (_) {
        // Gagal senyap: klien akan memperbaiki saat aplikasi dibuka lagi.
      }
    })(),
  );
});
