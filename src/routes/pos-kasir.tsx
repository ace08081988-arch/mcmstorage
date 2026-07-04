import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

type Produk = {
  id: string;
  nama: string;
  emoji: string;
  hargaPerKg: number;
  stokKg: number;
};

const PRODUK_AWAL: Produk[] = [
  { id: "beras", nama: "Beras Premium", emoji: "🍚", hargaPerKg: 15000, stokKg: 50 },
  { id: "gula", nama: "Gula Pasir", emoji: "🍬", hargaPerKg: 14000, stokKg: 30 },
  { id: "tepung", nama: "Tepung Terigu", emoji: "🌾", hargaPerKg: 12000, stokKg: 25 },
  { id: "kacang", nama: "Kacang Hijau", emoji: "🫘", hargaPerKg: 22000, stokKg: 15 },
  { id: "garam", nama: "Garam Halus", emoji: "🧂", hargaPerKg: 8000, stokKg: 40 },
  { id: "kopi", nama: "Kopi Bubuk", emoji: "☕", hargaPerKg: 65000, stokKg: 10 },
];

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

type Transaksi = {
  id: string;
  produkId: string;
  produkNama: string;
  produkEmoji: string;
  beratKg: number;
  hargaPerKg: number;
  total: number;
  sisaStokKg: number;
  waktu: number;
};

const waktuFmt = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  day: "2-digit",
  month: "short",
});

function PosKasirPage() {
  const [produk, setProduk] = useState<Produk[]>(PRODUK_AWAL);
  const [selectedId, setSelectedId] = useState<string>(PRODUK_AWAL[0].id);
  const [beratStr, setBeratStr] = useState<string>("0");
  const [toast, setToast] = useState<string | null>(null);
  const [riwayat, setRiwayat] = useState<Transaksi[]>([]);

  const selected = produk.find((p) => p.id === selectedId)!;
  const berat = useMemo(() => {
    const n = parseFloat(beratStr.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [beratStr]);

  const total = berat * selected.hargaPerKg;
  const stokCukup = berat > 0 && berat <= selected.stokKg;

  const bayar = () => {
    if (!stokCukup) {
      setToast(berat <= 0 ? "Masukkan berat terlebih dahulu" : "Stok tidak mencukupi");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const sisaStokKg = +(selected.stokKg - berat).toFixed(3);
    setProduk((prev) =>
      prev.map((p) => (p.id === selected.id ? { ...p, stokKg: sisaStokKg } : p)),
    );
    setRiwayat((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        produkId: selected.id,
        produkNama: selected.nama,
        produkEmoji: selected.emoji,
        beratKg: berat,
        hargaPerKg: selected.hargaPerKg,
        total,
        sisaStokKg,
        waktu: Date.now(),
      },
      ...prev,
    ]);
    setToast(`✅ Transaksi berhasil · ${berat} kg ${selected.nama} · ${rupiah(total)}`);
    setBeratStr("0");
    setTimeout(() => setToast(null), 3500);
  };

  const totalOmzet = riwayat.reduce((s, t) => s + t.total, 0);
  const totalKg = riwayat.reduce((s, t) => s + t.beratKg, 0);

  // Format 7-segment display: 5 digit integer + 3 decimal
  const displayBerat = berat.toFixed(3).padStart(9, " ");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100 p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">🧾 POS Kasir · Produk Curah</h1>
            <p className="text-sm text-slate-400 mt-1">Simulasi timbangan digital & penjualan per kilogram</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Produk */}
          <section className="lg:col-span-2 space-y-6">
            <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Pilih Produk</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {produk.map((p) => {
                  const active = p.id === selectedId;
                  const habis = p.stokKg <= 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      disabled={habis}
                      className={`text-left p-4 rounded-xl border transition-all ${
                        active
                          ? "bg-emerald-500/20 border-emerald-400 shadow-lg shadow-emerald-500/20"
                          : "bg-slate-900/60 border-slate-700 hover:border-slate-500"
                      } ${habis ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      <div className="text-3xl mb-2">{p.emoji}</div>
                      <div className="font-semibold text-sm">{p.nama}</div>
                      <div className="text-xs text-slate-400 mt-1">{rupiah(p.hargaPerKg)}/kg</div>
                      <div className={`text-xs mt-2 ${p.stokKg < 5 ? "text-amber-400" : "text-slate-300"}`}>
                        Stok: {p.stokKg.toLocaleString("id-ID")} kg
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scale Display */}
            <div className="bg-gradient-to-b from-slate-950 to-black rounded-2xl p-6 border-2 border-slate-700 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono uppercase tracking-widest text-emerald-400">⚖ Timbangan Digital</span>
                <span className="flex gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] font-mono text-emerald-400">LIVE</span>
                </span>
              </div>
              <div className="bg-black rounded-xl p-6 border border-emerald-900/50 relative overflow-hidden">
                <div className="absolute inset-0 bg-emerald-500/5" />
                <div className="relative flex items-baseline justify-end gap-2">
                  <span
                    className="font-mono text-6xl md:text-7xl font-bold text-emerald-400 tabular-nums"
                    style={{ textShadow: "0 0 20px rgba(52,211,153,0.6)", fontFamily: "'Courier New', monospace" }}
                  >
                    {displayBerat}
                  </span>
                  <span className="text-2xl font-mono text-emerald-500">kg</span>
                </div>
                <div className="mt-3 pt-3 border-t border-emerald-900/40 flex justify-between text-xs font-mono text-emerald-500/70">
                  <span>PRODUK: {selected.nama.toUpperCase()}</span>
                  <span>@ {rupiah(selected.hargaPerKg)}/KG</span>
                </div>
              </div>

              <div className="mt-5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Input Berat (kg)
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={beratStr}
                  onChange={(e) => setBeratStr(e.target.value)}
                  className="mt-2 w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-lg font-mono focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                  placeholder="0.000"
                />
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[0.25, 0.5, 1, 2].map((v) => (
                    <button
                      key={v}
                      onClick={() => setBeratStr(String((berat + v).toFixed(3)))}
                      className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium"
                    >
                      +{v} kg
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setBeratStr("0")}
                  className="mt-2 w-full py-2 rounded-lg bg-slate-800/50 hover:bg-slate-800 border border-slate-700 text-xs text-slate-400"
                >
                  Reset (Tara)
                </button>
              </div>
            </div>
          </section>

          {/* Right: Ringkasan & Bayar */}
          <aside className="space-y-4">
            <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700 sticky top-4">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">Ringkasan</h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Produk</span>
                  <span className="font-medium">{selected.emoji} {selected.nama}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Harga/kg</span>
                  <span className="font-mono">{rupiah(selected.hargaPerKg)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Berat</span>
                  <span className="font-mono">{berat.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Stok saat ini</span>
                  <span className={`font-mono ${!stokCukup && berat > 0 ? "text-red-400" : ""}`}>
                    {selected.stokKg.toLocaleString("id-ID")} kg
                  </span>
                </div>
                <div className="border-t border-slate-700 pt-3 flex justify-between items-baseline">
                  <span className="text-slate-300 font-semibold">TOTAL</span>
                  <span className="text-2xl font-bold text-emerald-400 font-mono">{rupiah(total)}</span>
                </div>
              </div>

              {berat > 0 && !stokCukup && (
                <div className="mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                  ⚠ Stok tidak mencukupi ({selected.stokKg} kg tersedia)
                </div>
              )}

              <button
                onClick={bayar}
                disabled={!stokCukup}
                className="mt-5 w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed font-bold text-lg shadow-lg shadow-emerald-500/30 transition-all"
              >
                💳 Bayar
              </button>
              <p className="mt-2 text-[11px] text-slate-500 text-center">
                Stok akan otomatis berkurang setelah pembayaran
              </p>
            </div>
          </aside>
        </div>

        {/* Riwayat Transaksi */}
        <section className="mt-6 bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                📋 Riwayat Transaksi
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {riwayat.length} transaksi · {totalKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg · omzet {rupiah(totalOmzet)}
              </p>
            </div>
            {riwayat.length > 0 && (
              <button
                onClick={() => setRiwayat([])}
                className="text-xs px-3 py-1.5 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-700 text-slate-400"
              >
                Bersihkan
              </button>
            )}
          </div>

          {riwayat.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              Belum ada transaksi. Lakukan pembayaran untuk melihat riwayat di sini.
            </div>
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="grid gap-2 md:hidden">
                {riwayat.map((t) => (
                  <div key={t.id} className="rounded-xl bg-slate-900/60 border border-slate-700 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{t.produkEmoji}</span>
                        <div>
                          <div className="text-sm font-medium">{t.produkNama}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            {waktuFmt.format(t.waktu)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-emerald-400 font-mono font-semibold text-sm">
                          {rupiah(t.total)}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-800 flex justify-between text-[11px] text-slate-500">
                      <span>@ {rupiah(t.hargaPerKg)}/kg</span>
                      <span>Sisa stok: <span className="text-slate-300 font-mono">{t.sisaStokKg.toLocaleString("id-ID")} kg</span></span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-700">
                      <th className="py-2 pr-3 font-medium">Waktu</th>
                      <th className="py-2 pr-3 font-medium">Produk</th>
                      <th className="py-2 pr-3 font-medium text-right">Berat</th>
                      <th className="py-2 pr-3 font-medium text-right">Harga/kg</th>
                      <th className="py-2 pr-3 font-medium text-right">Total</th>
                      <th className="py-2 font-medium text-right">Sisa Stok</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {riwayat.map((t) => (
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
                        <td className="py-2 pr-3 text-right font-mono text-slate-400">
                          {rupiah(t.hargaPerKg)}
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
            </>
          )}
        </section>

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 border border-emerald-500/50 rounded-xl px-5 py-3 shadow-2xl text-sm z-50 animate-in fade-in slide-in-from-bottom-4">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/pos-kasir")({
  head: () => ({
    meta: [
      { title: "POS Kasir Curah · Simulasi Timbangan Digital" },
      { name: "description", content: "Kasir produk curah dengan simulasi layar timbangan digital real-time dan pengurangan stok otomatis." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PosKasirPage,
});