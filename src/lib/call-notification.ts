/**
 * Notifikasi sistem untuk panggilan masuk.
 *
 * Dipakai oleh `CallHost`: saat sinyal `ring` datang tapi user sedang
 * di layar lain / aplikasi di background, banner in-app saja tidak
 * cukup terlihat. Di sini kita tampilkan notifikasi OS + getar.
 *
 * Semua fungsi aman dipanggil di web maupun APK — feature-detect dan
 * no-op bila API tidak tersedia atau izin belum diberikan.
 */

const TAG = "mcm-incoming-call";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Minta izin notifikasi sekali (idempotent, tidak melempar error). */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  try {
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

function vibrateRing(): void {
  try {
    navigator.vibrate?.([500, 400, 500, 400, 500]);
  } catch {
    /* ignore */
  }
}

/**
 * Tampilkan notifikasi panggilan masuk. Mengembalikan fungsi pembersih
 * (dipanggil saat panggilan diterima/ditolak/berakhir).
 */
export async function showIncomingCallNotification(opts: {
  callerName: string;
  kind: "audio" | "video";
}): Promise<void> {
  const title = `Panggilan ${opts.kind === "video" ? "video" : "suara"} masuk`;
  const body = `${opts.callerName} sedang memanggil…`;
  // Native (APK): Notification API web tidak menampilkan apa pun di WebView,
  // jadi pakai local notification dengan channel "Panggilan masuk".
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { notifyLocal } = await import("./local-notify");
      await notifyLocal({
        kind: "call",
        title,
        body,
        url: "/chat",
        tag: TAG,
        urgent: true,
      });
      return;
    }
  } catch {
    /* lanjut ke jalur web */
  }
  const granted = await ensureNotificationPermission();
  vibrateRing();
  if (!granted) return;
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body,
    tag: TAG,
    renotify: true,
    requireInteraction: true,
    silent: false,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [500, 400, 500],
    data: { url: "/chat" },
  };
  try {
    // Service worker lebih andal di Android (notifikasi tetap tampil
    // walau tab tidak fokus). Fallback ke Notification biasa.
    const reg = await navigator.serviceWorker?.getRegistration("/");
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    /* fallback di bawah */
  }
  try {
    new Notification(title, options);
  } catch {
    /* ignore */
  }
}

/** Tutup notifikasi panggilan masuk yang masih tampil. */
export async function clearIncomingCallNotification(): Promise<void> {
  try {
    navigator.vibrate?.(0);
  } catch {
    /* ignore */
  }
  try {
    const { clearLocalNotification } = await import("./local-notify");
    await clearLocalNotification(TAG);
  } catch {
    /* ignore */
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    const list = await reg?.getNotifications({ tag: TAG });
    list?.forEach((n) => n.close());
  } catch {
    /* ignore */
  }
}