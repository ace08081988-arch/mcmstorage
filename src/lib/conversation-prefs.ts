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

function safeRead(k: string): ConversationPrefs {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(k);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<ConversationPrefs>;
    return { ...DEFAULT, ...p };
  } catch {
    return DEFAULT;
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
    window.localStorage.setItem(k, JSON.stringify(next));
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
      if (uid && e.key === keyOf(uid, cid)) setPrefs(getConvPrefs(uid, cid));
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
