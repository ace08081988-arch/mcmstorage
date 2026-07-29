/**
 * Helper ekspor ringkasan konfirmasi auto-Kirim ke CSV & PDF supaya
 * owner bisa mengarsipkan / verifikasi biaya di luar aplikasi.
 *
 * Kontrak input sengaja pakai bentuk primitif (bukan `EcerPreparation`)
 * agar mudah dites & dipakai ulang.
 */
import { rupiah } from "@/lib/stock-format";

export type AutoSendExportGroup = {
  key: string;
  label: string;
  count: number;
  grams: number;
  isOther: boolean;
};

export type AutoSendExportPayload = {
  itemName: string;
  titleName: string;
  unit: string;
  unitPrice: number; // 0 = harga belum tersedia
  totalCount: number;
  totalGrams: number;
  totalPrice: number;
  groups: AutoSendExportGroup[];
  generatedAt: Date;
};

function csvCell(v: string | number): string {
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Bentuk CSV: metadata di baris atas, baris kosong, tabel breakdown. */
export function buildAutoSendSummaryCsv(p: AutoSendExportPayload): string {
  const lines: string[] = [];
  lines.push(csvCell("Ringkasan Auto-Kirim"));
  lines.push(["Produk", csvCell(p.itemName)].join(","));
  lines.push(["Judul", csvCell(p.titleName)].join(","));
  lines.push(["Waktu", csvCell(p.generatedAt.toISOString())].join(","));
  lines.push(["Total kotak", String(p.totalCount)].join(","));
  lines.push([`Total ${p.unit}`, String(p.totalGrams)].join(","));
  if (p.unitPrice > 0) {
    lines.push([`Harga per ${p.unit}`, String(p.unitPrice)].join(","));
    lines.push(["Total harga (Rp)", String(p.totalPrice)].join(","));
  }
  lines.push("");
  lines.push(
    [
      "Produk",
      "Status",
      "Jumlah kotak",
      `Total ${p.unit}`,
      "Total harga (Rp)",
    ]
      .map(csvCell)
      .join(","),
  );
  for (const g of p.groups) {
    lines.push(
      [
        csvCell(g.label),
        csvCell(g.isOther ? "Produk lain" : "Produk utama"),
        String(g.count),
        String(g.grams),
        p.unitPrice > 0 ? String(g.grams * p.unitPrice) : "",
      ].join(","),
    );
  }
  return lines.join("\n");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "ringkasan";
}

export function autoSendExportFilename(
  p: AutoSendExportPayload,
  ext: "csv" | "pdf",
): string {
  const stamp = p.generatedAt
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  return `auto-send-${slugify(p.itemName)}-${stamp}.${ext}`;
}

/** Pemicu download blob (browser-only). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/**
 * Bangun PDF ringkasan pakai jsPDF. Dipisah dari komponen supaya import
 * jsPDF hanya terjadi saat owner benar-benar menekan Ekspor PDF.
 */
export async function buildAutoSendSummaryPdf(
  p: AutoSendExportPayload,
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const { getPdfPrefs, densityFactor } = await import("@/lib/pdf-prefs");
  const prefs = getPdfPrefs();
  const dFactor = densityFactor(prefs.density);
  const fScale = prefs.fontScale;
  const lineH = (n: number) => n * dFactor * fScale;
  const margin = Math.round(40 * dFactor);
  const { prepareBrandHeader, drawSignatureBlock } = await import("@/lib/pdf-brand");
  const { bandH, draw: drawBrandHeader } = await prepareBrandHeader(doc, { marginX: margin });
  drawBrandHeader();
  let y = margin + bandH;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16 * fScale);
  doc.text("Ringkasan Auto-Kirim", margin, y);
  y += lineH(20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10 * fScale);
  const meta: Array<[string, string]> = [
    ["Produk", p.itemName],
    ["Judul", p.titleName],
    ["Waktu", p.generatedAt.toLocaleString("id-ID")],
    ["Total kotak", `${p.totalCount} kotak`],
    [`Total ${p.unit}`, `${p.totalGrams} ${p.unit}`],
  ];
  if (p.unitPrice > 0) {
    meta.push([`Harga per ${p.unit}`, rupiah(p.unitPrice)]);
    meta.push(["Total harga", rupiah(p.totalPrice)]);
  }
  for (const [k, v] of meta) {
    doc.text(`${k}:`, margin, y);
    doc.text(v, margin + 110, y);
    y += lineH(14);
  }
  y += lineH(6);

  // Header tabel
  doc.setFont("helvetica", "bold");
  doc.setFillColor(230, 230, 235);
  doc.rect(margin, y - 10, pageW - margin * 2, lineH(16), "F");
  doc.text("Produk", margin + 4, y);
  doc.text("Jml", margin + 240, y);
  doc.text(`Total ${p.unit}`, margin + 290, y);
  if (p.unitPrice > 0) doc.text("Total harga", margin + 380, y);
  y += lineH(14);
  doc.setFont("helvetica", "normal");

  for (const g of p.groups) {
    if (y > 780) {
      doc.addPage();
      drawBrandHeader();
      y = margin + bandH;
    }
    if (g.isOther) doc.setTextColor(180, 30, 30);
    else doc.setTextColor(20, 20, 20);
    const label = `${g.isOther ? "! " : ""}${g.label}`;
    doc.text(doc.splitTextToSize(label, 220), margin + 4, y);
    doc.text(String(g.count), margin + 240, y);
    doc.text(`${g.grams} ${p.unit}`, margin + 290, y);
    if (p.unitPrice > 0)
      doc.text(rupiah(g.grams * p.unitPrice), margin + 380, y);
    y += lineH(16);
  }
  doc.setTextColor(20, 20, 20);

  if (p.unitPrice > 0 && p.groups.some((g) => g.isOther)) {
    y += 6;
    doc.setFontSize(9 * fScale);
    doc.setTextColor(180, 30, 30);
    doc.text(
      "! Harga produk lain memakai tarif produk utama — perbaiki seleksi sebelum lanjut.",
      margin,
      y,
    );
    doc.setTextColor(20, 20, 20);
  }

  // Ruang tanda tangan admin + tanggal di halaman terakhir.
  const pageH = doc.internal.pageSize.getHeight();
  if (y + 24 + 96 > pageH - margin) {
    doc.addPage();
    drawBrandHeader();
    y = margin + bandH;
  }
  drawSignatureBlock(doc, {
    marginX: margin,
    marginBottom: margin,
    fontScale: fScale,
    date: p.generatedAt,
    startY: y,
  });

  return doc.output("blob");
}