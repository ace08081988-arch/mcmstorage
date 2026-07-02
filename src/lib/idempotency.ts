/**
 * Idempotency guard untuk pengiriman WA/Chat. Disimpan di localStorage agar
 * klik berulang (atau retry karena UI tersangkut/koneksi flaky) dengan
 * "payload" yang sama tidak menghasilkan kiriman ganda — yang berarti pesan
 * chat tidak ditulis dua kali dan markSent() tidak dipanggil ulang dengan
 * timestamp baru di Riwayat.
 *
 * Catatan stok: pengurangan stok bukan dilakukan di tahap kirim — itu sudah
 * dipotong oleh trigger DB saat foto/penyiapan dibuat. Guard ini fokus pada
 * sisi kirim agar tidak ada double-write.
 */
import { useSyncExternalStore } from "react";
const KEY = "send-idempotency:v1";
const EVENT = "send-idempotency:changed";
const TTL_MS = 5 * 60 * 1000;       // 5 menit
const MAX_ENTRIES = 200;

export type IdemStatus = "in-flight" | "done" | "failed";
/**
 * Ringkasan payload yang dilampirkan ke record idempotency agar dialog
 * pratinjau bisa menampilkan PERBEDAAN antara payload yang akan dikirim
 * sekarang dengan payload kiriman sebelumnya — bukan hanya status "cocok /
 * tidak cocok" dari fingerprint. Bidang dipilih agar serialisasi tetap
 * kecil (muat di localStorage) dan tidak menyimpan binari foto.
 */
export type SendPayloadSummary = {
  channel?: "wa" | "chat";
  destination?: string;
  caption: string;
  photoCount: number;
  locationUrl: string | null;
};
export type IdemRecord = {
  key: string;
  at: number;
  status: IdemStatus;
  note?: string;
  fingerprint?: string;
  summary?: SendPayloadSummary;
};

/** Channel turunan dari `key` (`wa:` atau `chat:<convId>:`). */
export function channelFromKey(key: string): "wa" | "chat" | "unknown" {
  if (key.startsWith("wa:")) return "wa";
  if (key.startsWith("chat:")) return "chat";
  return "unknown";
}

/** Ambil suffix daftar ID dari key (bagian setelah `:` terakhir). */
function idsSuffix(key: string): string {
  const i = key.lastIndexOf(":");
  return i >= 0 ? key.slice(i + 1) : key;
}

/**
 * Cari record idempotency aktif (status apapun) untuk daftar ID yang sama
 * — lintas channel (WA atau Chat) — sehingga dialog pratinjau di salah satu
 * channel bisa mengetahui bila channel lain sedang in-flight untuk shot yang
 * sama. Prioritas: in-flight > done > failed, lalu paling baru.
 */
export function findIdemByIds(idsKey: string): IdemRecord | null {
  if (!idsKey) return null;
  const m = readAll();
  let best: IdemRecord | null = null;
  const rank = (s: IdemStatus) => (s === "in-flight" ? 2 : s === "done" ? 1 : 0);
  const now = Date.now();
  for (const rec of m.values()) {
    if (now - rec.at > TTL_MS) continue;
    if (idsSuffix(rec.key) !== idsKey) continue;
    if (!best) { best = rec; continue; }
    const a = rank(rec.status), b = rank(best.status);
    if (a > b || (a === b && rec.at > best.at)) best = rec;
  }
  return best;
}

function subscribeIdem(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onEvt = () => cb();
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener(EVENT, onEvt);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onEvt);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * React hook: lacak record idempotency lintas channel untuk `idsKey`
 * (string ID ter-sort & ter-dedup, dipisah koma). Berubah otomatis saat
 * ada `setIdem`/`clearIdem` dari mana pun dalam tab yang sama maupun tab
 * lain — dipakai dialog pratinjau Chat/WA agar status in-flight di salah
 * satu channel langsung menonaktifkan tombol kirim di channel lainnya.
 */
export function useLiveIdemByIds(idsKey: string | undefined | null): IdemRecord | null {
  const key = idsKey ?? "";
  const subscribe = (cb: () => void) => subscribeIdem(cb);
  const getSnapshot = () => {
    const r = findIdemByIds(key);
    // Stabilkan referensi snapshot untuk useSyncExternalStore: kembalikan
    // string serialisasi sederhana untuk perbandingan, lalu rebuild object.
    return r
      ? `${r.key}|${r.at}|${r.status}|${r.fingerprint ?? ""}|${r.summary ? stableStringify(r.summary) : ""}`
      : "";
  };
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => "");
  if (!snap) return null;
  // Rebuild dari readAll (data lengkap), bukan dari string snapshot.
  return findIdemByIds(key);
}

function readAll(): Map<string, IdemRecord> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Map();
    const m = new Map<string, IdemRecord>();
    for (const r of arr) {
      if (r && typeof r.key === "string" && typeof r.at === "number") {
        m.set(r.key, {
          key: r.key,
          at: r.at,
          status: r.status === "done" || r.status === "failed" || r.status === "in-flight" ? r.status : "done",
          note: typeof r.note === "string" ? r.note : undefined,
          fingerprint: typeof r.fingerprint === "string" ? r.fingerprint : undefined,
          summary: isSummary(r.summary) ? (r.summary as SendPayloadSummary) : undefined,
        });
      }
    }
    return m;
  } catch { return new Map(); }
}

function isSummary(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.caption === "string" && typeof s.photoCount === "number"
    && (s.locationUrl === null || typeof s.locationUrl === "string");
}

function writeAll(map: Map<string, IdemRecord>) {
  // prune expired
  const now = Date.now();
  for (const [k, v] of map) if (now - v.at > TTL_MS) map.delete(k);
  // cap size
  if (map.size > MAX_ENTRIES) {
    const sorted = [...map.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
    map = new Map(sorted);
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...map.values()]));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* quota */ }
}

export function getIdem(key: string): IdemRecord | null {
  const m = readAll();
  const r = m.get(key);
  if (!r) return null;
  if (Date.now() - r.at > TTL_MS) {
    m.delete(key);
    writeAll(m);
    return null;
  }
  return r;
}

export function setIdem(key: string, status: IdemStatus, note?: string, fingerprint?: string, summary?: SendPayloadSummary) {
  const m = readAll();
  const prev = m.get(key);
  // Pertahankan fingerprint lama bila pemanggil tidak menyediakannya (mis. saat
  // menandai "in-flight" sebelum payload tersedia atau saat finalisasi status).
  const fp = fingerprint ?? prev?.fingerprint;
  const sm = summary ?? prev?.summary;
  m.set(key, { key, at: Date.now(), status, note, fingerprint: fp, summary: sm });
  writeAll(m);
}

export function clearIdem(key: string) {
  const m = readAll();
  if (m.delete(key)) writeAll(m);
}

/**
 * Bangun idempotency key untuk pengiriman.
 * `ids` di-sort dan di-deduplikasi agar urutan klik tidak mempengaruhi key.
 */
export function buildSendKey(input: {
  channel: "wa" | "chat";
  conversationId?: string;
  ids: string[];
}): string {
  const ids = [...new Set(input.ids.filter(Boolean))].sort();
  const prefix = input.channel === "chat" ? `chat:${input.conversationId ?? ""}` : "wa";
  return `${prefix}:${ids.join(",")}`;
}

/**
 * Eksekusi `run` hanya jika tidak ada kiriman aktif/baru saja untuk `key`.
 * - Saat key sedang `in-flight` atau `done` dalam TTL, panggil `onSkip` dan
 *   kembalikan hasil dari sana.
 * - Saat sebelumnya `failed`, jalankan ulang (retry diizinkan).
 */
export async function withIdempotency<T>(
  key: string,
  opts: { onSkip: (existing: IdemRecord) => T | Promise<T>; run: () => Promise<T>; fingerprint?: string; summary?: SendPayloadSummary },
): Promise<T> {
  const existing = getIdem(key);
  if (existing && existing.status !== "failed") {
    return await opts.onSkip(existing);
  }
  setIdem(key, "in-flight", undefined, opts.fingerprint, opts.summary);
  try {
    const result = await opts.run();
    setIdem(key, "done", undefined, opts.fingerprint, opts.summary);
    return result;
  } catch (e) {
    setIdem(key, "failed", (e as Error)?.message, opts.fingerprint, opts.summary);
    throw e;
  }
}

/**
 * Stable JSON-stringify dengan key tersortir, lalu di-hash FNV-1a 32-bit.
 * Digunakan untuk membandingkan apakah payload kiriman saat ini benar-benar
 * sama dengan payload kiriman sebelumnya pada idempotency key yang sama.
 * Bukan kriptografis — cukup untuk mendeteksi perbedaan konten yang tak
 * disengaja sebelum operator menekan "Kirim ulang (paksa)".
 */
export function payloadFingerprint(payload: unknown): string {
  const norm = stableStringify(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

/**
 * Snapshot payload kirim — dipakai untuk menjamin *idempotensi output*:
 * pengiriman kedua dengan `key` yang sama harus menghasilkan urutan &
 * konten teks yang persis sama seperti pengiriman pertama, meskipun
 * state upstream (mis. daftar `shots`) sudah berubah antara dua klik.
 *
 * Disimpan terpisah dari `IdemRecord` supaya volume record utama tetap
 * kecil; snapshot memiliki TTL yang sama.
 */
export type SendSnapshot = {
  key: string;
  at: number;
  fingerprint: string;
  orderedIds: string[];
  text: string;
  locationUrl: string | null;
  slotFileNames: string[];
  slotPaths: string[];
  expectedCount: number;
  /** Ruang bebas untuk metadata channel-spesifik (mis. label tujuan). */
  meta?: Record<string, string | number | boolean | null>;
};

const SNAP_KEY = "send-idempotency-snapshot:v1";

function readAllSnapshots(): Map<string, SendSnapshot> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(SNAP_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Map();
    const m = new Map<string, SendSnapshot>();
    const now = Date.now();
    for (const s of arr) {
      if (!s || typeof s.key !== "string" || typeof s.at !== "number") continue;
      if (now - s.at > TTL_MS) continue;
      if (!Array.isArray(s.orderedIds) || !Array.isArray(s.slotFileNames) || !Array.isArray(s.slotPaths)) continue;
      m.set(s.key, {
        key: s.key,
        at: s.at,
        fingerprint: typeof s.fingerprint === "string" ? s.fingerprint : "",
        orderedIds: s.orderedIds.map(String),
        text: typeof s.text === "string" ? s.text : "",
        locationUrl: typeof s.locationUrl === "string" ? s.locationUrl : null,
        slotFileNames: s.slotFileNames.map(String),
        slotPaths: s.slotPaths.map(String),
        expectedCount: Number(s.expectedCount) || 0,
        meta: s.meta && typeof s.meta === "object" ? (s.meta as SendSnapshot["meta"]) : undefined,
      });
    }
    return m;
  } catch { return new Map(); }
}

function writeAllSnapshots(map: Map<string, SendSnapshot>): void {
  const now = Date.now();
  for (const [k, v] of map) if (now - v.at > TTL_MS) map.delete(k);
  if (map.size > MAX_ENTRIES) {
    const sorted = [...map.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
    map = new Map(sorted);
  }
  try {
    window.localStorage.setItem(SNAP_KEY, JSON.stringify([...map.values()]));
  } catch { /* quota */ }
}

export function getSendSnapshot(key: string): SendSnapshot | null {
  return readAllSnapshots().get(key) ?? null;
}

export function saveSendSnapshot(input: Omit<SendSnapshot, "at">): SendSnapshot {
  const m = readAllSnapshots();
  const snap: SendSnapshot = { ...input, at: Date.now() };
  m.set(input.key, snap);
  writeAllSnapshots(m);
  return snap;
}

export function clearSendSnapshot(key: string): void {
  const m = readAllSnapshots();
  if (m.delete(key)) writeAllSnapshots(m);
}

/**
 * Ambil snapshot lama (bila ada & TTL belum lewat) atau bangun snapshot baru
 * dari `build()` lalu simpan. Kembalian dijamin STABIL untuk `key` yang sama
 * selama TTL — pengiriman kedua/ketiga menghasilkan urutan dan teks yang
 * identik.
 *
 * `expectedFingerprint` (opsional) memaksa pembentukan ulang bila sidik
 * jari payload berubah — dipakai saat operator memilih "Kirim ulang (paksa)"
 * dengan konten berbeda.
 */
export async function getOrCreateSendSnapshot(
  key: string,
  build: () => Promise<Omit<SendSnapshot, "at" | "key">>,
  opts?: { forceRebuild?: boolean; expectedFingerprint?: string },
): Promise<SendSnapshot> {
  if (!opts?.forceRebuild) {
    const existing = getSendSnapshot(key);
    if (existing) {
      if (!opts?.expectedFingerprint || existing.fingerprint === opts.expectedFingerprint) {
        return existing;
      }
    }
  }
  const built = await build();
  return saveSendSnapshot({ key, ...built });
}