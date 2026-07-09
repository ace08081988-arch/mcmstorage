import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { getPosKasirRiwayat, subscribePosKasirRiwayat } from "@/lib/pos-kasir";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  Line,
} from "recharts";

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

function toDateKey(ts: number) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function todayKey() {
  return toDateKey(Date.now());
}

function daysAgoKey(n: number) {
  return toDateKey(Date.now() - n * 24 * 60 * 60 * 1000);
}

function PosKasirRingkasanPage() {
  const [riwayat, setRiwayat] = useState(() => getPosKasirRiwayat());

  useEffect(() => {
    // Sinkron ulang saat tab difokuskan kembali (mis. balik dari kasir di mobile)
    const refresh = () => setRiwayat(getPosKasirRiwayat());
    const unsub = subscribePosKasirRiwayat(refresh);
    // M17: `focus` + `visibilitychange` sebelumnya keduanya memanggil
    // `refresh()` saat user balik dari tab lain → dua kali `setRiwayat`
    // beruntun → Recharts render dua kali. `visibilitychange` sudah
    // mencakup skenario "kembali ke tab" pada semua browser modern
    // (termasuk Safari iOS/Android). Cukup satu listener.
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const hariIni = useMemo(() => riwayat.filter((t) => isToday(t.waktu)), [riwayat]);

  const omzetHariIni = hariIni.reduce((s, t) => s + t.total, 0);
  const beratHariIni = hariIni.reduce((s, t) => s + t.beratKg, 0);
  const jumlahHariIni = hariIni.length;

  const [toast, setToast] = useState<string | null>(null);
  const [dariTanggal, setDariTanggal] = useState<string>(daysAgoKey(6));
  const [sampaiTanggal, setSampaiTanggal] = useState<string>(todayKey());

  const trenData = useMemo(() => {
    if (!dariTanggal || !sampaiTanggal) return [];
    const start = new Date(dariTanggal + "T00:00:00").getTime();
    const end = new Date(sampaiTanggal + "T23:59:59.999").getTime();
    if (isNaN(start) || isNaN(end) || start > end) return [];
    const buckets = new Map<string, { omzet: number; beratKg: number; jumlah: number }>();
    // seed all days so chart shows gaps as 0
    for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
      buckets.set(toDateKey(t), { omzet: 0, beratKg: 0, jumlah: 0 });
    }
    for (const trx of riwayat) {
      if (trx.waktu < start || trx.waktu > end) continue;
      const key = toDateKey(trx.waktu);
      const b = buckets.get(key) ?? { omzet: 0, beratKg: 0, jumlah: 0 };
      b.omzet += trx.total;
      b.beratKg += trx.beratKg;
      b.jumlah += 1;
      buckets.set(key, b);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tanggal, v]) => {
        const d = new Date(tanggal + "T00:00:00");
        const label = d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
        return {
          tanggal,
          label,
          omzet: v.omzet,
          beratKg: Number(v.beratKg.toFixed(3)),
          jumlah: v.jumlah,
        };
      });
  }, [riwayat, dariTanggal, sampaiTanggal]);

  const totalOmzetRentang = trenData.reduce((s, r) => s + r.omzet, 0);
  const totalBeratRentang = trenData.reduce((s, r) => s + r.beratKg, 0);
  const totalTrxRentang = trenData.reduce((s, r) => s + r.jumlah, 0);

  const setPreset = (n: number) => {
    setDariTanggal(daysAgoKey(n - 1));
    setSampaiTanggal(todayKey());
  };

  const exportCSV = () => {
    if (hariIni.length === 0) {
      setToast("Belum ada transaksi hari ini untuk diekspor");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const header = ["Waktu", "Produk", "Berat (kg)", "Harga per kg (IDR)", "Total (IDR)", "Sisa Stok (kg)"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = hariIni.map((t) =>
      [
        new Date(t.waktu).toLocaleString("id-ID"),
        t.produkNama,
        t.beratKg.toString().replace(".", ","),
        t.hargaPerKg.toString(),
        t.total.toString(),
        t.sisaStokKg.toString().replace(".", ","),
      ]
        .map((c) => escape(String(c)))
        .join(";")
    );
    const csv = "\uFEFF" + [header.map(escape).join(";"), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `ringkasan-pos-kasir-hari-ini-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast(`✅ Diekspor ${hariIni.length} transaksi hari ini ke CSV`);
    setTimeout(() => setToast(null), 2500);
  };

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

        <section className="bg-slate-800/50 backdrop-blur rounded-2xl p-3 sm:p-5 border border-slate-700 mb-6 min-w-0 overflow-hidden">
          <div className="flex flex-col gap-4 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                  📈 Tren Omzet & Berat Terjual
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {trenData.length > 0
                    ? `${trenData.length} hari · ${rupiah(totalOmzetRentang)} · ${totalBeratRentang.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg · ${totalTrxRentang} transaksi`
                    : "Pilih rentang tanggal yang valid"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { l: "7 hari", n: 7 },
                  { l: "14 hari", n: 14 },
                  { l: "30 hari", n: 30 },
                ].map((p) => (
                  <button
                    key={p.n}
                    onClick={() => setPreset(p.n)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-200"
                  >
                    {p.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Dari tanggal
                <input
                  type="date"
                  value={dariTanggal}
                  max={sampaiTanggal || undefined}
                  onChange={(e) => setDariTanggal(e.target.value)}
                  className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Sampai tanggal
                <input
                  type="date"
                  value={sampaiTanggal}
                  min={dariTanggal || undefined}
                  max={todayKey()}
                  onChange={(e) => setSampaiTanggal(e.target.value)}
                  className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </label>
            </div>
          </div>

          {trenData.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              Tidak ada data untuk rentang tanggal ini.
            </div>
          ) : (
            <div className="w-full min-w-0 h-64 sm:h-72 md:h-80">
              {/* L8: ResponsiveContainer + min-w-0 wrapper mencegah chart
                  melebar keluar container di 411px. Sumbu kanan (kg) dan
                  legend disempitkan di viewport kecil agar tidak overlap. */}
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trenData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis
                    yAxisId="left"
                    stroke="#34d399"
                    tick={{ fontSize: 10 }}
                    width={44}
                    tickFormatter={(v) =>
                      v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}jt` : v >= 1000 ? `${(v / 1000).toFixed(0)}rb` : `${v}`
                    }
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#60a5fa"
                    tick={{ fontSize: 10 }}
                    width={36}
                    tickFormatter={(v) => `${v}kg`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "#e2e8f0" }}
                    formatter={(value: number, name: string) => {
                      if (name === "Omzet") return [rupiah(value), name];
                      if (name === "Berat (kg)")
                        return [`${value.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`, name];
                      return [value, name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                  <Bar yAxisId="left" dataKey="omzet" name="Omzet" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="beratKg"
                    name="Berat (kg)"
                    stroke="#60a5fa"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Transaksi Hari Ini ({hariIni.length})
            </h2>
            <button
              onClick={exportCSV}
              disabled={hariIni.length === 0}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed border border-emerald-700 text-white font-medium"
            >
              ⬇ Ekspor CSV ({hariIni.length})
            </button>
          </div>
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

        {toast && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-slate-900 border border-slate-700 px-4 py-2.5 text-sm text-slate-100 shadow-lg">
            {toast}
          </div>
        )}
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
