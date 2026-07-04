import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getPosKasirRiwayat,
  setPosKasirRiwayat,
  PRODUK_AWAL,
  type PosKasirProduk,
  type PosKasirTransaksi,
} from "@/lib/pos-kasir";
import { normalizeWaNumber, formatWaDisplay } from "@/lib/phone";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

const waktuFmt = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  day: "2-digit",
  month: "short",
});

const QUICK_WEIGHTS = [0.1, 0.25, 0.5, 1, 2];

const AMBANG_STORAGE_KEY = "mcm-pos-kasir-ambang-stok";
const AMBANG_DEFAULT = 5;

type StokLevel = "habis" | "kritis" | "menipis" | "aman";

function levelStok(stokKg: number, ambang: number): StokLevel {
  if (stokKg <= 0) return "habis";
  if (stokKg <= ambang / 2) return "kritis";
  if (stokKg <= ambang) return "menipis";
  return "aman";
}

const LEVEL_META: Record<StokLevel, { label: string; badge: string; text: string; ring: string; emoji: string }> = {
  habis:   { label: "Habis",   badge: "bg-slate-700 text-slate-200 border-slate-600", text: "text-slate-400", ring: "ring-1 ring-slate-600",       emoji: "⛔" },
  kritis:  { label: "Kritis",  badge: "bg-rose-500/20 text-rose-300 border-rose-500/40", text: "text-rose-300", ring: "ring-2 ring-rose-500/60 animate-pulse", emoji: "🚨" },
  menipis: { label: "Menipis", badge: "bg-amber-500/20 text-amber-300 border-amber-500/40", text: "text-amber-300", ring: "ring-1 ring-amber-500/40", emoji: "⚠" },
  aman:    { label: "Aman",    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", text: "text-slate-300", ring: "", emoji: "" },
};

function PosKasirPage() {
  const [produk, setProduk] = useState<PosKasirProduk[]>(PRODUK_AWAL);
  const [selectedId, setSelectedId] = useState<string>(PRODUK_AWAL[0].id);
  const [beratStr, setBeratStr] = useState<string>("0");
  const [toast, setToast] = useState<string | null>(null);
  const [riwayat, setRiwayat] = useState<PosKasirTransaksi[]>(() => getPosKasirRiwayat());
  const [dariTgl, setDariTgl] = useState<string>("");
  const [sampaiTgl, setSampaiTgl] = useState<string>("");
  const [cariTransaksi, setCariTransaksi] = useState<string>("");
  const [swipeDx, setSwipeDx] = useState<number>(0);
  const swipeStartX = useRef<number | null>(null);
  const [strukTransaksi, setStrukTransaksi] = useState<PosKasirTransaksi | null>(null);
  const [waNomor, setWaNomor] = useState<string>("");
  const [waLokasi, setWaLokasi] = useState<string>("");
  const [ambangStok, setAmbangStok] = useState<number>(() => {
    if (typeof window === "undefined") return AMBANG_DEFAULT;
    const raw = localStorage.getItem(AMBANG_STORAGE_KEY);
    const n = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : AMBANG_DEFAULT;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(AMBANG_STORAGE_KEY, String(ambangStok));
  }, [ambangStok]);

  const waNomorNorm = useMemo(() => normalizeWaNumber(waNomor, "ID"), [waNomor]);
  const waNomorDisplay = useMemo(
    () => (waNomorNorm ? formatWaDisplay(waNomorNorm, "ID") : ""),
    [waNomorNorm],
  );
  const waLokasiTrim = waLokasi.trim();
  const waLokasiValid = useMemo(() => {
    if (!waLokasiTrim) return false;
    if (waLokasiTrim.length > 500) return false;
    try {
      const u = new URL(waLokasiTrim);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, [waLokasiTrim]);
  const waNomorError = waNomor.trim() === ""
    ? "Nomor WA wajib diisi"
    : !waNomorNorm
      ? "Nomor tidak valid (harus 8–15 digit, contoh: 0812… / 62812…)"
      : "";
  const waLokasiError = waLokasiTrim === ""
    ? "Lokasi (URL) wajib diisi"
    : !waLokasiValid
      ? "Lokasi harus berupa URL http(s):// yang sah (mis. link Google Maps)"
      : "";
  const waReady = !!waNomorNorm && waLokasiValid;
  const waDisabledReason = !waNomorNorm
    ? waNomorError
    : !waLokasiValid
      ? waLokasiError
      : "";

  const buildStrukText = (t: PosKasirTransaksi, withLokasi: boolean): string => {
    const lines = [
      "🧾 *Struk POS Kasir*",
      `${t.produkEmoji} ${t.produkNama}`,
      `Berat: ${t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`,
      `Harga: ${rupiah(t.hargaPerKg)}/kg`,
      `Total: *${rupiah(t.total)}*`,
      `Sisa stok: ${t.sisaStokKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`,
      `Waktu: ${new Date(t.waktu).toLocaleString("id-ID")}`,
    ];
    if (withLokasi && waLokasiValid) {
      lines.push("", `📍 Lokasi: ${waLokasiTrim}`);
    }
    return lines.join("\n");
  };

  const buildWaUrl = (t: PosKasirTransaksi): string | null => {
    if (!waNomorNorm || !waLokasiValid) return null;
    return `https://wa.me/${waNomorNorm}?text=${encodeURIComponent(buildStrukText(t, true))}`;
  };

  const salinStruk = async (t: PosKasirTransaksi) => {
    const text = buildStrukText(t, waLokasiValid);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setToast("📋 Ringkasan struk disalin");
    } catch {
      setToast("Gagal menyalin ringkasan");
    }
    setTimeout(() => setToast(null), 2500);
  };

  const kirimWa = (t: PosKasirTransaksi) => {
    const url = buildWaUrl(t);
    if (!url) {
      setToast(waDisabledReason || "Lengkapi nomor & lokasi WA");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    setPosKasirRiwayat(riwayat);
  }, [riwayat]);

  const selected = produk.find((p) => p.id === selectedId)!;
  const berat = useMemo(() => {
    const n = parseFloat(beratStr.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [beratStr]);

  const total = berat * selected.hargaPerKg;
  const stokCukup = berat > 0 && berat <= selected.stokKg;

  const totalStok = useMemo(() => produk.reduce((s, p) => s + p.stokKg, 0), [produk]);
  const produkKritis = useMemo(
    () => produk.filter((p) => levelStok(p.stokKg, ambangStok) === "kritis"),
    [produk, ambangStok],
  );
  const produkMenipis = useMemo(
    () => produk.filter((p) => levelStok(p.stokKg, ambangStok) === "menipis"),
    [produk, ambangStok],
  );
  const produkHabis = useMemo(
    () => produk.filter((p) => levelStok(p.stokKg, ambangStok) === "habis"),
    [produk, ambangStok],
  );

  const bayar = () => {
    if (!stokCukup) {
      setToast(berat <= 0 ? "Masukkan berat terlebih dahulu" : "Stok tidak mencukupi");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const sisaStokKg = +(selected.stokKg - berat).toFixed(3);
    const levelSebelum = levelStok(selected.stokKg, ambangStok);
    const levelSesudah = levelStok(sisaStokKg, ambangStok);
    setProduk((prev) => prev.map((p) => (p.id === selected.id ? { ...p, stokKg: sisaStokKg } : p)));
    const trxBaru: PosKasirTransaksi = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      produkId: selected.id,
      produkNama: selected.nama,
      produkEmoji: selected.emoji,
      beratKg: berat,
      hargaPerKg: selected.hargaPerKg,
      total,
      sisaStokKg,
      waktu: Date.now(),
    };
    setRiwayat((prev) => [trxBaru, ...prev]);
    setStrukTransaksi(trxBaru);
    let pesan = `✅ Transaksi berhasil · ${berat} kg ${selected.nama} · ${rupiah(total)}`;
    if (levelSesudah !== levelSebelum && levelSesudah !== "aman") {
      const meta = LEVEL_META[levelSesudah];
      pesan += ` · ${meta.emoji} Stok ${selected.nama} kini ${meta.label.toLowerCase()} (${sisaStokKg.toLocaleString("id-ID")} kg)`;
    }
    setToast(pesan);
    setBeratStr("0");
    setTimeout(() => setToast(null), 4500);
  };

  const batalkanTransaksi = (t: PosKasirTransaksi) => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Batalkan transaksi ${t.produkNama} (${t.beratKg.toLocaleString("id-ID")} kg · ${rupiah(t.total)})?\nStok akan dikembalikan.`,
      );
      if (!ok) return;
    }
    setProduk((prev) =>
      prev.map((p) =>
        p.id === t.produkId ? { ...p, stokKg: +(p.stokKg + t.beratKg).toFixed(3) } : p,
      ),
    );
    setRiwayat((prev) => prev.filter((r) => r.id !== t.id));
    setSwipeDx(0);
    swipeStartX.current = null;
    setToast(`↶ Transaksi dibatalkan · ${t.produkNama} · ${rupiah(t.total)} dikembalikan`);
    setTimeout(() => setToast(null), 3500);
  };

  const totalOmzet = riwayat.reduce((s, t) => s + t.total, 0);
  const totalKg = riwayat.reduce((s, t) => s + t.beratKg, 0);

  const riwayatFiltered = useMemo(() => {
    const dari = dariTgl ? new Date(dariTgl + "T00:00:00").getTime() : -Infinity;
    const sampai = sampaiTgl ? new Date(sampaiTgl + "T23:59:59.999").getTime() : Infinity;
    return riwayat.filter((t) => t.waktu >= dari && t.waktu <= sampai);
  }, [riwayat, dariTgl, sampaiTgl]);

  const riwayatCariMobile = useMemo(() => {
    const q = cariTransaksi.trim().toLowerCase();
    if (!q) return riwayatFiltered;
    return riwayatFiltered.filter(
      (t) =>
        t.produkNama.toLowerCase().includes(q) ||
        waktuFmt.format(t.waktu).toLowerCase().includes(q),
    );
  }, [riwayatFiltered, cariTransaksi]);

  const exportCSV = () => {
    if (riwayatFiltered.length === 0) {
      setToast("Tidak ada transaksi pada rentang tanggal terpilih");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const header = ["Waktu", "Produk", "Berat (kg)", "Harga per kg (IDR)", "Total (IDR)", "Sisa Stok (kg)"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = riwayatFiltered.map((t) =>
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
    a.download = `riwayat-pos-kasir-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast(`✅ Diekspor ${riwayatFiltered.length} transaksi ke CSV`);
    setTimeout(() => setToast(null), 2500);
  };

  const exportPDF = () => {
    if (riwayatFiltered.length === 0) {
      setToast("Tidak ada transaksi pada rentang tanggal terpilih");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    const totalOmzetF = riwayatFiltered.reduce((s, t) => s + t.total, 0);
    const totalKgF = riwayatFiltered.reduce((s, t) => s + t.beratKg, 0);
    const rangeLabel =
      dariTgl || sampaiTgl
        ? `Periode: ${dariTgl || "awal"} s/d ${sampaiTgl || "sekarang"}`
        : "Periode: seluruh riwayat";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Laporan Riwayat POS Kasir", 40, 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(rangeLabel, 40, 58);
    doc.text(`Dibuat: ${now.toLocaleString("id-ID")}`, 40, 72);
    doc.text(
      `Total transaksi: ${riwayatFiltered.length}  ·  Total berat: ${totalKgF.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg  ·  Omzet: ${rupiah(totalOmzetF)}`,
      40,
      86,
    );

    autoTable(doc, {
      startY: 100,
      head: [["Waktu", "Produk", "Berat (kg)", "Harga/kg", "Total", "Sisa Stok"]],
      body: riwayatFiltered.map((t) => [
        new Date(t.waktu).toLocaleString("id-ID"),
        `${t.produkEmoji} ${t.produkNama}`,
        t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 }),
        rupiah(t.hargaPerKg),
        rupiah(t.total),
        `${t.sisaStokKg.toLocaleString("id-ID")} kg`,
      ]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
      margin: { left: 40, right: 40 },
      didDrawPage: (data) => {
        const pageCount = doc.getNumberOfPages();
        const pageSize = doc.internal.pageSize;
        const pageHeight = pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          `Halaman ${data.pageNumber} / ${pageCount}`,
          pageSize.getWidth() - 40,
          pageHeight - 20,
          { align: "right" },
        );
        doc.setTextColor(0);
      },
    });

    doc.save(`riwayat-pos-kasir-${stamp}.pdf`);
    setToast(`✅ Diekspor ${riwayatFiltered.length} transaksi ke PDF`);
    setTimeout(() => setToast(null), 2500);
  };

  const displayBerat = berat.toFixed(3).padStart(9, " ");

  const addBerat = (delta: number) => {
    const next = Math.max(0, +(berat + delta).toFixed(3));
    setBeratStr(String(next));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100 p-3 md:p-8">
      <div className="mx-auto max-w-6xl">
        {/* Mobile header */}
        <header className="md:hidden mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">🧾 POS Kasir</h1>
            <p className="truncate text-xs text-slate-400 mt-0.5">
              {riwayat.length} transaksi · {totalKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg
            </p>
          </div>
          <Link
            to="/pos-kasir/ringkasan"
            className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors"
          >
            📊 Ringkasan
          </Link>
        </header>

        {/* Desktop header */}
        <header className="hidden md:flex mb-6 items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">🧾 POS Kasir · Produk Curah</h1>
            <p className="text-sm text-slate-400 mt-1">Simulasi timbangan digital & penjualan per kilogram</p>
          </div>
          <Link
            to="/pos-kasir/ringkasan"
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
          >
            📊 Ringkasan
          </Link>
        </header>

        {/* Mobile stock summary */}
        <section className="md:hidden mb-4 bg-slate-800/50 backdrop-blur rounded-xl p-3 border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Stok Tersisa</span>
            <span className="text-xs text-slate-400">{totalStok.toLocaleString("id-ID")} kg total</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {produk.map((p) => {
              const active = p.id === selectedId;
              const level = levelStok(p.stokKg, ambangStok);
              const meta = LEVEL_META[level];
              const habis = level === "habis";
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  disabled={habis}
                  className={`relative shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${meta.ring} ${
                    active
                      ? "bg-emerald-500/20 border-emerald-400"
                      : "bg-slate-900/60 border-slate-700 hover:border-slate-500"
                  } ${habis ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  <span className="text-lg">{p.emoji}</span>
                  <div className="text-left min-w-0">
                    <div className="font-medium truncate max-w-[80px]">{p.nama}</div>
                    <div className={`font-mono ${level === "aman" ? "text-slate-400" : meta.text}`}>
                      {p.stokKg.toLocaleString("id-ID")} kg
                    </div>
                  </div>
                  {level !== "aman" && (
                    <span
                      aria-label={`Stok ${meta.label}`}
                      className={`absolute -top-1.5 -right-1.5 text-[10px] leading-none px-1.5 py-0.5 rounded-full border ${meta.badge}`}
                    >
                      {meta.emoji}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {produkKritis.length > 0 && (
              <div className="text-[11px] text-rose-300">
                🚨 Stok kritis: {produkKritis.map((p) => `${p.emoji} ${p.nama} (${p.stokKg}kg)`).join(", ")}
              </div>
            )}
            {produkMenipis.length > 0 && (
              <div className="text-[11px] text-amber-300">
                ⚠ Stok menipis: {produkMenipis.map((p) => `${p.emoji} ${p.nama} (${p.stokKg}kg)`).join(", ")}
              </div>
            )}
            {produkHabis.length > 0 && (
              <div className="text-[11px] text-slate-400">
                ⛔ Habis: {produkHabis.map((p) => `${p.emoji} ${p.nama}`).join(", ")}
              </div>
            )}
            <label className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
              Ambang notifikasi
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={ambangStok}
                onChange={(e) => {
                  const n = parseFloat(e.target.value.replace(",", "."));
                  if (Number.isFinite(n) && n > 0) setAmbangStok(n);
                }}
                className="w-16 rounded-md bg-slate-900 border border-slate-700 px-2 py-0.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              kg
            </label>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Main */}
          <section className="lg:col-span-2 space-y-4 md:space-y-6">
            {/* Desktop product grid */}
            <div className="hidden md:block bg-slate-800/50 backdrop-blur rounded-2xl p-5 border border-slate-700">
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Pilih Produk</h2>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  Ambang notifikasi
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={ambangStok}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value.replace(",", "."));
                      if (Number.isFinite(n) && n > 0) setAmbangStok(n);
                    }}
                    className="w-20 rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                  kg
                </label>
              </div>
              {(produkKritis.length > 0 || produkMenipis.length > 0 || produkHabis.length > 0) && (
                <div className="mb-3 flex flex-col gap-1 text-xs">
                  {produkKritis.length > 0 && (
                    <div className="text-rose-300">
                      🚨 Kritis: {produkKritis.map((p) => `${p.emoji} ${p.nama} (${p.stokKg}kg)`).join(", ")}
                    </div>
                  )}
                  {produkMenipis.length > 0 && (
                    <div className="text-amber-300">
                      ⚠ Menipis: {produkMenipis.map((p) => `${p.emoji} ${p.nama} (${p.stokKg}kg)`).join(", ")}
                    </div>
                  )}
                  {produkHabis.length > 0 && (
                    <div className="text-slate-400">
                      ⛔ Habis: {produkHabis.map((p) => `${p.emoji} ${p.nama}`).join(", ")}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {produk.map((p) => {
                  const active = p.id === selectedId;
                  const level = levelStok(p.stokKg, ambangStok);
                  const meta = LEVEL_META[level];
                  const habis = level === "habis";
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      disabled={habis}
                      className={`relative text-left p-4 rounded-xl border transition-all ${meta.ring} ${
                        active
                          ? "bg-emerald-500/20 border-emerald-400 shadow-lg shadow-emerald-500/20"
                          : "bg-slate-900/60 border-slate-700 hover:border-slate-500"
                      } ${habis ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      <div className="text-3xl mb-2">{p.emoji}</div>
                      <div className="font-semibold text-sm">{p.nama}</div>
                      <div className="text-xs text-slate-400 mt-1">{rupiah(p.hargaPerKg)}/kg</div>
                      <div className={`text-xs mt-2 ${meta.text}`}>
                        Stok: {p.stokKg.toLocaleString("id-ID")} kg
                      </div>
                      {level !== "aman" && (
                        <span
                          aria-label={`Stok ${meta.label}`}
                          className={`absolute top-2 right-2 text-[10px] font-medium leading-none px-2 py-1 rounded-full border ${meta.badge}`}
                        >
                          {meta.emoji} {meta.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mobile scale */}
            <div className="md:hidden bg-gradient-to-b from-slate-950 to-black rounded-2xl p-4 border-2 border-slate-700 shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono uppercase tracking-widest text-emerald-400">⚖ Timbangan</span>
                <span className="text-xs text-slate-400 truncate">
                  {selected.emoji} {selected.nama}
                </span>
              </div>
              <div className="bg-black rounded-xl p-4 border border-emerald-900/50 relative overflow-hidden">
                <div className="absolute inset-0 bg-emerald-500/5" />
                <div className="relative flex items-baseline justify-end gap-2">
                  <span
                    className="font-mono text-5xl font-bold text-emerald-400 tabular-nums"
                    style={{ textShadow: "0 0 20px rgba(52,211,153,0.6)", fontFamily: "'Courier New', monospace" }}
                  >
                    {displayBerat}
                  </span>
                  <span className="text-xl font-mono text-emerald-500">kg</span>
                </div>
                <div className="mt-2 pt-2 border-t border-emerald-900/40 flex justify-between text-xs font-mono text-emerald-500/70">
                  <span>@ {rupiah(selected.hargaPerKg)}/KG</span>
                  <span>TOTAL {rupiah(total)}</span>
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Input Berat (kg)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max={selected.stokKg}
                  value={beratStr}
                  onChange={(e) => setBeratStr(e.target.value)}
                  className={`mt-2 w-full bg-slate-900 border rounded-lg px-3 py-2.5 text-base font-mono focus:outline-none focus:ring-2 transition-colors ${
                    berat > selected.stokKg
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500/30 text-red-300"
                      : "border-slate-700 focus:border-emerald-400 focus:ring-emerald-400/30"
                  }`}
                  placeholder="0.000"
                />
                {berat > selected.stokKg && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-500/15 border border-red-500/40 p-2 text-xs text-red-200">
                    <span className="shrink-0 text-red-400">⚠</span>
                    <div>
                      Melebihi stok {selected.stokKg.toLocaleString("id-ID")} kg.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Mobile quick buttons */}
            <div className="md:hidden space-y-2">
              <div className="grid grid-cols-5 gap-2">
                {QUICK_WEIGHTS.map((v) => {
                  const wouldExceed = berat + v > selected.stokKg;
                  return (
                    <button
                      key={v}
                      onClick={() => addBerat(v)}
                      disabled={wouldExceed}
                      className={`py-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                        wouldExceed
                          ? "bg-slate-800/50 border-slate-800 text-slate-600 cursor-not-allowed"
                          : "bg-slate-800 hover:bg-slate-700 border-slate-700 active:bg-emerald-600/30"
                      }`}
                    >
                      +{v}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => addBerat(-0.25)}
                  disabled={berat <= 0}
                  className="py-2.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold disabled:opacity-50 active:bg-slate-700"
                >
                  -0.25
                </button>
                <button
                  onClick={() => setBeratStr("0")}
                  className="py-2.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-400 active:bg-slate-700"
                >
                  Reset
                </button>
                <button
                  onClick={bayar}
                  disabled={!stokCukup}
                  className="py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-xs font-bold text-white shadow-lg shadow-emerald-500/30 active:scale-95 transition-transform"
                >
                  Bayar
                </button>
              </div>
            </div>

            {/* Desktop scale */}
            <div className="hidden md:block bg-gradient-to-b from-slate-950 to-black rounded-2xl p-6 border-2 border-slate-700 shadow-2xl">
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
                  max={selected.stokKg}
                  value={beratStr}
                  onChange={(e) => setBeratStr(e.target.value)}
                  className={`mt-2 w-full bg-slate-900 border rounded-lg px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 transition-colors ${
                    berat > selected.stokKg
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500/30 text-red-300"
                      : "border-slate-700 focus:border-emerald-400 focus:ring-emerald-400/30"
                  }`}
                  placeholder="0.000"
                />
                {berat > selected.stokKg && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/15 border border-red-500/40 p-3 text-sm text-red-200">
                    <span className="shrink-0 text-red-400">⚠</span>
                    <div>
                      <p className="font-semibold">Berat melebihi stok</p>
                      <p className="text-xs text-red-300/80 mt-0.5">
                        Stok {selected.nama} tersedia {selected.stokKg.toLocaleString("id-ID")} kg.
                      </p>
                      <p className="text-xs text-red-300/80 mt-0.5">
                        Kurangi berat agar tidak melebihi stok yang ada.
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[0.25, 0.5, 1, 2].map((v) => {
                    const wouldExceed = berat + v > selected.stokKg;
                    return (
                      <button
                        key={v}
                        onClick={() => addBerat(v)}
                        disabled={wouldExceed}
                        className={`py-2 rounded-lg border text-sm font-medium transition-colors ${
                          wouldExceed
                            ? "bg-slate-800/50 border-slate-800 text-slate-600 cursor-not-allowed"
                            : "bg-slate-800 hover:bg-slate-700 border-slate-700"
                        }`}
                      >
                        +{v} kg
                      </button>
                    );
                  })}
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

          {/* Desktop summary */}
          <aside className="hidden md:block space-y-4">
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
                <div className="mt-3 p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-sm text-red-200">
                  <p className="font-semibold">⚠ Stok tidak mencukupi</p>
                  <p className="text-xs text-red-300/80 mt-0.5">
                    Tersedia {selected.stokKg.toLocaleString("id-ID")} kg, butuh{" "}
                    {berat.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg. Kurangi berat untuk melanjutkan pembayaran.
                  </p>
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
        <section className="mt-4 md:mt-6 bg-slate-800/50 backdrop-blur rounded-2xl p-4 md:p-5 border border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                📋 Riwayat Transaksi
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {riwayat.length} transaksi · {totalKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg · omzet {rupiah(totalOmzet)}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-[10px] uppercase tracking-wider text-slate-500">
                Dari
                <input
                  type="date"
                  value={dariTgl}
                  onChange={(e) => setDariTgl(e.target.value)}
                  className="mt-1 text-xs px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700 text-slate-200"
                />
              </label>
              <label className="flex flex-col text-[10px] uppercase tracking-wider text-slate-500">
                Sampai
                <input
                  type="date"
                  value={sampaiTgl}
                  onChange={(e) => setSampaiTgl(e.target.value)}
                  className="mt-1 text-xs px-2 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700 text-slate-200"
                />
              </label>
              {(dariTgl || sampaiTgl) && (
                <button
                  onClick={() => {
                    setDariTgl("");
                    setSampaiTgl("");
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-700 text-slate-400"
                >
                  Reset
                </button>
              )}
              <button
                onClick={exportCSV}
                disabled={riwayatFiltered.length === 0}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed border border-emerald-700 text-white font-medium"
              >
                ⬇ Ekspor CSV ({riwayatFiltered.length})
              </button>
              <button
                onClick={exportPDF}
                disabled={riwayatFiltered.length === 0}
                className="text-xs px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed border border-rose-700 text-white font-medium"
              >
                📄 Ekspor PDF ({riwayatFiltered.length})
              </button>
              {riwayat.length > 0 && (
                <button
                  onClick={() => setRiwayat([])}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-700 text-slate-400"
                >
                  Bersihkan
                </button>
              )}
            </div>
          </div>

          {riwayatFiltered.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              {riwayat.length === 0
                ? "Belum ada transaksi. Lakukan pembayaran untuk melihat riwayat di sini."
                : "Tidak ada transaksi pada rentang tanggal terpilih."}
            </div>
          ) : (
            <>
              {/* WA share form */}
              <div className="mb-4 rounded-xl border border-slate-700 bg-slate-900/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    💬 Kirim Struk via WA
                  </span>
                  {waReady ? (
                    <span className="text-[11px] text-emerald-400 font-mono truncate">
                      → {waNomorDisplay}
                    </span>
                  ) : (
                    <span className="text-[11px] text-amber-400">Lengkapi nomor & lokasi</span>
                  )}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500">
                      Nomor WA tujuan
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      value={waNomor}
                      onChange={(e) => setWaNomor(e.target.value)}
                      placeholder="0812… atau 62812…"
                      aria-invalid={!!waNomor && !waNomorNorm}
                      className={`mt-1 w-full text-sm px-3 py-2 rounded-lg bg-slate-900/60 border text-slate-100 font-mono focus:outline-none focus:ring-2 ${
                        waNomor && !waNomorNorm
                          ? "border-red-500/60 focus:border-red-500 focus:ring-red-500/30"
                          : "border-slate-700 focus:border-emerald-400 focus:ring-emerald-400/30"
                      }`}
                    />
                    {waNomorError && waNomor.trim() !== "" && (
                      <p className="mt-1 text-[11px] text-red-300">{waNomorError}</p>
                    )}
                    {!waNomorError && waNomorDisplay && (
                      <p className="mt-1 text-[11px] text-slate-400 font-mono">
                        Terformat: {waNomorDisplay}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500">
                      Lokasi (URL Maps / http-https)
                    </label>
                    <input
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      value={waLokasi}
                      onChange={(e) => setWaLokasi(e.target.value)}
                      placeholder="https://maps.google.com/…"
                      maxLength={500}
                      aria-invalid={!!waLokasiTrim && !waLokasiValid}
                      className={`mt-1 w-full text-sm px-3 py-2 rounded-lg bg-slate-900/60 border text-slate-100 focus:outline-none focus:ring-2 ${
                        waLokasiTrim && !waLokasiValid
                          ? "border-red-500/60 focus:border-red-500 focus:ring-red-500/30"
                          : "border-slate-700 focus:border-emerald-400 focus:ring-emerald-400/30"
                      }`}
                    />
                    {waLokasiError && waLokasiTrim !== "" && (
                      <p className="mt-1 text-[11px] text-red-300">{waLokasiError}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Mobile: card list */}
              <div className="grid gap-2 md:hidden">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">🔍</span>
                  <input
                    type="search"
                    inputMode="search"
                    value={cariTransaksi}
                    onChange={(e) => setCariTransaksi(e.target.value)}
                    placeholder="Cari nama produk atau waktu…"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                  />
                </div>
                {riwayatCariMobile.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-500">
                    Tidak ada transaksi yang cocok dengan pencarian.
                  </div>
                ) : (
                  riwayatCariMobile.map((t) => {
                    const isTerakhir = riwayat[0]?.id === t.id;
                    const dx = isTerakhir ? swipeDx : 0;
                    const revealed = dx < -60;
                    return (
                    <div key={t.id} className="relative overflow-hidden rounded-xl">
                      {isTerakhir && (
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 bg-rose-600/90 rounded-xl">
                          <button
                            type="button"
                            onClick={() => batalkanTransaksi(t)}
                            className="text-white text-xs font-semibold px-3 py-1.5 rounded-md bg-rose-700 hover:bg-rose-800"
                          >
                            ↶ Batalkan
                          </button>
                        </div>
                      )}
                      <div
                        className="rounded-xl bg-slate-900/60 border border-slate-700 p-3 relative transition-transform touch-pan-y"
                        style={{ transform: `translateX(${dx}px)` }}
                        onTouchStart={(e) => {
                          if (!isTerakhir) return;
                          swipeStartX.current = e.touches[0].clientX;
                        }}
                        onTouchMove={(e) => {
                          if (!isTerakhir || swipeStartX.current === null) return;
                          const delta = e.touches[0].clientX - swipeStartX.current;
                          setSwipeDx(Math.min(0, Math.max(-140, delta)));
                        }}
                        onTouchEnd={() => {
                          if (!isTerakhir) return;
                          swipeStartX.current = null;
                          if (swipeDx < -100) {
                            batalkanTransaksi(t);
                          } else if (swipeDx < -60) {
                            setSwipeDx(-90);
                          } else {
                            setSwipeDx(0);
                          }
                        }}
                      >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-xl shrink-0">{t.produkEmoji}</span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{t.produkNama}</div>
                            <div className="text-[11px] text-slate-500 font-mono">{waktuFmt.format(t.waktu)}</div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-emerald-400 font-mono font-semibold text-sm">{rupiah(t.total)}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-800 flex justify-between text-[11px] text-slate-500">
                        <span>@ {rupiah(t.hargaPerKg)}/kg</span>
                        <span>
                          Sisa:{" "}
                          <span className="text-slate-300 font-mono">{t.sisaStokKg.toLocaleString("id-ID")} kg</span>
                        </span>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => kirimWa(t)}
                          disabled={!waReady}
                          title={waDisabledReason || `Kirim struk ke ${waNomorDisplay}`}
                          aria-disabled={!waReady}
                          className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white transition-colors"
                        >
                          💬 Kirim WA
                        </button>
                        {isTerakhir && (
                          <button
                            type="button"
                            onClick={() => batalkanTransaksi(t)}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors"
                            title="Batalkan transaksi terakhir & kembalikan stok"
                          >
                            ↶ Batalkan
                          </button>
                        )}
                      </div>
                      {isTerakhir && (
                        <div className="mt-1 text-[10px] text-slate-500 text-center">
                          {revealed ? "Lepas untuk membatalkan →" : "Geser ← untuk membatalkan"}
                        </div>
                      )}
                      </div>
                    </div>
                    );
                  })
                )}
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
                      <th className="py-2 font-medium text-right">WA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {riwayatFiltered.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-900/40">
                        <td className="py-2 pr-3 font-mono text-xs text-slate-400">{waktuFmt.format(t.waktu)}</td>
                        <td className="py-2 pr-3">
                          <span className="mr-1.5">{t.produkEmoji}</span>
                          {t.produkNama}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">
                          {t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-400">{rupiah(t.hargaPerKg)}</td>
                        <td className="py-2 pr-3 text-right font-mono font-semibold text-emerald-400">
                          {rupiah(t.total)}
                        </td>
                        <td className="py-2 text-right font-mono text-slate-300">
                          {t.sisaStokKg.toLocaleString("id-ID")} kg
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => kirimWa(t)}
                            disabled={!waReady}
                            title={waDisabledReason || `Kirim struk ke ${waNomorDisplay}`}
                            aria-disabled={!waReady}
                            className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white transition-colors"
                          >
                            💬 Kirim
                          </button>
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

export const Route = createFileRoute("/pos-kasir/")({
  head: () => ({
    meta: [
      { title: "POS Kasir Curah · Simulasi Timbangan Digital" },
      { name: "description", content: "Kasir produk curah dengan simulasi layar timbangan digital real-time dan pengurangan stok otomatis." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PosKasirPage,
});
