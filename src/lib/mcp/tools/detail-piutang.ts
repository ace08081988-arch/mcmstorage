import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForCaller } from "../supabase";

/**
 * Detail piutang per pelanggan, digabung dari dua sumber (identik dengan
 * SSOT `piutang_summary_v1` / `derivePiutangFromRows`):
 *   1. `sales` dengan `payment_method='hutang'` dikurangi `customer_payments`.
 *   2. `debts` dengan `kind='piutang'` dikurangi `debt_payments`.
 *
 * Filter tanggal diterapkan pada tanggal transaksi asal (sale.created_at
 * atau debt.created_at / due_date fallback). Status: `outstanding` (sisa > 0),
 * `paid` (sisa = 0), `all`.
 */

type Row = {
  customer_id: string | null;
  customer_name: string;
  gross: number;
  paid: number;
  outstanding: number;
  last_activity: string | null;
  sources: { sales_hutang: number; manual_debt: number };
};

function toISO(d: string | undefined | null) {
  if (!d) return null;
  const t = new Date(d);
  return isNaN(t.getTime()) ? null : t.toISOString();
}

export default defineTool({
  name: "detail_piutang",
  title: "Detail piutang",
  description:
    "Daftar piutang per pelanggan (bukan ringkasan) untuk user Ace Storage yang sedang terhubung. Menggabungkan sales (payment_method='hutang') dan debts (kind='piutang'), dikurangi pembayaran masing-masing. Mendukung filter rentang tanggal (from/to, ISO YYYY-MM-DD), status ('outstanding'|'paid'|'all'), pencarian nama pelanggan, dan limit hasil.",
  inputSchema: {
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Tanggal mulai (inklusif), format YYYY-MM-DD."),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Tanggal akhir (inklusif), format YYYY-MM-DD."),
    status: z
      .enum(["outstanding", "paid", "all"])
      .optional()
      .describe("Filter status; default 'outstanding'."),
    customer_search: z
      .string()
      .optional()
      .describe("Cari nama pelanggan (case-insensitive substring)."),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maksimum baris pelanggan; default 50, maksimum 200."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Tidak terautentikasi" }], isError: true };
    }
    const supabase = supabaseForCaller(ctx);

    const status = input.status ?? "outstanding";
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const fromISO = toISO(input.from);
    // Untuk `to` inklusif satu hari penuh, geser ke akhir hari.
    const toISOEnd = input.to ? toISO(`${input.to}T23:59:59.999Z`) : null;
    const needle = input.customer_search?.trim().toLowerCase() ?? "";

    // 1. Sales hutang + payments.
    let salesQ = supabase
      .from("sales")
      .select("id, customer_id, total_revenue, created_at, payment_method")
      .eq("payment_method", "hutang");
    if (fromISO) salesQ = salesQ.gte("created_at", fromISO);
    if (toISOEnd) salesQ = salesQ.lte("created_at", toISOEnd);
    const { data: sales, error: salesErr } = await salesQ;
    if (salesErr) return { content: [{ type: "text", text: salesErr.message }], isError: true };

    const saleIds = (sales ?? []).map((s) => s.id);
    let custPays: Array<{ sale_id: string | null; customer_id: string | null; amount: number | string }> = [];
    if (saleIds.length > 0) {
      const { data, error } = await supabase
        .from("customer_payments")
        .select("sale_id, customer_id, amount")
        .in("sale_id", saleIds);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      custPays = data ?? [];
    }

    // 2. Manual debts (kind='piutang') + debt_payments.
    let debtsQ = supabase
      .from("debts")
      .select("id, customer_id, party_name, amount, created_at, due_date, kind")
      .eq("kind", "piutang");
    if (fromISO) debtsQ = debtsQ.gte("created_at", fromISO);
    if (toISOEnd) debtsQ = debtsQ.lte("created_at", toISOEnd);
    const { data: debts, error: debtsErr } = await debtsQ;
    if (debtsErr) return { content: [{ type: "text", text: debtsErr.message }], isError: true };

    const debtIds = (debts ?? []).map((d) => d.id);
    let debtPays: Array<{ debt_id: string; amount: number | string; paid_at: string | null }> = [];
    if (debtIds.length > 0) {
      const { data, error } = await supabase
        .from("debt_payments")
        .select("debt_id, amount, paid_at")
        .in("debt_id", debtIds);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      debtPays = data ?? [];
    }

    // 3. Nama pelanggan.
    const customerIds = new Set<string>();
    for (const s of sales ?? []) if (s.customer_id) customerIds.add(s.customer_id);
    for (const d of debts ?? []) if (d.customer_id) customerIds.add(d.customer_id);
    const namesById = new Map<string, string>();
    if (customerIds.size > 0) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .in("id", Array.from(customerIds));
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      for (const c of data ?? []) namesById.set(c.id, c.name ?? "");
    }

    // 4. Aggregate per customer key.
    const rows = new Map<string, Row>();
    function bucket(key: string, name: string) {
      let r = rows.get(key);
      if (!r) {
        r = {
          customer_id: key.startsWith("cust:") ? key.slice(5) : null,
          customer_name: name || "(Tanpa nama)",
          gross: 0,
          paid: 0,
          outstanding: 0,
          last_activity: null,
          sources: { sales_hutang: 0, manual_debt: 0 },
        };
        rows.set(key, r);
      }
      return r;
    }
    function touch(r: Row, ts: string | null | undefined) {
      if (!ts) return;
      if (!r.last_activity || ts > r.last_activity) r.last_activity = ts;
    }

    for (const s of sales ?? []) {
      const key = s.customer_id ? `cust:${s.customer_id}` : "cust:__none__";
      const name = s.customer_id ? namesById.get(s.customer_id) ?? "" : "(Tanpa pelanggan)";
      const r = bucket(key, name);
      const amt = Number(s.total_revenue) || 0;
      r.gross += amt;
      r.sources.sales_hutang += amt;
      touch(r, s.created_at);
    }
    for (const p of custPays) {
      if (!p.sale_id) continue;
      const sale = (sales ?? []).find((s) => s.id === p.sale_id);
      if (!sale) continue; // pembayaran di luar rentang tanggal sales — abaikan
      const key = sale.customer_id ? `cust:${sale.customer_id}` : "cust:__none__";
      const name = sale.customer_id ? namesById.get(sale.customer_id) ?? "" : "(Tanpa pelanggan)";
      const r = bucket(key, name);
      r.paid += Number(p.amount) || 0;
    }
    for (const d of debts ?? []) {
      const key = d.customer_id ? `cust:${d.customer_id}` : `manual:${d.party_name ?? "__none__"}`;
      const name = d.customer_id
        ? namesById.get(d.customer_id) ?? d.party_name ?? ""
        : d.party_name ?? "(Tanpa nama)";
      const r = bucket(key, name);
      const amt = Number(d.amount) || 0;
      r.gross += amt;
      r.sources.manual_debt += amt;
      touch(r, d.created_at ?? d.due_date);
    }
    for (const dp of debtPays) {
      const debt = (debts ?? []).find((d) => d.id === dp.debt_id);
      if (!debt) continue;
      const key = debt.customer_id
        ? `cust:${debt.customer_id}`
        : `manual:${debt.party_name ?? "__none__"}`;
      const name = debt.customer_id
        ? namesById.get(debt.customer_id) ?? debt.party_name ?? ""
        : debt.party_name ?? "(Tanpa nama)";
      const r = bucket(key, name);
      r.paid += Number(dp.amount) || 0;
      touch(r, dp.paid_at);
    }

    // 5. Finalize outstanding, filter, sort.
    let list = Array.from(rows.values()).map((r) => {
      r.outstanding = Math.max(r.gross - r.paid, 0);
      return r;
    });
    if (status === "outstanding") list = list.filter((r) => r.outstanding > 0);
    else if (status === "paid") list = list.filter((r) => r.outstanding === 0 && r.gross > 0);
    if (needle) list = list.filter((r) => r.customer_name.toLowerCase().includes(needle));
    list.sort((a, b) => b.outstanding - a.outstanding || b.gross - a.gross);
    const truncated = list.length > limit;
    list = list.slice(0, limit);

    const totals = list.reduce(
      (acc, r) => {
        acc.gross += r.gross;
        acc.paid += r.paid;
        acc.outstanding += r.outstanding;
        return acc;
      },
      { gross: 0, paid: 0, outstanding: 0 },
    );

    const payload = {
      filter: {
        from: input.from ?? null,
        to: input.to ?? null,
        status,
        customer_search: input.customer_search ?? null,
        limit,
      },
      totals,
      truncated,
      count: list.length,
      rows: list,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});