/**
 * Audit log perubahan saldo per kontak.
 *
 * Sumbernya SAMA dengan SSOT `party_balance_v1()` — hanya saja RPC
 * `party_balance_events_v1()` mengembalikan setiap kejadian (bukan hasil
 * agregat), sehingga total saldo tiap kontak bisa ditelusuri baris demi
 * baris: dari mana angkanya datang, kapan, dan lewat kanal apa.
 *
 * Kanal yang tercakup (identik dengan party_balance_v1):
 *   debts (manual/turunan) · debt_payments · sales(hutang) ·
 *   customer_payments · purchases(hutang) · supplier_payments
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeParty } from "@/lib/chat-debt-sync";

export type BalanceEventKind = "hutang" | "piutang";

export type BalanceEvent = {
  key: string;
  name: string;
  kind: BalanceEventKind;
  /** Positif = saldo naik (tagihan baru), negatif = saldo turun (pembayaran). */
  delta: number;
  sourceTable: string;
  source: string;
  at: string;
  note: string | null;
  refId: string;
};

type RawEvent = {
  key?: string | null;
  name?: string | null;
  kind?: string | null;
  delta?: number | string | null;
  source_table?: string | null;
  source?: string | null;
  at?: string | null;
  note?: string | null;
  ref_id?: string | null;
};

export const PARTY_AUDIT_QUERY_KEY = ["party-balance", "audit"] as const;

export async function fetchPartyBalanceEvents(limit = 400): Promise<BalanceEvent[]> {
  const { data, error } = await supabase.rpc("party_balance_events_v1" as never, {
    p_limit: limit,
    p_key: null,
  } as never);
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  const out: BalanceEvent[] = [];
  for (const raw of data as unknown as RawEvent[]) {
    const kind = raw?.kind === "hutang" ? "hutang" : "piutang";
    const key = normalizeParty(raw?.key ?? raw?.name);
    if (!key || !raw?.at) continue;
    out.push({
      key,
      name: (raw.name ?? key).trim(),
      kind,
      delta: Number(raw.delta) || 0,
      sourceTable: raw.source_table ?? "-",
      source: raw.source ?? "-",
      at: raw.at,
      note: raw.note ?? null,
      refId: raw.ref_id ?? "",
    });
  }
  return out;
}

/** Label ramah pengguna untuk sumber update. */
export function sourceLabel(e: Pick<BalanceEvent, "sourceTable" | "source">): string {
  switch (e.sourceTable) {
    case "debt_payments":
      return "Pembayaran catatan";
    case "customer_payments":
      return "Pembayaran pelanggan";
    case "supplier_payments":
      return "Pembayaran ke supplier";
    case "sales":
      return "Penjualan hutang";
    case "purchases":
      return "Pembelian hutang";
    case "debts":
      switch (e.source) {
        case "manual":
          return "Catatan manual";
        case "sale":
          return "Catatan dari penjualan";
        case "purchase":
          return "Catatan dari pembelian";
        case "request_prep":
          return "Penyiapan request";
        case "ecer_prep":
          return "Penyiapan ecer";
        case "self_prep":
          return "Penyiapan sendiri";
        default:
          return "Catatan";
      }
    default:
      return e.sourceTable;
  }
}

export type PartyAuditGroup = {
  key: string;
  name: string;
  hutang: number;
  piutang: number;
  lastAt: string;
  events: BalanceEvent[];
};

/**
 * Kelompokkan event per kontak dan hitung saldo berjalan.
 * Rumusnya mengikuti party_balance_v1: saldo per jenis tidak pernah negatif.
 */
export function groupByParty(events: readonly BalanceEvent[]): PartyAuditGroup[] {
  const map = new Map<string, PartyAuditGroup>();
  for (const e of events) {
    const g =
      map.get(e.key) ??
      { key: e.key, name: e.name, hutang: 0, piutang: 0, lastAt: e.at, events: [] };
    if (e.kind === "hutang") g.hutang += e.delta;
    else g.piutang += e.delta;
    if (e.at > g.lastAt) {
      g.lastAt = e.at;
      g.name = e.name || g.name;
    }
    g.events.push(e);
    map.set(e.key, g);
  }
  const out = Array.from(map.values());
  for (const g of out) {
    g.hutang = Math.max(g.hutang, 0);
    g.piutang = Math.max(g.piutang, 0);
    g.events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }
  out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return out;
}