import { Capacitor } from "@capacitor/core";
import { registerFcmToken } from "./push.functions";

let started = false;
let currentToken: string | null = null;

export function getCurrentFcmToken() {
  return currentToken;
}

/**
 * Aktifkan notifikasi native (Android FCM / iOS APNs via Firebase).
 * Aman dipanggil di web — no-op di luar platform native.
 * Idempotent — listener hanya dipasang sekali per sesi.
 */
export async function startNativePush(opts?: {
  onOpenUrl?: (url: string) => void;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!Capacitor.isNativePlatform()) return { ok: false, reason: "not_native" };
  if (started) return { ok: true };
  started = true;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    // Pastikan izin diberikan
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive !== "granted") {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== "granted") {
        started = false;
        return { ok: false, reason: "denied" };
      }
    }

    // Registrasi (kembali via listener registration)
    await PushNotifications.addListener("registration", async (t) => {
      currentToken = t.value;
      try {
        await registerFcmToken({
          data: {
            token: t.value,
            platform: Capacitor.getPlatform() === "ios" ? "ios" : "android",
            deviceInfo: navigator.userAgent.slice(0, 256),
          },
        });
      } catch (e) {
        console.warn("[native-push] register token gagal", e);
      }
    });

    await PushNotifications.addListener("registrationError", (err) => {
      console.warn("[native-push] registrationError", err);
    });

    // Foreground: log saja — FCM notification block akan tetap tampil di system tray
    // di Android dengan Capacitor plugin default.
    await PushNotifications.addListener("pushNotificationReceived", (n) => {
      console.debug("[native-push] received", n);
    });

    // Tap notifikasi → buka deep link
    await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
      const url = (a.notification.data as { url?: string } | undefined)?.url;
      if (url && opts?.onOpenUrl) opts.onOpenUrl(url);
      else if (url && typeof window !== "undefined") {
        window.location.assign(url.startsWith("http") ? url : url || "/");
      }
    });

    await PushNotifications.register();
    return { ok: true };
  } catch (e) {
    started = false;
    console.warn("[native-push] init gagal", e);
    return { ok: false, reason: (e as Error).message };
  }
}