/**
 * Status sinkron hutang/piutang per percakapan.
 *
 * Tujuan: di pratinjau daftar chat, pemilik toko bisa langsung melihat
 * apakah lawan bicara sudah tertaut ke buku hutang/piutang (SSOT `debts`
 * + `debt_payments`) atau belum. Pencocokan memakai nama percakapan
 * (display_title) dinormalisasi — sama seperti pengelompokan party di
 * halaman Hutang & Piutang saat tidak ada supplier_id/customer_id.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

type DebtRow = {
  id: string;
  kind: "hutang" | "piutang";
  party_name: string;
  amount: number;
};

export async function fetchDebtSyncMap(): Promise<DebtSyncMap> {
  const [debtsRes, paysRes] = await Promise.all([
    supabase.from("debts").select("id,kind,party_name,amount").limit(2000),
    supabase.from("debt_payments").select("debt_id,amount").limit(5000),
  ]);
  const debts = (debtsRes.data ?? []) as DebtRow[];
  const paid = new Map<string, number>();
  for (const p of (paysRes.data ?? []) as { debt_id: string; amount: number }[]) {
    paid.set(p.debt_id, (paid.get(p.debt_id) ?? 0) + (Number(p.amount) || 0));
  }
  const map: DebtSyncMap = new Map();
  for (const d of debts) {
    const key = normalizeParty(d.party_name);
    if (!key) continue;
    const outstanding = Math.max(0, (Number(d.amount) || 0) - (paid.get(d.id) ?? 0));
    const cur = map.get(key) ?? { name: d.party_name, hutang: 0, piutang: 0 };
    if (d.kind === "hutang") cur.hutang += outstanding;
    else cur.piutang += outstanding;
    map.set(key, cur);
  }
  return map;
}

export function useDebtSyncMap() {
  return useQuery({
    queryKey: ["chat", "debt-sync"],
    queryFn: fetchDebtSyncMap,
    staleTime: 60_000,
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
