// Util format kuantitas/stok seragam di seluruh aplikasi.
// Aturan: 100 botol = 1 karton, berlaku untuk semua produk satuan "botol".

export const BOTOL_PER_KARTON = 100;

export function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function fmtBase(n: number, u: "g" | "pcs") {
  const v = Number(n) || 0;
  if (u === "g") {
    if (Math.abs(v) >= 1000) {
      return `${(v / 1000).toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`;
    }
    if (Math.abs(v) > 0 && Math.abs(v) < 1) {
      // Tampilkan dalam mg untuk nilai sub-gram (1 gr = 1000 mg).
      const mg = v * 1000;
      return `${mg.toLocaleString("id-ID", { maximumFractionDigits: 2 })} mg`;
    }
    return `${v.toLocaleString("id-ID", { maximumFractionDigits: 2 })} g`;
  }
  return `${v.toLocaleString("id-ID")} pcs`;
}

function getBotolPerKarton(_name: string | undefined, packageType: string): number | null {
  if ((packageType ?? "").trim().toLowerCase() === "botol") return BOTOL_PER_KARTON;
  return null;
}

export function fmtKartonHint(
  pkgQty: number,
  name: string | undefined,
  packageType: string,
): string {
  const per = getBotolPerKarton(name, packageType);
  if (!per || per <= 0) return "";
  const k = pkgQty / per;
  if (!Number.isFinite(k) || k < 1) return "";
  const kInt = Math.floor(k);
  const sisa = Math.round(pkgQty - kInt * per);
  const kStr = kInt.toLocaleString("id-ID");
  return sisa > 0
    ? ` · = ${kStr} karton + ${sisa.toLocaleString("id-ID")} botol`
    : ` · = ${kStr} karton`;
}

export function fmtQtyDual(
  baseQty: number,
  baseUnit: "g" | "pcs",
  packageType: string,
  packageSize: number,
  mode: "base" | "package",
  itemName?: string,
) {
  // GS: tiap "pcs" sebenarnya 1 botol → tampilkan langsung sebagai botol.
  if ((itemName ?? "").trim().toLowerCase() === "gs" && baseUnit === "pcs") {
    const botol = Math.round(Number(baseQty) || 0);
    return `${botol.toLocaleString("id-ID")} botol${fmtKartonHint(botol, "gs", "botol")}`;
  }
  if (mode === "base" || !packageType || packageType === "pcs" || packageSize <= 0) {
    return fmtBase(baseQty, baseUnit);
  }
  const pkgQty = baseQty / packageSize;
  const pkgStr = `${pkgQty.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${packageType}`;
  return `${pkgStr} (= ${fmtBase(baseQty, baseUnit)})${fmtKartonHint(pkgQty, itemName, packageType)}`;
}

export type StockItemLike = {
  name?: string;
  base_unit: "g" | "pcs";
  package_type?: string | null;
  package_size?: number | null;
};

export function fmtItemQty(baseQty: number, item: StockItemLike | null | undefined) {
  if (!item) return fmtBase(baseQty, "pcs");
  const pt = item.package_type ?? "";
  const ps = Number(item.package_size) || 0;
  const mode: "base" | "package" = pt && pt !== "pcs" && ps > 0 ? "package" : "base";
  return fmtQtyDual(baseQty, item.base_unit, pt, ps, mode, item.name);
}

export function fmtItemPrice(pricePerBase: number, item: StockItemLike | null | undefined) {
  if (!item) return `${rupiah(pricePerBase)}/pcs`;
  const pt = item.package_type ?? "";
  const ps = Number(item.package_size) || 0;
  if (pt && pt !== "pcs" && ps > 0) {
    const perPkg = pricePerBase * ps;
    return `${rupiah(perPkg)}/${pt} (= ${rupiah(pricePerBase)}/${item.base_unit})`;
  }
  return `${rupiah(pricePerBase)}/${item.base_unit}`;
}
