import { BOTOL_PER_KARTON } from "@/lib/stock-format";

export type BeliPackageType = "gram" | "pcs" | "botol" | "sachet";
export type BeliBaseUnit = "g" | "pcs";

export type BeliDerivedItem = {
  package_type: BeliPackageType | string;
  package_size: number;
  base_unit: BeliBaseUnit | string;
};

export function defaultBaseUnit(pt: BeliPackageType): BeliBaseUnit {
  return pt === "gram" ? "g" : "pcs";
}

export type BeliDerivedInput = {
  mode: "existing" | "new";
  selectedItem: BeliDerivedItem | null;
  newPackageType: BeliPackageType;
  newPackageSize: string | number;
  packageQty: string | number;
  pricePerPackage: string | number;
  priceMode: "package" | "base";
  pricePerBase: string | number;
  inputKarton: boolean;
};

export type BeliDerivedOutput = {
  effPackageType: BeliPackageType;
  effBaseUnit: BeliBaseUnit;
  effectivePkgSize: number;
  kartonActive: boolean;
  pkgQ: number;
  price: number;
  baseAdded: number;
  totalCost: number;
};

/**
 * Signature konten yang benar-benar mempengaruhi hasil derivation.
 * `selectedItem` disederhanakan ke tuple field yang dipakai supaya refetch
 * dengan referensi baru (isi sama) tetap menghasilkan signature yang sama.
 */
function beliDerivedSig(input: BeliDerivedInput): string {
  const it = input.mode === "existing" && input.selectedItem
    ? `${input.selectedItem.package_type}|${input.selectedItem.package_size}|${input.selectedItem.base_unit}`
    : "-";
  return [
    input.mode,
    it,
    input.newPackageType,
    String(input.newPackageSize),
    String(input.packageQty),
    String(input.pricePerPackage),
    input.priceMode,
    String(input.pricePerBase),
    input.inputKarton ? "1" : "0",
  ].join("::");
}

// Single-slot memo (size 1). Sudah cukup karena pemakai memanggil dengan
// input yang stabil per render; hit rate tinggi setelah refetch identitas.
let lastDerivedSig: string | null = null;
let lastDerivedOut: BeliDerivedOutput | null = null;

/**
 * Pure derivation of quantities/prices for the "Catat Pembelian" form.
 *
 * In "existing" mode every packaging attribute (jenis kemasan, ukuran, base
 * unit) MUST come from the selected item — never from the "barang baru"
 * form state — so that switching between items does not smuggle in stale
 * defaults (e.g. a botol item appearing as "999 g").
 */
export function computeBeliDerived(input: BeliDerivedInput): BeliDerivedOutput {
  const sig = beliDerivedSig(input);
  if (sig === lastDerivedSig && lastDerivedOut) return lastDerivedOut;

  const {
    mode,
    selectedItem,
    newPackageType,
    newPackageSize,
    packageQty,
    pricePerPackage,
    priceMode,
    pricePerBase,
    inputKarton,
  } = input;

  const useItem = mode === "existing" ? selectedItem : null;

  const effPackageType = (useItem
    ? ((useItem.package_type as BeliPackageType) || "pcs")
    : newPackageType) as BeliPackageType;
  const effBaseUnit = (useItem
    ? (useItem.base_unit as BeliBaseUnit)
    : defaultBaseUnit(newPackageType)) as BeliBaseUnit;
  const effectivePkgSize = useItem
    ? (effPackageType === "pcs" ? 1 : Number(useItem.package_size) || 0)
    : (newPackageType === "pcs" ? 1 : Number(newPackageSize) || 0);

  const kartonActive = inputKarton && effPackageType === "botol";
  const rawQty = Number(packageQty) || 0;
  const pkgQ = kartonActive ? rawQty * BOTOL_PER_KARTON : rawQty;
  const rawPricePerPackage = Number(pricePerPackage) || 0;
  const pricePerBotol = kartonActive
    ? rawPricePerPackage / BOTOL_PER_KARTON
    : rawPricePerPackage;
  const price = priceMode === "package"
    ? pricePerBotol
    : (Number(pricePerBase) || 0) * effectivePkgSize;
  const baseAdded = pkgQ * effectivePkgSize;
  const totalCost = pkgQ * price;

  const out: BeliDerivedOutput = {
    effPackageType,
    effBaseUnit,
    effectivePkgSize,
    kartonActive,
    pkgQ,
    price,
    baseAdded,
    totalCost,
  };
  lastDerivedSig = sig;
  lastDerivedOut = out;
  return out;
}

/** Untuk test: bersihkan cache internal antar-skenario. */
export function __resetBeliDerivedMemo(): void {
  lastDerivedSig = null;
  lastDerivedOut = null;
}