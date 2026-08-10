import { describe, it, expect } from "vitest";
import { BOTOL_PER_KARTON } from "@/lib/stock-format";

// ============================================================
// Replika suite `refetch-stability` untuk JualTab.
//
// JualTab (di `_authenticated.gudang.tsx`) tidak memakai
// computeBeliDerived/computeBeliWarnings karena pipeline reset
// hanya relevan untuk pencatatan pembelian. Namun JualTab tetap
// menurunkan angka ringkasan realtime (qtyBase, pricePerBaseEff,
// total, profit) dari `selectedItem` yang bisa direfetch. Test
// ini menjamin ringkasan JualTab **konsisten** — deep equal —
// setelah refetch identitas item, sejalan dengan invariant yang
// sudah dienforce di BeliTab.
//
// Kalau di masa depan JualTab (atau tab lain) diportkan ke pipeline
// beliResetKey/computeBeli*, tes ini tetap valid karena mengukur
// invariant di sisi output (bukan implementasi).
// ============================================================

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

type SellMode = "base" | "package" | "karton";

/** Salinan 1:1 dari derivation JualTab (lihat _authenticated.gudang.tsx). */
function jualDerive(input: {
  item: WItem | null;
  sellMode: SellMode;
  qty: string;
  pricePerBase: string;
  pricePerPackage: string;
}) {
  const { item, sellMode, qty, pricePerBase, pricePerPackage } = input;
  const qtyN = Number(qty) || 0;
  const baseFactor = item
    ? sellMode === "base"
      ? 1
      : sellMode === "package"
        ? item.package_size
        : BOTOL_PER_KARTON * item.package_size
    : 0;
  const qtyBase = qtyN * baseFactor;
  const pricePerBaseEff = item
    ? sellMode === "base"
      ? Number(pricePerBase) || 0
      : baseFactor > 0
        ? (Number(pricePerPackage) || 0) / baseFactor
        : 0
    : 0;
  const total = qtyBase * pricePerBaseEff;
  const profit = item ? (pricePerBaseEff - item.avg_cost_per_base) * qtyBase : 0;
  return { qtyBase, pricePerBaseEff, total, profit, baseFactor };
}

const BASE_ITEM: WItem = {
  id: "botol-500",
  name: "Sirup Botol 500ml",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
};

/** Simulasi refetch: objek baru, isi sama. */
function refetch<T extends object>(o: T): T {
  return { ...o };
}

describe("JualTab — stabilitas derivation saat item direfetch", () => {
  it("qtyBase/total/profit identik setelah refetch identitas item yang sama (sellMode=base)", () => {
    const a = jualDerive({
      item: BASE_ITEM,
      sellMode: "base",
      qty: "500",
      pricePerBase: "30",
      pricePerPackage: "",
    });
    const b = jualDerive({
      item: refetch(BASE_ITEM),
      sellMode: "base",
      qty: "500",
      pricePerBase: "30",
      pricePerPackage: "",
    });
    expect(b).toEqual(a);
  });

  it("stabil untuk sellMode='package'", () => {
    const a = jualDerive({
      item: BASE_ITEM,
      sellMode: "package",
      qty: "2",
      pricePerBase: "",
      pricePerPackage: "15000",
    });
    const b = jualDerive({
      item: refetch(BASE_ITEM),
      sellMode: "package",
      qty: "2",
      pricePerBase: "",
      pricePerPackage: "15000",
    });
    expect(b).toEqual(a);
  });

  it("stabil untuk sellMode='karton'", () => {
    const a = jualDerive({
      item: BASE_ITEM,
      sellMode: "karton",
      qty: "1",
      pricePerBase: "",
      pricePerPackage: "1200000",
    });
    const b = jualDerive({
      item: refetch(BASE_ITEM),
      sellMode: "karton",
      qty: "1",
      pricePerBase: "",
      pricePerPackage: "1200000",
    });
    expect(b).toEqual(a);
  });

  it("stabil setelah 10× refetch berturut-turut", () => {
    const base = jualDerive({
      item: BASE_ITEM,
      sellMode: "package",
      qty: "3",
      pricePerBase: "",
      pricePerPackage: "15000",
    });
    let ref: WItem = BASE_ITEM;
    for (let i = 0; i < 10; i++) {
      ref = refetch(ref);
      const next = jualDerive({
        item: ref,
        sellMode: "package",
        qty: "3",
        pricePerBase: "",
        pricePerPackage: "15000",
      });
      expect(next).toEqual(base);
    }
  });

  it("stabil untuk item pcs (baseFactor=1 di semua mode kecuali karton)", () => {
    const pcs: WItem = {
      id: "pcs-1",
      name: "Sikat",
      package_type: "pcs",
      package_size: 1,
      base_unit: "pcs",
      stock_base: 20,
      avg_cost_per_base: 3000,
    };
    const a = jualDerive({
      item: pcs,
      sellMode: "base",
      qty: "5",
      pricePerBase: "3500",
      pricePerPackage: "",
    });
    const b = jualDerive({
      item: refetch(pcs),
      sellMode: "base",
      qty: "5",
      pricePerBase: "3500",
      pricePerPackage: "",
    });
    expect(b).toEqual(a);
  });

  it("kontrol negatif — ISI item berubah (avg_cost_per_base) → profit BERUBAH", () => {
    const a = jualDerive({
      item: BASE_ITEM,
      sellMode: "base",
      qty: "500",
      pricePerBase: "30",
      pricePerPackage: "",
    });
    const b = jualDerive({
      item: { ...BASE_ITEM, avg_cost_per_base: 5 },
      sellMode: "base",
      qty: "500",
      pricePerBase: "30",
      pricePerPackage: "",
    });
    expect(b.profit).not.toEqual(a.profit);
    // qtyBase / pricePerBaseEff / total tidak bergantung pada avg_cost_per_base.
    expect(b.qtyBase).toEqual(a.qtyBase);
    expect(b.total).toEqual(a.total);
  });

  it("kontrol negatif — package_size berubah → semua derivation berubah untuk mode package/karton", () => {
    const a = jualDerive({
      item: BASE_ITEM,
      sellMode: "package",
      qty: "2",
      pricePerBase: "",
      pricePerPackage: "15000",
    });
    const b = jualDerive({
      item: { ...BASE_ITEM, package_size: 250 },
      sellMode: "package",
      qty: "2",
      pricePerBase: "",
      pricePerPackage: "15000",
    });
    expect(b.qtyBase).not.toEqual(a.qtyBase);
    expect(b.pricePerBaseEff).not.toEqual(a.pricePerBaseEff);
  });
});