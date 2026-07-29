/**
 * Detail transaksi hari ini.
 *
 * Sumber angka: tabel `sales` (SSOT penjualan) — sama dengan panel
 * "Ringkasan hari ini" di Beranda, sehingga total di sini selalu cocok
 * dengan metrik omzet / transaksi / unit terjual.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/transaksi-hari-ini")({
  component: TransaksiHariIniPage,
  head: () => ({
    meta: [
      { title: "Transaksi Hari Ini — MCM Storage" },
      {
        name: "description",
        content:
          "Rincian penjualan hari ini: unit terjual, omzet, dan produk per transaksi.",
      },
      { property: "og:title", content: "Transaksi Hari Ini — MCM Storage" },
      {
        property: "og:description",
        content: "Rincian penjualan hari ini yang menyusun metrik unit terjual.",
      },
    ],
  }),
});

type SaleRow = {
  id: string;
  item_id: string;
  qty_base: number;
  total_revenue: number;
  created_at: string;
  warehouse_items?: { name: string; base_unit: string | null } | null;
};

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const num = (n: number) =>
  n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

function TransaksiHariIniPage() {
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase
      .from("sales")
      .select(
        "id,item_id,qty_base,total_revenue,created_at,warehouse_items(name,base_unit)",
      )
      .gte("created_at", startOfToday().toISOString())
      .order("created_at", { ascending: false });
    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as SaleRow[]);
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    let omzet = 0;
    let unit = 0;
    for (const r of rows ?? []) {
      omzet += Number(r.total_revenue) || 0;
      unit += Number(r.qty_base) || 0;
    }
    return { omzet, unit, trx: rows?.length ?? 0 };
  }, [rows]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Beranda
          </Link>
          <h1 className="text-lg font-semibold">Transaksi hari ini</h1>
          <p className="text-xs text-muted-foreground">
            Sumber: penjualan (SSOT) · {num(totals.unit)} unit ·{" "}
            {rupiah(totals.omzet)} dari {totals.trx} transaksi
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
          Segarkan
        </button>
      </div>

      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          Gagal memuat: {err}
        </div>
      )}

      {rows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Belum ada penjualan hari ini.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {r.warehouse_items?.name ?? "Produk"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {num(Number(r.qty_base) || 0)}{" "}
                  {r.warehouse_items?.base_unit || "pcs"}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">
                {rupiah(Number(r.total_revenue) || 0)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
