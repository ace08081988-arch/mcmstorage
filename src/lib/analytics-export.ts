/**
 * Ekspor ringkasan analytics harian ke CSV / PDF.
 * Angka diterima apa adanya dari pemanggil (SSOT penjualan) — tidak ada
 * perhitungan ulang di sini.
 */
import { getOrgName, getOrgLogo, getOrgBrand } from "@/lib/org-name";

export type AnalyticsExportRow = {
  waktu: string;
  produk: string;
  qty: number;
  unit: string;
  total: number;
};

export type AnalyticsExportData = {
  judul: string;
  tanggal: Date;
  omzet: number;
  trx: number;
  unit: number;
  terlaris: string;
  rows: AnalyticsExportRow[];
};

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const num = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

function stamp(d: Date) {
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** Ambil logo sebagai data URL (aman untuk data URL maupun URL remote). */
async function loadLogo(src: string): Promise<{ data: string; fmt: "PNG" | "JPEG"; w: number; h: number } | null> {
  if (!src) return null;
  try {
    let dataUrl = src;
    if (!src.startsWith("data:")) {
      const res = await fetch(src, { mode: "cors" });
      if (!res.ok) return null;
      const blob = await res.blob();
      dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("read fail"));
        fr.readAsDataURL(blob);
      });
    }
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = () => reject(new Error("img fail"));
      img.src = dataUrl;
    });
    const fmt: "PNG" | "JPEG" = /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";
    return { data: dataUrl, fmt, w: dims.w, h: dims.h };
  } catch {
    return null;
  }
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function exportAnalyticsCsv(data: AnalyticsExportData) {
  const lines: string[] = [];
  lines.push(esc(data.judul));
  lines.push(esc(`Dibuat: ${data.tanggal.toLocaleString("id-ID")}`));
  lines.push("");
  lines.push(["Metrik", "Nilai"].map(esc).join(";"));
  lines.push(["Omzet", rupiah(data.omzet)].map(esc).join(";"));
  lines.push(["Transaksi", num(data.trx)].map(esc).join(";"));
  lines.push(["Unit terjual", num(data.unit)].map(esc).join(";"));
  lines.push(["Terlaris", data.terlaris].map(esc).join(";"));
  lines.push("");
  lines.push(["Waktu", "Produk", "Qty", "Satuan", "Total"].map(esc).join(";"));
  for (const r of data.rows) {
    lines.push([r.waktu, r.produk, num(r.qty), r.unit, Math.round(r.total)].map(esc).join(";"));
  }
  // BOM agar Excel id-ID membaca UTF-8 dengan benar
  download(
    new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
    `ringkasan-analytics-${stamp(data.tanggal)}.csv`,
  );
}

export async function exportAnalyticsPdf(data: AnalyticsExportData) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = (autoTableMod as unknown as { default: (doc: unknown, opts: unknown) => void })
    .default;

  // Selalu portrait A4 agar hasil konsisten saat dicetak/dibagikan.
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Identitas bisnis untuk kop dokumen
  const orgName = getOrgName();
  const logo = await loadLogo(getOrgLogo());
  const brand = hexToRgb(getOrgBrand()) ?? ([49, 46, 129] as [number, number, number]);

  const rowCount = data.rows.length;
  const longestProduct = data.rows.reduce((m, r) => Math.max(m, r.produk.length), 0);

  // Margin otomatis: makin padat konten (banyak baris / nama produk panjang),
  // makin ramping margin supaya tabel tidak terpotong; konten sedikit → lega.
  const dense = rowCount > 24 || longestProduct > 28;
  const roomy = rowCount <= 8 && longestProduct <= 18;
  const marginX = dense ? 28 : roomy ? 56 : 40;
  const bandH = 46;
  const marginTop = (dense ? 34 : 44) + bandH;
  const marginBottom = 46;
  const contentW = pageW - marginX * 2;

  const bodyFont = dense ? 8 : 9.5;
  const cellPad = dense ? 3.5 : 5;

  // Kop resmi: logo + nama bisnis, digambar di setiap halaman.
  const drawBrandHeader = () => {
    doc.setFillColor(brand[0], brand[1], brand[2]);
    doc.rect(0, 0, pageW, bandH, "F");
    let tx = marginX;
    if (logo) {
      const maxH = bandH - 16;
      const h = maxH;
      const w = Math.min(maxH * (logo.w / logo.h), 90);
      try {
        doc.addImage(logo.data, logo.fmt, marginX, (bandH - h) / 2, w, h, undefined, "FAST");
        tx = marginX + w + 10;
      } catch { /* logo gagal dimuat — lanjut tanpa logo */ }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.text(orgName, tx, bandH / 2 + 1, { baseline: "middle" });
    doc.setFontSize(8);
    doc.text("Laporan resmi", pageW - marginX, bandH / 2 + 1, {
      align: "right",
      baseline: "middle",
    });
    doc.setTextColor(0);
  };
  drawBrandHeader();

  // Header dokumen
  let y = marginTop + 8;
  doc.setFontSize(dense ? 14 : 16);
  doc.text(doc.splitTextToSize(data.judul, contentW), marginX, y);
  y += dense ? 16 : 18;
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Dibuat: ${data.tanggal.toLocaleString("id-ID")}`, marginX, y);
  y += 12;
  doc.text("Sumber angka: penjualan (SSOT)", marginX, y);
  doc.setTextColor(0);
  y += dense ? 12 : 16;

  const common = {
    margin: { left: marginX, right: marginX, top: marginTop, bottom: marginBottom },
    tableWidth: contentW,
    headStyles: { fillColor: brand, fontSize: bodyFont },
    theme: "grid" as const,
    didDrawPage: () => drawBrandHeader(),
  };

  autoTable(doc, {
    ...common,
    startY: y,
    head: [["Metrik", "Nilai"]],
    body: [
      ["Omzet", rupiah(data.omzet)],
      ["Transaksi", num(data.trx)],
      ["Unit terjual", num(data.unit)],
      ["Terlaris", data.terlaris],
    ],
    styles: { fontSize: bodyFont, cellPadding: cellPad, overflow: "linebreak" },
    columnStyles: {
      0: { cellWidth: contentW * 0.35, fontStyle: "bold" },
      1: { cellWidth: contentW * 0.65, halign: "right" },
    },
  });

  const afterY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 80;

  autoTable(doc, {
    ...common,
    startY: afterY + (dense ? 14 : 22),
    head: [["Waktu", "Produk", "Qty", "Satuan", "Total"]],
    body: data.rows.map((r) => [r.waktu, r.produk, num(r.qty), r.unit, rupiah(r.total)]),
    // Ulangi header di tiap halaman & jangan potong baris di tepi halaman.
    showHead: "everyPage",
    rowPageBreak: "avoid",
    styles: { fontSize: bodyFont, cellPadding: cellPad, overflow: "linebreak", valign: "middle" },
    columnStyles: {
      0: { cellWidth: contentW * 0.14 },
      1: { cellWidth: contentW * 0.42 },
      2: { cellWidth: contentW * 0.11, halign: "right" },
      3: { cellWidth: contentW * 0.13 },
      4: { cellWidth: contentW * 0.2, halign: "right" },
    },
    didDrawPage: () => {
      drawBrandHeader();
      const page = doc.getCurrentPageInfo().pageNumber;
      doc.setFontSize(8);
      doc.setTextColor(130);
      doc.text(`Halaman ${page}`, pageW - marginX, pageH - marginBottom / 2, {
        align: "right",
      });
      doc.text(orgName, marginX, pageH - marginBottom / 2);
      doc.setTextColor(0);
    },
  });

  doc.save(`ringkasan-analytics-${stamp(data.tanggal)}.pdf`);
}