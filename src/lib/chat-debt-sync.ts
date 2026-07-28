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
import { nameSimilarity } from "@/lib/contact-dup";

export type DebtSyncEntry = {
  /** Nama party sesuai buku hutang/piutang. */
  name: string;
  /** Sisa hutang saya ke party ini. */
  hutang: number;
  /** Sisa piutang party ini ke saya. */
  piutang: number;
};

export type DebtSyncMap = Map<string, DebtSyncEntry>;

/** Tautan manual: nama kontak chat → nama pihak di buku hutang/piutang. */
export type PartyLinkMap = Map<string, string>;
export const PARTY_LINK_QUERY_KEY = ["chat", "party-links"] as const;

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
    // Otomatis segar: saat kembali ke app / online lagi / tiap 60 detik,
    // supaya angka di chip chat tidak pernah tertinggal dari halaman lain.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export async function fetchPartyLinks(): Promise<PartyLinkMap> {
  const map: PartyLinkMap = new Map();
  const { data, error } = await (supabase.from as any)("chat_party_links")
    .select("alias_key,party_key");
  if (error || !Array.isArray(data)) return map;
  for (const row of data as Array<{ alias_key: string; party_key: string }>) {
    if (row?.alias_key && row?.party_key) map.set(row.alias_key, row.party_key);
  }
  return map;
}

export function usePartyLinks() {
  return useQuery({
    queryKey: PARTY_LINK_QUERY_KEY,
    queryFn: fetchPartyLinks,
    staleTime: 60_000,
  });
}

/** Simpan/perbarui tautan kontak chat ke pihak di buku hutang/piutang. */
export async function savePartyLink(aliasLabel: string, partyName: string) {
  const aliasKey = normalizeParty(aliasLabel);
  const partyKey = normalizeParty(partyName);
  if (!aliasKey || !partyKey) throw new Error("Nama tidak boleh kosong.");
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Tidak ada sesi pengguna.");
  const { error } = await (supabase.from as any)("chat_party_links").upsert(
    {
      user_id: uid,
      alias_key: aliasKey,
      alias_label: aliasLabel.trim(),
      party_key: partyKey,
      party_name: partyName.trim(),
    },
    { onConflict: "user_id,alias_key" },
  );
  if (error) throw error;
}

export async function removePartyLink(aliasLabel: string) {
  const aliasKey = normalizeParty(aliasLabel);
  if (!aliasKey) return;
  const { error } = await (supabase.from as any)("chat_party_links")
    .delete()
    .eq("alias_key", aliasKey);
  if (error) throw error;
}

/** Kandidat nama mirip di buku hutang/piutang (untuk saran penautan). */
export function suggestPartyMatches(
  title: string | null | undefined,
  map: DebtSyncMap | undefined,
  limit = 5,
): Array<{ entry: DebtSyncEntry; score: number }> {
  const raw = (title ?? "").trim();
  if (!raw || !map) return [];
  return Array.from(map.values())
    .map((entry) => ({ entry, score: nameSimilarity(raw, entry.name) }))
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type DebtSyncStatus =
  | { state: "unlinked" }
  | { state: "settled"; entry: DebtSyncEntry }
  | { state: "open"; entry: DebtSyncEntry };

export function debtSyncStatus(
  title: string | null | undefined,
  map: DebtSyncMap | undefined,
  links?: PartyLinkMap,
): DebtSyncStatus {
  const key = normalizeParty(title);
  // Tautan manual menang: satu orang boleh punya ejaan berbeda di chat
  // dan di buku hutang/piutang ("PANGAT" vs "PWNGAT").
  const linked = links?.get(key);
  const entry = (linked ? map?.get(linked) : undefined) ?? map?.get(key);
  if (!entry) return { state: "unlinked" };
  if (entry.hutang <= 0 && entry.piutang <= 0) return { state: "settled", entry };
  return { state: "open", entry };
}
