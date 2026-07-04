const STORAGE_KEY = "mcm-pos-kasir-riwayat";

export type PosKasirProduk = {
  id: string;
  nama: string;
  emoji: string;
  hargaPerKg: number;
  stokKg: number;
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
};

export const PRODUK_AWAL: PosKasirProduk[] = [
  { id: "beras", nama: "Beras Premium", emoji: "🍚", hargaPerKg: 15000, stokKg: 50 },
  { id: "gula", nama: "Gula Pasir", emoji: "🍬", hargaPerKg: 14000, stokKg: 30 },
  { id: "tepung", nama: "Tepung Terigu", emoji: "🌾", hargaPerKg: 12000, stokKg: 25 },
  { id: "kacang", nama: "Kacang Hijau", emoji: "🫘", hargaPerKg: 22000, stokKg: 15 },
  { id: "garam", nama: "Garam Halus", emoji: "🧂", hargaPerKg: 8000, stokKg: 40 },
  { id: "kopi", nama: "Kopi Bubuk", emoji: "☕", hargaPerKg: 65000, stokKg: 10 },
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
  } catch {
    // Abaikan error quota atau kebijakan security.
  }
}
