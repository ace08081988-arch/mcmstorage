import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Local-only registry of kiriman pegawai (prep_submissions IDs) yang sudah
 * dikirim ke WA. Disimpan di localStorage agar tetap ada antar reload dan
 * bersinkron antar tab via `storage` event + custom event.
 */
const KEY = "wa-sent-shots:v1";
const EVENT = "wa-sent-shots:changed";
const MAX_ENTRIES = 500;
const RETAIN_MS = 1000 * 60 * 60 * 24 * 30; // 30 hari

/**
 * Registry terpisah untuk id yang di-"Hapus dari Riwayat" — kartu ini
 * TIDAK muncul di Aktif maupun Riwayat sampai user meng-unhide. Disimpan
 * di key sendiri supaya operasi hide tidak mengganggu waktu / metadata
 * kiriman asli di `wa-sent-shots:v1`.
 */
const HIDDEN_KEY = "wa-sent-hidden:v1";
const HIDDEN_EVENT = "wa-sent-hidden:changed";

// -------------------------------------------------------------------
// In-memory overlay. localStorage adalah persistence, TAPI sumber
// kebenaran untuk pembaca (useSentShots / useSentDetails / useHiddenSent)
// adalah map/set di modul ini. Alasan:
//   - private mode / quota exceeded → `setItem` throw; tanpa overlay,
//     entri yang baru saja `markSent` hilang lagi saat subscriber
//     re-read → kartu tidak pindah ke Riwayat tanpa refresh.
//   - dispatch event harus SELALU jalan (bukan hanya bila setItem
//     sukses) supaya subscriber di tab yang sama refetch snapshot.
// -------------------------------------------------------------------
let memSent: Map<string, Entry> | null = null;
let memHidden: Set<string> | null = null;

function ensureMemSent(): Map<string, Entry> {
  if (memSent) return memSent;
  const m = new Map<string, Entry>();
  for (const e of readRawStorage()) m.set(e.id, e);
  memSent = m;
  return m;
}

function ensureMemHidden(): Set<string> {
  if (memHidden) return memHidden;
  memHidden = new Set(readHiddenRawStorage());
  return memHidden;
}

function safeDispatch(name: string) {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new CustomEvent(name)); } catch { /* ignore */ }
}

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

function readRawStorage(): Entry[] {
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
        idemKey: typeof e.idemKey === "string" ? e.idemKey : undefined,
      }));
  } catch {
    return [];
  }
}

function persistSent(entries: Entry[]) {
  // Update overlay dulu — pembaca tidak bergantung pada setItem sukses.
  const map = new Map<string, Entry>();
  for (const e of entries) map.set(e.id, e);
  memSent = map;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(KEY, JSON.stringify(entries)); }
    catch { /* quota / private mode: overlay tetap kanonik */ }
  }
  safeDispatch(EVENT);
}

/** @deprecated dipakai internal saja untuk kompat sinyal test lama */
function readRaw(): Entry[] {
  return Array.from(ensureMemSent().values());
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
  for (const e of ensureMemSent().values()) m.set(e.id, e.at);
  return m;
}

/** Map id → entri lengkap (channel, mapsUrl, status). */
export function getSentDetailsMap(): Map<string, Entry> {
  return new Map(ensureMemSent());
}

export function markSent(ids: string[], meta?: SentMeta) {
  if (!ids || ids.length === 0) return;
  const map = new Map(ensureMemSent());
  const at = Date.now();
  for (const id of ids) {
    if (!id) continue;
    map.set(id, {
      id,
      at,
      channel: meta?.channel,
      mapsUrl: meta?.mapsUrl ?? null,
      status: meta?.status ?? "success",
      idemKey: meta?.idemKey,
    });
  }
  const entries = prune(Array.from(map.values()));
  persistSent(entries);
  // H6: write-through ke DB agar status "terkirim" konsisten lintas
  // perangkat. Fire-and-forget — kegagalan tidak boleh mengganggu UI,
  // localStorage tetap kanonik untuk perangkat ini.
  const channel = meta?.channel === "chat" ? "chat" : "wa";
  const cleanIds = ids.filter((s): s is string => typeof s === "string" && s.length > 0);
  if (cleanIds.length > 0) {
    void supabase
      .rpc("prep_submissions_mark_sent", {
        _ids: cleanIds,
        _channel: channel,
        _maps_url: meta?.mapsUrl ?? undefined,
      })
      .then(() => undefined, () => undefined);
  }
}

export function unmarkSent(ids: string[]) {
  if (!ids || ids.length === 0) return;
  const map = new Map(ensureMemSent());
  for (const id of ids) map.delete(id);
  persistSent(Array.from(map.values()));
  const cleanIds = ids.filter((s): s is string => typeof s === "string" && s.length > 0);
  if (cleanIds.length > 0) {
    void supabase
      .rpc("prep_submissions_unmark_sent", { _ids: cleanIds })
      .then(() => undefined, () => undefined);
  }
}

export function clearSent() { persistSent([]); }

/**
 * H6: hydrate registry lokal dari kolom DB `prep_submissions.sent_at`.
 * Dipanggil sekali per mount komponen konsumen (ReadyEcerSection),
 * setelah data submission dimuat. Menggabungkan entri DB ke overlay
 * lokal tanpa mengganti entri lokal yang lebih baru — supaya perangkat
 * offline yang baru saja markSent tidak kehilangan riwayatnya.
 */
export function hydrateSentFromDb(
  rows: Array<{ id: string; sent_at: string | null; sent_channel?: string | null; sent_maps_url?: string | null }>,
) {
  if (!rows || rows.length === 0) return;
  const map = new Map(ensureMemSent());
  let dirty = false;
  for (const r of rows) {
    if (!r.sent_at) continue;
    const at = new Date(r.sent_at).getTime();
    if (!Number.isFinite(at)) continue;
    const existing = map.get(r.id);
    if (existing && existing.at >= at) continue;
    map.set(r.id, {
      id: r.id,
      at,
      channel: r.sent_channel === "chat" ? "chat" : r.sent_channel === "wa" ? "wa" : undefined,
      mapsUrl: r.sent_maps_url ?? null,
      status: "success",
    });
    dirty = true;
  }
  if (dirty) persistSent(prune(Array.from(map.values())));
}

// ---------------------------------------------------------------------
// Hidden registry — sembunyikan permanen dari Riwayat terkirim.
// ---------------------------------------------------------------------

function readHiddenRawStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

function persistHidden(ids: string[]) {
  const uniq = Array.from(new Set(ids)).slice(-MAX_ENTRIES * 2);
  memHidden = new Set(uniq);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(uniq)); }
    catch { /* quota / private mode: overlay tetap kanonik */ }
  }
  safeDispatch(HIDDEN_EVENT);
}

export function getHiddenSet(): Set<string> {
  return new Set(ensureMemHidden());
}

export function hideSent(ids: string[]) {
  if (!ids || ids.length === 0) return;
  const set = new Set(ensureMemHidden());
  for (const id of ids) if (id) set.add(id);
  persistHidden(Array.from(set));
}

export function unhideSent(ids: string[]) {
  if (!ids || ids.length === 0) return;
  const set = new Set(ensureMemHidden());
  for (const id of ids) set.delete(id);
  persistHidden(Array.from(set));
}

export function useHiddenSent() {
  const [set, setSet] = useState<Set<string>>(() => getHiddenSet());
  const refresh = useCallback(() => setSet(getHiddenSet()), []);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === HIDDEN_KEY) refresh(); };
    const onLocal = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(HIDDEN_EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(HIDDEN_EVENT, onLocal);
    };
  }, [refresh]);
  return set;
}

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
