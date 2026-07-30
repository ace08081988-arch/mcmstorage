/**
 * SWR-style cache untuk halaman Gudang.
 *
 * Alasan: setiap masuk halaman Gudang melakukan 9 query ke Supabase
 * (warehouse_items, suppliers, sales, warehouse_categories, purchases,
 * supplier_payments, customers, customer_payments, order_requests).
 * Di APK Android dengan koneksi lambat, ini terasa "berat" walaupun
 * datanya sama persis dengan kunjungan sebelumnya di sesi yang sama.
 *
 * Strategi: simpan snapshot per-user di `sessionStorage` (bukan
 * localStorage — supaya tidak menyimpan data multi-tenant di device
 * setelah tab ditutup). Saat halaman dimount, hidrasi state dari
 * cache secara sinkron (instant paint), lalu jalankan `reloadAllNow`
 * di background untuk revalidasi (SWR).
 *
 * TTL: 5 menit — cukup untuk menjaga UX tab-switch instan, cukup
 * pendek supaya perubahan dari mutasi (yang juga menulis ke cache
 * lewat `writeGudangCache`) tidak tertinggal jauh dari server.
 */

const KEY_PREFIX = "mcm:gudang:cache:v1:";
const TTL_MS = 5 * 60 * 1000;

export type GudangCacheSnapshot = {
  items: unknown[];
  suppliers: unknown[];
  sales: unknown[];
  categoryOrder: [string, number][];
  purchases: unknown[];
  payments: unknown[];
  customers: unknown[];
  custPayments: unknown[];
  orders: unknown[];
  savedAt: number;
};

function keyFor(uid: string) {
  return `${KEY_PREFIX}${uid}`;
}

export function readGudangCache(uid: string): GudangCacheSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(keyFor(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GudangCacheSnapshot;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeGudangCache(
  uid: string,
  snapshot: Omit<GudangCacheSnapshot, "savedAt">,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: GudangCacheSnapshot = { ...snapshot, savedAt: Date.now() };
    window.sessionStorage.setItem(keyFor(uid), JSON.stringify(payload));
  } catch {
    // Quota exceeded / storage disabled — abaikan, cache bersifat opsional.
  }
}

export function clearGudangCache(uid?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (uid) {
      window.sessionStorage.removeItem(keyFor(uid));
      return;
    }
    // Bersihkan semua key gudang (mis. saat sign-out).
    const toRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}