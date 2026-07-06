/**
 * Sumber tunggal pesan notifikasi ketika user mencoba mengubah paket
 * berstatus **Riwayat Terkirim**. Dipakai oleh guard di Request PrepCard
 * dan Ecer PrepBox agar isi toast konsisten dan mudah dites.
 *
 * Kontrak: pesan HARUS memuat (1) alasan aksi ditolak dan (2) status
 * paket saat ini — metode bayar, nominal, pelanggan, dan waktu kirim
 * bila tersedia — supaya user tahu paket ini sudah menjadi transaksi.
 */

import { rupiah } from "@/lib/stock-format";
import { isSentPrep } from "@/lib/prep-active-selector";

export type ReadOnlyAction = "delete" | "resend" | "edit";

export type ReadOnlyPrepStatus = {
  sold_at?: string | null;
  sold_payment_method?: string | null; // "kas" | "hutang" | "partial" | null
  sold_total?: number | string | null;
  sold_paid_amount?: number | string | null;
  sold_party_name?: string | null;
};

const ACTION_LABEL: Record<ReadOnlyAction, string> = {
  delete: "menghapus",
  resend: "mengirim ulang",
  edit: "mengubah",
};

function methodLabel(m?: string | null): string {
  switch (m) {
    case "kas": return "Lunas";
    case "hutang": return "Piutang";
    case "partial": return "Bayar sebagian";
    default: return "Terkirim";
  }
}

function formatWhen(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return d.toISOString();
  }
}

function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Bangun ringkasan status "sold" untuk ditampilkan di description toast.
 * Return null bila paket belum sold (guard salah dipanggil) — caller
 * boleh fallback ke pesan generik.
 */
export function describeSoldStatus(p: ReadOnlyPrepStatus): string | null {
  // Guard: paket harus benar-benar "sent" untuk punya status Riwayat
  // Terkirim. Pakai SSOT (`isSentPrep`) — jangan tulis `!p.sold_at` di
  // level modul supaya definisi "sent" tetap tunggal.
  if (!isSentPrep(p)) return null;
  const method = methodLabel(p.sold_payment_method);
  const total = toNum(p.sold_total);
  const paid = toNum(p.sold_paid_amount);
  const parts: string[] = [];
  if (p.sold_payment_method === "partial") {
    const remain = Math.max(0, total - paid);
    parts.push(`${method} · dibayar ${rupiah(paid)} dari ${rupiah(total)} (sisa piutang ${rupiah(remain)})`);
  } else if (total > 0) {
    parts.push(`${method} · ${rupiah(total)}`);
  } else {
    parts.push(method);
  }
  if (p.sold_party_name) parts.push(`ke ${p.sold_party_name}`);
  const when = formatWhen(p.sold_at);
  if (when) parts.push(when);
  return parts.join(" · ");
}

/**
 * Ringkasan pesan toast untuk aksi yang ditolak. `title` selalu memuat
 * alasan; `description` memuat status saat ini bila tersedia.
 */
export function buildReadOnlyToast(action: ReadOnlyAction, p: ReadOnlyPrepStatus): {
  title: string;
  description: string | undefined;
} {
  const verb = ACTION_LABEL[action];
  const title = `Paket sudah di Riwayat Terkirim — tidak bisa ${verb}.`;
  const status = describeSoldStatus(p);
  const description = status
    ? `Status saat ini: ${status}. Batalkan lewat transaksi/piutang terkait bila perlu koreksi.`
    : undefined;
  return { title, description };
}
