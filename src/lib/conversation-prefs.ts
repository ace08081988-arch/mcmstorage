/**
 * Preferensi per-percakapan yang disimpan lokal per user (pin, mute, wallpaper).
 * Sengaja tidak menyentuh server: preferensi ini bersifat device-local seperti
 * WhatsApp — pin urutan chat berbeda antar perangkat kalau user memang mau.
 * Nanti bisa dinaikkan ke tabel Cloud jika user minta sinkron.
 */
import { useEffect, useState } from "react";

export type ConversationPrefs = {
  pinned: boolean;
  mutedUntil: number | null; // epoch ms; null = tidak di-mute
  archived: boolean;
  markedUnread: boolean;
};

const DEFAULT: ConversationPrefs = {
  pinned: false,
  mutedUntil: null,
  archived: false,
  markedUnread: false,
};

const EVT = "mcm:conv-prefs-changed";
const keyOf = (uid: string, cid: string) => `mcm.conv-prefs.${uid}.${cid}`;

// ID unik per tab; dipakai untuk menandai penulis perubahan agar tab asal
// tidak menampilkan toast "sinkron dari perangkat lain" atas aksinya sendiri.
const TAB_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// Dedupe window: sinyal (cid + changes-signature) yang sudah ditoast dalam
// jendela ini akan diabaikan agar tidak dobel bila StorageEvent terpicu
// beberapa kali beruntun (mis. dua patch dalam 1 tick).
const DEDUPE_MS = 1500;
const recentSignals = new Map<string, number>();
function shouldEmit(cid: string, sig: string): boolean {
  const key = `${cid}::${sig}`;
  const now = Date.now();
  const last = recentSignals.get(key) ?? 0;
  if (now - last < DEDUPE_MS) return false;
  recentSignals.set(key, now);
  // GC
  if (recentSignals.size > 64) {
    for (const [k, t] of recentSignals) if (now - t > DEDUPE_MS * 4) recentSignals.delete(k);
  }
  return true;
}

type StoredPrefs = ConversationPrefs & { __by?: string; __at?: number };

function safeRead(k: string): ConversationPrefs {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(k);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<StoredPrefs>;
    // Buang metadata sebelum mengembalikan ke consumer
    const { __by: _b, __at: _a, ...clean } = p;
    void _b;
    void _a;
    return { ...DEFAULT, ...clean };
  } catch {
    return DEFAULT;
  }
}

function readStoredMeta(k: string): { by?: string; at?: number } {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(k);
    if (!raw) return {};
    const p = JSON.parse(raw) as Partial<StoredPrefs>;
    return { by: p.__by, at: p.__at };
  } catch {
    return {};
  }
}

export function getConvPrefs(uid: string | undefined, cid: string): ConversationPrefs {
  if (!uid) return DEFAULT;
  return safeRead(keyOf(uid, cid));
}

export function setConvPrefs(
  uid: string | undefined,
  cid: string,
  patch: Partial<ConversationPrefs>,
): ConversationPrefs {
  if (!uid || typeof window === "undefined") return DEFAULT;
  const k = keyOf(uid, cid);
  const next = { ...safeRead(k), ...patch };
  try {
    const stored: StoredPrefs = { ...next, __by: TAB_ID, __at: Date.now() };
    window.localStorage.setItem(k, JSON.stringify(stored));
  } catch {
    /* ignore quota */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: { cid } }));
  return next;
}

export function useConvPrefs(uid: string | undefined, cid: string) {
  const [prefs, setPrefs] = useState<ConversationPrefs>(() => getConvPrefs(uid, cid));
  useEffect(() => {
    setPrefs(getConvPrefs(uid, cid));
    if (typeof window === "undefined") return;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { cid?: string } | undefined;
      if (!detail || detail.cid === cid) setPrefs(getConvPrefs(uid, cid));
    };
    const onStorage = (e: StorageEvent) => {
      if (uid && e.key === keyOf(uid, cid)) {
        // Abaikan jika penulis adalah tab ini (StorageEvent normalnya tak
        // menyala di tab asal, tapi kita perkeras terhadap kasus edge).
        const meta = readStoredMeta(keyOf(uid, cid));
        if (meta.by === TAB_ID) {
          setPrefs(getConvPrefs(uid, cid));
          return;
        }
        const next = getConvPrefs(uid, cid);
        setPrefs((prev) => {
          // Diff → beri tahu subscriber bahwa perubahan datang dari tab lain
          try {
            const changes: string[] = [];
            const sigParts: string[] = [];
            if (prev.pinned !== next.pinned) {
              changes.push(next.pinned ? "disematkan" : "dilepas sematan");
              sigParts.push(`pin:${prev.pinned ? 1 : 0}->${next.pinned ? 1 : 0}`);
            }
            if ((prev.mutedUntil ?? 0) !== (next.mutedUntil ?? 0)) {
              changes.push(next.mutedUntil ? "disenyapkan" : "notifikasi aktif");
              // Bucket mute into on/off + expiry timestamp so identical mute
              // targets dedupe, but "8 jam" → "1 minggu" tetap sig berbeda.
              sigParts.push(
                `mute:${prev.mutedUntil ?? 0}->${next.mutedUntil ?? 0}`,
              );
            }
            if (prev.archived !== next.archived) {
              changes.push(next.archived ? "diarsipkan" : "dikeluarkan arsip");
              sigParts.push(`arch:${prev.archived ? 1 : 0}->${next.archived ? 1 : 0}`);
            }
            // Signature mencakup nilai konkret pin/mute/arsip agar dua tulisan
            // beruntun dengan hasil identik ter-dedupe, sementara toggle bolak-
            // balik (on→off→on) tetap dianggap kejadian berbeda.
            const sig = sigParts.join("|");
            if (changes.length && shouldEmit(cid, sig)) {
              window.dispatchEvent(
                new CustomEvent("mcm:conv-prefs-remote", {
                  detail: { cid, changes },
                }),
              );
            }
          } catch {
            /* noop */
          }
          return next;
        });
      }
    };
    window.addEventListener(EVT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [uid, cid]);
  const set = (patch: Partial<ConversationPrefs>) => setPrefs(setConvPrefs(uid, cid, patch));
  const mutedNow = !!(prefs.mutedUntil && prefs.mutedUntil > Date.now());
  return { prefs, set, mutedNow };
}

export const MUTE_PRESETS: Array<{ label: string; ms: number | "forever" }> = [
  { label: "8 jam", ms: 8 * 60 * 60 * 1000 },
  { label: "1 minggu", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "Selalu", ms: "forever" },
];
