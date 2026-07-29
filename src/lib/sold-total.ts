/**
 * SSOT nilai penjualan paket (request / ecer / self prep).
 *
 * Aturan tunggal yang dipakai di SEMUA surface (kartu Request, kartu Ecer,
 * Siapkan Sendiri, ringkasan pesanan di chat, dan perhitungan total halaman
 * lain):
 *
 *  1. Pakai `sold_total` dari baris penyiapan bila > 0.
 *  2. Bila 0/kosong (mis. salah input saat kirim), pakai jumlah
 *     `sales.total_revenue` dari baris penjualan yang berasal dari paket itu
 *     (`source` + `source_id`).
 *  3. Format tampilan selalu `rupiah()` (Rp + pemisah ribuan).
 *
 * Tidak mengubah data apa pun — murni pembacaan & penyajian.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { rupiah } from "@/lib/stock-format";

export type SoldSource = "request_prep" | "ecer_prep" | "self_prep";

/** Total riil dari tabel `sales` untuk satu paket. `null` bila gagal/kosong. */
export async function fetchSalesTotalForSource(
  source: SoldSource,
  sourceId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("sales")
    .select("total_revenue")
    .eq("source", source)
    .eq("source_id", sourceId);
  if (error || !data) return null;
  return data.reduce((s, r) => s + Number(r.total_revenue ?? 0), 0);
}

export type ResolvedSoldTotal = {
  /** Angka yang harus ditampilkan / dijumlahkan. */
  total: number;
  /** true bila angka diambil dari catatan penjualan (fallback). */
  fromSales: boolean;
  /** Teks siap tampil, format seragam. */
  label: string;
};

export function resolveSoldTotal(
  soldTotal: number | string | null | undefined,
  salesTotal: number | null | undefined,
): ResolvedSoldTotal {
  const raw = Number(soldTotal ?? 0) || 0;
  const fallback = Number(salesTotal ?? 0) || 0;
  const fromSales = raw <= 0 && fallback > 0;
  const total = raw > 0 ? raw : fallback;
  return { total, fromSales, label: rupiah(total) };
}

/**
 * Hook pembungkus: ambil fallback dari `sales` hanya bila paket sudah terkirim
 * dan `sold_total` belum terisi.
 */
export function useEffectiveSoldTotal(
  source: SoldSource,
  sourceId: string | null | undefined,
  soldTotal: number | string | null | undefined,
  sold: boolean,
): ResolvedSoldTotal & { salesTotal: number | null } {
  const raw = Number(soldTotal ?? 0) || 0;
  const [salesTotal, setSalesTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!sold || !sourceId || raw > 0) {
      setSalesTotal(null);
      return;
    }
    let alive = true;
    fetchSalesTotalForSource(source, sourceId).then((v) => {
      if (alive) setSalesTotal(v);
    });
    return () => {
      alive = false;
    };
  }, [source, sourceId, sold, raw]);

  return { ...resolveSoldTotal(soldTotal, salesTotal), salesTotal };
}
