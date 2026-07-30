/**
 * SSOT unit jenis produk untuk Request Order & Ecer.
 *
 * DB storage tetap `unit_label text` (free-form). File ini hanya menstandarkan
 * nilai yang DITULIS ke DB dan yang DITAMPILKAN ke UI supaya seragam di
 * seluruh permukaan (/request, /ecer, /tugas, /t/$token, riwayat, PDF, share
 * WA). Backward-compat: legacy label ("gram", "Kilogram", "grm", "dus") tetap
 * bisa dibaca via `resolveKind()` yang mempelajari sinonim di `unit-label.ts`.
 */
import { isSameUnitLabel } from "@/lib/unit-label";

export type UnitKind =
  | "mg"
  | "gr"
  | "ons"
  | "kg"
  | "pcs"
  | "botol"
  | "karton"
  | "koli"
  | "custom";

export const UNIT_LABEL_ID: Record<UnitKind, string> = {
  mg: "mg",
  gr: "gr",
  ons: "ons",
  kg: "kg",
  pcs: "pcs",
  botol: "botol",
  karton: "karton",
  koli: "koli",
  custom: "lainnya",
};

export const UNIT_GROUPS: ReadonlyArray<{ label: string; kinds: readonly UnitKind[] }> = [
  { label: "Ecer (berat)", kinds: ["mg", "gr", "ons", "kg"] as const },
  { label: "Hitungan", kinds: ["pcs", "botol"] as const },
  { label: "Bulk", kinds: ["karton", "koli"] as const },
  { label: "Lainnya", kinds: ["custom"] as const },
];

/** Kind yang menerima nilai desimal (berat). Selain ini → integer. */
export function isDecimalKind(kind: UnitKind): boolean {
  return kind === "mg" || kind === "gr" || kind === "ons" || kind === "kg";
}

/**
 * Petakan free-text `unit_label` (mungkin legacy) → UnitKind kanonik.
 * Tak match apa pun → "custom" (biar tetap tampil apa adanya).
 */
export function resolveKind(free: string | null | undefined): UnitKind {
  const v = (free ?? "").trim().toLowerCase();
  if (!v) return "custom";
  const canonicals: UnitKind[] = ["mg", "gr", "ons", "kg", "pcs", "botol", "karton", "koli"];
  for (const k of canonicals) {
    if (isSameUnitLabel(v, k)) return k;
  }
  return "custom";
}

/**
 * Bentuk kanonik yang ditulis ke DB. Untuk kind terkurasi kembalikan singkatan
 * standar; untuk `custom` pakai teks bebas yang user masukkan (fallback "gr"
 * bila kosong supaya tak menabrak constraint downstream yang mengasumsikan
 * label non-null).
 */
export function canonicalUnitLabel(kind: UnitKind, custom?: string | null): string {
  if (kind === "custom") {
    const c = (custom ?? "").trim();
    return c || "gr";
  }
  return kind;
}

/**
 * Format qty + satuan untuk display. Hormati kasus khusus GS→botol dari
 * SSOT `displayUnit` lama.
 */
export function formatQty(
  qty: number | string,
  unitLabel: string | null | undefined,
  productName?: string | null | undefined,
): string {
  const n = typeof qty === "number" ? qty : Number(qty);
  const qStr = Number.isFinite(n) ? String(n) : String(qty ?? "");
  const name = (productName ?? "").trim().toLowerCase();
  if (name === "gs") return `${qStr} botol`;
  const kind = resolveKind(unitLabel);
  const suffix = kind === "custom" ? ((unitLabel ?? "").trim() || "") : kind;
  return suffix ? `${qStr} ${suffix}` : qStr;
}

/** Placeholder qty per kind — bantu user tahu jumlah tipikal. */
export function qtyPlaceholder(kind: UnitKind): string {
  switch (kind) {
    case "mg": return "500";
    case "gr": return "250";
    case "ons": return "1";
    case "kg": return "1";
    case "pcs": return "1";
    case "botol": return "1";
    case "karton": return "1";
    case "koli": return "1";
    case "custom": return "1";
  }
}

// --- Weight helpers (opsional; dipakai kalau nanti perlu total dalam gram) ---

const GRAMS_PER: Partial<Record<UnitKind, number>> = {
  mg: 0.001,
  gr: 1,
  ons: 100,
  kg: 1000,
};

export function toGrams(qty: number, kind: UnitKind): number | null {
  const m = GRAMS_PER[kind];
  if (m == null) return null;
  return qty * m;
}

export function fromGrams(grams: number, kind: UnitKind): number | null {
  const m = GRAMS_PER[kind];
  if (m == null) return null;
  return grams / m;
}