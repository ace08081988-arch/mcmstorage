/**
 * Ekspor daftar pesanan & total penjualan per status.
 * Angka memakai SSOT `src/lib/orders-export.ts` (sold_total + fallback sales).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { rupiah } from "@/lib/stock-format";
import {
  fetchOrdersExportData,
  exportOrdersCsv,
  exportOrdersExcel,
  type OrdersExportData,
} from "@/lib/orders-export";

export const Route = createFileRoute("/_authenticated/ekspor-pesanan")({
  head: () => ({
    meta: [
      { title: "Ekspor Pesanan · Ace Storage" },
      {
        name: "description",
        content:
          "Unduh daftar pesanan Request, Ecer, dan Siapkan Sendiri beserta total penjualan dan piutang per status ke CSV atau Excel.",
      },
      { property: "og:title", content: "Ekspor Pesanan · Ace Storage" },
      {
        property: "og:description",
        content: "Rekap pesanan per status lengkap dengan total penjualan dan piutang.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EksporPesananPage,
});

function EksporPesananPage() {
  const [data, setData] = useState<OrdersExportData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchOrdersExportData());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-3xl px-ms-4 py-ms-4 sm:px-ms-6 sm:py-ms-6 space-ms-4 sm:space-ms-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Ekspor Pesanan</h1>
        <p className="text-xs text-muted-foreground">
          Rekap Request, Ecer, dan Siapkan Sendiri per status (Siap / Terkirim) beserta nilai
          penjualan dan piutangnya. Sumber angka: catatan paket dengan fallback ke penjualan (SSOT).
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={"mr-1.5 h-4 w-4 " + (loading ? "animate-spin" : "")} />
          Muat ulang
        </Button>
        <Button size="sm" disabled={!data} onClick={() => data && exportOrdersCsv(data)}>
          <Download className="mr-1.5 h-4 w-4" /> Unduh CSV
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!data}
          onClick={() => data && exportOrdersExcel(data)}
        >
          <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Unduh Excel
        </Button>
      </div>

      {!data ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Kategori</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Jumlah</th>
                  <th className="p-2 text-right">Total penjualan</th>
                  <th className="p-2 text-right">Piutang</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.map((s) => (
                  <tr key={s.kategori + s.status} className="border-t">
                    <td className="p-2">{s.kategori}</td>
                    <td className="p-2">{s.status}</td>
                    <td className="p-2 text-right">{s.jumlah}</td>
                    <td className="p-2 text-right">{rupiah(s.total)}</td>
                    <td className="p-2 text-right">{rupiah(s.piutang)}</td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="p-2" colSpan={2}>
                    TOTAL
                  </td>
                  <td className="p-2 text-right">{data.totals.jumlah}</td>
                  <td className="p-2 text-right">{rupiah(data.totals.total)}</td>
                  <td className="p-2 text-right">{rupiah(data.totals.piutang)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {data.rows.length} baris pesanan · dihitung {data.generatedAt.toLocaleString("id-ID")}
          </p>
        </>
      )}
    </main>
  );
}