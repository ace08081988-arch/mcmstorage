import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const FLAG_KEY = "mcm_permissions_requested_v1";
const WEB_FLAG_KEY = "mcm_permissions_requested_web_v1";

/**
 * Minta izin notifikasi di web PWA saat aplikasi terpasang
 * (dibuka dari home screen / standalone) — sekali saja.
 */
async function bootstrapWebPermissions() {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;

  // Hanya minta saat aplikasi dipasang (standalone / minimal-ui / fullscreen),
  // atau iOS Safari yang sudah ditambahkan ke home screen.
  const mql = window.matchMedia?.("(display-mode: standalone)");
  const isStandalone =
    (mql && mql.matches) ||
    // iOS legacy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).standalone === true;
  if (!isStandalone) return;

  try {
    if (localStorage.getItem(WEB_FLAG_KEY) === "1") return;
  } catch {
    // Ignore storage errors (private mode dsb.)
  }

  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch (e) {
    console.warn("[perm] web notification", e);
  }

  try {
    localStorage.setItem(WEB_FLAG_KEY, "1");
  } catch {
    // ignore
  }
}

/**
 * Minta semua izin perangkat sekaligus saat pertama kali aplikasi native
 * dibuka. Aman dipanggil di web — tidak melakukan apa-apa di luar Capacitor.
 */
export async function bootstrapNativePermissions() {
  if (!Capacitor.isNativePlatform()) {
    // Di web, minta izin notifikasi saat PWA terpasang.
    await bootstrapWebPermissions();
    return;
  }

  const existing = await Preferences.get({ key: FLAG_KEY });
  if (existing.value === "1") return;

  // Notifikasi
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const status = await PushNotifications.checkPermissions();
    if (status.receive !== "granted") {
      await PushNotifications.requestPermissions();
    }
  } catch (e) {
    console.warn("[perm] push", e);
  }

  // Kamera + Galeri (Camera plugin meminta kedua izin)
  try {
    const { Camera } = await import("@capacitor/camera");
    const status = await Camera.checkPermissions();
    if (status.camera !== "granted" || status.photos !== "granted") {
      await Camera.requestPermissions({ permissions: ["camera", "photos"] });
    }
  } catch (e) {
    console.warn("[perm] camera", e);
  }

  // Lokasi
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const status = await Geolocation.checkPermissions();
    if (status.location !== "granted") {
      await Geolocation.requestPermissions({ permissions: ["location"] });
    }
  } catch (e) {
    console.warn("[perm] geo", e);
  }

  await Preferences.set({ key: FLAG_KEY, value: "1" });
}