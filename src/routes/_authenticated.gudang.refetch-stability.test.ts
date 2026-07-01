import { describe, it, expect } from "vitest";
import { computeBeliDerived } from "@/lib/beli-derived";
import { computeBeliWarnings } from "@/lib/beli-warnings";

// Regression: saat query item di-refetch, `selectedItem` bisa mendapatkan
// referensi objek baru walau isinya persis sama (mode/itemId/packageType
// tidak berubah). Test ini memastikan ringkasan real-time — `derived` dan
// `warnings` — tetap identik secara nilai (deep equal) sehingga UI tidak
// "berkedip" atau menampilkan angka berbeda karena identitas objek.

type PackageType = "gram" | "pcs" | "botol" | "sachet";

type WItem = {
  id: string;
  name: string;
  package_type: PackageType;
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base: number;
  avg_cost_per_base: number;
};

const BASE_ITEM: WItem = {
  id: "botol-500",
  name: "Sirup Botol 500ml",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
};

/** Simulasi refetch: kembalikan objek dengan isi sama tapi referensi baru. */
function refetch<T extends object>(o: T): T {
  return { ...o };
}

function snap(item: WItem | null, overrides?: {
  packageQty?: string;
  pricePerPackage?: string;
  priceMode?: "package" | "base";
  pricePerBase?: string;
  inputKarton?: boolean;
}) {
  const packageQty = overrides?.packageQty ?? "2";
  const pricePerPackage = overrides?.pricePerPackage ?? "10000";
  const priceMode = overrides?.priceMode ?? "package";
  const pricePerBase = overrides?.pricePerBase ?? "";
  const inputKarton = overrides?.inputKarton ?? false;
  const derived = computeBeliDerived({
    mode: "existing",
    selectedItem: item,
    newPackageType: "botol",
    newPackageSize: "500",
    packageQty,
    pricePerPackage,
    priceMode,
    pricePerBase,
    inputKarton,
  });
  const warnings = computeBeliWarnings({
    mode: "existing",
    selectedItem: item,
    derived,
    priceMode,
    inputKarton,
  });
  return { derived, warnings };
}

describe("BeliTab — stabilitas derived/warnings saat selectedItem direfetch", () => {
  it("derived identik (deep equal) setelah refetch identitas item yang sama", () => {
    const a = snap(BASE_ITEM);
    const b = snap(refetch(BASE_ITEM));
    expect(b.derived).toEqual(a.derived);
  });

  it("warnings identik setelah refetch identitas item yang sama", () => {
    const a = snap(BASE_ITEM, { pricePerPackage: "999999" });
    const b = snap(refetch(BASE_ITEM), { pricePerPackage: "999999" });
    expect(b.warnings).toEqual(a.warnings);
  });

  it("stabil setelah beberapa kali refetch berturut-turut", () => {
    const a = snap(BASE_ITEM, { inputKarton: true });
    let ref: WItem = BASE_ITEM;
    for (let i = 0; i < 5; i++) {
      ref = refetch(ref);
      const s = snap(ref, { inputKarton: true });
      expect(s.derived).toEqual(a.derived);
      expect(s.warnings).toEqual(a.warnings);
    }
  });

  it("berubah ketika ISI item benar-benar berubah (kontrol negatif)", () => {
    const a = snap(BASE_ITEM);
    // Item lain dengan package_type/size berbeda → derived HARUS beda.
    const other: WItem = {
      ...BASE_ITEM,
      id: "gram-1000",
      package_type: "gram",
      package_size: 1000,
      base_unit: "g",
    };
    const b = snap(other);
    expect(b.derived).not.toEqual(a.derived);
  });

  it("stabil untuk item type 'pcs' (priceMode='base') di lintas refetch", () => {
    const pcs: WItem = {
      id: "pcs-1",
      name: "Sikat",
      package_type: "pcs",
      package_size: 1,
      base_unit: "pcs",
      stock_base: 20,
      avg_cost_per_base: 3000,
    };
    const a = snap(pcs, { priceMode: "base", pricePerBase: "3000", pricePerPackage: "" });
    const b = snap(refetch(pcs), {
      priceMode: "base",
      pricePerBase: "3000",
      pricePerPackage: "",
    });
    expect(b.derived).toEqual(a.derived);
    expect(b.warnings).toEqual(a.warnings);
  });
});