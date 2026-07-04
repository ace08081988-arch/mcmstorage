import { supabase } from "@/integrations/supabase/client";
import type { PosKasirProduk } from "./pos-kasir";

/**
 * Sinkronisasi POS Kasir ⇄ Gudang.
 *
 * Saat user login, POS Kasir memuat daftar produk dari `warehouse_items`
 * (RLS scope: pemilik). Transaksi "Bayar" ditulis ke tabel `sales` sehingga
 * trigger `apply_sale` otomatis mengurangi `warehouse_items.stock_base`.
 * Saat belum login → jatuh kembali ke daftar demo (`PRODUK_AWAL`).
 */

const CATEGORY_EMOJI: Record<string, string> = {
  kristal: "💎",
  crystal: "💎",
  gs: "🧪",
  beras: "🍚",
  gula: "🍬",
  tepung: "🌾",
  kacang: "🫘",
  garam: "🧂",
  kopi: "☕",
  bumbu: "🧄",
  minuman: "🥤",
};

function emojiForItem(name: string, category: string | null | undefined): string {
  const key = (category ?? "").trim().toLowerCase();
  if (key && CATEGORY_EMOJI[key]) return CATEGORY_EMOJI[key];
  const n = name.toLowerCase();
  for (const [k, v] of Object.entries(CATEGORY_EMOJI)) {
    if (n.includes(k)) return v;
  }
  return "📦";
}

export type LoadGudangResult =
  | { authed: false }
  | { authed: true; produk: PosKasirProduk[]; error?: string };

/** Muat produk gudang milik user aktif. Return `authed:false` bila belum login. */
export async function loadGudangProduk(): Promise<LoadGudangResult> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { authed: false };

  const { data, error } = await supabase
    .from("warehouse_items")
    .select("id, name, category, base_unit, stock_base, avg_cost_per_base")
    .order("name", { ascending: true });

  if (error) {
    return { authed: true, produk: [], error: error.message };
  }

  const produk: PosKasirProduk[] = (data ?? []).map((row) => ({
    id: row.id,
    warehouseItemId: row.id,
    nama: row.name,
    emoji: emojiForItem(row.name, row.category),
    // Harga jual di-input manual per transaksi (keputusan produk).
    // avg_cost_per_base dipakai sebagai *saran* awal di UI, bukan sumber harga.
    hargaPerKg: 0,
    stokKg: Number(row.stock_base ?? 0),
    unitLabel: row.base_unit || "kg",
  }));

  return { authed: true, produk };
}

/**
 * Catat transaksi ke tabel `sales`. Trigger `apply_sale` di DB akan
 * mengurangi stok `warehouse_items.stock_base` secara atomik.
 */
export async function recordSale(input: {
  warehouseItemId: string;
  qtyBase: number;
  pricePerBase: number;
  note?: string | null;
}): Promise<{ ok: true; saleId: string } | { ok: false; error: string }> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, error: "Belum login" };

  const total = +(input.qtyBase * input.pricePerBase).toFixed(2);
  const { data, error } = await supabase
    .from("sales")
    .insert({
      user_id: userData.user.id,
      item_id: input.warehouseItemId,
      qty_base: input.qtyBase,
      price_per_base: input.pricePerBase,
      total_revenue: total,
      cost_at_sale: 0,
      payment_method: "cash",
      note: input.note ?? "POS Kasir",
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Gagal menyimpan penjualan" };
  return { ok: true, saleId: data.id };
}

/** Batalkan transaksi POS: hapus sales row → trigger apply_sale mengembalikan stok. */
export async function refundSale(saleId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("sales").delete().eq("id", saleId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}