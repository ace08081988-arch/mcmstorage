/**
 * Laporan hutang/piutang sekali klik untuk dikirim ke dalam chat.
 *
 * Angka WAJIB berasal dari SSOT `party_balance_v1()` (lihat
 * `src/lib/chat-debt-sync.ts`) supaya isi laporan identik dengan chip di
 * daftar chat, header chat, dan halaman Hutang & Piutang.
 */
import { rupiah } from "@/lib/stock-format";

export type DebtReportLine = {
  at: string;
  kind: "hutang" | "piutang";
  type: "tagihan" | "pembayaran";
  amount: number;
  note?: string | null;
};

export type DebtReportInput = {
  peerName: string;
  hutang: number;
  piutang: number;
  history?: DebtReportLine[];
  /** Batas jumlah baris riwayat yang ikut dikirim. */
  maxLines?: number;
  now?: Date;
  /**
   * Gaya pesan:
   * - "ringkas": hanya saldo akhir (tanpa riwayat), untuk kabar cepat.
   * - "detail": rincian lengkap + riwayat perubahan terakhir.
   */
  style?: DebtReportStyle;
};

export type DebtReportStyle = "ringkas" | "detail";

function fmtWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function buildDebtReport({
  peerName,
  hutang,
  piutang,
  history = [],
  maxLines = 5,
  now = new Date(),
  style = "detail",
}: DebtReportInput): string {
  const ringkas = style === "ringkas";
  const lines: string[] = [];
  lines.push("*Laporan Hutang & Piutang*");
  lines.push(`Pihak: ${peerName}`);
  lines.push(
    `Per ${now.toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`,
  );
  lines.push("");
  lines.push(`• Piutang (Anda menagih): ${rupiah(Math.max(0, piutang))}`);
  lines.push(`• Hutang (Anda membayar): ${rupiah(Math.max(0, hutang))}`);
  const net = piutang - hutang;
  lines.push(
    net === 0
      ? "• Saldo akhir: LUNAS"
      : net > 0
        ? `• Saldo akhir: ${rupiah(net)} (tagihan ke ${peerName})`
        : `• Saldo akhir: ${rupiah(Math.abs(net))} (kewajiban ke ${peerName})`,
  );

  const recent = ringkas ? [] : history.slice(0, maxLines);
  if (recent.length > 0) {
    lines.push("");
    lines.push("*Perubahan terakhir*");
    for (const h of recent) {
      const sign = h.type === "tagihan" ? "+" : "−";
      const label = h.type === "tagihan" ? "Tagihan" : "Pembayaran";
      lines.push(
        `${fmtWhen(h.at)} · ${label} ${h.kind} ${sign}${rupiah(h.amount)}` +
          (h.note ? ` (${h.note})` : ""),
      );
    }
  }
  lines.push("");
  lines.push("_Sumber angka: buku Hutang & Piutang MCM Storage._");
  return lines.join("\n");
}