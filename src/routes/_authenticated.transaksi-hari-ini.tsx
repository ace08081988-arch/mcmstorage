/**
 * Detail transaksi hari ini.
 *
 * Sumber angka: tabel `sales` (SSOT penjualan) — sama dengan panel
 * "Ringkasan hari ini" di Beranda, sehingga total di sini selalu cocok
 * dengan metrik omzet / transaksi / unit terjual.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, FileDown, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { AnalyticsExportData } from "@/lib/analytics-export";
import PdfPreviewDialog, { type PdfPreviewSource } from "@/components/PdfPreviewDialog";

export const Route = createFileRoute("/_authenticated/transaksi-hari-ini")({
  component: TransaksiHariIniPage,
  head: () => ({
    meta: [
      { title: "Transaksi Hari Ini — Ace Storage" },
      {
        name: "description",
        content:
          "Rincian penjualan hari ini: unit terjual, omzet, dan produk per transaksi.",
      },
      { property: "og:title", content: "Transaksi Hari Ini — Ace Storage" },
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
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewSource>(null);

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

  const doExport = useCallback(
    async (kind: "csv" | "pdf") => {
      const list = rows ?? [];
      if (list.length === 0) {
        toast.error("Belum ada transaksi untuk diekspor");
        return;
      }
      setExporting(kind);
      try {
        // Produk terlaris dihitung dari baris yang sama (SSOT penjualan).
        const byItem = new Map<string, { name: string; qty: number; unit: string }>();
        for (const r of list) {
          const cur = byItem.get(r.item_id) ?? {
            name: r.warehouse_items?.name ?? "Produk",
            qty: 0,
            unit: r.warehouse_items?.base_unit || "pcs",
          };
          cur.qty += Number(r.qty_base) || 0;
          byItem.set(r.item_id, cur);
        }
        const best = [...byItem.values()].sort((a, b) => b.qty - a.qty)[0] ?? null;

        const data: AnalyticsExportData = {
          judul: `Transaksi penyumbang unit terjual — ${new Date().toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}`,
          tanggal: new Date(),
          omzet: totals.omzet,
          trx: totals.trx,
          unit: totals.unit,
          terlaris: best ? `${best.name} (${num(best.qty)} ${best.unit})` : "—",
          rows: list.map((r) => ({
            waktu: new Date(r.created_at).toLocaleTimeString("id-ID"),
            produk: r.warehouse_items?.name ?? "Produk",
            qty: Number(r.qty_base) || 0,
            unit: r.warehouse_items?.base_unit || "pcs",
            total: Number(r.total_revenue) || 0,
          })),
        };

        const mod = await import("@/lib/analytics-export");
        if (kind === "csv") {
          mod.exportAnalyticsCsv(data);
          toast.success("Daftar transaksi diunduh sebagai CSV");
        } else {
          setPdfPreview(await mod.buildAnalyticsPdfBlob(data));
        }
      } catch (e) {
        toast.error(`Gagal ekspor ${kind.toUpperCase()}`, {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setExporting(null);
      }
    },
    [rows, totals],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
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
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => void doExport("csv")}
            disabled={busy || exporting !== null || !rows?.length}
            aria-label="Ekspor daftar transaksi ke CSV"
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <FileDown className="h-3 w-3" />
            {exporting === "csv" ? "…" : "CSV"}
          </button>
          <button
            type="button"
            onClick={() => void doExport("pdf")}
            disabled={busy || exporting !== null || !rows?.length}
            aria-label="Ekspor daftar transaksi ke PDF"
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <FileText className="h-3 w-3" />
            {exporting === "pdf" ? "…" : "PDF"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            Segarkan
          </button>
        </div>
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
      <PdfPreviewDialog
        open={pdfPreview !== null}
        onOpenChange={(v) => !v && setPdfPreview(null)}
        source={pdfPreview}
        title="Pratinjau daftar transaksi"
        onDownloaded={() => toast.success("Daftar transaksi diunduh sebagai PDF")}
      />
    </div>
  );
}
