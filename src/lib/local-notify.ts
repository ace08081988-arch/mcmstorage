/**
 * Notifikasi lokal "rasa aplikasi beneran".
 *
 * Masalah yang diselesaikan:
 *  - Di APK (Android WebView), `new Notification()` milik web TIDAK
 *    menampilkan apa pun. Jadi notifikasi in-app selama ini tak terlihat.
 *  - Push FCM yang datang saat aplikasi sedang DIBUKA (foreground) juga
 *    tidak ditampilkan Android — hanya di-log.
 *
 * Modul ini memakai @capacitor/local-notifications di native (channel
 * beneran: suara, getar, importance, lampu) dan jatuh ke Service Worker /
 * Notification API di web. Semua fungsi aman dipanggil di mana pun.
 */
import { Capacitor } from "@capacitor/core";
import { isInDndWindow, loadPrefs, type NotifKind } from "./notif-prefs";

export type LocalNotifyKind = NotifKind | "call";

export type LocalNotifyInput = {
  kind: LocalNotifyKind;
  title: string;
  body: string;
  /** Deep link yang dibuka saat notifikasi ditekan. */
  url?: string;
  /** Tag unik — notifikasi dengan tag sama saling menimpa (bukan menumpuk). */
  tag?: string;
  /** Lewati DND & bypass "kind dimatikan" (mis. panggilan masuk). */
  urgent?: boolean;
  /** Grup notifikasi di Android (mis. per percakapan). */
  group?: string;
};

type Channel = {
  id: string;
  name: string;
  description: string;
  importance: 1 | 2 | 3 | 4 | 5;
  vibration: boolean;
};

export const NOTIF_CHANNELS: Record<LocalNotifyKind, Channel> = {
  chat: {
    id: "mcm_chat",
    name: "Pesan chat",
    description: "Pesan masuk dari pelanggan, supplier, dan pegawai",
    importance: 5,
    vibration: true,
  },
  tugas: {
    id: "mcm_tugas",
    name: "Penyiapan & tugas",
    description: "Pegawai mengunggah penyiapan, tugas selesai atau gagal",
    importance: 4,
    vibration: true,
  },
  order: {
    id: "mcm_order",
    name: "Pesanan & pembayaran",
    description: "Pesanan baru, verifikasi pembayaran, hutang piutang",
    importance: 4,
    vibration: true,
  },
  system: {
    id: "mcm_system",
    name: "Sistem",
    description: "Peringatan sistem, keamanan, dan pembaruan aplikasi",
    importance: 3,
    vibration: false,
  },
  call: {
    id: "mcm_call",
    name: "Panggilan masuk",
    description: "Panggilan suara dan video masuk",
    importance: 5,
    vibration: true,
  },
};

const isNative = () => Capacitor.isNativePlatform();

let inited = false;
let openUrlHandler: ((url: string) => void) | null = null;

/** id numerik stabil dari tag (Android butuh integer). */
function idFromTag(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return Math.abs(h % 2000000) + 1000;
}

function openUrl(url?: string) {
  if (!url) return;
  if (openUrlHandler) {
    openUrlHandler(url);
    return;
  }
  try {
    window.location.assign(url.startsWith("http") || url.startsWith("/") ? url : `/${url}`);
  } catch {
    /* ignore */
  }
}

/**
 * Buat notification channel + pasang listener tap. Idempotent.
 * Panggil sekali saat boot (dari __root).
 */
export async function initLocalNotifications(opts?: {
  onOpenUrl?: (url: string) => void;
}): Promise<{ ok: boolean; reason?: string }> {
  if (opts?.onOpenUrl) openUrlHandler = opts.onOpenUrl;
  if (inited) return { ok: true };
  if (!isNative()) {
    inited = true;
    return { ok: false, reason: "not_native" };
  }
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    inited = true;

    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== "granted") return { ok: false, reason: "denied" };
    }

    if (Capacitor.getPlatform() === "android") {
      for (const ch of Object.values(NOTIF_CHANNELS)) {
        try {
          await LocalNotifications.createChannel({
            id: ch.id,
            name: ch.name,
            description: ch.description,
            importance: ch.importance,
            visibility: 1,
            vibration: ch.vibration,
            lights: true,
          });
        } catch {
          /* channel mungkin sudah ada */
        }
      }
    }

    await LocalNotifications.addListener("localNotificationActionPerformed", (a) => {
      const url = (a.notification.extra as { url?: string } | undefined)?.url;
      openUrl(url);
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Apakah notifikasi jenis ini boleh tampil sekarang (prefs + DND)? */
export function shouldNotify(kind: LocalNotifyKind, urgent = false): boolean {
  if (urgent) return true;
  const prefs = loadPrefs();
  const k: NotifKind = kind === "call" ? "chat" : kind;
  if (!prefs.enabledKinds[k]) return false;
  if (prefs.dnd.enabled && isInDndWindow(new Date(), prefs.dnd.start, prefs.dnd.end)) {
    return false;
  }
  return true;
}

function vibrate(kind: LocalNotifyKind) {
  try {
    if (!loadPrefs().vibrate) return;
    const pattern = kind === "call" ? [500, 400, 500, 400, 500] : [180, 90, 180];
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

/**
 * Tampilkan notifikasi sistem. Native → LocalNotifications (channel asli),
 * web → Service Worker / Notification API.
 */
export async function notifyLocal(input: LocalNotifyInput): Promise<boolean> {
  const { kind, title, body, url, urgent } = input;
  if (!shouldNotify(kind, urgent)) return false;
  const tag = input.tag ?? `${kind}:${title}`;
  const channel = NOTIF_CHANNELS[kind] ?? NOTIF_CHANNELS.system;
  vibrate(kind);

  if (isNative()) {
    try {
      if (!inited) await initLocalNotifications();
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.schedule({
        notifications: [
          {
            id: idFromTag(tag),
            title,
            body,
            channelId: channel.id,
            group: input.group ?? channel.id,
            ongoing: kind === "call",
            autoCancel: kind !== "call",
            extra: { url, kind, tag },
          },
        ],
      });
      return true;
    } catch (e) {
      console.warn("[local-notify] native gagal", e);
      return false;
    }
  }

  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission !== "granted") {
      const res = await Notification.requestPermission();
      if (res !== "granted") return false;
    }
    const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
      body,
      tag,
      renotify: true,
      requireInteraction: kind === "call",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
    };
    const reg = await navigator.serviceWorker?.getRegistration("/");
    if (reg) {
      await reg.showNotification(title, options);
      return true;
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

/** Tutup notifikasi berdasarkan tag (native + web). */
export async function clearLocalNotification(tag: string): Promise<void> {
  if (isNative()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.cancel({ notifications: [{ id: idFromTag(tag) }] });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    const list = await reg?.getNotifications({ tag });
    list?.forEach((n) => n.close());
  } catch {
    /* ignore */
  }
}

/** Badge angka di ikon aplikasi (web: Badging API). */
export async function setAppBadge(count: number): Promise<void> {
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    /* ignore */
  }
}

/** Uji cepat dari halaman pengaturan — selalu tampil (urgent). */
export async function sendLocalTestNotification(): Promise<boolean> {
  return notifyLocal({
    kind: "system",
    title: "Notifikasi aktif",
    body: "Begini tampilan notifikasi MCM di perangkat ini.",
    url: "/notifikasi",
    tag: "mcm:test",
    urgent: true,
  });
}
