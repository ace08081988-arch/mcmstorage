/**
 * Catatan langkah pengiriman per idempotency key. Disimpan di localStorage
 * supaya operator bisa melihat urutan langkah & error kiriman sebelumnya
 * dari dialog pratinjau ("Lihat log") tanpa harus mengulang aksi.
 */
import type { SendPayloadSummary } from "@/lib/idempotency";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const KEY = "send-log:v1";
const EVENT = "send-log:changed";
const SYNC_KEY = "send-log-sync:v1";
const SYNC_EVENT = "send-log-sync:changed";
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
 * Status sinkronisasi terakhir per idempotency key — dipersist ke
 * localStorage agar indikator "Data belum tersinkron" konsisten meski
 * operator pindah tab atau refresh halaman. Bukan untuk korelasi lintas
 * device; cukup per-browser saja.
 */
export type SendLogSyncStatus = {
  lastSyncedAt: number | null;
  lastError: string | null;
  lastSnapshot: string;
  updatedAt: number;
};
type SyncStore = Record<string, SendLogSyncStatus>;

function readSyncAll(): SyncStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SYNC_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    return data as SyncStore;
  } catch { return {}; }
}

function writeSyncAll(store: SyncStore) {
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
    window.localStorage.setItem(SYNC_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
  } catch { /* quota */ }
}

export function getSendLogSyncStatus(key: string): SendLogSyncStatus | null {
  if (!key) return null;
  const slot = readSyncAll()[key];
  if (!slot) return null;
  if (Date.now() - slot.updatedAt > TTL_MS) return null;
  return slot;
}

function patchSendLogSyncStatus(key: string, patch: Partial<SendLogSyncStatus>) {
  if (!key) return;
  const store = readSyncAll();
  const prev = store[key] ?? { lastSyncedAt: null, lastError: null, lastSnapshot: "", updatedAt: 0 };
  const next: SendLogSyncStatus = {
    lastSyncedAt: patch.lastSyncedAt !== undefined ? patch.lastSyncedAt : prev.lastSyncedAt,
    lastError: patch.lastError !== undefined ? patch.lastError : prev.lastError,
    lastSnapshot: patch.lastSnapshot !== undefined ? patch.lastSnapshot : prev.lastSnapshot,
    updatedAt: Date.now(),
  };
  // Skip write jika tidak ada perubahan material — kurangi storage churn.
  if (
    prev.lastSyncedAt === next.lastSyncedAt &&
    prev.lastError === next.lastError &&
    prev.lastSnapshot === next.lastSnapshot
  ) {
    return;
  }
  store[key] = next;
  writeSyncAll(store);
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
  /** Asal update sinkron terakhir: `"self"` saat read() di tab ini, atau
   *  `"external"` saat tab lain memancarkan storage event SYNC_KEY/KEY. */
  lastSource: "self" | "external" | null;
} {
  const k = key ?? "";
  const pollMs = options?.pollMs ?? 1200;
  // Hydrate dari localStorage agar indikator tetap konsisten setelah
  // refresh / pindah tab — operator tidak melihat status "fresh" palsu
  // hanya karena komponen baru di-mount.
  const initial = k ? getSendLogSyncStatus(k) : null;
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(initial?.lastSyncedAt ?? null);
  const [error, setError] = useState<string | null>(initial?.lastError ?? null);
  const [tick, setTick] = useState(0);
  const [lastSource, setLastSource] = useState<"self" | "external" | null>(null);
  const lastSnapshotRef = useRef<string>(initial?.lastSnapshot ?? "");

  useEffect(() => {
    if (!k) {
      setLastSyncedAt(null);
      setError(null);
      setLastSource(null);
      lastSnapshotRef.current = "";
      return;
    }
    // Re-hydrate saat key berubah.
    const hydrated = getSendLogSyncStatus(k);
    setLastSyncedAt(hydrated?.lastSyncedAt ?? null);
    setError(hydrated?.lastError ?? null);
    setLastSource(null);
    lastSnapshotRef.current = hydrated?.lastSnapshot ?? "";
    let cancelled = false;
    // Guard anti-dobel: simpan signature terakhir yang sudah diterapkan ke
    // state. Saat banyak tab menulis SYNC_KEY hampir bersamaan, beberapa
    // storage event bisa tiba berturut-turut dengan payload identik —
    // signature ini memastikan kita hanya memicu setState/tick saat benar-
    // benar ada perubahan material.
    let lastAppliedSig = "";
    const sigOf = (s: SendLogSyncStatus | null) =>
      s ? `${s.lastSyncedAt ?? 0}|${s.lastError ?? ""}|${s.lastSnapshot}` : "";
    // Throttle storage event lintas tab: pakai trailing-edge ~80 ms supaya
    // burst write dari N tab (mis. semuanya melakukan poll bersamaan) hanya
    // memicu satu siklus apply, namun tetap responsif untuk mata operator.
    const STORAGE_THROTTLE_MS = 80;
    let syncPending: ReturnType<typeof setTimeout> | null = null;
    let readPending: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      if (cancelled) return;
      try {
        const entries = getSendLog(k);
        const snap = entries.map((e) => `${e.at}|${e.kind}|${e.label}`).join("\n");
        const now = Date.now();
        setLastSyncedAt(now);
        setError((prev) => (prev ? null : prev));
        setLastSource("self");
        if (snap !== lastSnapshotRef.current) {
          lastSnapshotRef.current = snap;
          setTick((t) => t + 1);
        }
        // Persist status sinkronisasi agar tab/refresh lain melihat nilai
        // konsisten — bukan reset ke "belum pernah sinkron".
        patchSendLogSyncStatus(k, { lastSyncedAt: now, lastError: null, lastSnapshot: snap });
        lastAppliedSig = `${now}|${""}|${snap}`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Gagal membaca log kiriman";
        setError(msg);
        patchSendLogSyncStatus(k, { lastError: msg });
      }
    };
    read();
    const onEvt = () => read();
    // Sinkron antar-tab: ketika tab lain memperbarui status sinkron,
    // tarik nilai terbarunya supaya UI tab ini ikut up-to-date.
    const onSyncEvt = (source: "self" | "external" = "self") => {
      // Diterapkan instan baik untuk event dari tab ini (SYNC_EVENT) maupun
      // dari tab lain (storage event SYNC_KEY) — TIDAK menunggu
      // `visibilitychange`. Kita juga selalu menaikkan tick agar entries
      // ikut dibaca ulang lewat re-render meski snapshot hash sama
      // (mis. saat tab lain hanya menulis error atau memperbarui
      // `lastSyncedAt` tanpa entri baru).
      const s = getSendLogSyncStatus(k);
      if (!s) return;
      const sig = sigOf(s);
      // Guard: jika signature persis sama dengan yang terakhir diterapkan,
      // skip — mencegah re-render dobel saat beberapa tab menulis SYNC_KEY
      // bersamaan (mis. lima tab poll sinkron, kelimanya men-trigger event
      // dengan payload sama).
      if (sig && sig === lastAppliedSig) return;
      lastAppliedSig = sig;
      setLastSyncedAt(s.lastSyncedAt);
      setError(s.lastError);
      setLastSource(source);
      if (s.lastSnapshot !== lastSnapshotRef.current) {
        lastSnapshotRef.current = s.lastSnapshot;
      }
      setTick((t) => t + 1);
      // Sumber kebenaran entries ada di KEY; tarik ulang supaya UI tidak
      // memperlihatkan badge "tersinkron" sementara isi entries masih
      // tertinggal (race antar tab: SYNC_KEY tertulis lebih dulu / lebih
      // belakangan dari KEY tergantung urutan write).
      try {
        const entries = getSendLog(k);
        const snap = entries.map((e) => `${e.at}|${e.kind}|${e.label}`).join("\n");
        if (snap !== lastSnapshotRef.current) {
          lastSnapshotRef.current = snap;
        }
      } catch { /* abaikan, read() berikutnya akan mencoba lagi */ }
    };
    // Trailing-edge schedulers: coalesce burst storage event ke satu apply.
    const scheduleSyncApply = () => {
      if (syncPending) return;
      syncPending = setTimeout(() => { syncPending = null; if (!cancelled) onSyncEvt("external"); }, STORAGE_THROTTLE_MS);
    };
    const scheduleReadEntries = () => {
      if (readPending) return;
      readPending = setTimeout(() => {
        readPending = null;
        if (cancelled) return;
        // KEY berubah dari tab lain — read() menandai "self", lalu kita
        // override jadi "external" karena pemicunya storage event.
        read();
        setLastSource("external");
      }, STORAGE_THROTTLE_MS);
    };
    // Storage event lintas tab — JANGAN tunggu visibility. Untuk SYNC_KEY
    // dan KEY pakai throttle trailing-edge (~80 ms) + guard signature agar
    // tidak menjadwalkan apply dobel saat beberapa tab menulis bersamaan.
    // Indikator "Data belum tersinkron" tetap reset cepat di tab background
    // tanpa membanjiri React dengan setState berturut-turut.
    const onCrossTabStorage = (e: StorageEvent) => {
      if (e.key === SYNC_KEY) { scheduleSyncApply(); return; }
      if (e.key === KEY) { scheduleReadEntries(); return; }
    };
    // visibilitychange tetap dipasang sebagai fallback paling akhir
    // (browser tertentu kadang melempar storage event saat tab background
    // tapi men-throttle setInterval); ini bukan jalur utama.
    const onVisibility = () => { if (document.visibilityState === "visible") { onSyncEvt("self"); read(); } };
    window.addEventListener(EVENT, onEvt);
    // Catatan: kita gabungkan handler storage untuk KEY & SYNC_KEY ke satu
    // listener agar urutan eksekusi deterministik dan tidak ada race dua
    // listener saling menimpa state.
    const onSyncEvtSelf = () => onSyncEvt("self");
    window.addEventListener(SYNC_EVENT, onSyncEvtSelf);
    window.addEventListener("storage", onCrossTabStorage);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = pollMs > 0 ? setInterval(read, pollMs) : null;
    return () => {
      cancelled = true;
      if (syncPending) { clearTimeout(syncPending); syncPending = null; }
      if (readPending) { clearTimeout(readPending); readPending = null; }
      window.removeEventListener(EVENT, onEvt);
      window.removeEventListener(SYNC_EVENT, onSyncEvtSelf);
      window.removeEventListener("storage", onCrossTabStorage);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, pollMs]);

  // Re-render-aware read (tick mencegah snapshot tertinggal di first paint).
  void tick;
  const entries = k ? (() => { try { return getSendLog(k); } catch { return []; } })() : [];
  const staleThreshold = Math.max(2500, pollMs * 3);
  const stale = !!k && (error != null || lastSyncedAt == null || Date.now() - lastSyncedAt > staleThreshold);
  return { entries, stale, error, lastSyncedAt, active: !!k, lastSource };
}