/**
 * Ekspor laporan hutang/piutang (dari header chat) ke CSV (Excel) & PDF.
 *
 * Angka WAJIB berasal dari SSOT `party_balance_v1()` — modul ini hanya
 * memformat, tidak menghitung ulang saldo.
 */
import { rupiah } from "@/lib/stock-format";
import { loadJsPDF } from "@/lib/pdf-loader";
import { downloadBlob } from "@/lib/auto-send-export";
import type { DebtReportLine } from "@/lib/debt-report";

export type DebtExportPayload = {
  peerName: string;
  hutang: number;
  piutang: number;
  history: DebtReportLine[];
  generatedAt?: Date;
};

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "kontak"
  );
}

export function debtExportFilename(
  p: DebtExportPayload,
  ext: "csv" | "pdf",
): string {
  const at = p.generatedAt ?? new Date();
  const stamp = at.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `hutang-piutang-${slug(p.peerName)}-${stamp}.${ext}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "-"
    : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export function buildDebtReportCsv(p: DebtExportPayload): string {
  const at = p.generatedAt ?? new Date();
  const net = p.piutang - p.hutang;
  const lines: string[] = [];
  lines.push(cell("Laporan Hutang & Piutang"));
  lines.push(["Pihak", cell(p.peerName)].join(","));
  lines.push(["Waktu", cell(at.toISOString())].join(","));
  lines.push(["Piutang (Rp)", String(Math.max(0, p.piutang))].join(","));
  lines.push(["Hutang (Rp)", String(Math.max(0, p.hutang))].join(","));
  lines.push(
    [
      "Saldo akhir (Rp)",
      String(net),
      cell(net === 0 ? "LUNAS" : net > 0 ? "tagihan ke pihak" : "kewajiban ke pihak"),
    ].join(","),
  );
  lines.push("");
  lines.push(["Tanggal", "Jenis", "Tipe", "Nominal (Rp)", "Catatan"].map(cell).join(","));
  for (const h of p.history) {
    lines.push(
      [
        cell(fmtDate(h.at)),
        cell(h.kind),
        cell(h.type),
        String(h.type === "tagihan" ? h.amount : -h.amount),
        cell(h.note ?? ""),
      ].join(","),
    );
  }
  lines.push("");
  lines.push(cell("Sumber angka: buku Hutang & Piutang MCM Storage (party_balance_v1)."));
  return lines.join("\n");
}

export async function buildDebtReportPdf(p: DebtExportPayload): Promise<Blob> {
  const JsPDF = await loadJsPDF();
  const at = p.generatedAt ?? new Date();
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Laporan Hutang & Piutang", margin, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const net = p.piutang - p.hutang;
  const meta: Array<[string, string]> = [
    ["Pihak", p.peerName],
    ["Waktu", at.toLocaleString("id-ID")],
    ["Piutang (menagih)", rupiah(Math.max(0, p.piutang))],
    ["Hutang (membayar)", rupiah(Math.max(0, p.hutang))],
    [
      "Saldo akhir",
      net === 0
        ? "LUNAS"
        : net > 0
          ? `${rupiah(net)} (tagihan ke ${p.peerName})`
          : `${rupiah(Math.abs(net))} (kewajiban ke ${p.peerName})`,
    ],
  ];
  for (const [k, v] of meta) {
    doc.text(`${k}:`, margin, y);
    doc.text(v, margin + 130, y);
    y += 14;
  }
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFillColor(230, 230, 235);
  doc.rect(margin, y - 10, pageW - margin * 2, 16, "F");
  doc.text("Tanggal", margin + 4, y);
  doc.text("Jenis", margin + 90, y);
  doc.text("Tipe", margin + 160, y);
  doc.text("Nominal", margin + 250, y);
  doc.text("Catatan", margin + 350, y);
  y += 16;
  doc.setFont("helvetica", "normal");

  if (p.history.length === 0) {
    doc.setTextColor(120, 120, 120);
    doc.text("Belum ada riwayat perubahan.", margin + 4, y);
    doc.setTextColor(20, 20, 20);
    y += 16;
  }
  for (const h of p.history) {
    if (y > 780) {
      doc.addPage();
      y = margin;
    }
    doc.text(fmtDate(h.at), margin + 4, y);
    doc.text(h.kind, margin + 90, y);
    doc.text(h.type, margin + 160, y);
    doc.text(`${h.type === "tagihan" ? "+" : "-"}${rupiah(h.amount)}`, margin + 250, y);
    if (h.note) doc.text(doc.splitTextToSize(h.note, 160), margin + 350, y);
    y += 16;
  }

  y += 10;
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(
    "Sumber angka: buku Hutang & Piutang MCM Storage (party_balance_v1).",
    margin,
    y,
  );
  return doc.output("blob");
}

export async function exportDebtReport(
  p: DebtExportPayload,
  format: "csv" | "pdf",
): Promise<void> {
  const payload: DebtExportPayload = { ...p, generatedAt: p.generatedAt ?? new Date() };
  const blob =
    format === "csv"
      ? new Blob(["\uFEFF" + buildDebtReportCsv(payload)], {
          type: "text/csv;charset=utf-8",
        })
      : await buildDebtReportPdf(payload);
  downloadBlob(blob, debtExportFilename(payload, format));
}
