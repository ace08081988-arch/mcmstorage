/**
 * Rekonsiliasi Piutang.
 *
 * Membandingkan SSOT (`piutang_summary_v1`) dengan agregat yang dihitung
 * langsung di klien dari baris mentah `sales`, `customer_payments`, `debts`,
 * dan `debt_payments`. Kalau selisih ≠ 0 → ada baris yang lolos dari salah
 * satu kanal, dan bisa langsung ditelusuri lewat rincian per hari.
 */
import { ProGate } from "@/components/ProGate";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { rupiah } from "@/lib/stock-format";
import { fetchPiutangSummary, type PiutangSummary } from "@/lib/piutang";

export const Route = createFileRoute("/_authenticated/rekonsiliasi-piutang")({
  head: () => ({
    meta: [
      { title: "Rekonsiliasi Piutang · MCM Storage" },
      {
        name: "description",
        content:
          "Bandingkan total SSOT piutang_summary_v1 dengan agregat harian dari sales/debts untuk mendeteksi selisih.",
      },
    ],
  }),
  component: RekonsiliasiPiutangPageGated,
});

type SaleRow = { created_at: string; payment_method: string; total_revenue: number | string };
type CustPay = { created_at: string; amount: number | string };
type DebtRow = { id: string; kind: string; created_at: string; amount: number | string };
type DebtPay = { debt_id: string; created_at: string; amount: number | string };

type DailyRow = {
  date: string;
  salesHutang: number;
  custPaid: number;
  manualGross: number;
  manualPaid: number;
  cumSalesG: number;
  cumCustP: number;
  cumManualG: number;
  cumManualP: number;
  cumOutstanding: number;
};

// id-ID zona Asia/Jakarta → yyyy-mm-dd
function toJakartaDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts; // en-CA → "YYYY-MM-DD"
}

function num(v: unknown): number {
  return Number(v) || 0;
}

function RekonsiliasiPiutangPageGated() {
  return (
    <ProGate feature="Rekonsiliasi piutang">
      <RekonsiliasiPiutangPage />
    </ProGate>
  );
}

function RekonsiliasiPiutangPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ssot, setSsot] = useState<PiutangSummary | null>(null);
  const [ssotAt, setSsotAt] = useState<Date | null>(null);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [custPays, setCustPays] = useState<CustPay[]>([]);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [debtPays, setDebtPays] = useState<DebtPay[]>([]);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [ssotRes, salesRes, cpRes, debtsRes, dpRes] = await Promise.all([
        fetchPiutangSummary(),
        supabase.from("sales").select("created_at,payment_method,total_revenue"),
        supabase.from("customer_payments").select("created_at,amount"),
        supabase.from("debts").select("id,kind,created_at,amount").eq("kind", "piutang"),
        supabase.from("debt_payments").select("debt_id,created_at,amount"),
      ]);
      if (salesRes.error) throw salesRes.error;
      if (cpRes.error) throw cpRes.error;
      if (debtsRes.error) throw debtsRes.error;
      if (dpRes.error) throw dpRes.error;
      setSsot(ssotRes);
      setSsotAt(new Date());
      setSales((salesRes.data ?? []) as SaleRow[]);
      setCustPays((cpRes.data ?? []) as CustPay[]);
      setDebts((debtsRes.data ?? []) as DebtRow[]);
      setDebtPays((dpRes.data ?? []) as DebtPay[]);
    } catch (e) {
      setErr((e as Error).message || "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const { rows, computed } = useMemo(() => {
    const piutangIds = new Set(debts.map((d) => d.id));
    const byDay = new Map<
      string,
      { salesHutang: number; custPaid: number; manualGross: number; manualPaid: number }
    >();
    const bump = (
      date: string,
      key: "salesHutang" | "custPaid" | "manualGross" | "manualPaid",
      amt: number,
    ) => {
      const cur =
        byDay.get(date) ?? { salesHutang: 0, custPaid: 0, manualGross: 0, manualPaid: 0 };
      cur[key] += amt;
      byDay.set(date, cur);
    };
    for (const s of sales) {
      if (s.payment_method === "hutang")
        bump(toJakartaDate(s.created_at), "salesHutang", num(s.total_revenue));
    }
    for (const p of custPays) bump(toJakartaDate(p.created_at), "custPaid", num(p.amount));
    for (const d of debts)
      bump(toJakartaDate(d.created_at), "manualGross", num(d.amount));
    for (const dp of debtPays) {
      if (piutangIds.has(dp.debt_id))
        bump(toJakartaDate(dp.created_at), "manualPaid", num(dp.amount));
    }

    const sorted = Array.from(byDay.keys()).sort();
    let cS = 0, cC = 0, cMg = 0, cMp = 0;
    const rows: DailyRow[] = sorted.map((date) => {
      const b = byDay.get(date)!;
      cS += b.salesHutang;
      cC += b.custPaid;
      cMg += b.manualGross;
      cMp += b.manualPaid;
      const cumOutstanding = Math.max(cS - cC, 0) + Math.max(cMg - cMp, 0);
      return { date, ...b, cumSalesG: cS, cumCustP: cC, cumManualG: cMg, cumManualP: cMp, cumOutstanding };
    });

    const computed = {
      sales_hutang_gross: cS,
      sales_hutang_paid: cC,
      manual_gross: cMg,
      manual_paid: cMp,
      total_outstanding: Math.max(cS - cC, 0) + Math.max(cMg - cMp, 0),
    };
    return { rows, computed };
  }, [sales, custPays, debts, debtPays]);

  const diff = ssot ? ssot.total_outstanding - computed.total_outstanding : 0;
  const diffLine = (label: string, ssotVal: number, calcVal: number) => {
    const d = ssotVal - calcVal;
    return (
      <tr className={Math.abs(d) > 0.01 ? "bg-warning/10" : ""}>
        <td className="py-1 pr-2">{label}</td>
        <td className="py-1 pr-2 text-right tabular-nums">{rupiah(ssotVal)}</td>
        <td className="py-1 pr-2 text-right tabular-nums">{rupiah(calcVal)}</td>
        <td className="py-1 pr-2 text-right tabular-nums font-semibold">
          {d === 0 ? "—" : rupiah(d)}
        </td>
      </tr>
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-ms-4 py-ms-4 sm:px-ms-6 sm:py-ms-6 space-ms-4 sm:space-ms-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Rekonsiliasi Piutang</h1>
          <p className="text-xs text-muted-foreground">
            SSOT <code>piutang_summary_v1</code> vs agregat harian dari{" "}
            <code>sales</code>, <code>customer_payments</code>, <code>debts</code>,{" "}
            <code>debt_payments</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
        >
          {loading ? "⏳ Memuat…" : "🔄 Hitung ulang"}
        </button>
      </div>

      <div className="text-xs">
        <Link to="/gudang" className="text-primary underline">
          ← Kembali ke Gudang
        </Link>
      </div>

      {err && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {err}
        </div>
      )}

      <section className="rounded-lg border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">Perbandingan total</div>
          <div className="text-[0.625rem] text-muted-foreground">
            {ssotAt ? `🕒 ${ssotAt.toLocaleTimeString("id-ID")}` : ""}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-2 font-normal">Komponen</th>
                <th className="py-1 pr-2 text-right font-normal">SSOT</th>
                <th className="py-1 pr-2 text-right font-normal">Dihitung</th>
                <th className="py-1 pr-2 text-right font-normal">Selisih</th>
              </tr>
            </thead>
            <tbody>
              {ssot ? (
                <>
                  {diffLine("Sales hutang (bruto)", ssot.sales_hutang_gross, computed.sales_hutang_gross)}
                  {diffLine("Cust. pembayaran", ssot.sales_hutang_paid, computed.sales_hutang_paid)}
                  {diffLine("Manual piutang (bruto)", ssot.manual_gross, computed.manual_gross)}
                  {diffLine("Manual pembayaran", ssot.manual_paid, computed.manual_paid)}
                  <tr
                    className={`border-t font-semibold ${
                      Math.abs(diff) > 0.01 ? "bg-warning/20" : "bg-success/10"
                    }`}
                  >
                    <td className="py-1 pr-2">Outstanding</td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {rupiah(ssot.total_outstanding)}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {rupiah(computed.total_outstanding)}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {diff === 0 ? "✅ 0" : rupiah(diff)}
                    </td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td className="py-2 text-muted-foreground" colSpan={4}>
                    {loading ? "Memuat…" : "Belum ada data"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {ssot && Math.abs(diff) > 0.01 && (
          <p className="mt-2 text-[0.6875rem] text-warning-foreground">
            ⚠️ Selisih terdeteksi. Baris pada tabel harian yang berkontribusi ke komponen
            dengan selisih perlu ditelusuri (kemungkinan penyebab: RLS memfilter baris untuk
            client-side query, atau ada trigger yang mengubah data setelah pencatatan).
          </p>
        )}
      </section>

      <section className="rounded-lg border bg-card p-3">
        <div className="mb-2 text-sm font-semibold">
          Rincian per hari ({rows.length} hari)
        </div>
        {rows.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {loading ? "Memuat…" : "Belum ada baris piutang tercatat."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[0.6875rem]">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-normal">Tanggal</th>
                  <th className="py-1 pr-2 text-right font-normal">Sales hutang</th>
                  <th className="py-1 pr-2 text-right font-normal">Cust bayar</th>
                  <th className="py-1 pr-2 text-right font-normal">Manual +</th>
                  <th className="py-1 pr-2 text-right font-normal">Manual bayar</th>
                  <th className="py-1 pr-2 text-right font-normal">Outstanding kum.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} className="border-b last:border-b-0">
                    <td className="py-1 pr-2 whitespace-nowrap">{r.date}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {r.salesHutang ? rupiah(r.salesHutang) : "—"}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {r.custPaid ? rupiah(r.custPaid) : "—"}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {r.manualGross ? rupiah(r.manualGross) : "—"}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {r.manualPaid ? rupiah(r.manualPaid) : "—"}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums font-medium">
                      {rupiah(r.cumOutstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}