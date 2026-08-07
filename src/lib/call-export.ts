/**
 * Ekspor hasil pencarian/filter riwayat panggilan ke CSV atau PDF.
 * Dipakai di halaman Panggilan sebelum entri dihapus.
 */

import { formatCallDuration, type CallRow } from "@/lib/calls";

export type ExportCall = {
  waktu: string;
  kontak: string;
  arah: string;
  jenis: string;
  status: string;
  durasi: string;
};

export const CALL_STATUS_LABEL: Record<string, string> = {
  ringing: "Berdering",
  accepted: "Terjawab",
  declined: "Ditolak",
  missed: "Tak terjawab",
  ended: "Selesai",
  cancelled: "Dibatalkan",
  failed: "Gagal",
};

const STATUS_LABEL = CALL_STATUS_LABEL;

const HEADERS = ["Waktu", "Kontak", "Arah", "Jenis", "Status", "Durasi"];

export function toExportRows(
  rows: CallRow[],
  myId: string | null,
  nameMap: Record<string, string>,
): ExportCall[] {
  return rows.map((c) => {
    const outgoing = c.caller_id === myId;
    const peerId = outgoing ? c.callee_id : c.caller_id;
    return {
      waktu: new Date(c.started_at).toLocaleString("id-ID"),
      kontak: (peerId && nameMap[peerId]) || "Kontak",
      arah: outgoing ? "Keluar" : "Masuk",
      jenis: c.kind === "video" ? "Video" : "Suara",
      status: STATUS_LABEL[c.status] ?? c.status,
      durasi: formatCallDuration(c.duration_sec ?? 0),
    };
  });
}

function csvCell(v: string): string {
  return /[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildCallsCsv(rows: ExportCall[]): string {
  const lines = [HEADERS.join(";")];
  for (const r of rows) {
    lines.push([r.waktu, r.kontak, r.arah, r.jenis, r.status, r.durasi].map(csvCell).join(";"));
  }
  // BOM agar Excel id-ID membaca UTF-8 dengan benar.
  return `\uFEFF${lines.join("\r\n")}`;
}

function fileStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
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

export function exportCallsCsv(rows: ExportCall[]): string {
  const name = `riwayat-panggilan-${fileStamp()}.csv`;
  download(new Blob([buildCallsCsv(rows)], { type: "text/csv;charset=utf-8" }), name);
  return name;
}

export async function exportCallsPdf(rows: ExportCall[], subtitle?: string): Promise<string> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = (autoTableMod as unknown as { default: (doc: unknown, opts: unknown) => void }).default;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text("Riwayat Panggilan — Ace Chat", 40, 40);
  doc.setFontSize(9);
  doc.text(
    `${rows.length} entri · dibuat ${new Date().toLocaleString("id-ID")}${subtitle ? ` · ${subtitle}` : ""}`,
    40,
    56,
  );
  autoTable(doc, {
    startY: 70,
    head: [HEADERS],
    body: rows.map((r) => [r.waktu, r.kontak, r.arah, r.jenis, r.status, r.durasi]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [26, 26, 26], textColor: [212, 175, 55] },
  });
  const name = `riwayat-panggilan-${fileStamp()}.pdf`;
  doc.save(name);
  return name;
}
