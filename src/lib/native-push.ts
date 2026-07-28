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

    // Foreground: Android TIDAK menampilkan push saat aplikasi dibuka.
    // Tampilkan sendiri lewat local notification (channel asli + getar)
    // supaya perilakunya sama seperti aplikasi chat sungguhan.
    await PushNotifications.addListener("pushNotificationReceived", async (n) => {
      try {
        const data = (n.data ?? {}) as { url?: string; kind?: string; tag?: string };
        const { notifyLocal } = await import("./local-notify");
        const kind = (["chat", "tugas", "order", "system"] as const).includes(
          data.kind as never,
        )
          ? (data.kind as "chat" | "tugas" | "order" | "system")
          : "system";
        await notifyLocal({
          kind,
          title: n.title ?? "MCM Storage",
          body: n.body ?? "",
          url: data.url,
          tag: data.tag ?? `push:${kind}:${n.title ?? ""}`,
        });
      } catch (e) {
        console.warn("[native-push] foreground render gagal", e);
      }
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
    // Siapkan channel notifikasi lokal + listener tap sekali di sini juga,
    // supaya notifikasi in-app tetap muncul walau push belum pernah tiba.
    try {
      const { initLocalNotifications } = await import("./local-notify");
      await initLocalNotifications({ onOpenUrl: opts?.onOpenUrl });
    } catch {
      /* non-fatal */
    }
    return { ok: true };
  } catch (e) {
    started = false;
    console.warn("[native-push] init gagal", e);
    return { ok: false, reason: (e as Error).message };
  }
}