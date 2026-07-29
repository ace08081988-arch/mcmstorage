/**
 * Ekspor ringkasan analytics harian ke CSV / PDF.
 * Angka diterima apa adanya dari pemanggil (SSOT penjualan) — tidak ada
 * perhitungan ulang di sini.
 */
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

export async function exportAnalyticsPdf(data: AnalyticsExportData) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = (autoTableMod as unknown as { default: (doc: unknown, opts: unknown) => void })
    .default;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(16);
  doc.text(data.judul, 40, 48);
  doc.setFontSize(10);
  doc.text(`Dibuat: ${data.tanggal.toLocaleString("id-ID")}`, 40, 66);
  doc.text("Sumber angka: penjualan (SSOT)", 40, 80);

  autoTable(doc, {
    startY: 100,
    head: [["Metrik", "Nilai"]],
    body: [
      ["Omzet", rupiah(data.omzet)],
      ["Transaksi", num(data.trx)],
      ["Unit terjual", num(data.unit)],
      ["Terlaris", data.terlaris],
    ],
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [49, 46, 129] },
  });

  const afterY =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 180;

  autoTable(doc, {
    startY: afterY + 24,
    head: [["Waktu", "Produk", "Qty", "Satuan", "Total"]],
    body: data.rows.map((r) => [r.waktu, r.produk, num(r.qty), r.unit, rupiah(r.total)]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [49, 46, 129] },
    columnStyles: { 2: { halign: "right" }, 4: { halign: "right" } },
  });

  doc.save(`ringkasan-analytics-${stamp(data.tanggal)}.pdf`);
}