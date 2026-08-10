import { isNativeApp } from "./is-native";
import { registerPushSubscription, unregisterPushSubscription, sendTestPush } from "./push.functions";

export const VAPID_PUBLIC_KEY =
  "BPu9dnY_SQKEYY_G9tz1YjsBWMuoYZbHPa0lDz0oSsH35dtczBKPIPCxXEF4UuMnDHH_ln-agOhpJwQLmcgNEHw";

const SW_URL = "/sw-push.js";
const SW_SCOPE = "/";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}


/**
 * Simpan token kepemilikan push agar bisa dibaca service worker (yang tidak
 * punya akses localStorage) saat merotasi endpoint.
 */
const PUSH_OWNER_CACHE = "mcm-push-owner";
const PUSH_OWNER_URL = "https://push-owner.local/token";

async function storeOwnershipToken(token: string | null | undefined): Promise<void> {
  if (!token || typeof caches === "undefined") return;
  try {
    const cache = await caches.open(PUSH_OWNER_CACHE);
    await cache.put(
      PUSH_OWNER_URL,
      new Response(JSON.stringify({ token }), {
        headers: { "content-type": "application/json" },
      }),
    );
  } catch {
    /* penyimpanan token bersifat best-effort */
  }
}

async function getOrRegisterSW(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (existing && existing.active && existing.active.scriptURL.endsWith(SW_URL)) return existing;
  return navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
}

export async function enablePushNotifications(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "denied" };
  const reg = await getOrRegisterSW();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const registered = await registerPushSubscription({
    data: {
      endpoint: sub.endpoint,
      p256dh: arrayBufferToBase64(sub.getKey("p256dh")),
      auth: arrayBufferToBase64(sub.getKey("auth")),
      userAgent: navigator.userAgent.slice(0, 256),
    },
  });
  await storeOwnershipToken(registered?.ownershipToken);
  return { ok: true };
}

export async function disablePushNotifications(): Promise<{ ok: boolean }> {
  if (!isPushSupported()) return { ok: true };
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    try {
      await unregisterPushSubscription({ data: { endpoint: sub.endpoint } });
    } catch (_) {}
    await sub.unsubscribe();
  }
  return { ok: true };
}

export async function hasActivePushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

export async function sendTestNotification(): Promise<{ sent: number; message: string }> {
  return sendTestPush();
}

/**
 * Jaga agar notifikasi tetap masuk walau aplikasi tidak dibuka.
 *
 * Langganan push bisa hilang diam-diam (browser merotasi endpoint, storage
 * dibersihkan, service worker digusur). Fungsi ini dipanggil setiap aplikasi
 * dibuka / kembali online: bila izin notifikasi sudah diberikan, service
 * worker dipastikan terdaftar, langganan dibuat ulang bila hilang, lalu
 * didaftarkan ulang ke server supaya baris di database tetap segar.
 */
let keepAliveInFlight: Promise<{ ok: boolean; reason?: string }> | null = null;

export async function keepPushAlive(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };
  if (Notification.permission !== "granted") return { ok: false, reason: "no-permission" };
  // Dedup: `visibilitychange` dan `online` sering menyala bersamaan sehingga
  // pendaftaran ulang bisa terkirim berkali-kali. Bagikan satu proses saja.
  if (keepAliveInFlight) return keepAliveInFlight;
  keepAliveInFlight = (async () => {
   try {
    const reg = await getOrRegisterSW();
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const registered = await registerPushSubscription({
      data: {
        endpoint: sub.endpoint,
        p256dh: arrayBufferToBase64(sub.getKey("p256dh")),
        auth: arrayBufferToBase64(sub.getKey("auth")),
        userAgent: navigator.userAgent.slice(0, 256),
      },
    });
    await storeOwnershipToken(registered?.ownershipToken);
    return { ok: true };
   } catch (e) {
    console.warn("[push] keepPushAlive gagal", e);
    return { ok: false, reason: "error" };
   }
  })();
  try {
    return await keepAliveInFlight;
  } finally {
    keepAliveInFlight = null;
  }
}

let pushKeepAliveStarted = false;

/**
 * Pasang penjaga langganan: sekali saat load, lalu tiap aplikasi kembali
 * terlihat/online (dibatasi maksimal sekali per 6 jam agar hemat).
 */
export function startPushKeepAlive(): void {
  // Di APK memakai native push (FCM), bukan Web Push berbasis SW.
  if (isNativeApp()) return;
  if (typeof window === "undefined" || pushKeepAliveStarted) return;
  pushKeepAliveStarted = true;
  let lastRun = 0;
  const MIN_GAP_MS = 6 * 60 * 60 * 1000;
  // Jeda pendek khusus untuk burst event (visible + online bersamaan).
  const BURST_GAP_MS = 30 * 1000;
  let lastAnyRun = 0;
  const run = (force = false) => {
    const now = Date.now();
    if (now - lastAnyRun < BURST_GAP_MS) return;
    lastAnyRun = now;
    if (!force && now - lastRun < MIN_GAP_MS) return;
    lastRun = now;
    void keepPushAlive();
  };
  run(true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") run();
  });
  window.addEventListener("online", () => run());
}