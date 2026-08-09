import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getPosKasirRiwayat,
  setPosKasirRiwayat,
  PRODUK_AWAL,
  type PosKasirProduk,
  type PosKasirTransaksi,
} from "@/lib/pos-kasir";
import { loadGudangProduk, recordSale, refundSale } from "@/lib/pos-kasir-gudang";
import { supabase } from "@/integrations/supabase/client";
import { normalizeWaNumber, formatWaDisplay } from "@/lib/phone";
import { NumericTextField } from "@/components/NumericDraftInput";
import { useVisualViewportKeyboardInset } from "@/hooks/use-visual-viewport-inset";
// jsPDF + autoTable dimuat lazy (dynamic import) di dalam exportPDF supaya
// bundle awal halaman POS Kasir tidak membawa ~200KB kode PDF yang hanya
// dipakai saat user mengekspor.

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);

const waktuFmt = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  day: "2-digit",
  month: "short",
});

const QUICK_WEIGHTS_KG = [0.1, 0.25, 0.5, 1, 2];
const QUICK_WEIGHTS_GRAM = [10, 25, 50, 100, 250];
const QUICK_WEIGHTS_PCS = [1, 2, 5, 10, 25];

function quickAddsFor(unitLabel: string): number[] {
  const u = unitLabel.toLowerCase();
  if (u === "g" || u === "gr" || u === "gram") return QUICK_WEIGHTS_GRAM;
  if (u === "pcs" || u === "botol" || u === "karton" || u === "pack" || u === "unit") return QUICK_WEIGHTS_PCS;
  return QUICK_WEIGHTS_KG;
}

const AMBANG_STORAGE_KEY = "mcm-pos-kasir-ambang-stok";
const AMBANG_DEFAULT = 5;

// M16: ambil unit label dari transaksi (SSOT: `PosKasirTransaksi.unitLabel`).
// Untuk transaksi lama yang belum menyimpan `unitLabel`, fallback ke "kg"
// karena dulu semua produk memang default kg (backward-compatible).
function unitOf(t: { unitLabel?: string | null }): string {
  const u = (t.unitLabel ?? "").trim();
  return u || "kg";
}
// Item dengan `base_unit === "pcs"` (botol, karton, pack, unit) tidak
// pernah dijual pecahan — input, step & pembulatan mengikuti bilangan
// bulat. Kesalahan input (mis. 1.5 botol) akan otomatis di-floor saat
// disimpan supaya stok/sisa tetap konsisten dengan `Jumlah/pcs`.
function isDiscreteUnit(unitLabel: string | null | undefined): boolean {
  const u = (unitLabel ?? "").trim().toLowerCase();
  return u === "pcs" || u === "botol" || u === "karton" || u === "pack" || u === "unit";
}
const MODE_RINGKAS_KEY = "mcm-pos-kasir-mode-ringkas";
const URUTAN_KEY = "mcm-pos-kasir-urutan";

type UrutanTransaksi = "terbaru" | "terlama";

type StokLevel = "habis" | "kritis" | "menipis" | "aman";

function levelStok(stokKg: number, ambang: number): StokLevel {
  if (stokKg <= 0) return "habis";
  if (stokKg <= ambang / 2) return "kritis";
  if (stokKg <= ambang) return "menipis";
  return "aman";
}

const LEVEL_META: Record<StokLevel, { label: string; badge: string; text: string; ring: string; emoji: string }> = {
  habis:   { label: "Habis",   badge: "bg-muted text-foreground border-border", text: "text-muted-foreground", ring: "ring-1 ring-ring",       emoji: "⛔" },
  kritis:  { label: "Kritis",  badge: "bg-rose-500/20 text-rose-300 border-rose-500/40", text: "text-rose-300", ring: "ring-2 ring-rose-500/60 animate-pulse", emoji: "🚨" },
  menipis: { label: "Menipis", badge: "bg-warning/20 text-warning border-warning/40", text: "text-warning", ring: "ring-1 ring-warning/40", emoji: "⚠" },
  aman:    { label: "Aman",    badge: "bg-success/15 text-success border-success/30", text: "text-foreground", ring: "", emoji: "" },
};

function PosKasirPage() {
  const [produk, setProduk] = useState<PosKasirProduk[]>(PRODUK_AWAL);
  const [selectedId, setSelectedId] = useState<string>(PRODUK_AWAL[0].id);
  const [beratStr, setBeratStr] = useState<string>("0");
  const [hargaStr, setHargaStr] = useState<string>("0");
  const [gudangSynced, setGudangSynced] = useState<boolean>(false);
  const [gudangError, setGudangError] = useState<string | null>(null);
  const [bayarBusy, setBayarBusy] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  const keyboardInset = useVisualViewportKeyboardInset();
  const [riwayat, setRiwayat] = useState<PosKasirTransaksi[]>(() => getPosKasirRiwayat());
  const [dariTgl, setDariTgl] = useState<string>("");
  const [sampaiTgl, setSampaiTgl] = useState<string>("");
  const [cariTransaksi, setCariTransaksi] = useState<string>("");
  const [swipeDx, setSwipeDx] = useState<number>(0);
  const swipeStartX = useRef<number | null>(null);
  const [strukTransaksi, setStrukTransaksi] = useState<PosKasirTransaksi | null>(null);
  const [waNomor, setWaNomor] = useState<string>("");
  const [waLokasi, setWaLokasi] = useState<string>("");
  const [gpsBusy, setGpsBusy] = useState<boolean>(false);

  const ambilLokasiGps = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      alert("GPS tidak tersedia di perangkat ini");
      return;
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setWaLokasi(`https://www.google.com/maps?q=${latitude},${longitude}`);
        setGpsBusy(false);
      },
      (err) => {
        setGpsBusy(false);
        alert("Gagal ambil GPS: " + err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };
  const [ambangStok, setAmbangStok] = useState<number>(() => {
    if (typeof window === "undefined") return AMBANG_DEFAULT;
    const raw = localStorage.getItem(AMBANG_STORAGE_KEY);
    const n = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : AMBANG_DEFAULT;
  });
  const [modeRingkas, setModeRingkas] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const raw = localStorage.getItem(MODE_RINGKAS_KEY);
    return raw === "true" ? true : raw === "false" ? false : false;
  });
  const [urutan, setUrutan] = useState<UrutanTransaksi>(() => {
    if (typeof window === "undefined") return "terbaru";
    const raw = localStorage.getItem(URUTAN_KEY);
    return raw === "terlama" ? "terlama" : "terbaru";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(AMBANG_STORAGE_KEY, String(ambangStok));
  }, [ambangStok]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(MODE_RINGKAS_KEY, String(modeRingkas));
  }, [modeRingkas]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(URUTAN_KEY, urutan);
  }, [urutan]);


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
    const u = unitOf(t);
    const lines = [
      "🧾 *Struk POS Kasir*",
      `${t.produkEmoji} ${t.produkNama}`,
      `Jumlah: ${t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} ${u}`,
      `Harga: ${rupiah(t.hargaPerKg)}/${u}`,
      `Total: *${rupiah(t.total)}*`,
      `Sisa stok: ${t.sisaStokKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} ${u}`,
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

  const selected = produk.find((p) => p.id === selectedId) ?? produk[0];
  const berat = useMemo(() => {
    const n = parseFloat(beratStr.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return 0;
    // Item pcs/botol/karton dijual bulat — floor supaya stok & sisa
    // ikut hitungan `Jumlah/pcs`, bukan pecahan berat.
    return isDiscreteUnit(selected?.unitLabel) ? Math.floor(n) : n;
  }, [beratStr, selected?.unitLabel]);
  const hargaInput = useMemo(() => {
    const n = parseFloat(hargaStr.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [hargaStr]);
  // Sumber harga:
  //  - Mode gudang: dari input manual (per keputusan produk)
  //  - Mode demo: dari harga tetap tiap produk
  const hargaEfektif = selected.warehouseItemId ? hargaInput : selected.hargaPerKg;
  const total = berat * hargaEfektif;
  const stokCukup = berat > 0 && berat <= selected.stokKg;
  const hargaCukup = hargaEfektif > 0;
  const bayarSiap = stokCukup && hargaCukup && !bayarBusy;
  const quickAdds = useMemo(() => quickAddsFor(selected.unitLabel), [selected.unitLabel]);
  const unit = selected.unitLabel;
  const isPcs = isDiscreteUnit(selected.unitLabel);
  const inputStep = isPcs ? "1" : "0.001";
  const inputPlaceholder = isPcs ? "0" : "0.000";

  // Sinkronisasi produk dengan gudang saat user login.
  const refreshGudang = async (opts?: { silent?: boolean }) => {
    const res = await loadGudangProduk();
    if (!res.authed) {
      setGudangSynced(false);
      setGudangError(null);
      return;
    }
    if (res.error) {
      setGudangError(res.error);
      if (!opts?.silent) {
        setToast(`Gagal muat gudang: ${res.error}`);
        setTimeout(() => setToast(null), 3000);
      }
      return;
    }
    setGudangError(null);
    setGudangSynced(true);
    if (res.produk.length === 0) {
      setProduk([]);
      return;
    }
    setProduk(res.produk);
    setSelectedId((prev) => (res.produk.some((p) => p.id === prev) ? prev : res.produk[0].id));
  };

  useEffect(() => {
    void refreshGudang({ silent: true });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void refreshGudang({ silent: true });
      }
    });
    return () => {
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const bayar = async () => {
    if (bayarBusy) return;
    if (!stokCukup) {
      setToast(berat <= 0 ? "Masukkan berat terlebih dahulu" : "Stok tidak mencukupi");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    if (!hargaCukup) {
      setToast("Masukkan harga per " + unit + " terlebih dahulu");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    // Mode gudang: tulis ke tabel sales; trigger apply_sale kurangi stok.
    if (selected.warehouseItemId) {
      setBayarBusy(true);
      const res = await recordSale({
        warehouseItemId: selected.warehouseItemId,
        qtyBase: berat,
        pricePerBase: hargaEfektif,
      });
      setBayarBusy(false);
      if (!res.ok) {
        setToast(`❌ Gagal menyimpan: ${res.error}`);
        setTimeout(() => setToast(null), 4000);
        return;
      }
      const sisaStokKg = +(selected.stokKg - berat).toFixed(3);
      const trxBaru: PosKasirTransaksi = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        produkId: selected.id,
        produkNama: selected.nama,
        produkEmoji: selected.emoji,
        beratKg: berat,
        hargaPerKg: hargaEfektif,
        total,
        sisaStokKg,
        waktu: Date.now(),
        unitLabel: unit,
        warehouseItemId: selected.warehouseItemId,
        saleId: res.saleId,
      };
      setRiwayat((prev) => [trxBaru, ...prev]);
      setStrukTransaksi(trxBaru);
      setToast(`✅ Tersimpan · ${berat} ${unit} ${selected.nama} · ${rupiah(total)}`);
      setBeratStr("0");
      setTimeout(() => setToast(null), 3500);
      void refreshGudang({ silent: true });
      return;
    }
    // Mode demo (belum login) — perilaku lama, stok lokal.
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
      hargaPerKg: hargaEfektif,
      total,
      sisaStokKg,
      waktu: Date.now(),
      unitLabel: unit,
    };
    setRiwayat((prev) => [trxBaru, ...prev]);
    setStrukTransaksi(trxBaru);
    let pesan = `✅ Transaksi berhasil · ${berat} ${unit} ${selected.nama} · ${rupiah(total)}`;
    if (levelSesudah !== levelSebelum && levelSesudah !== "aman") {
      const meta = LEVEL_META[levelSesudah];
      pesan += ` · ${meta.emoji} Stok ${selected.nama} kini ${meta.label.toLowerCase()} (${sisaStokKg.toLocaleString("id-ID")} ${unit})`;
    }
    setToast(pesan);
    setBeratStr("0");
    setTimeout(() => setToast(null), 4500);
  };

  const batalkanTransaksi = async (t: PosKasirTransaksi) => {
    const u = t.unitLabel || "kg";
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `Batalkan transaksi ${t.produkNama} (${t.beratKg.toLocaleString("id-ID")} ${u} · ${rupiah(t.total)})?\nStok akan dikembalikan.`,
      );
      if (!ok) return;
    }
    if (t.saleId) {
      const res = await refundSale(t.saleId);
      if (!res.ok) {
        setToast(`❌ Gagal batalkan: ${res.error}`);
        setTimeout(() => setToast(null), 4000);
        return;
      }
      setRiwayat((prev) => prev.filter((r) => r.id !== t.id));
      setSwipeDx(0);
      swipeStartX.current = null;
      setToast(`↶ Transaksi dibatalkan · stok dikembalikan`);
      setTimeout(() => setToast(null), 3000);
      void refreshGudang({ silent: true });
      return;
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

  const riwayatSorted = useMemo(() => {
    return [...riwayatFiltered].sort((a, b) =>
      urutan === "terbaru" ? b.waktu - a.waktu : a.waktu - b.waktu,
    );
  }, [riwayatFiltered, urutan]);

  const riwayatCariMobile = useMemo(() => {
    const q = cariTransaksi.trim().toLowerCase();
    if (!q) return riwayatSorted;
    return riwayatSorted.filter(
      (t) =>
        t.produkNama.toLowerCase().includes(q) ||
        waktuFmt.format(t.waktu).toLowerCase().includes(q),
    );
  }, [riwayatSorted, cariTransaksi]);

  const exportCSV = () => {
    if (riwayatSorted.length === 0) {
      setToast("Tidak ada transaksi pada rentang tanggal terpilih");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const header = ["Waktu", "Produk", "Jumlah", "Unit", "Harga per unit (IDR)", "Total (IDR)", "Sisa Stok"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = riwayatSorted.map((t) =>
      [
        new Date(t.waktu).toLocaleString("id-ID"),
        t.produkNama,
        t.beratKg.toString().replace(".", ","),
        unitOf(t),
        t.hargaPerKg.toString(),
        t.total.toString(),
        `${t.sisaStokKg.toString().replace(".", ",")} ${unitOf(t)}`,
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
    setToast(`✅ Diekspor ${riwayatSorted.length} transaksi ke CSV`);
    setTimeout(() => setToast(null), 2500);
  };

  const exportPDF = async () => {
    if (riwayatSorted.length === 0) {
      setToast("Tidak ada transaksi pada rentang tanggal terpilih");
      setTimeout(() => setToast(null), 2500);
      return;
    }
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    const totalOmzetF = riwayatSorted.reduce((s, t) => s + t.total, 0);
    const totalKgF = riwayatSorted.reduce((s, t) => s + t.beratKg, 0);
    // M16: bila seluruh transaksi pakai unit yang sama, tampilkan di header;
    // bila campur unit, gunakan "unit" generik agar tidak menyesatkan.
    const unitSet = new Set(riwayatSorted.map((t) => unitOf(t)));
    const totalUnitLabel = unitSet.size === 1 ? Array.from(unitSet)[0] : "unit";
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
      `Total transaksi: ${riwayatSorted.length}  ·  Total jumlah: ${totalKgF.toLocaleString("id-ID", { maximumFractionDigits: 3 })} ${totalUnitLabel}  ·  Omzet: ${rupiah(totalOmzetF)}`,
      40,
      86,
    );

    autoTable(doc, {
      startY: 100,
      head: [["Waktu", "Produk", "Jumlah", "Unit", "Harga/unit", "Total", "Sisa Stok"]],
      body: riwayatSorted.map((t) => [
        new Date(t.waktu).toLocaleString("id-ID"),
        `${t.produkEmoji} ${t.produkNama}`,
        t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 }),
        unitOf(t),
        rupiah(t.hargaPerKg),
        rupiah(t.total),
        `${t.sisaStokKg.toLocaleString("id-ID")} ${unitOf(t)}`,
      ]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        2: { halign: "right" },
        3: { halign: "left" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
      margin: { left: 40, right: 40 },
      didDrawPage: (data: { pageNumber: number }) => {
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
    setToast(`✅ Diekspor ${riwayatSorted.length} transaksi ke PDF`);
    setTimeout(() => setToast(null), 2500);
  };

  // Tampilan LCD-style: pcs dibulatkan (5 digit) supaya tidak ada
  // ",000" palsu; berat kg/gram tetap 3 desimal.
  const displayBerat = isPcs
    ? Math.floor(berat).toString().padStart(5, " ")
    : berat.toFixed(3).padStart(9, " ");

  const addBerat = (delta: number) => {
    const raw = berat + delta;
    const next = isPcs ? Math.max(0, Math.floor(raw)) : Math.max(0, +raw.toFixed(3));
    setBeratStr(String(next));
  };

  // Edge case: user login tapi belum ada barang di gudang.
  if (gudangSynced && produk.length === 0) {
    return (
      <div
        className="min-h-screen bg-gradient-to-br from-background via-card to-background text-foreground p-ms-6 flex items-center justify-center" style={{ paddingTop: "calc(var(--app-safe-top, 0px) + 1.5rem)", paddingLeft: "calc(var(--app-safe-left, 0px) + 1.5rem)", paddingRight: "calc(var(--app-safe-right, 0px) + 1.5rem)" }}
      >
        <div className="max-w-md text-center space-ms-4 bg-card/60 border border-border rounded-2xl p-ms-6">
          <div className="text-ms-4xl">📦</div>
          <h1 className="text-ms-xl font-bold">Belum ada produk di gudang</h1>
          <p className="text-ms-sm text-muted-foreground">
            POS Kasir menampilkan produk dari halaman <Link className="underline text-success" to="/gudang">Gudang</Link>.
            Tambahkan minimal satu barang untuk mulai menjual.
          </p>
          {gudangError && <p className="text-ms-xs text-red-300">{gudangError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen bg-gradient-to-br from-background via-card to-background text-foreground md:p-8 ${modeRingkas ? "p-ms-2" : "p-ms-3"}`} style={{ paddingTop: "calc(var(--app-safe-top, 0px) + 0.5rem)", paddingLeft: "calc(var(--app-safe-left, 0px) + 0.5rem)", paddingRight: "calc(var(--app-safe-right, 0px) + 0.5rem)" }}
    >
      <div className="mx-auto max-w-6xl">
        {/* Mobile header */}
        <header className={`md:hidden grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-ms-2 ${modeRingkas ? "mb-2" : "mb-4"}`}>
          <div className="min-w-0">
            <h1 className="truncate text-ms-xl font-bold tracking-tight">🧾 POS Kasir</h1>
            <p className="truncate text-ms-xs text-muted-foreground mt-0.5">
              {riwayat.length} transaksi · {totalKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModeRingkas((v) => !v)}
            title={modeRingkas ? "Mode normal" : "Mode ringkas"}
            aria-pressed={modeRingkas}
            className={`shrink-0 rounded-lg border text-ms-xs font-medium transition-colors ${
              modeRingkas
                ? "bg-success/20 border-success/50 text-success"
                : "bg-card border-border text-foreground hover:bg-muted"
            } ${modeRingkas ? "px-ms-2 py-1" : "px-ms-3 py-1.5"}`}
          >
            {modeRingkas ? "📱 Ringkas" : "📱 Normal"}
          </button>
          <Link
            to="/pos-kasir/ringkasan"
            className={`shrink-0 rounded-lg bg-card border border-border text-ms-xs font-medium text-foreground hover:bg-muted transition-colors ${modeRingkas ? "px-ms-2 py-1" : "px-ms-3 py-1.5"}`}
          >
            📊 Ringkasan
          </Link>
        </header>

        <div className={`${modeRingkas ? "mb-2" : "mb-3"} rounded-lg border text-ms-2xs px-ms-3 py-ms-2 flex items-center justify-between gap-ms-2 ${
          gudangSynced
            ? "bg-success/10 border-success/30 text-success"
            : "bg-warning/10 border-warning/30 text-warning"
        }`}>
          <span className="truncate">
            {gudangSynced
              ? "🔗 Tersinkron dengan Gudang · stok otomatis dari warehouse"
              : "⚠ Mode demo · login untuk sinkron ke Gudang & catat penjualan"}
          </span>
          {gudangSynced ? (
            <Link to="/gudang" className="shrink-0 underline">Kelola gudang →</Link>
          ) : (
            <Link to="/auth" className="shrink-0 underline">Masuk →</Link>
          )}
        </div>

        {/* Desktop header */}
        <header className="hidden md:flex mb-6 items-center justify-between">
          <div>
            <h1 className="text-ms-2xl md:text-ms-3xl font-bold tracking-tight">🧾 POS Kasir · Produk Curah</h1>
            <p className="text-ms-sm text-muted-foreground mt-1">Simulasi timbangan digital & penjualan per kilogram</p>
          </div>
          <div className="flex items-center gap-ms-2">
            <button
              type="button"
              onClick={() => setModeRingkas((v) => !v)}
              title={modeRingkas ? "Mode normal" : "Mode ringkas"}
              aria-pressed={modeRingkas}
              className={`rounded-lg border text-ms-sm font-medium transition-colors ${
                modeRingkas
                  ? "bg-success/20 border-success/50 text-success"
                  : "bg-card border-border text-foreground hover:bg-muted"
              } px-ms-4 py-ms-2`}
            >
              {modeRingkas ? "📱 Mode ringkas" : "📱 Mode normal"}
            </button>
            <Link
              to="/pos-kasir/ringkasan"
              className="px-ms-4 py-ms-2 rounded-lg bg-success hover:bg-success text-success-foreground text-ms-sm font-medium transition-colors"
            >
              📊 Ringkasan
            </Link>
          </div>
        </header>


        {/* Mobile stock summary */}
        <section className={`md:hidden bg-card/50 backdrop-blur rounded-xl border border-border ${modeRingkas ? "mb-2 p-ms-2" : "mb-4 p-ms-3"}`}>
          <div className={`flex items-center justify-between ${modeRingkas ? "mb-1" : "mb-2"}`}>
            <span className="text-ms-xs font-semibold text-foreground uppercase tracking-wider">Stok Tersisa</span>
            <span className="text-ms-xs text-muted-foreground">{totalStok.toLocaleString("id-ID")} kg total</span>
          </div>
          <div className={`flex overflow-x-auto scrollbar-thin ${modeRingkas ? "gap-ms-1.5 pb-0.5" : "gap-ms-2 pb-1"}`}>
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
                  className={`relative shrink-0 flex items-center gap-ms-2 rounded-lg border text-ms-xs transition-colors ${meta.ring} ${
                    active
                      ? "bg-success/20 border-success"
                      : "bg-background/60 border-border hover:border-border"
                  } ${habis ? "opacity-40 cursor-not-allowed" : ""} ${modeRingkas ? "px-ms-2 py-1.5" : "px-ms-3 py-ms-2"}`}
                >
                  <span className="text-ms-lg">{p.emoji}</span>
                  <div className="text-left min-w-0">
                    <div className="font-medium truncate max-w-[80px]">{p.nama}</div>
                    <div className={`font-mono ${level === "aman" ? "text-muted-foreground" : meta.text}`}>
                      {p.stokKg.toLocaleString("id-ID")} {unitOf(p)}
                    </div>
                  </div>
                  {level !== "aman" && (
                    <span
                      aria-label={`Stok ${meta.label}`}
                      className={`absolute -top-1.5 -right-1.5 text-ms-2xs leading-none px-1.5 py-0.5 rounded-full border ${meta.badge}`}
                    >
                      {meta.emoji}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className={`mt-2 flex flex-col gap-ms-1 ${modeRingkas ? "hidden" : ""}`}>
            {produkKritis.length > 0 && (
              <div className="text-ms-2xs text-rose-300">
                🚨 Stok kritis: {produkKritis.map((p) => `${p.emoji} ${p.nama} (${p.stokKg} ${unitOf(p)})`).join(", ")}
              </div>
            )}
            {produkMenipis.length > 0 && (
              <div className="text-ms-2xs text-warning">
                ⚠ Stok menipis: {produkMenipis.map((p) => `${p.emoji} ${p.nama} (${p.stokKg} ${unitOf(p)})`).join(", ")}
              </div>
            )}
            {produkHabis.length > 0 && (
              <div className="text-ms-2xs text-muted-foreground">
                ⛔ Habis: {produkHabis.map((p) => `${p.emoji} ${p.nama}`).join(", ")}
              </div>
            )}
            <label className="mt-1 flex items-center gap-ms-2 text-ms-2xs text-muted-foreground">
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
                className="w-16 rounded-md bg-background border border-border px-ms-2 py-0.5 text-ms-xs text-foreground focus:outline-none focus:border-success"
              />
              unit
            </label>
          </div>
        </section>


        <div className={`grid grid-cols-1 lg:grid-cols-3 md:gap-ms-6 ${modeRingkas ? "gap-ms-2" : "gap-ms-4"}`}>
          {/* Main */}
          <section className={`lg:col-span-2 ${modeRingkas ? "space-ms-2 md:space-ms-6" : "space-ms-4 md:space-ms-6"}`}>

            {/* Desktop product grid */}
            <div className="hidden md:block bg-card/50 backdrop-blur rounded-2xl p-ms-5 border border-border">
              <div className="flex items-center justify-between mb-3 gap-ms-3 flex-wrap">
                <h2 className="text-ms-sm font-semibold text-foreground uppercase tracking-wider">Pilih Produk</h2>
                <label className="flex items-center gap-ms-2 text-ms-xs text-muted-foreground">
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
                    className="w-20 rounded-md bg-background border border-border px-ms-2 py-1 text-ms-xs text-foreground focus:outline-none focus:border-success"
                  />
                  unit
                </label>
              </div>
              {(produkKritis.length > 0 || produkMenipis.length > 0 || produkHabis.length > 0) && (
                <div className="mb-3 flex flex-col gap-ms-1 text-ms-xs">
                  {produkKritis.length > 0 && (
                    <div className="text-rose-300">
                      🚨 Kritis: {produkKritis.map((p) => `${p.emoji} ${p.nama} (${p.stokKg} ${unitOf(p)})`).join(", ")}
                    </div>
                  )}
                  {produkMenipis.length > 0 && (
                    <div className="text-warning">
                      ⚠ Menipis: {produkMenipis.map((p) => `${p.emoji} ${p.nama} (${p.stokKg} ${unitOf(p)})`).join(", ")}
                    </div>
                  )}
                  {produkHabis.length > 0 && (
                    <div className="text-muted-foreground">
                      ⛔ Habis: {produkHabis.map((p) => `${p.emoji} ${p.nama}`).join(", ")}
                    </div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-ms-3">
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
                      className={`relative text-left p-ms-4 rounded-xl border transition-all ${meta.ring} ${
                        active
                          ? "bg-success/20 border-success shadow-lg shadow-success/20"
                          : "bg-background/60 border-border hover:border-border"
                      } ${habis ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      <div className="text-ms-3xl mb-2">{p.emoji}</div>
                      <div className="font-semibold text-ms-sm">{p.nama}</div>
                      <div className="text-ms-xs text-muted-foreground mt-1">{rupiah(p.hargaPerKg)}/{unitOf(p)}</div>
                      <div className={`text-ms-xs mt-2 ${meta.text}`}>
                        Stok: {p.stokKg.toLocaleString("id-ID")} {unitOf(p)}
                      </div>
                      {level !== "aman" && (
                        <span
                          aria-label={`Stok ${meta.label}`}
                          className={`absolute top-2 right-2 text-ms-2xs font-medium leading-none px-ms-2 py-1 rounded-full border ${meta.badge}`}
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
            <div className={`md:hidden bg-gradient-to-b from-background to-black rounded-2xl border-2 border-border shadow-2xl ${modeRingkas ? "p-ms-3" : "p-ms-4"}`}>
              <div className={`flex items-center justify-between ${modeRingkas ? "mb-2" : "mb-3"}`}>
                <span className="text-ms-xs font-mono uppercase tracking-widest text-success">⚖ Timbangan</span>
                <span className="text-ms-xs text-muted-foreground truncate">
                  {selected.emoji} {selected.nama}
                </span>
              </div>
              <div className={`bg-background rounded-xl border border-success/50 relative overflow-hidden ${modeRingkas ? "p-ms-3" : "p-ms-4"}`}>
                <div className="absolute inset-0 bg-success/5" />
                <div className="relative flex items-baseline justify-end gap-ms-2">
                  <span
                    className={`font-mono font-bold text-success tabular-nums ${modeRingkas ? "text-ms-4xl" : "text-5xl"}`}
                    style={{ textShadow: "0 0 20px rgba(52,211,153,0.6)", fontFamily: "'Courier New', monospace" }}
                  >
                    {displayBerat}
                  </span>
                  <span className={`font-mono text-success ${modeRingkas ? "text-ms-lg" : "text-ms-xl"}`}>{unit}</span>
                </div>
                <div className={`border-t border-success/40 flex justify-between font-mono text-success/70 ${modeRingkas ? "mt-1 pt-1 text-ms-2xs" : "mt-2 pt-2 text-ms-xs"}`}>
                  <span>@ {rupiah(hargaEfektif)}/{unit.toUpperCase()}</span>
                  <span>TOTAL {rupiah(total)}</span>
                </div>
              </div>

              <div className={modeRingkas ? "mt-3" : "mt-4"}>
                <label className="text-ms-xs font-semibold text-muted-foreground uppercase tracking-wider">Input Jumlah ({unit})</label>
                <NumericTextField
                  value={beratStr}
                  onValueChange={setBeratStr}
                  step={inputStep}
                  decimal={true}
                  className={`w-full bg-background border rounded-lg font-mono focus:outline-none focus:ring-2 transition-colors ${
                    berat > selected.stokKg
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500/30 text-red-300"
                      : "border-border focus:border-success focus:ring-success/30"
                  }`}
                  placeholder={inputPlaceholder}
                />
                {berat > selected.stokKg && (
                  <div className={`flex items-start gap-ms-2 rounded-lg bg-red-500/15 border border-red-500/40 text-ms-xs text-red-200 ${modeRingkas ? "mt-1 p-ms-1.5" : "mt-2 p-ms-2"}`}>
                    <span className="shrink-0 text-red-400">⚠</span>
                    <div>
                      Melebihi stok {selected.stokKg.toLocaleString("id-ID")} {unit}.
                    </div>
                  </div>
                )}
              </div>
              {selected.warehouseItemId && (
                <div className={modeRingkas ? "mt-2" : "mt-3"}>
                  <label className="text-ms-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Harga jual / {unit} (Rp)
                  </label>
                  <NumericTextField
                    value={hargaStr}
                    onValueChange={setHargaStr}
                    step={1}
                    decimal={false}
                    className={`w-full bg-background border border-border focus:border-success focus:ring-success/30 rounded-lg font-mono focus:outline-none focus:ring-2 ${modeRingkas ? "mt-1 px-ms-2.5 py-ms-2 text-ms-sm" : "mt-2 px-ms-3 py-ms-2.5 text-ms-base"}`}
                    placeholder="0"
                  />
                </div>
              )}
            </div>


            {/* Mobile quick buttons */}
            <div className={`md:hidden ${modeRingkas ? "space-y-1.5" : "space-ms-2"}`}>
              <div className={`grid grid-cols-5 ${modeRingkas ? "gap-ms-1.5" : "gap-ms-2"}`}>
                {quickAdds.map((v) => {
                  const wouldExceed = berat + v > selected.stokKg;
                  return (
                    <button
                      key={v}
                      onClick={() => addBerat(v)}
                      disabled={wouldExceed}
                      className={`rounded-lg border text-ms-xs font-semibold transition-colors ${
                        wouldExceed
                          ? "bg-card/50 border-border text-muted-foreground cursor-not-allowed"
                          : "bg-card hover:bg-muted border-border active:bg-success/30"
                      } ${modeRingkas ? "py-ms-2" : "py-ms-2.5"}`}
                    >
                      +{v}
                    </button>
                  );
                })}
              </div>
              <div className={`grid grid-cols-3 ${modeRingkas ? "gap-ms-1.5" : "gap-ms-2"}`}>
                <button
                  onClick={() => addBerat(-0.25)}
                  disabled={berat <= 0}
                  className={`rounded-lg border border-border bg-card text-ms-xs font-semibold disabled:opacity-50 active:bg-muted ${modeRingkas ? "py-ms-2" : "py-ms-2.5"}`}
                >
                  -0.25
                </button>
                <button
                  onClick={() => setBeratStr("0")}
                  className={`rounded-lg border border-border bg-card text-ms-xs font-semibold text-muted-foreground active:bg-muted ${modeRingkas ? "py-ms-2" : "py-ms-2.5"}`}
                >
                  Reset
                </button>
                <button
                  onClick={bayar}
                  disabled={!bayarSiap}
                  className={`rounded-lg bg-success hover:bg-success disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-ms-xs font-bold text-success-foreground shadow-lg shadow-success/30 active:scale-95 transition-transform ${modeRingkas ? "py-ms-2" : "py-ms-2.5"}`}
                >
                  Bayar
                </button>
              </div>
            </div>


            {/* Desktop scale */}
            <div className="hidden md:block bg-gradient-to-b from-background to-black rounded-2xl p-ms-6 border-2 border-border shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <span className="text-ms-xs font-mono uppercase tracking-widest text-success">⚖ Timbangan Digital</span>
                <span className="flex gap-ms-1.5">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  <span className="text-ms-2xs font-mono text-success">LIVE</span>
                </span>
              </div>
              <div className="bg-background rounded-xl p-ms-6 border border-success/50 relative overflow-hidden">
                <div className="absolute inset-0 bg-success/5" />
                <div className="relative flex items-baseline justify-end gap-ms-2">
                  <span
                    className="font-mono text-6xl md:text-7xl font-bold text-success tabular-nums"
                    style={{ textShadow: "0 0 20px rgba(52,211,153,0.6)", fontFamily: "'Courier New', monospace" }}
                  >
                    {displayBerat}
                  </span>
                  <span className="text-ms-2xl font-mono text-success">{unit}</span>
                </div>
                <div className="mt-3 pt-3 border-t border-success/40 flex justify-between text-ms-xs font-mono text-success/70">
                  <span>PRODUK: {selected.nama.toUpperCase()}</span>
                  <span>@ {rupiah(hargaEfektif)}/{unit.toUpperCase()}</span>
                </div>
              </div>

              <div className="mt-5">
                <label className="text-ms-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Input Jumlah ({unit})
                </label>
                <NumericTextField
                  value={beratStr}
                  onValueChange={setBeratStr}
                  step={inputStep}
                  decimal={true}
                  className={`mt-2 w-full bg-background border rounded-lg px-ms-4 py-ms-3 text-ms-lg font-mono focus:outline-none focus:ring-2 transition-colors ${
                    berat > selected.stokKg
                      ? "border-red-500 focus:border-red-500 focus:ring-red-500/30 text-red-300"
                      : "border-border focus:border-success focus:ring-success/30"
                  }`}
                  placeholder={inputPlaceholder}
                />
                 {berat > selected.stokKg && (
                   <div className="mt-3 flex items-start gap-ms-2 rounded-lg bg-red-500/15 border border-red-500/40 p-ms-3 text-ms-sm text-red-200">
                     <span className="shrink-0 text-red-400">⚠</span>
                     <div>
                       <p className="font-semibold">Jumlah melebihi stok</p>
                       <p className="text-ms-xs text-red-300/80 mt-0.5">
                         Stok {selected.nama} tersedia {selected.stokKg.toLocaleString("id-ID")} {unit}.
                       </p>
                       <p className="text-ms-xs text-red-300/80 mt-0.5">
                         Kurangi jumlah agar tidak melebihi stok yang ada.
                       </p>
                     </div>
                   </div>
                 )}

                 <div className="mt-3 grid grid-cols-4 gap-ms-2">
                   {quickAdds.slice(0, 4).map((v) => {
                    const wouldExceed = berat + v > selected.stokKg;
                    return (
                      <button
                        key={v}
                        onClick={() => addBerat(v)}
                        disabled={wouldExceed}
                        className={`py-ms-2 rounded-lg border text-ms-sm font-medium transition-colors ${
                          wouldExceed
                            ? "bg-card/50 border-border text-muted-foreground cursor-not-allowed"
                            : "bg-card hover:bg-muted border-border"
                        }`}
                      >
                        +{v} {unit}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setBeratStr("0")}
                  className="mt-2 w-full py-ms-2 rounded-lg bg-card/50 hover:bg-card border border-border text-ms-xs text-muted-foreground"
                >
                  Reset (Tara)
                </button>
              </div>
              {selected.warehouseItemId && (
                <div className="mt-4">
                  <label className="text-ms-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Harga jual / {unit} (Rp)
                  </label>
                  <NumericTextField value={hargaStr} onValueChange={setHargaStr} step={1} decimal={false} className="mt-2 w-full bg-background border border-border focus:border-success focus:ring-success/30 rounded-lg px-ms-4 py-ms-3 text-ms-lg font-mono focus:outline-none focus:ring-2" placeholder="0" />
                </div>
              )}
            </div>
          </section>

          {/* Desktop summary */}
          <aside className="hidden md:block space-ms-4">
            <div className="bg-card/50 backdrop-blur rounded-2xl p-ms-5 border border-border sticky top-4">
              <h2 className="text-ms-sm font-semibold text-foreground uppercase tracking-wider mb-4">Ringkasan</h2>
              <div className="space-ms-3 text-ms-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Produk</span>
                  <span className="font-medium">{selected.emoji} {selected.nama}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Harga/{unit}</span>
                  <span className="font-mono">{rupiah(hargaEfektif)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Berat</span>
                  <span className="font-mono">{berat.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {unit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stok saat ini</span>
                  <span className={`font-mono ${!stokCukup && berat > 0 ? "text-red-400" : ""}`}>
                    {selected.stokKg.toLocaleString("id-ID")} {unit}
                  </span>
                </div>
                <div className="border-t border-border pt-3 flex justify-between items-baseline">
                  <span className="text-foreground font-semibold">TOTAL</span>
                  <span className="text-ms-2xl font-bold text-success font-mono">{rupiah(total)}</span>
                </div>
              </div>

              {berat > 0 && !stokCukup && (
                <div className="mt-3 p-ms-3 rounded-lg bg-red-500/15 border border-red-500/40 text-ms-sm text-red-200">
                  <p className="font-semibold">⚠ Stok tidak mencukupi</p>
                  <p className="text-ms-xs text-red-300/80 mt-0.5">
                    Tersedia {selected.stokKg.toLocaleString("id-ID")} {unit}, butuh {berat.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {unit}. Kurangi berat untuk melanjutkan pembayaran.
                  </p>
                </div>
              )}

              <button
                onClick={bayar}
                disabled={!bayarSiap}
                className="mt-5 w-full py-ms-4 rounded-xl bg-gradient-to-r from-success to-success hover:from-success hover:to-success disabled:from-muted disabled:to-muted disabled:text-muted-foreground disabled:cursor-not-allowed font-bold text-ms-lg shadow-lg shadow-success/30 transition-all"
              >
                💳 Bayar
              </button>
              <p className="mt-2 text-ms-2xs text-muted-foreground text-center">
                Stok akan otomatis berkurang setelah pembayaran
              </p>
            </div>
          </aside>
        </div>

        {/* Riwayat Transaksi */}
        <section className={`md:mt-6 bg-card/50 backdrop-blur rounded-2xl border border-border ${modeRingkas ? "mt-2 p-ms-3 md:p-ms-5" : "mt-4 p-ms-4 md:p-ms-5"}`}>
          <div className={`flex flex-wrap items-center justify-between gap-ms-3 ${modeRingkas ? "mb-2" : "mb-4"}`}>

            <div>
              <h2 className="text-ms-sm font-semibold text-foreground uppercase tracking-wider">
                📋 Riwayat Transaksi
              </h2>
              <p className="text-ms-xs text-muted-foreground mt-1">
                {riwayat.length} transaksi · {totalKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg · omzet {rupiah(totalOmzet)}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-ms-2">
              <label className="flex flex-col text-ms-2xs uppercase tracking-wider text-muted-foreground">
                Dari
                <input
                  type="date"
                  value={dariTgl}
                  onChange={(e) => setDariTgl(e.target.value)}
                  className="mt-1 text-ms-xs px-ms-2 py-1.5 rounded-lg bg-background/60 border border-border text-foreground"
                />
              </label>
              <label className="flex flex-col text-ms-2xs uppercase tracking-wider text-muted-foreground">
                Sampai
                <input
                  type="date"
                  value={sampaiTgl}
                  onChange={(e) => setSampaiTgl(e.target.value)}
                  className="mt-1 text-ms-xs px-ms-2 py-1.5 rounded-lg bg-background/60 border border-border text-foreground"
                />
              </label>
              {(dariTgl || sampaiTgl) && (
                <button
                  onClick={() => {
                    setDariTgl("");
                    setSampaiTgl("");
                  }}
                  className="text-ms-xs px-ms-3 py-1.5 rounded-lg bg-background/60 hover:bg-background border border-border text-muted-foreground"
                >
                  Reset
                </button>
              )}
              <div className="flex items-center rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setUrutan("terbaru")}
                  className={`px-ms-2.5 py-1.5 text-ms-xs font-medium transition-colors ${
                    urutan === "terbaru"
                      ? "bg-success text-success-foreground"
                      : "bg-background/60 text-muted-foreground hover:bg-background"
                  }`}
                  aria-pressed={urutan === "terbaru"}
                >
                  Terbaru
                </button>
                <button
                  type="button"
                  onClick={() => setUrutan("terlama")}
                  className={`px-ms-2.5 py-1.5 text-ms-xs font-medium transition-colors ${
                    urutan === "terlama"
                      ? "bg-success text-success-foreground"
                      : "bg-background/60 text-muted-foreground hover:bg-background"
                  }`}
                  aria-pressed={urutan === "terlama"}
                >
                  Terlama
                </button>
              </div>
              <button
                onClick={exportCSV}
                disabled={riwayatSorted.length === 0}
                className="text-ms-xs px-ms-3 py-1.5 rounded-lg bg-success hover:bg-success disabled:bg-card disabled:text-muted-foreground disabled:cursor-not-allowed border border-success text-success-foreground font-medium"
              >
                ⬇ Ekspor CSV ({riwayatSorted.length})
              </button>
              <button
                onClick={exportPDF}
                disabled={riwayatSorted.length === 0}
                className="text-ms-xs px-ms-3 py-1.5 rounded-lg bg-destructive hover:bg-destructive/90 disabled:bg-card disabled:text-muted-foreground disabled:cursor-not-allowed border border-destructive text-destructive-foreground font-medium"
              >
                📄 Ekspor PDF ({riwayatSorted.length})
              </button>
              {riwayat.length > 0 && (
                <button
                  onClick={() => setRiwayat([])}
                  className="text-ms-xs px-ms-3 py-1.5 rounded-lg bg-background/60 hover:bg-background border border-border text-muted-foreground"
                >
                  Bersihkan
                </button>
              )}
            </div>
          </div>

          {riwayatSorted.length === 0 ? (
            <div className="text-center py-8 text-ms-sm text-muted-foreground">
              {riwayat.length === 0
                ? "Belum ada transaksi. Lakukan pembayaran untuk melihat riwayat di sini."
                : "Tidak ada transaksi pada rentang tanggal terpilih."}
            </div>
          ) : (
            <>
              {/* WA share form */}
              <div className={`rounded-xl border border-border bg-background/40 ${modeRingkas ? "mb-2 p-ms-2" : "mb-4 p-ms-3"}`}>
                <div className={`flex items-center justify-between gap-ms-2 ${modeRingkas ? "mb-1" : "mb-2"}`}>
                  <span className="text-ms-xs font-semibold text-foreground uppercase tracking-wider">
                    💬 Kirim Struk via WA
                  </span>
                  {waReady ? (
                    <span className="text-ms-2xs text-success font-mono truncate">
                      → {waNomorDisplay}
                    </span>
                  ) : (
                    <span className="text-ms-2xs text-warning">Lengkapi nomor & lokasi</span>
                  )}
                </div>

                <div className={`grid md:grid-cols-2 ${modeRingkas ? "gap-ms-1.5" : "gap-ms-2"}`}>
                  <div>
                    <label className="text-ms-2xs uppercase tracking-wider text-muted-foreground">
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
                      className={`w-full text-ms-sm rounded-lg bg-background/60 border text-foreground font-mono focus:outline-none focus:ring-2 ${
                        waNomor && !waNomorNorm
                          ? "border-red-500/60 focus:border-red-500 focus:ring-red-500/30"
                          : "border-border focus:border-success focus:ring-success/30"
                      } ${modeRingkas ? "mt-0.5 px-ms-2 py-1" : "mt-1 px-ms-3 py-ms-2"}`}
                    />
                    {waNomorError && waNomor.trim() !== "" && (
                      <p className="mt-1 text-ms-2xs text-red-300">{waNomorError}</p>
                    )}
                    {!waNomorError && waNomorDisplay && (
                      <p className="mt-1 text-ms-2xs text-muted-foreground font-mono">
                        Terformat: {waNomorDisplay}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-ms-2xs uppercase tracking-wider text-muted-foreground">
                      Lokasi (URL Maps / http-https)
                    </label>
                    <div className={`flex items-stretch gap-ms-2 ${modeRingkas ? "mt-0.5" : "mt-1"}`}>
                      <input
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        value={waLokasi}
                        onChange={(e) => setWaLokasi(e.target.value)}
                        placeholder="https://maps.google.com/…"
                        maxLength={500}
                        aria-invalid={!!waLokasiTrim && !waLokasiValid}
                        className={`flex-1 min-w-0 text-ms-sm rounded-lg bg-background/60 border text-foreground focus:outline-none focus:ring-2 ${
                          waLokasiTrim && !waLokasiValid
                            ? "border-red-500/60 focus:border-red-500 focus:ring-red-500/30"
                            : "border-border focus:border-success focus:ring-success/30"
                        } ${modeRingkas ? "px-ms-2 py-1" : "px-ms-3 py-ms-2"}`}
                      />
                      <button
                        type="button"
                        onClick={ambilLokasiGps}
                        disabled={gpsBusy}
                        title="Ambil lokasi GPS saat ini"
                        aria-label="Ambil lokasi GPS saat ini"
                        className={`shrink-0 inline-flex items-center gap-ms-1 rounded-lg border border-success/40 bg-success/10 text-success hover:bg-success/20 disabled:opacity-60 ${modeRingkas ? "px-ms-2 py-1 text-ms-xs" : "px-ms-3 py-ms-2 text-ms-sm"}`}
                      >
                        📍 <span>{gpsBusy ? "…" : "GPS"}</span>
                      </button>
                    </div>
                    {waLokasiError && waLokasiTrim !== "" && (
                      <p className="mt-1 text-ms-2xs text-red-300">{waLokasiError}</p>
                    )}
                  </div>
                </div>

              </div>

              {/* Mobile: card list */}
              <div className={`grid md:hidden ${modeRingkas ? "gap-ms-1.5" : "gap-ms-2"}`}>
                <div className="flex items-center justify-between gap-ms-2">
                  <span className={`text-muted-foreground ${modeRingkas ? "text-ms-2xs" : "text-ms-xs"}`}>Urutan</span>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setUrutan("terbaru")}
                      className={`text-ms-xs font-medium transition-colors ${
                        urutan === "terbaru"
                          ? "bg-success text-success-foreground"
                          : "bg-background/60 text-muted-foreground hover:bg-background"
                      } ${modeRingkas ? "px-ms-2 py-1" : "px-ms-2.5 py-1.5"}`}
                      aria-pressed={urutan === "terbaru"}
                    >
                      Terbaru
                    </button>
                    <button
                      type="button"
                      onClick={() => setUrutan("terlama")}
                      className={`text-ms-xs font-medium transition-colors ${
                        urutan === "terlama"
                          ? "bg-success text-success-foreground"
                          : "bg-background/60 text-muted-foreground hover:bg-background"
                      } ${modeRingkas ? "px-ms-2 py-1" : "px-ms-2.5 py-1.5"}`}
                      aria-pressed={urutan === "terlama"}
                    >
                      Terlama
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">🔍</span>
                  <input
                    type="search"
                    inputMode="search"
                    value={cariTransaksi}
                    onChange={(e) => setCariTransaksi(e.target.value)}
                    placeholder="Cari nama produk atau waktu…"
                    className={`w-full pl-9 rounded-lg bg-background/60 border border-border text-ms-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-success ${cariTransaksi ? "pr-20" : "pr-3"} ${modeRingkas ? "py-1.5" : "py-ms-2"}`}
                  />
                  {cariTransaksi && (
                    <button
                      type="button"
                      onClick={() => setCariTransaksi("")}
                      className={`absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-muted text-foreground text-ms-xs font-medium hover:bg-muted transition-colors ${modeRingkas ? "px-ms-2 py-0.5" : "px-ms-2.5 py-1"}`}
                      aria-label="Bersihkan pencarian"
                    >
                      Bersihkan
                    </button>
                  )}
                </div>

                {riwayatCariMobile.length === 0 ? (
                  <div className="text-center py-ms-6 text-ms-xs text-muted-foreground">
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
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 bg-destructive/90 rounded-xl">
                          <button
                            type="button"
                            onClick={() => batalkanTransaksi(t)}
                            className="text-destructive-foreground text-ms-xs font-semibold px-ms-3 py-1.5 rounded-md bg-destructive hover:bg-destructive/90"
                          >
                            ↶ Batalkan
                          </button>
                        </div>
                      )}
                      <div
                        className={`rounded-xl bg-background/60 border border-border relative transition-transform touch-pan-y ${modeRingkas ? "p-ms-2" : "p-ms-3"}`}
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

                      <div className="flex items-center justify-between gap-ms-2">
                        <div className="flex min-w-0 items-center gap-ms-2">
                          <span className={`shrink-0 ${modeRingkas ? "text-ms-lg" : "text-ms-xl"}`}>{t.produkEmoji}</span>
                          <div className="min-w-0">
                            <div className="text-ms-sm font-medium truncate">{t.produkNama}</div>
                            <div className="text-ms-2xs text-muted-foreground font-mono">{waktuFmt.format(t.waktu)}</div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-success font-mono font-semibold text-ms-sm">{rupiah(t.total)}</div>
                          <div className="text-ms-2xs text-muted-foreground font-mono">
                            {t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {unitOf(t)}
                          </div>
                        </div>
                      </div>
                      <div className={`border-t border-border flex justify-between text-ms-2xs text-muted-foreground ${modeRingkas ? "mt-1.5 pt-1.5" : "mt-2 pt-2"}`}>
                        <span>@ {rupiah(t.hargaPerKg)}/{unitOf(t)}</span>
                        <span>
                          Sisa:{" "}
                          <span className="text-foreground font-mono">{t.sisaStokKg.toLocaleString("id-ID")} {unitOf(t)}</span>
                        </span>
                      </div>
                      <div className={`flex ${modeRingkas ? "mt-1.5 gap-ms-1.5" : "mt-2 gap-ms-2"}`}>
                        <button
                          type="button"
                          onClick={() => kirimWa(t)}
                          disabled={!waReady}
                          title={waDisabledReason || `Kirim struk ke ${waNomorDisplay}`}
                          aria-disabled={!waReady}
                          className={`flex-1 rounded-lg text-ms-2xs font-semibold bg-success hover:bg-success disabled:bg-card disabled:text-muted-foreground disabled:cursor-not-allowed text-success-foreground transition-colors ${modeRingkas ? "py-1" : "py-1.5"}`}
                        >
                          💬 Kirim WA
                        </button>
                        {isTerakhir && (
                          <button
                            type="button"
                            onClick={() => batalkanTransaksi(t)}
                            className={`rounded-lg text-ms-2xs font-semibold bg-destructive hover:bg-destructive/90 text-destructive-foreground transition-colors ${modeRingkas ? "px-ms-2 py-1" : "px-ms-3 py-1.5"}`}
                            title="Batalkan transaksi terakhir & kembalikan stok"
                          >
                            ↶ Batalkan
                          </button>
                        )}
                      </div>
                      {isTerakhir && (
                        <div className={`text-ms-2xs text-muted-foreground text-center ${modeRingkas ? "mt-0.5" : "mt-1"}`}>
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
                <table className="w-full text-ms-sm">
                  <thead>
                    <tr className="text-left text-ms-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="py-ms-2 pr-3 font-medium">Waktu</th>
                      <th className="py-ms-2 pr-3 font-medium">Produk</th>
                      <th className="py-ms-2 pr-3 font-medium text-right">Jumlah</th>
                      <th className="py-ms-2 pr-3 font-medium text-right">Harga/unit</th>
                      <th className="py-ms-2 pr-3 font-medium text-right">Total</th>
                      <th className="py-ms-2 font-medium text-right">Sisa Stok</th>
                      <th className="py-ms-2 font-medium text-right">WA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {riwayatSorted.map((t) => (
                      <tr key={t.id} className="hover:bg-background/40">
                        <td className="py-ms-2 pr-3 font-mono text-ms-xs text-muted-foreground">{waktuFmt.format(t.waktu)}</td>
                        <td className="py-ms-2 pr-3">
                          <span className="mr-1.5">{t.produkEmoji}</span>
                          {t.produkNama}
                        </td>
                        <td className="py-ms-2 pr-3 text-right font-mono">
                          {t.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {unitOf(t)}
                        </td>
                        <td className="py-ms-2 pr-3 text-right font-mono text-muted-foreground">{rupiah(t.hargaPerKg)}</td>
                        <td className="py-ms-2 pr-3 text-right font-mono font-semibold text-success">
                          {rupiah(t.total)}
                        </td>
                        <td className="py-ms-2 text-right font-mono text-foreground">
                          {t.sisaStokKg.toLocaleString("id-ID")} {unitOf(t)}
                        </td>
                        <td className="py-ms-2 text-right">
                          <button
                            type="button"
                            onClick={() => kirimWa(t)}
                            disabled={!waReady}
                            title={waDisabledReason || `Kirim struk ke ${waNomorDisplay}`}
                            aria-disabled={!waReady}
                            className="px-ms-2.5 py-1 rounded-md text-ms-2xs font-semibold bg-success hover:bg-success disabled:bg-card disabled:text-muted-foreground disabled:cursor-not-allowed text-success-foreground transition-colors"
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
          <div className="fixed app-fab-bottom left-1/2 -translate-x-1/2 bg-background border border-success/50 rounded-xl px-ms-5 py-ms-3 shadow-2xl text-ms-sm z-50 animate-in fade-in slide-in-from-bottom-4">
            {toast}
          </div>
        )}

        {/* Bilah aksi saat keyboard terbuka: total + Bayar tetap terlihat
            di atas keyboard sehingga user tak perlu menutup keyboard dulu. */}
        {keyboardInset > 0 && (
          <div className="app-keyboard-action-bar md:hidden border-t border-border bg-background/95 backdrop-blur px-ms-3 py-ms-2 shadow-2xl">
            <div className="flex items-center gap-ms-3">
              <div className="min-w-0 flex-1">
                <p className="text-ms-2xs text-muted-foreground truncate">
                  {selected.emoji} {selected.nama} · {berat.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {unit}
                </p>
                <p className="text-ms-base font-bold font-mono text-success truncate">{rupiah(total)}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  (document.activeElement as HTMLElement | null)?.blur?.();
                }}
                className="shrink-0 rounded-lg border border-border bg-card px-ms-3 py-ms-2 text-ms-xs font-semibold text-muted-foreground"
              >
                Selesai
              </button>
              <button
                type="button"
                onClick={bayar}
                disabled={!bayarSiap}
                className="shrink-0 rounded-lg bg-success px-ms-4 py-ms-2 text-ms-sm font-bold text-success-foreground shadow-lg shadow-success/30 disabled:bg-muted disabled:text-muted-foreground"
              >
                💳 Bayar
              </button>
            </div>
          </div>
        )}

        {strukTransaksi && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-ms-3 animate-in fade-in"
            onClick={() => setStrukTransaksi(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-background border border-success/40 shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-ms-4 py-ms-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-ms-2">
                  <span className="text-ms-lg">🧾</span>
                  <span className="text-ms-sm font-semibold text-success">Struk Transaksi</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStrukTransaksi(null)}
                  className="text-muted-foreground hover:text-foreground text-ms-lg leading-none px-1"
                  aria-label="Tutup"
                >
                  ✕
                </button>
              </div>
              <div className="p-ms-4 space-ms-3">
                <div className="flex items-center gap-ms-3">
                  <span className="text-ms-3xl">{strukTransaksi.produkEmoji}</span>
                  <div className="min-w-0">
                    <div className="text-ms-base font-semibold text-foreground truncate">
                      {strukTransaksi.produkNama}
                    </div>
                    <div className="text-ms-2xs text-muted-foreground font-mono">
                      {new Date(strukTransaksi.waktu).toLocaleString("id-ID")}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg bg-card/60 border border-border p-ms-3 text-ms-sm space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Jumlah</span>
                    <span className="text-foreground">
                      {strukTransaksi.beratKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {unitOf(strukTransaksi)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Harga/{unitOf(strukTransaksi)}</span>
                    <span className="text-foreground">{rupiah(strukTransaksi.hargaPerKg)}</span>
                  </div>
                  <div className="flex justify-between pt-1.5 border-t border-border">
                    <span className="text-foreground">Total</span>
                    <span className="text-success font-semibold text-ms-base">
                      {rupiah(strukTransaksi.total)}
                    </span>
                  </div>
                  <div className="flex justify-between text-ms-2xs text-muted-foreground">
                    <span>Sisa stok</span>
                    <span>
                      {strukTransaksi.sisaStokKg.toLocaleString("id-ID", { maximumFractionDigits: 3 })} {unitOf(strukTransaksi)}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-ms-2">
                  <button
                    type="button"
                    onClick={() => salinStruk(strukTransaksi)}
                    className="py-ms-2.5 rounded-lg text-ms-xs font-semibold bg-muted hover:bg-muted text-foreground transition-colors"
                  >
                    📋 Salin ringkasan
                  </button>
                  <button
                    type="button"
                    onClick={() => kirimWa(strukTransaksi)}
                    disabled={!waReady}
                    title={waDisabledReason || `Kirim ulang ke ${waNomorDisplay}`}
                    aria-disabled={!waReady}
                    className="py-ms-2.5 rounded-lg text-ms-xs font-semibold bg-success hover:bg-success disabled:bg-card disabled:text-muted-foreground disabled:cursor-not-allowed text-success-foreground transition-colors"
                  >
                    💬 Kirim ulang WA
                  </button>
                </div>
                {!waReady && (
                  <p className="text-ms-2xs text-warning/80 text-center">
                    {waDisabledReason}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setStrukTransaksi(null)}
                  className="w-full py-ms-2 rounded-lg text-ms-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Tutup
                </button>
              </div>
            </div>
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
