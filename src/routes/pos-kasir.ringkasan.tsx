import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { getPosKasirRiwayat } from "@/lib/pos-kasir";

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

const waktuFmt = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  day: "2-digit",
  month: "short",
});

function isToday(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

function PosKasirRingkasanPage() {
  const riwayat = useMemo(() => getPosKasirRiwayat(), []);
  const hariIni = useMemo(() => riwayat.filter((t) => isToday(t.waktu)), [riwayat]);

  const omzetHariIni = hariIni.reduce((s, t) => s + t.total, 0);
  const beratHariIni = hariIni.reduce((s, t) => s + t.beratKg, 0);
  const jumlahHariIni = hariIni.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100 p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">📊 Ringkasan POS Kasir</h1>
            <p className="text-sm text-slate-400 mt-1">
              Pantau omzet, berat terjual, dan jumlah transaksi hari ini
            </p>
          </div>
          <Link
            to="/pos-kasir"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
          >
            ⬅ Kembali ke Kasir
          </Link>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wider">Omzet Hari Ini</div>
            <div className="text-2xl md:text-3xl font-bold text-emerald-400 font-mono mt-2">
              {rupiah(omzetHariIni)}
            </div>
          </div>
          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wider">Berat Terjual Hari Ini</div>
            <div className="text-2xl md:text-3xl font-bold text-blue-400 font-mono mt-2">
              {beratHariIni.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg
            </div>
          </div>
          <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wider">Jumlah Transaksi Hari Ini</div>
            <div className="text-2xl md:text-3xl font-bold text-amber-400 font-mono mt-2">
              {jumlahHariIni}
            </div>
          </div>
        </div>

        <section className="bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
            Transaksi Hari Ini ({hariIni.length})
          </h2>
          {hariIni.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              Belum ada transaksi hari ini. Lakukan penjualan di halaman POS Kasir.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-700">
                    <th className="py-2 pr-3 font-medium">Waktu</th>
                    <th className="py-2 pr-3 font-medium">Produk</th>
                    <th className="py-2 pr-3 font-medium text-right">Berat</th>
                    <th className="py-2 pr-3 font-medium text-right">Total</th>
                    <th className="py-2 font-medium text-right">Sisa Stok</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {hariIni.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-900/40">
                      <td className="py-2 pr-3 font-mono text-xs text-slate-400">
                        {waktuFmt.format(t.waktu)}
                      </td>
                      <td className="py-2 pr-3">
                        <span className="mr-1.5">{t.produkEmoji}</span>
                        {t.produkNama}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg
                      </td>
                      <td className="py-2 pr-3 text-right font-mono font-semibold text-emerald-400">
                        {rupiah(t.total)}
                      </td>
                      <td className="py-2 text-right font-mono text-slate-300">
                        {t.sisaStokKg.toLocaleString("id-ID")} kg
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/pos-kasir/ringkasan")({
  head: () => ({
    meta: [
      { title: "Ringkasan POS Kasir · Omzet Hari Ini" },
      { name: "description", content: "Ringkasan harian penjualan produk curah: omzet, berat terjual, dan jumlah transaksi." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PosKasirRingkasanPage,
});
