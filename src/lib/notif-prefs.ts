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
const SYNC_META_KEY = "mcm.notif.prefs.synced_at";

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
  // Sinkronkan ke cloud (best-effort) supaya perangkat lain ikut update.
  pushPrefsToCloud(prefs).catch(() => {});
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

// ===== Sinkronisasi lintas perangkat via Supabase =====

async function pushPrefsToCloud(prefs: NotifPrefs): Promise<void> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    await supabase
      .from("user_notif_prefs")
      .upsert(
        { user_id: u.user.id, prefs: prefs as unknown as Record<string, unknown>, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    try { window.localStorage.setItem(SYNC_META_KEY, new Date().toISOString()); } catch {}
  } catch {
    // diamkan; perubahan lokal tetap tersimpan dan akan disinkronkan saat online berikutnya
  }
}

/**
 * Tarik preferensi terbaru dari cloud lalu terapkan ke lokal + broadcast ke SW.
 * Aman dipanggil berkali-kali; mengembalikan prefs aktif setelah merge.
 */
export async function pullPrefsFromCloud(): Promise<NotifPrefs> {
  const local = loadPrefs();
  if (typeof window === "undefined") return local;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return local;
    const { data, error } = await supabase
      .from("user_notif_prefs")
      .select("prefs, updated_at")
      .eq("user_id", u.user.id)
      .maybeSingle();
    if (error || !data) {
      // Baris belum ada → dorong default/lokal ke cloud sebagai baseline
      await pushPrefsToCloud(local);
      return local;
    }
    const remote = data.prefs as Partial<NotifPrefs> | null;
    const merged: NotifPrefs = {
      ...DEFAULT_PREFS,
      ...(remote || {}),
      enabledKinds: { ...DEFAULT_PREFS.enabledKinds, ...((remote && remote.enabledKinds) || {}) },
      dnd: { ...DEFAULT_PREFS.dnd, ...((remote && remote.dnd) || {}) },
    };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
    try { window.localStorage.setItem(SYNC_META_KEY, new Date().toISOString()); } catch {}
    broadcastPrefs(merged);
    try {
      window.dispatchEvent(new CustomEvent("notif-prefs-changed", { detail: merged }));
    } catch {}
    return merged;
  } catch {
    return local;
  }
}

/**
 * Berlangganan perubahan preferensi dari perangkat lain (realtime).
 * Mengembalikan fungsi unsubscribe.
 */
export function subscribeRemotePrefs(onChange: (p: NotifPrefs) => void): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  let cleanup: (() => void) | null = null;
  (async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user || cancelled) return;
      const channel = supabase
        .channel(`notif-prefs:${u.user.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_notif_prefs", filter: `user_id=eq.${u.user.id}` },
          (payload) => {
            const remote = (payload.new as { prefs?: Partial<NotifPrefs> } | null)?.prefs;
            if (!remote) return;
            const merged: NotifPrefs = {
              ...DEFAULT_PREFS,
              ...remote,
              enabledKinds: { ...DEFAULT_PREFS.enabledKinds, ...(remote.enabledKinds || {}) },
              dnd: { ...DEFAULT_PREFS.dnd, ...(remote.dnd || {}) },
            };
            try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
            broadcastPrefs(merged);
            try {
              window.dispatchEvent(new CustomEvent("notif-prefs-changed", { detail: merged }));
            } catch {}
            onChange(merged);
          },
        )
        .subscribe();
      cleanup = () => {
        try { supabase.removeChannel(channel); } catch {}
      };
    } catch {}
  })();
  return () => {
    cancelled = true;
    if (cleanup) cleanup();
  };
}

export function getLastSyncedAt(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(SYNC_META_KEY); } catch { return null; }
}