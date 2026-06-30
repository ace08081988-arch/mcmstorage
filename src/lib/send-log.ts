/**
 * Catatan langkah pengiriman per idempotency key. Disimpan di localStorage
 * supaya operator bisa melihat urutan langkah & error kiriman sebelumnya
 * dari dialog pratinjau ("Lihat log") tanpa harus mengulang aksi.
 */
import type { SendPayloadSummary } from "@/lib/idempotency";
import { useSyncExternalStore } from "react";

const KEY = "send-log:v1";
const EVENT = "send-log:changed";
const TTL_MS = 24 * 60 * 60 * 1000;  // 24 jam
const MAX_ENTRIES_PER_KEY = 50;
const MAX_KEYS = 80;

export type SendLogKind = "info" | "step" | "error" | "outcome";
export type SendLogDiff = {
  previous: SendPayloadSummary | null;
  current: SendPayloadSummary | null;
  reason: string;
};
export type SendLogEntry = {
  at: number;
  kind: SendLogKind;
  label: string;
  detail?: string;
  /** Snapshot perbedaan payload (kiriman sebelumnya vs sekarang). Dilampirkan
   *  saat kiriman sebelumnya gagal atau sidik jari payload tidak cocok — agar
   *  diff bisa direview di "Lihat log kiriman sebelumnya" tanpa perlu replay. */
  diff?: SendLogDiff;
};

type Store = Record<string, { updatedAt: number; entries: SendLogEntry[] }>;

function readAll(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    return data as Store;
  } catch { return {}; }
}

function writeAll(store: Store) {
  const now = Date.now();
  for (const k of Object.keys(store)) {
    if (now - store[k].updatedAt > TTL_MS) delete store[k];
  }
  const keys = Object.keys(store);
  if (keys.length > MAX_KEYS) {
    keys.sort((a, b) => store[b].updatedAt - store[a].updatedAt);
    for (const k of keys.slice(MAX_KEYS)) delete store[k];
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* quota */ }
}

export function appendSendLog(key: string, entry: Omit<SendLogEntry, "at"> & { at?: number }) {
  if (!key) return;
  const store = readAll();
  const slot = store[key] ?? { updatedAt: 0, entries: [] };
  slot.entries.push({ at: entry.at ?? Date.now(), kind: entry.kind, label: entry.label, detail: entry.detail, diff: entry.diff });
  if (slot.entries.length > MAX_ENTRIES_PER_KEY) slot.entries = slot.entries.slice(-MAX_ENTRIES_PER_KEY);
  slot.updatedAt = Date.now();
  store[key] = slot;
  writeAll(store);
}

export function getSendLog(key: string): SendLogEntry[] {
  if (!key) return [];
  const slot = readAll()[key];
  if (!slot) return [];
  if (Date.now() - slot.updatedAt > TTL_MS) return [];
  return slot.entries.slice();
}

export function clearSendLog(key: string) {
  const store = readAll();
  if (store[key]) { delete store[key]; writeAll(store); }
}

export function resetSendLog(key: string) {
  const store = readAll();
  store[key] = { updatedAt: Date.now(), entries: [] };
  writeAll(store);
}

/**
 * Catat snapshot diff payload (kiriman sebelumnya vs sekarang) ke log
 * idempotency key. Dipakai saat kiriman sebelumnya gagal atau sidik jari
 * payload tidak cocok agar operator bisa meninjau penyebabnya dari panel
 * "Lihat log kiriman sebelumnya".
 *
 * Dedupe: jika entri terakhir adalah diff dengan payload identik (alasan,
 * previous, current — dibandingkan via JSON), tidak menambah baris baru
 * supaya log tidak banjir saat dialog dibuka berkali-kali.
 */
export function appendPayloadDiffLog(
  key: string,
  previous: SendPayloadSummary | null,
  current: SendPayloadSummary | null,
  reason: string,
) {
  if (!key) return;
  const store = readAll();
  const slot = store[key] ?? { updatedAt: 0, entries: [] };
  const last = slot.entries[slot.entries.length - 1];
  const nextDiff: SendLogDiff = { previous, current, reason };
  if (last?.diff && JSON.stringify(last.diff) === JSON.stringify(nextDiff)) return;
  slot.entries.push({
    at: Date.now(),
    kind: "info",
    label: reason,
    diff: nextDiff,
  });
  if (slot.entries.length > MAX_ENTRIES_PER_KEY) slot.entries = slot.entries.slice(-MAX_ENTRIES_PER_KEY);
  slot.updatedAt = Date.now();
  store[key] = slot;
  writeAll(store);
}

/**
 * Hook: lacak entri send-log untuk `key` secara real-time. Dipakai dialog
 * pratinjau Chat/WA untuk menampilkan progres langkah dari kiriman channel
 * lain yang sedang in-flight (cross-channel awareness).
 */
export function useLiveSendLog(key: string | null | undefined): SendLogEntry[] {
  const k = key ?? "";
  const subscribe = (cb: () => void) => {
    if (typeof window === "undefined") return () => {};
    const onEvt = () => cb();
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
    window.addEventListener(EVENT, onEvt);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onEvt);
      window.removeEventListener("storage", onStorage);
    };
  };
  const getSnapshot = () => {
    if (!k) return "";
    const entries = getSendLog(k);
    // Snapshot string stabil untuk useSyncExternalStore.
    return entries.map((e) => `${e.at}|${e.kind}|${e.label}`).join("\n");
  };
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => "");
  if (!snap) return [];
  return getSendLog(k);
}