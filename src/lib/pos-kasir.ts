const STORAGE_KEY = "mcm-pos-kasir-riwayat";
const CHANGE_EVENT = "mcm:pos-kasir:changed";

export type PosKasirProduk = {
  id: string;
  nama: string;
  emoji: string;
  hargaPerKg: number;
  stokKg: number;
  /** Label unit dasar produk (mis. "kg", "g", "pcs"). */
  unitLabel: string;
  /** ID di warehouse_items — bila terisi, transaksi ditulis ke tabel sales
   *  dan trigger apply_sale otomatis mengurangi stok gudang. */
  warehouseItemId?: string | null;
};

export type PosKasirTransaksi = {
  id: string;
  produkId: string;
  produkNama: string;
  produkEmoji: string;
  beratKg: number;
  hargaPerKg: number;
  total: number;
  sisaStokKg: number;
  waktu: number;
  /** Unit label saat transaksi (mengikuti produk). Default "kg" utk transaksi lama. */
  unitLabel?: string;
  /** ID sale di database bila transaksi memakai produk gudang; tanpa nilai = demo lokal. */
  saleId?: string | null;
  warehouseItemId?: string | null;
};

export const PRODUK_AWAL: PosKasirProduk[] = [
  { id: "beras", nama: "Beras Premium", emoji: "🍚", hargaPerKg: 15000, stokKg: 50, unitLabel: "kg" },
  { id: "gula", nama: "Gula Pasir", emoji: "🍬", hargaPerKg: 14000, stokKg: 30, unitLabel: "kg" },
  { id: "tepung", nama: "Tepung Terigu", emoji: "🌾", hargaPerKg: 12000, stokKg: 25, unitLabel: "kg" },
  { id: "kacang", nama: "Kacang Hijau", emoji: "🫘", hargaPerKg: 22000, stokKg: 15, unitLabel: "kg" },
  { id: "garam", nama: "Garam Halus", emoji: "🧂", hargaPerKg: 8000, stokKg: 40, unitLabel: "kg" },
  { id: "kopi", nama: "Kopi Bubuk", emoji: "☕", hargaPerKg: 65000, stokKg: 10, unitLabel: "kg" },
];

export function getPosKasirRiwayat(): PosKasirTransaksi[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setPosKasirRiwayat(riwayat: PosKasirTransaksi[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(riwayat));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // Abaikan error quota atau kebijakan security.
  }
}

/**
 * Berlangganan perubahan riwayat POS Kasir (sama tab via CustomEvent,
 * lintas tab via event `storage`). Kembalikan fungsi unsubscribe.
 */
export function subscribePosKasirRiwayat(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => cb();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) cb();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
