import type { BeliDerivedOutput } from "./beli-derived";

export type BeliWarnItem = {
  package_type: string;
  package_size: number;
  base_unit: string;
  stock_base?: number;
  avg_cost_per_base?: number;
  name?: string;
};

export type BeliWarning = {
  code:
    | "PKG_SIZE_MISMATCH"
    | "PKG_TYPE_MISMATCH"
    | "PRICE_PER_BASE_HIGH"
    | "PRICE_PER_BASE_LOW"
    | "PRICE_ZERO"
    | "QTY_ZERO"
    | "BASE_ADDED_HUGE"
    | "KARTON_ON_NON_BOTOL"
    | "PCS_PACKAGE_PRICE";
  level: "error" | "warn" | "info";
  message: string;
};

export type BeliWarnInput = {
  mode: "existing" | "new";
  selectedItem: BeliWarnItem | null;
  derived: BeliDerivedOutput;
  priceMode: "package" | "base";
  inputKarton: boolean;
};

/**
 * Deviasi harga per base unit dianggap mencurigakan bila > 50% dari rata-rata.
 */
export const PRICE_DEVIATION_RATIO = 0.5;
/** Ambang qty tambahan yang dianggap sangat besar (untuk mencegah salah input). */
export const HUGE_BASE_ADDED = 1_000_000;
/** Ambang qty tambahan relatif ke stok sekarang (mis. 100× stok saat ini). */
export const HUGE_BASE_ADDED_RATIO = 100;

export function computeBeliWarnings(input: BeliWarnInput): BeliWarning[] {
  const { mode, selectedItem, derived, priceMode, inputKarton } = input;
  const {
    effPackageType,
    effectivePkgSize,
    pkgQ,
    price,
    baseAdded,
  } = derived;
  const warnings: BeliWarning[] = [];

  if (pkgQ <= 0) {
    warnings.push({
      code: "QTY_ZERO",
      level: "error",
      message: "Jumlah kemasan belum diisi.",
    });
  }
  if (price <= 0) {
    warnings.push({
      code: "PRICE_ZERO",
      level: "error",
      message: "Harga belum diisi.",
    });
  }

  if (inputKarton && effPackageType !== "botol") {
    warnings.push({
      code: "KARTON_ON_NON_BOTOL",
      level: "warn",
      message: `Mode karton hanya berlaku untuk item botol; item terpilih ${effPackageType}.`,
    });
  }
  if (effPackageType === "pcs" && priceMode === "package") {
    warnings.push({
      code: "PCS_PACKAGE_PRICE",
      level: "warn",
      message: "Item pcs tidak punya ukuran kemasan; gunakan harga per pcs.",
    });
  }

  if (mode === "existing" && selectedItem) {
    // Ukuran kemasan efektif harus konsisten dengan data item.
    const expectedSize = effPackageType === "pcs" ? 1 : Number(selectedItem.package_size) || 0;
    if (expectedSize > 0 && effectivePkgSize !== expectedSize) {
      warnings.push({
        code: "PKG_SIZE_MISMATCH",
        level: "warn",
        message: `Ukuran kemasan (${effectivePkgSize}) tidak sama dengan data item (${expectedSize} ${selectedItem.base_unit}).`,
      });
    }
    if (selectedItem.package_type && selectedItem.package_type !== effPackageType) {
      warnings.push({
        code: "PKG_TYPE_MISMATCH",
        level: "warn",
        message: `Jenis kemasan (${effPackageType}) berbeda dari data item (${selectedItem.package_type}).`,
      });
    }

    // Harga per base unit vs rata-rata historis item.
    const avg = Number(selectedItem.avg_cost_per_base) || 0;
    if (avg > 0 && baseAdded > 0 && price > 0) {
      const pricePerBase = (pkgQ * price) / baseAdded;
      const ratio = pricePerBase / avg;
      if (ratio >= 1 + PRICE_DEVIATION_RATIO) {
        warnings.push({
          code: "PRICE_PER_BASE_HIGH",
          level: "warn",
          message: `Modal per ${selectedItem.base_unit} (${pricePerBase.toFixed(2)}) ${Math.round((ratio - 1) * 100)}% lebih tinggi dari rata-rata (${avg.toFixed(2)}).`,
        });
      } else if (ratio <= 1 - PRICE_DEVIATION_RATIO) {
        warnings.push({
          code: "PRICE_PER_BASE_LOW",
          level: "warn",
          message: `Modal per ${selectedItem.base_unit} (${pricePerBase.toFixed(2)}) ${Math.round((1 - ratio) * 100)}% lebih rendah dari rata-rata (${avg.toFixed(2)}).`,
        });
      }
    }

    // Qty tambahan yang tidak masuk akal.
    const stock = Number(selectedItem.stock_base) || 0;
    if (
      baseAdded > HUGE_BASE_ADDED ||
      (stock > 0 && baseAdded > stock * HUGE_BASE_ADDED_RATIO)
    ) {
      warnings.push({
        code: "BASE_ADDED_HUGE",
        level: "warn",
        message: `Tambahan stok (${baseAdded.toLocaleString("id-ID")} ${selectedItem.base_unit}) tampak sangat besar — cek jumlah kemasan.`,
      });
    }
  }

  return warnings;
}

export function hasBlockingWarnings(list: BeliWarning[]): boolean {
  return list.some((w) => w.level === "error");
}