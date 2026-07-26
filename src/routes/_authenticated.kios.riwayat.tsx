import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { notifyError } from "@/lib/friendly-error";

/**
 * Riwayat Kios — daftar gabungan terima (purchases) & jual (sales)
 * untuk owner yang login, urut terbaru. Sumber data langsung ke tabel
 * `purchases` + `sales` + `customer_payments`, discope RLS (owner-only).
 *
 * Baris menampilkan:
 *  - Jenis transaksi (📥 Terima / 💰 Jual)
 *  - Nama barang, jumlah, dampak stok (+ / −)
 *  - Total nilai transaksi
 *  - Status pembayaran (Lunas / Hutang Rp X)
 *  - Nama pelanggan / pegawai (bila ada)
 *  - Tautan detail: barang → /gudang, hutang → /hutang-piutang.
 */

export const Route = createFileRoute("/_authenticated/kios/riwayat")({
  head: () => ({
    meta: [
      { title: "Riwayat Kios — MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: RiwayatKiosPage,
});

type Row =
  | {
      kind: "terima";
      id: string;
      created_at: string;
      item_name: string;
      base_unit: string | null;
      qty_base: number;
      total: number;
      payment_method: "kas" | "hutang";
      supplier_name: string | null;
    }
  | {
      kind: "jual";
      id: string;
      created_at: string;
      item_name: string;
      base_unit: string | null;
      qty_base: number;
      total: number;
      payment_method: "kas" | "hutang";
      paid_amount: number; // dibayar sekarang (customer_payments.amount pada tanggal ~sale)
      customer_name: string | null;
      customer_id: string | null;
      note: string | null;
    };

type Filter = "semua" | "terima" | "jual";

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

function fmtQty(n: number, u: string | null) {
  const v = Number(n) || 0;
  const unit = u ?? "";
  return unit === "g"
    ? `${v.toLocaleString("id-ID", { maximumFractionDigits: 2 })} g`
    : `${v.toLocaleString("id-ID")} ${unit || "pcs"}`;
}

function fmtWaktu(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RiwayatKiosPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<Filter>("semua");

  useEffect(() => {
    let on = true;
    (async () => {
      setLoading(true);
      try {
        // Ambil 150 baris terbaru tiap kanal — cukup untuk halaman pertama.
        const [purchasesRes, salesRes, itemsRes, customersRes, suppliersRes] =
          await Promise.all([
            supabase
              .from("purchases")
              .select(
                "id,created_at,item_id,base_added,total_cost,payment_method,supplier_id",
              )
              .order("created_at", { ascending: false })
              .limit(150),
            supabase
              .from("sales")
              .select(
                "id,created_at,item_id,qty_base,total_revenue,payment_method,customer_id,note",
              )
              .order("created_at", { ascending: false })
              .limit(150),
            supabase.from("warehouse_items").select("id,name,base_unit"),
            supabase.from("customers").select("id,name"),
            supabase.from("suppliers").select("id,name"),
          ]);
        if (!on) return;
        if (purchasesRes.error) throw purchasesRes.error;
        if (salesRes.error) throw salesRes.error;

        const itemMap = new Map<string, { name: string; base_unit: string | null }>();
        for (const it of (itemsRes.data ?? []) as Array<{
          id: string;
          name: string;
          base_unit: string | null;
        }>) {
          itemMap.set(it.id, { name: it.name, base_unit: it.base_unit });
        }
        const custMap = new Map<string, string>();
        for (const c of (customersRes.data ?? []) as Array<{ id: string; name: string }>) {
          custMap.set(c.id, c.name);
        }
        const suppMap = new Map<string, string>();
        for (const s of (suppliersRes.data ?? []) as Array<{ id: string; name: string }>) {
          suppMap.set(s.id, s.name);
        }

        const saleIds = ((salesRes.data ?? []) as Array<{ id: string }>).map(
          (r) => r.id,
        );
        const paidBySaleId = new Map<string, number>();
        if (saleIds.length > 0) {
          const paidRes = await supabase
            .from("customer_payments")
            .select("sale_id,amount")
            .in("sale_id", saleIds);
          if (!on) return;
          for (const p of (paidRes.data ?? []) as Array<{
            sale_id: string | null;
            amount: number;
          }>) {
            if (!p.sale_id) continue;
            paidBySaleId.set(
              p.sale_id,
              (paidBySaleId.get(p.sale_id) ?? 0) + Number(p.amount || 0),
            );
          }
        }

        const purchaseRows: Row[] = (purchasesRes.data ?? []).map((p) => {
          const info = itemMap.get(p.item_id as string);
          return {
            kind: "terima" as const,
            id: p.id as string,
            created_at: p.created_at as string,
            item_name: info?.name ?? "(barang dihapus)",
            base_unit: info?.base_unit ?? null,
            qty_base: Number(p.base_added || 0),
            total: Number(p.total_cost || 0),
            payment_method: (p.payment_method as "kas" | "hutang") ?? "kas",
            supplier_name: p.supplier_id ? (suppMap.get(p.supplier_id as string) ?? null) : null,
          };
        });

        const saleRows: Row[] = (salesRes.data ?? []).map((s) => {
          const info = itemMap.get(s.item_id as string);
          const method = (s.payment_method as "kas" | "hutang") ?? "kas";
          const total = Number(s.total_revenue || 0);
          const paid = paidBySaleId.get(s.id as string) ?? 0;
          return {
            kind: "jual" as const,
            id: s.id as string,
            created_at: s.created_at as string,
            item_name: info?.name ?? "(barang dihapus)",
            base_unit: info?.base_unit ?? null,
            qty_base: Number(s.qty_base || 0),
            total,
            payment_method: method,
            // Lunas → dianggap paid=total; hutang → paid = jumlah customer_payments
            paid_amount: method === "kas" ? total : paid,
            customer_name: s.customer_id
              ? (custMap.get(s.customer_id as string) ?? null)
              : null,
            customer_id: (s.customer_id as string | null) ?? null,
            note: (s.note as string | null) ?? null,
          };
        });

        const merged = [...purchaseRows, ...saleRows].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        );
        setRows(merged);
      } catch (e) {
        notifyError(e, { fallback: "Gagal memuat riwayat kios" });
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "semua") return rows;
    return rows.filter((r) => r.kind === filter);
  }, [rows, filter]);

  const summary = useMemo(() => {
    let terimaCount = 0;
    let terimaTotal = 0;
    let jualCount = 0;
    let jualTotal = 0;
    let piutangSisa = 0;
    for (const r of rows) {
      if (r.kind === "terima") {
        terimaCount += 1;
        terimaTotal += r.total;
      } else {
        jualCount += 1;
        jualTotal += r.total;
        if (r.payment_method === "hutang") {
          piutangSisa += Math.max(0, r.total - r.paid_amount);
        }
      }
    }
    return { terimaCount, terimaTotal, jualCount, jualTotal, piutangSisa };
  }, [rows]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-3">
          <Link to="/kios" className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
            ← Kios
          </Link>
          <h1 className="text-base font-bold">📜 Riwayat Kios</h1>
          <Link
            to="/hutang-piutang"
            className="ml-auto rounded-md border px-2 py-1 text-xs hover:bg-accent"
          >
            Piutang →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 p-3 pb-24">
        {/* Ringkasan */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Terima</div>
            <div className="mt-1 text-sm font-semibold tabular-nums">
              {summary.terimaCount}×
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {rupiah(summary.terimaTotal)}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Jual</div>
            <div className="mt-1 text-sm font-semibold tabular-nums">
              {summary.jualCount}×
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {rupiah(summary.jualTotal)}
            </div>
          </div>
          <div className="col-span-2 rounded-lg border bg-card p-3 sm:col-span-2">
            <div className="text-[10px] uppercase text-muted-foreground">
              Piutang berjalan
            </div>
            <div
              className={`mt-1 text-sm font-semibold tabular-nums ${
                summary.piutangSisa > 0 ? "text-warning" : ""
              }`}
            >
              {rupiah(summary.piutangSisa)}
            </div>
            <div className="text-xs text-muted-foreground">
              Sisa belum dibayar dari jual-hutang di daftar ini.
            </div>
          </div>
        </section>

        {/* Filter */}
        <div className="flex flex-wrap gap-2">
          {(["semua", "terima", "jual"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                filter === k
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-accent"
              }`}
              aria-pressed={filter === k}
            >
              {k === "semua" ? "Semua" : k === "terima" ? "Terima" : "Jual"}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-sm text-muted-foreground">Memuat…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Belum ada transaksi.{" "}
            <Link to="/kios" className="text-primary underline">
              Mulai di Kios
            </Link>
            .
          </div>
        ) : (
          <VirtualizedList
            items={filtered}
            getKey={(r) => `${r.kind}:${r.id}`}
            estimateSize={96}
            gap={8}
            renderItem={(r) => <HistoryCard r={r} />}
          />
        )}
      </main>
    </div>
  );
}

const HistoryCard = React.memo(function HistoryCard({ r }: { r: Row }) {
  return (
    <Link
      to="/kios/riwayat/$kind/$id"
      params={{ kind: r.kind, id: r.id }}
      className="block rounded-lg border bg-card p-3 transition hover:bg-accent"
    >
      {r.kind === "terima" ? <TerimaRow r={r} /> : <JualRow r={r} />}
    </Link>
  );
});

const TerimaRow = React.memo(function TerimaRow({
  r,
}: {
  r: Extract<Row, { kind: "terima" }>;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">📥 Terima · {fmtWaktu(r.created_at)}</div>
          <div className="mt-0.5 block truncate text-sm font-semibold">
            {r.item_name}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold text-success tabular-nums">
            + {fmtQty(r.qty_base, r.base_unit)}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {rupiah(r.total)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {r.supplier_name ? (
          <span className="rounded-full bg-muted px-2 py-0.5">
            Supplier: {r.supplier_name}
          </span>
        ) : null}
        <span
          className={`rounded-full px-2 py-0.5 ${
            r.payment_method === "kas"
              ? "bg-success/15 text-success"
              : "bg-warning/15 text-warning"
          }`}
        >
          {r.payment_method === "kas" ? "Lunas kas" : "Hutang supplier"}
        </span>
      </div>
    </div>
  );
}

function JualRow({
  r,
}: {
  r: Extract<Row, { kind: "jual" }>;
}) {
  const sisa = Math.max(0, r.total - r.paid_amount);
  const isPaid = r.payment_method === "kas" || sisa === 0;
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">💰 Jual · {fmtWaktu(r.created_at)}</div>
          <div className="mt-0.5 block truncate text-sm font-semibold">
            {r.item_name}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold text-destructive tabular-nums">
            − {fmtQty(r.qty_base, r.base_unit)}
          </div>
          <div className="text-xs font-semibold tabular-nums">{rupiah(r.total)}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {r.customer_name ? (
          <span className="rounded-full bg-muted px-2 py-0.5">
            Pelanggan: {r.customer_name}
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5">
            Pelanggan: —
          </span>
        )}
        {isPaid ? (
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-success">
            Lunas
          </span>
        ) : (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">
            Hutang {rupiah(sisa)}
            {r.paid_amount > 0 ? ` · dibayar ${rupiah(r.paid_amount)}` : ""}
          </span>
        )}
        {r.note ? (
          <span className="truncate text-[11px] italic">“{r.note}”</span>
        ) : null}
      </div>
    </div>
  );
}
