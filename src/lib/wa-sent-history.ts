import { useEffect, useState, useCallback } from "react";

/**
 * Local-only registry of kiriman pegawai (prep_submissions IDs) yang sudah
 * dikirim ke WA. Disimpan di localStorage agar tetap ada antar reload dan
 * bersinkron antar tab via `storage` event + custom event.
 */
const KEY = "wa-sent-shots:v1";
const EVENT = "wa-sent-shots:changed";
const MAX_ENTRIES = 500;
const RETAIN_MS = 1000 * 60 * 60 * 24 * 30; // 30 hari

/** Channel pengiriman yang menghasilkan entri Riwayat. */
export type SentChannel = "wa" | "chat";
/** Status hasil pengiriman. Saat ini hanya kiriman sukses yang masuk Riwayat. */
export type SentStatus = "success" | "failed";

export type SentMeta = {
  channel?: SentChannel;
  mapsUrl?: string | null;
  status?: SentStatus;
  /** Idempotency key dari helper kirim, untuk audit/debug ulangan klik. */
  idemKey?: string;
};

export type Entry = {
  id: string;
  at: number;
  channel?: SentChannel;
  mapsUrl?: string | null;
  status?: SentStatus;
  idemKey?: string;
};

function readRaw(): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((e): e is Entry => e && typeof e.id === "string" && typeof e.at === "number")
      .map((e) => ({
        id: e.id,
        at: e.at,
        channel: e.channel === "wa" || e.channel === "chat" ? e.channel : undefined,
        mapsUrl: typeof e.mapsUrl === "string" && e.mapsUrl ? e.mapsUrl : null,
        status: e.status === "failed" ? "failed" : e.status === "success" ? "success" : undefined,
      }));
  } catch {
    return [];
  }
}

function writeRaw(entries: Entry[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* ignore quota */ }
}

function prune(entries: Entry[]): Entry[] {
  const cutoff = Date.now() - RETAIN_MS;
  const fresh = entries.filter((e) => e.at >= cutoff);
  if (fresh.length <= MAX_ENTRIES) return fresh;
  // newest first, then keep MAX_ENTRIES
  return [...fresh].sort((a, b) => b.at - a.at).slice(0, MAX_ENTRIES);
}

export function getSentMap(): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of readRaw()) m.set(e.id, e.at);
  return m;
}

/** Map id → entri lengkap (channel, mapsUrl, status). */
export function getSentDetailsMap(): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const e of readRaw()) m.set(e.id, e);
  return m;
}

export function markSent(ids: string[], meta?: SentMeta) {
  if (!ids || ids.length === 0) return;
  const map = getSentDetailsMap();
  const at = Date.now();
  for (const id of ids) {
    if (!id) continue;
    map.set(id, {
      id,
      at,
      channel: meta?.channel,
      mapsUrl: meta?.mapsUrl ?? null,
      status: meta?.status ?? "success",
    });
  }
  const entries = prune(Array.from(map.values()));
  writeRaw(entries);
}

export function unmarkSent(ids: string[]) {
  if (!ids || ids.length === 0) return;
  const map = getSentDetailsMap();
  for (const id of ids) map.delete(id);
  writeRaw(Array.from(map.values()));
}

export function clearSent() { writeRaw([]); }

export function useSentShots() {
  const [map, setMap] = useState<Map<string, number>>(() => getSentMap());
  const refresh = useCallback(() => setMap(getSentMap()), []);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) refresh(); };
    const onLocal = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT, onLocal);
    };
  }, [refresh]);
  return map;
}

/** Sama seperti `useSentShots` tetapi mengembalikan metadata lengkap per id. */
export function useSentDetails() {
  const [map, setMap] = useState<Map<string, Entry>>(() => getSentDetailsMap());
  const refresh = useCallback(() => setMap(getSentDetailsMap()), []);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) refresh(); };
    const onLocal = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT, onLocal);
    };
  }, [refresh]);
  return map;
}
