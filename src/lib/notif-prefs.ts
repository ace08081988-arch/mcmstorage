// Preferensi notifikasi (disimpan di localStorage + di-broadcast ke service worker)
export type NotifKind = "chat" | "tugas" | "order" | "system";

export type NotifPrefs = {
  enabledKinds: Record<NotifKind, boolean>;
  vibrate: boolean;
  dnd: {
    enabled: boolean;
    start: string; // "HH:MM"
    end: string;   // "HH:MM"
    allowUrgent: boolean; // tetap tampil jika payload.urgent === true
  };
};

const STORAGE_KEY = "mcm.notif.prefs.v1";

export const DEFAULT_PREFS: NotifPrefs = {
  enabledKinds: { chat: true, tugas: true, order: true, system: true },
  vibrate: true,
  dnd: { enabled: false, start: "22:00", end: "06:00", allowUrgent: true },
};

export function loadPrefs(): NotifPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotifPrefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      enabledKinds: { ...DEFAULT_PREFS.enabledKinds, ...(parsed.enabledKinds || {}) },
      dnd: { ...DEFAULT_PREFS.dnd, ...(parsed.dnd || {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: NotifPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
  broadcastPrefs(prefs);
  try {
    window.dispatchEvent(new CustomEvent("notif-prefs-changed", { detail: prefs }));
  } catch {}
}

export function broadcastPrefs(prefs: NotifPrefs) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) {
      try {
        r.active?.postMessage({ type: "notif-prefs", prefs });
      } catch {}
    }
  }).catch(() => {});
}

// Helper waktu: apakah jam "HH:MM" saat ini berada dalam jendela DND?
export function isInDndWindow(now: Date, start: string, end: string): boolean {
  const [sh, sm] = start.split(":").map((n) => parseInt(n, 10) || 0);
  const [eh, em] = end.split(":").map((n) => parseInt(n, 10) || 0);
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s === e) return false;
  if (s < e) return cur >= s && cur < e;
  // Melewati tengah malam
  return cur >= s || cur < e;
}