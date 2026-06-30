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
const KEY = "send-idempotency:v1";
const EVENT = "send-idempotency:changed";
const TTL_MS = 5 * 60 * 1000;       // 5 menit
const MAX_ENTRIES = 200;

export type IdemStatus = "in-flight" | "done" | "failed";
export type IdemRecord = { key: string; at: number; status: IdemStatus; note?: string; fingerprint?: string };

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
        });
      }
    }
    return m;
  } catch { return new Map(); }
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

export function setIdem(key: string, status: IdemStatus, note?: string, fingerprint?: string) {
  const m = readAll();
  const prev = m.get(key);
  // Pertahankan fingerprint lama bila pemanggil tidak menyediakannya (mis. saat
  // menandai "in-flight" sebelum payload tersedia atau saat finalisasi status).
  const fp = fingerprint ?? prev?.fingerprint;
  m.set(key, { key, at: Date.now(), status, note, fingerprint: fp });
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
  opts: { onSkip: (existing: IdemRecord) => T | Promise<T>; run: () => Promise<T>; fingerprint?: string },
): Promise<T> {
  const existing = getIdem(key);
  if (existing && existing.status !== "failed") {
    return await opts.onSkip(existing);
  }
  setIdem(key, "in-flight", undefined, opts.fingerprint);
  try {
    const result = await opts.run();
    setIdem(key, "done", undefined, opts.fingerprint);
    return result;
  } catch (e) {
    setIdem(key, "failed", (e as Error)?.message, opts.fingerprint);
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}