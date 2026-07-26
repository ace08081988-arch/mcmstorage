/**
 * Status sinkron hutang/piutang per percakapan.
 *
 * Tujuan: di pratinjau daftar chat, pemilik toko bisa langsung melihat
 * apakah lawan bicara sudah tertaut ke buku hutang/piutang atau belum.
 *
 * SSOT: RPC `party_balance_v1()` — sumbernya identik dengan total di
 * Dashboard/Gudang/Hutang & Piutang, yaitu catatan manual `debts`
 * (dikurangi `debt_payments`) **plus** penjualan hutang per pelanggan
 * (dikurangi `customer_payments`) **plus** pembelian hutang per supplier
 * (dikurangi `supplier_payments`). Sebelumnya chip di chat hanya membaca
 * `debts`, sehingga saldo di chat bisa lebih kecil dari halaman lain.
 *
 * Pencocokan memakai nama percakapan (display_title) yang dinormalisasi.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOnDebtTx } from "@/lib/debt-tx-event";
import { useCallback } from "react";

export type DebtSyncEntry = {
  /** Nama party sesuai buku hutang/piutang. */
  name: string;
  /** Sisa hutang saya ke party ini. */
  hutang: number;
  /** Sisa piutang party ini ke saya. */
  piutang: number;
};

export type DebtSyncMap = Map<string, DebtSyncEntry>;

export function normalizeParty(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

type PartyBalanceRow = {
  key: string;
  name: string;
  hutang: number | string;
  piutang: number | string;
};

/** Kunci cache bersama supaya semua permukaan chat memakai data yang sama. */
export const DEBT_SYNC_QUERY_KEY = ["chat", "debt-sync"] as const;

export async function fetchDebtSyncMap(): Promise<DebtSyncMap> {
  const map: DebtSyncMap = new Map();
  const { data, error } = await supabase.rpc("party_balance_v1");
  if (error || !Array.isArray(data)) return map;
  for (const row of data as unknown as PartyBalanceRow[]) {
    const key = normalizeParty(row?.name ?? row?.key);
    if (!key) continue;
    map.set(key, {
      name: row.name,
      hutang: Number(row.hutang) || 0,
      piutang: Number(row.piutang) || 0,
    });
  }
  return map;
}

export function useDebtSyncMap() {
  const qc = useQueryClient();
  // Setiap transaksi hutang/piutang di mana pun (Ecer, Kios, Request,
  // DebtQuickActions) langsung menyegarkan chip saldo di chat.
  useOnDebtTx(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: DEBT_SYNC_QUERY_KEY });
    }, [qc]),
  );
  return useQuery({
    queryKey: DEBT_SYNC_QUERY_KEY,
    queryFn: fetchDebtSyncMap,
    staleTime: 30_000,
  });
}

export type DebtSyncStatus =
  | { state: "unlinked" }
  | { state: "settled"; entry: DebtSyncEntry }
  | { state: "open"; entry: DebtSyncEntry };

export function debtSyncStatus(
  title: string | null | undefined,
  map: DebtSyncMap | undefined,
): DebtSyncStatus {
  const entry = map?.get(normalizeParty(title));
  if (!entry) return { state: "unlinked" };
  if (entry.hutang <= 0 && entry.piutang <= 0) return { state: "settled", entry };
  return { state: "open", entry };
}
