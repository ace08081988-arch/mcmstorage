import { rupiah } from "./stock-format";

export type PaymentMethod = "kas" | "hutang" | "partial";

export type PaymentBreakdown = {
  method: PaymentMethod;
  label: "Lunas" | "Hutang" | "Bayar sebagian";
  total: number;
  paid: number;
  remaining: number;
  partialValid: boolean;
};

export function parsePaymentAmountInput(raw: string): number {
  const normalized = raw.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function getPaymentBreakdown(
  method: PaymentMethod,
  totalAmount: number,
  partialPaidAmount: number,
): PaymentBreakdown {
  const total = Number.isFinite(totalAmount) ? Math.max(0, totalAmount) : 0;
  const typedPaid = Number.isFinite(partialPaidAmount) ? Math.max(0, partialPaidAmount) : 0;
  const paid = method === "kas" ? total : method === "hutang" ? 0 : typedPaid;
  const remaining = Math.max(0, total - paid);

  return {
    method,
    label: method === "kas" ? "Lunas" : method === "hutang" ? "Hutang" : "Bayar sebagian",
    total,
    paid,
    remaining,
    partialValid: method !== "partial" || (paid > 0 && paid < total),
  };
}

export function formatPaymentRupiah(amount: number): string {
  return rupiah(amount).replace(/\s+/g, "");
}

/**
 * Placeholder eksplisit yang WAJIB muncul di caption WA kalau `location_url`
 * kosong. Diekspor supaya call-site (route Ecer/Request/ReadyPackagesPanel)
 * dan test regresi pakai literal yang sama persis.
 */
export const LOCATION_MISSING_PLACEHOLDER =
  "📍 Lokasi belum diisi (owner akan menyusul link)";

export type BuildPaymentMessageOptions = {
  /**
   * `undefined` → jangan sentuh blok lokasi (tetap kompatibel dengan
   * call-site lama yang merakit lokasi sendiri).
   * `null` atau string kosong → cantumkan placeholder.
   * string non-kosong → cantumkan blok "📍 Lokasi ambil:" + URL.
   */
  locationUrl?: string | null;
};

export function buildPaymentMessageLines(
  payment: PaymentBreakdown,
  options: BuildPaymentMessageOptions = {},
): string[] {
  const lines = [`Pembayaran: ${payment.label}`];
  if (payment.method === "hutang") {
    // Cantumkan sisa piutang eksplisit di pesan WA agar pembeli tahu
    // nominal yang tercatat sebagai hutang (bukan hanya label "Hutang").
    lines.push(`Sisa hutang: ${formatPaymentRupiah(payment.remaining)}`);
  } else if (payment.method === "partial") {
    lines.push(`Dibayar: ${formatPaymentRupiah(payment.paid)}`);
    lines.push(`Sisa hutang: ${formatPaymentRupiah(payment.remaining)}`);
  }
  if ("locationUrl" in options) {
    const raw = options.locationUrl;
    const url = typeof raw === "string" ? raw.trim() : "";
    if (url) {
      lines.push("", "📍 Lokasi ambil:", url);
    } else {
      lines.push(LOCATION_MISSING_PLACEHOLDER);
    }
  }
  return lines;
}

export function formatSoldPaymentSummary(method: string | null | undefined, total: number, paid: number | null | undefined): string {
  const safeMethod: PaymentMethod = method === "hutang" || method === "partial" ? method : "kas";
  const breakdown = getPaymentBreakdown(safeMethod, total, Number(paid ?? 0));
  if (breakdown.method === "hutang") return `Piutang · Sisa ${formatPaymentRupiah(breakdown.remaining)}`;
  if (breakdown.method === "partial") {
    return `Bayar sebagian · Dibayar ${formatPaymentRupiah(breakdown.paid)} · Sisa ${formatPaymentRupiah(breakdown.remaining)}`;
  }
  return `Lunas · ${formatPaymentRupiah(breakdown.total)}`;
}