import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { getPosKasirRiwayat, subscribePosKasirRiwayat } from "@/lib/pos-kasir";

const RingkasanChart = lazy(() =>
  import("@/components/pos-kasir/RingkasanChart").then((m) => ({ default: m.RingkasanChart })),
);

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
    <div className="min-h-screen bg-gradient-to-br from-background via-card to-background text-foreground p-ms-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-col gap-ms-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-ms-2xl md:text-ms-3xl font-bold tracking-tight">📊 Ringkasan POS Kasir</h1>
            <p className="text-ms-sm text-muted-foreground mt-1">
              Pantau omzet, berat terjual, dan jumlah transaksi hari ini
            </p>
          </div>
          <Link
            to="/pos-kasir"
            className="inline-flex items-center justify-center px-ms-4 py-ms-2 rounded-lg bg-success hover:bg-success text-success-foreground text-ms-sm font-medium transition-colors"
          >
            ⬅ Kembali ke Kasir
          </Link>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-ms-4 mb-6">
          <div className="bg-card/50 backdrop-blur rounded-2xl p-ms-5 border border-border">
            <div className="text-ms-xs text-muted-foreground uppercase tracking-wider">Omzet Hari Ini</div>
            <div className="text-ms-2xl md:text-ms-3xl font-bold text-success font-mono mt-2">
              {rupiah(omzetHariIni)}
            </div>
          </div>
          <div className="bg-card/50 backdrop-blur rounded-2xl p-ms-5 border border-border">
            <div className="text-ms-xs text-muted-foreground uppercase tracking-wider">Berat Terjual Hari Ini</div>
            <div className="text-ms-2xl md:text-ms-3xl font-bold text-blue-400 font-mono mt-2">
              {beratHariIni.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg
            </div>
          </div>
          <div className="bg-card/50 backdrop-blur rounded-2xl p-ms-5 border border-border">
            <div className="text-ms-xs text-muted-foreground uppercase tracking-wider">Jumlah Transaksi Hari Ini</div>
            <div className="text-ms-2xl md:text-ms-3xl font-bold text-warning font-mono mt-2">
              {jumlahHariIni}
            </div>
          </div>
        </div>

        <section className="bg-card/50 backdrop-blur rounded-2xl p-ms-3 sm:p-ms-5 border border-border mb-6 min-w-0 overflow-hidden">
          <div className="flex flex-col gap-ms-4 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-ms-3">
              <div>
                <h2 className="text-ms-sm font-semibold text-foreground uppercase tracking-wider">
                  📈 Tren Omzet & Berat Terjual
                </h2>
                <p className="text-ms-xs text-muted-foreground mt-1">
                  {trenData.length > 0
                    ? `${trenData.length} hari · ${rupiah(totalOmzetRentang)} · ${totalBeratRentang.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg · ${totalTrxRentang} transaksi`
                    : "Pilih rentang tanggal yang valid"}
                </p>
              </div>
              <div className="flex flex-wrap gap-ms-2">
                {[
                  { l: "7 hari", n: 7 },
                  { l: "14 hari", n: 14 },
                  { l: "30 hari", n: 30 },
                ].map((p) => (
                  <button
                    key={p.n}
                    onClick={() => setPreset(p.n)}
                    className="text-ms-xs px-ms-3 py-1.5 rounded-lg bg-background hover:bg-muted border border-border text-foreground"
                  >
                    {p.l}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-ms-3">
              <label className="flex flex-col gap-ms-1 text-ms-xs text-muted-foreground">
                Dari tanggal
                <input
                  type="date"
                  value={dariTanggal}
                  max={sampaiTanggal || undefined}
                  onChange={(e) => setDariTanggal(e.target.value)}
                  className="rounded-lg bg-background border border-border px-ms-3 py-ms-2 text-ms-sm text-foreground focus:outline-none focus:border-success"
                />
              </label>
              <label className="flex flex-col gap-ms-1 text-ms-xs text-muted-foreground">
                Sampai tanggal
                <input
                  type="date"
                  value={sampaiTanggal}
                  min={dariTanggal || undefined}
                  max={todayKey()}
                  onChange={(e) => setSampaiTanggal(e.target.value)}
                  className="rounded-lg bg-background border border-border px-ms-3 py-ms-2 text-ms-sm text-foreground focus:outline-none focus:border-success"
                />
              </label>
            </div>
          </div>

          {trenData.length === 0 ? (
            <div className="text-center py-8 text-ms-sm text-muted-foreground">
              Tidak ada data untuk rentang tanggal ini.
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="w-full h-64 sm:h-72 md:h-80 flex items-center justify-center text-ms-sm text-muted-foreground">
                  Memuat grafik…
                </div>
              }
            >
              <RingkasanChart data={trenData} />
            </Suspense>
          )}
        </section>

        <section className="bg-card/50 backdrop-blur rounded-2xl p-ms-5 border border-border">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-ms-3 mb-4">
            <h2 className="text-ms-sm font-semibold text-foreground uppercase tracking-wider">
              Transaksi Hari Ini ({hariIni.length})
            </h2>
            <button
              onClick={exportCSV}
              disabled={hariIni.length === 0}
              className="text-ms-xs px-ms-3 py-1.5 rounded-lg bg-success hover:bg-success disabled:bg-card disabled:text-muted-foreground disabled:cursor-not-allowed border border-success text-success-foreground font-medium"
            >
              ⬇ Ekspor CSV ({hariIni.length})
            </button>
          </div>
          {hariIni.length === 0 ? (
            <div className="text-center py-8 text-ms-sm text-muted-foreground">
              Belum ada transaksi hari ini. Lakukan penjualan di halaman POS Kasir.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-ms-sm">
                <thead>
                  <tr className="text-left text-ms-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="py-ms-2 pr-3 font-medium">Waktu</th>
                    <th className="py-ms-2 pr-3 font-medium">Produk</th>
                    <th className="py-ms-2 pr-3 font-medium text-right">Berat</th>
                    <th className="py-ms-2 pr-3 font-medium text-right">Total</th>
                    <th className="py-ms-2 font-medium text-right">Sisa Stok</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {hariIni.map((t) => (
                    <tr key={t.id} className="hover:bg-background/40">
                      <td className="py-ms-2 pr-3 font-mono text-ms-xs text-muted-foreground">
                        {waktuFmt.format(t.waktu)}
                      </td>
                      <td className="py-ms-2 pr-3">
                        <span className="mr-1.5">{t.produkEmoji}</span>
                        {t.produkNama}
                      </td>
                      <td className="py-ms-2 pr-3 text-right font-mono">
                        {t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg
                      </td>
                      <td className="py-ms-2 pr-3 text-right font-mono font-semibold text-success">
                        {rupiah(t.total)}
                      </td>
                      <td className="py-ms-2 text-right font-mono text-foreground">
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
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-background border border-border px-ms-4 py-ms-2.5 text-ms-sm text-foreground shadow-lg">
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
