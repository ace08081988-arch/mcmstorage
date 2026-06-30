/**
 * Catatan langkah pengiriman per idempotency key. Disimpan di localStorage
 * supaya operator bisa melihat urutan langkah & error kiriman sebelumnya
 * dari dialog pratinjau ("Lihat log") tanpa harus mengulang aksi.
 */
const KEY = "send-log:v1";
const TTL_MS = 24 * 60 * 60 * 1000;  // 24 jam
const MAX_ENTRIES_PER_KEY = 50;
const MAX_KEYS = 80;

export type SendLogKind = "info" | "step" | "error" | "outcome";
export type SendLogEntry = {
  at: number;
  kind: SendLogKind;
  label: string;
  detail?: string;
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
  try { window.localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* quota */ }
}

export function appendSendLog(key: string, entry: Omit<SendLogEntry, "at"> & { at?: number }) {
  if (!key) return;
  const store = readAll();
  const slot = store[key] ?? { updatedAt: 0, entries: [] };
  slot.entries.push({ at: entry.at ?? Date.now(), kind: entry.kind, label: entry.label, detail: entry.detail });
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