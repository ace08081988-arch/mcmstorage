// Preferensi notifikasi (disimpan di localStorage + di-broadcast ke service worker)
export type NotifKind = "chat" | "tugas" | "order" | "system";

export type NotifChannel = "toast" | "push" | "email" | "wa";

export type NotifChannels = Record<NotifChannel, boolean>;

export type NotifPrefs = {
  enabledKinds: Record<NotifKind, boolean>;
  channels: Record<NotifKind, NotifChannels>;
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
const LOCAL_UPDATED_KEY = "mcm.notif.prefs.updated_at";

const DEFAULT_CHANNELS: NotifChannels = { toast: true, push: true, email: false, wa: false };

export const DEFAULT_PREFS: NotifPrefs = {
  enabledKinds: { chat: true, tugas: true, order: true, system: true },
  channels: {
    chat: { ...DEFAULT_CHANNELS },
    tugas: { ...DEFAULT_CHANNELS, wa: true },
    order: { ...DEFAULT_CHANNELS, wa: true },
    system: { ...DEFAULT_CHANNELS, email: true },
  },
  vibrate: true,
  dnd: { enabled: false, start: "22:00", end: "06:00", allowUrgent: true },
};

function mergeChannels(remote?: Partial<Record<NotifKind, Partial<NotifChannels>>>): NotifPrefs["channels"] {
  const base = DEFAULT_PREFS.channels;
  const out = {} as NotifPrefs["channels"];
  (Object.keys(base) as NotifKind[]).forEach((k) => {
    out[k] = { ...base[k], ...((remote && remote[k]) || {}) };
  });
  return out;
}

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
      channels: mergeChannels(parsed.channels as never),
      dnd: { ...DEFAULT_PREFS.dnd, ...(parsed.dnd || {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: NotifPrefs) {
  if (typeof window === "undefined") return;
  const stamp = new Date().toISOString();
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    window.localStorage.setItem(LOCAL_UPDATED_KEY, stamp);
  } catch {}
  broadcastPrefs(prefs);
  try {
    window.dispatchEvent(new CustomEvent("notif-prefs-changed", { detail: prefs }));
  } catch {}
  // Sinkronkan ke cloud (best-effort) supaya perangkat lain ikut update.
  pushPrefsToCloud(prefs, stamp).catch(() => {});
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

// C7: Sinkronisasi daftar chat yang di-mute ke Service Worker.
// Map: conversationId -> mutedUntil (ms epoch). Nilai <= now dianggap tidak mute.
// SW menggunakan map ini untuk menahan tampilan notifikasi walau server salah
// mengirim (mis. karena race saat mute baru diaktifkan).
export function broadcastMutedConversations(muted: Record<string, number>) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) {
      try {
        r.active?.postMessage({ type: "muted-conversations", muted });
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

async function pushPrefsToCloud(prefs: NotifPrefs, updatedAt?: string): Promise<void> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const stamp = updatedAt ?? new Date().toISOString();
    await supabase
      .from("user_notif_prefs")
      .upsert(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { user_id: u.user.id, prefs: prefs as any, updated_at: stamp },
        { onConflict: "user_id" },
      );
    try { window.localStorage.setItem(SYNC_META_KEY, stamp); } catch {}
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
  const localUpdated = (() => {
    try { return window.localStorage.getItem(LOCAL_UPDATED_KEY); } catch { return null; }
  })();
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
      await pushPrefsToCloud(local, localUpdated ?? undefined);
      return local;
    }
    // Jika perubahan lokal lebih baru daripada cloud, dorong lokal ke cloud
    // dan jangan timpa state UI dengan versi cloud yang lebih lama.
    const remoteUpdated = (data as { updated_at?: string | null }).updated_at ?? null;
    if (localUpdated && (!remoteUpdated || localUpdated > remoteUpdated)) {
      await pushPrefsToCloud(local, localUpdated);
      return local;
    }
    const remote = data.prefs as Partial<NotifPrefs> | null;
    const merged: NotifPrefs = {
      ...DEFAULT_PREFS,
      ...(remote || {}),
      enabledKinds: { ...DEFAULT_PREFS.enabledKinds, ...((remote && remote.enabledKinds) || {}) },
      channels: mergeChannels((remote && remote.channels) as never),
      dnd: { ...DEFAULT_PREFS.dnd, ...((remote && remote.dnd) || {}) },
    };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
    try {
      if (remoteUpdated) {
        window.localStorage.setItem(LOCAL_UPDATED_KEY, remoteUpdated);
      }
      window.localStorage.setItem(SYNC_META_KEY, new Date().toISOString());
    } catch {}
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
              channels: mergeChannels(remote.channels as never),
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