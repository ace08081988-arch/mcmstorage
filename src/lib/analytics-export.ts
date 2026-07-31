/**
 * Ekspor ringkasan analytics harian ke CSV / PDF.
 * Angka diterima apa adanya dari pemanggil (SSOT penjualan) — tidak ada
 * perhitungan ulang di sini.
 */
import { prepareBrandHeader, drawSignatureBlock } from "@/lib/pdf-brand";
import { nextDocNumber, docNumberSlug } from "@/lib/doc-number";
import { getPdfPrefs, densityFactor } from "@/lib/pdf-prefs";

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

export function analyticsPdfFilename(data: AnalyticsExportData, docNo?: string) {
  return docNo
    ? `${docNumberSlug(docNo)}-ringkasan-analytics.pdf`
    : `ringkasan-analytics-${stamp(data.tanggal)}.pdf`;
}

/** Bangun PDF sebagai Blob (dipakai untuk pratinjau sebelum unduh). */
export async function buildAnalyticsPdfBlob(
  data: AnalyticsExportData,
): Promise<{ blob: Blob; filename: string; docNumber: string }> {
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

  const rowCount = data.rows.length;
  const longestProduct = data.rows.reduce((m, r) => Math.max(m, r.produk.length), 0);

  // Preferensi pengguna: kerapatan margin + skala font.
  const prefs = getPdfPrefs();
  const dFactor = densityFactor(prefs.density);
  const fScale = prefs.fontScale;

  // Margin otomatis: makin padat konten (banyak baris / nama produk panjang),
  // makin ramping margin supaya tabel tidak terpotong; konten sedikit → lega.
  const dense = rowCount > 24 || longestProduct > 28;
  const roomy = rowCount <= 8 && longestProduct <= 18;
  const marginX = Math.round((dense ? 28 : roomy ? 56 : 40) * dFactor);
  const marginBottom = Math.round(46 * dFactor);
  const contentW = pageW - marginX * 2;

  const bodyFont = (dense ? 8 : 9.5) * fScale;
  const cellPad = (dense ? 3.5 : 5) * dFactor;

  // Kop resmi: logo + nama bisnis, digambar di setiap halaman.
  // Nomor dokumen otomatis (INV-YYYYMMDD-XXXX) untuk jejak audit.
  const docNo = await nextDocNumber("INV", data.tanggal);
  const { bandH, orgName, brand, draw: drawBrandHeader } = await prepareBrandHeader(doc, {
    marginX,
    docNumber: docNo,
    subtitle: "Dokumen resmi",
  });
  const marginTop = Math.round((dense ? 34 : 44) * dFactor) + bandH;
  drawBrandHeader();

  // Header dokumen
  let y = marginTop + 8;
  doc.setFontSize((dense ? 14 : 16) * fScale);
  doc.text(doc.splitTextToSize(data.judul, contentW), marginX, y);
  y += dense ? 16 : 18;
  doc.setFontSize(9 * fScale);
  doc.setTextColor(110);
  doc.text(`Dibuat: ${data.tanggal.toLocaleString("id-ID")}`, marginX, y);
  y += 12;
  doc.text(`No. dokumen: ${docNo}`, marginX, y);
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

  // Ruang tanda tangan admin + tanggal (halaman terakhir), siap dicap.
  const tableEndY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? afterY;
  const drawFooter = () => {
    const page = doc.getCurrentPageInfo().pageNumber;
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(`Halaman ${page}`, pageW - marginX, pageH - marginBottom / 2, { align: "right" });
    doc.text(orgName, marginX, pageH - marginBottom / 2);
    doc.setTextColor(0);
  };
  let signY = tableEndY;
  if (tableEndY + 24 + 96 > pageH - marginBottom) {
    doc.addPage();
    drawBrandHeader();
    drawFooter();
    signY = marginTop;
  }
  drawSignatureBlock(doc, {
    marginX,
    marginBottom,
    fontScale: fScale,
    date: data.tanggal,
    startY: signY,
    docNumber: docNo,
  });

  return {
    blob: doc.output("blob") as Blob,
    filename: analyticsPdfFilename(data, docNo),
    docNumber: docNo,
  };
}

export async function exportAnalyticsPdf(data: AnalyticsExportData) {
  const { blob, filename } = await buildAnalyticsPdfBlob(data);
  download(blob, filename);
}