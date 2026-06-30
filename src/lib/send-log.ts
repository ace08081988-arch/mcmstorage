/**
 * Catatan langkah pengiriman per idempotency key. Disimpan di localStorage
 * supaya operator bisa melihat urutan langkah & error kiriman sebelumnya
 * dari dialog pratinjau ("Lihat log") tanpa harus mengulang aksi.
 */
import type { SendPayloadSummary } from "@/lib/idempotency";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
export function useLiveSendLog(
  key: string | null | undefined,
  options?: { pollMs?: number },
): SendLogEntry[] {
  const k = key ?? "";
  // Polling fallback: meski `appendSendLog` memancarkan event `send-log:changed`
  // di tab yang sama dan event `storage` lintas tab, beberapa WebView Android
  // suka men-throttle event tersebut saat dialog modal terbuka. Selama key
  // diset (caller hanya mengaktifkan saat status in-flight), kita bump snapshot
  // setiap ~1.2 dtk supaya indikator langkah tidak pernah tertinggal.
  const pollMs = options?.pollMs ?? 1200;
  const subscribe = (cb: () => void) => {
    if (typeof window === "undefined") return () => {};
    const onEvt = () => cb();
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
    window.addEventListener(EVENT, onEvt);
    window.addEventListener("storage", onStorage);
    let timer: ReturnType<typeof setInterval> | null = null;
    if (k && pollMs > 0) {
      timer = setInterval(cb, pollMs);
    }
    return () => {
      window.removeEventListener(EVENT, onEvt);
      window.removeEventListener("storage", onStorage);
      if (timer) clearInterval(timer);
    };
  };
  const getSnapshot = () => {
    if (!k) return "";
    const entries = getSendLog(k);
    // Snapshot string stabil untuk useSyncExternalStore — hanya berubah saat
    // ada entri baru / berubah, sehingga poll tanpa perubahan tidak memicu
    // re-render boros.
    return entries.map((e) => `${e.at}|${e.kind}|${e.label}`).join("\n");
  };
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => "");
  if (!snap) return [];
  return getSendLog(k);
}

/**
 * Varian `useLiveSendLog` yang juga mengembalikan metadata sinkronisasi:
 * - `stale`     : true bila tidak ada sync yang berhasil dalam ~3× polling
 *                 interval (misal dialog yang sempat ditutup / WebView freeze),
 *                 atau saat pembacaan localStorage melempar exception.
 * - `error`     : pesan singkat error baca terakhir, jika ada.
 * - `lastSyncedAt` : timestamp pembacaan sukses terakhir (untuk badge "baru saja").
 * - `active`    : apakah hook saat ini aktif memantau (key non-kosong).
 *
 * Catatan: meski sumber data adalah localStorage (bukan jaringan), pembacaan
 * masih bisa gagal — quota, serialization error, atau JSON parse error setelah
 * write parsial. Indikator "data belum tersinkron" memberitahu operator bahwa
 * tampilan progres mungkin tertinggal sehingga ia bisa memuat ulang dialog.
 */
export function useLiveSendLogStatus(
  key: string | null | undefined,
  options?: { pollMs?: number },
): {
  entries: SendLogEntry[];
  stale: boolean;
  error: string | null;
  lastSyncedAt: number | null;
  active: boolean;
} {
  const k = key ?? "";
  const pollMs = options?.pollMs ?? 1200;
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const lastSnapshotRef = useRef<string>("");

  useEffect(() => {
    if (!k) {
      setLastSyncedAt(null);
      setError(null);
      lastSnapshotRef.current = "";
      return;
    }
    let cancelled = false;
    const read = () => {
      if (cancelled) return;
      try {
        const entries = getSendLog(k);
        const snap = entries.map((e) => `${e.at}|${e.kind}|${e.label}`).join("\n");
        setLastSyncedAt(Date.now());
        if (error) setError(null);
        if (snap !== lastSnapshotRef.current) {
          lastSnapshotRef.current = snap;
          setTick((t) => t + 1);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal membaca log kiriman");
      }
    };
    read();
    const onEvt = () => read();
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) read(); };
    window.addEventListener(EVENT, onEvt);
    window.addEventListener("storage", onStorage);
    const timer = pollMs > 0 ? setInterval(read, pollMs) : null;
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT, onEvt);
      window.removeEventListener("storage", onStorage);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, pollMs]);

  // Re-render-aware read (tick mencegah snapshot tertinggal di first paint).
  void tick;
  const entries = k ? (() => { try { return getSendLog(k); } catch { return []; } })() : [];
  const staleThreshold = Math.max(2500, pollMs * 3);
  const stale = !!k && (error != null || lastSyncedAt == null || Date.now() - lastSyncedAt > staleThreshold);
  return { entries, stale, error, lastSyncedAt, active: !!k };
}