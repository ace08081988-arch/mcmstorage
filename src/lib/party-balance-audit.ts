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
  /** Saldo jenis ini (hutang/piutang) sebelum kejadian. Diisi oleh groupByParty. */
  balanceBefore?: number;
  /** Saldo jenis ini sesudah kejadian. Diisi oleh groupByParty. */
  balanceAfter?: number;
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

/** Ringkasan delta bersih (tanpa clamp) untuk rentang tanggal terpilih. */
export type PartyDeltaSummary = {
  key: string;
  name: string;
  /** Delta bersih piutang pada rentang (naik = tagihan baru). */
  piutangDelta: number;
  /** Delta bersih hutang pada rentang. */
  hutangDelta: number;
  /** Total tagihan baru (delta positif) pada rentang. */
  naik: number;
  /** Total pembayaran (delta negatif, dinyatakan positif) pada rentang. */
  turun: number;
  count: number;
  lastAt: string;
};

/** Hitung delta bersih per kontak dari daftar kejadian yang sudah difilter. */
export function summarizeDeltas(events: readonly BalanceEvent[]): PartyDeltaSummary[] {
  const map = new Map<string, PartyDeltaSummary>();
  for (const e of events) {
    const s =
      map.get(e.key) ??
      {
        key: e.key,
        name: e.name,
        piutangDelta: 0,
        hutangDelta: 0,
        naik: 0,
        turun: 0,
        count: 0,
        lastAt: e.at,
      };
    if (e.kind === "hutang") s.hutangDelta += e.delta;
    else s.piutangDelta += e.delta;
    if (e.delta >= 0) s.naik += e.delta;
    else s.turun += -e.delta;
    s.count += 1;
    if (e.at > s.lastAt) {
      s.lastAt = e.at;
      s.name = e.name || s.name;
    }
    map.set(e.key, s);
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      Math.abs(b.piutangDelta) + Math.abs(b.hutangDelta) -
      (Math.abs(a.piutangDelta) + Math.abs(a.hutangDelta)),
  );
}

/**
 * Kelompokkan event per kontak dan hitung saldo berjalan.
 * Rumusnya mengikuti party_balance_v1: saldo per jenis tidak pernah negatif.
 */
export type DeltaFactor = {
  /** Label ramah pengguna untuk sumber (kanal) perubahan. */
  label: string;
  sourceTable: string;
  source: string;
  /** Delta bersih dari kanal ini. */
  delta: number;
  naik: number;
  turun: number;
  count: number;
  /** Kontribusi terhadap total pergerakan absolut kontak (0–100). */
  share: number;
  events: BalanceEvent[];
};

/**
 * Rincian faktor penyebab delta bersih seorang kontak:
 * event dikelompokkan per kanal sumber, diurutkan dari dampak terbesar.
 */
export function breakdownFactors(events: readonly BalanceEvent[]): DeltaFactor[] {
  const map = new Map<string, DeltaFactor>();
  for (const e of events) {
    const id = `${e.sourceTable}::${e.source}`;
    const f =
      map.get(id) ??
      {
        label: sourceLabel(e),
        sourceTable: e.sourceTable,
        source: e.source,
        delta: 0,
        naik: 0,
        turun: 0,
        count: 0,
        share: 0,
        events: [] as BalanceEvent[],
      };
    f.delta += e.delta;
    if (e.delta >= 0) f.naik += e.delta;
    else f.turun += -e.delta;
    f.count += 1;
    f.events.push(e);
    map.set(id, f);
  }
  const out = Array.from(map.values());
  const total = out.reduce((n, f) => n + Math.abs(f.delta), 0);
  for (const f of out) {
    f.share = total > 0 ? (Math.abs(f.delta) / total) * 100 : 0;
    f.events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }
  out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return out;
}

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
    // Saldo berjalan per jenis, dihitung dari kejadian terlama ke terbaru.
    const running: Record<BalanceEventKind, number> = { hutang: 0, piutang: 0 };
    for (let i = g.events.length - 1; i >= 0; i--) {
      const e = g.events[i];
      const before = running[e.kind];
      const after = before + e.delta;
      running[e.kind] = after;
      g.events[i] = { ...e, balanceBefore: before, balanceAfter: after };
    }
  }
  out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return out;
}