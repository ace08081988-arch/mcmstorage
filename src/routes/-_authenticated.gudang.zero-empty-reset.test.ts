import { describe, it, expect } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings } from "@/lib/beli-warnings";
import { beliResetKey } from "@/lib/beli-reset-key";

// ============================================================
// Verifikasi perilaku `derived` + `warnings` ketika input efektif
// (packageQty, pricePerPackage) bernilai 0/kosong, dan `stock_base`
// item juga 0. Aturan penting yang diuji:
//
// - Nilai form (qty, harga, karton, priceMode) HANYA di-reset ke
//   default saat `resetKey` (mode/itemId/packageType) berubah,
//   mengikuti effect `useEffect([resetKey])` di BeliTab.
// - Refetch selectedItem yang tidak menggeser `resetKey` TIDAK
//   boleh memicu reset — derived/warnings zero-state harus tetap.
// - Setelah resetKey berubah, derived/warnings HARUS mencerminkan
//   nilai default baru (packageQty="1", pricePerPackage="") dan
//   atribut item baru (mis. stock_base=0 → tidak ada
//   PRICE_PER_BASE_HIGH karena avg_cost tidak tersedia).
// ============================================================

type PT = "botol" | "gram" | "pcs";
type Item = {
  id: string;
  package_type: PT;
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base: number;
  avg_cost_per_base: number;
};

const BOTOL: Item = {
  id: "botol-500",
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
};

const EMPTY_ITEM: Item = {
  id: "gram-1000-empty",
  package_type: "gram",
  package_size: 1000,
  base_unit: "g",
  stock_base: 0,
  avg_cost_per_base: 0,
};

/**
 * Harness lifecycle mini: state form direset saat `resetKey` berubah,
 * meniru `useEffect([resetKey])` di BeliTab.
 */
function createBeliHarness(initial: { item: Item }) {
  let item: Item = initial.item;
  let mode: "existing" | "new" = "existing";
  // Form state (default nilai reset).
  let packageQty = "1";
  let pricePerPackage = "";
  let inputKarton = false;
  let priceMode: "package" | "base" =
    item.package_type === "pcs" ? "base" : "package";

  let lastResetKey = beliResetKey({
    mode,
    itemId: item.id,
    packageType: item.package_type,
  });

  function currentKey() {
    return beliResetKey({ mode, itemId: item.id, packageType: item.package_type });
  }

  function maybeReset() {
    const k = currentKey();
    if (k !== lastResetKey) {
      lastResetKey = k;
      packageQty = "1";
      pricePerPackage = "";
      inputKarton = false;
      priceMode = item.package_type === "pcs" ? "base" : "package";
      return true;
    }
    return false;
  }

  function snapshot() {
    const input: BeliDerivedInput = {
      mode,
      selectedItem: mode === "existing" ? item : null,
      newPackageType: item.package_type,
      newPackageSize: String(item.package_size),
      packageQty,
      pricePerPackage,
      priceMode,
      pricePerBase: "",
      inputKarton,
    };
    const derived = computeBeliDerived(input);
    const warnings = computeBeliWarnings({
      mode,
      selectedItem: item,
      derived,
      priceMode,
      inputKarton,
    });
    return { derived, warnings, form: { packageQty, pricePerPackage, priceMode } };
  }

  return {
    setQty(v: string) {
      packageQty = v;
    },
    setPricePerPackage(v: string) {
      pricePerPackage = v;
    },
    switchItem(next: Item) {
      item = next;
      return maybeReset();
    },
    refetch(mutator: (i: Item) => Item) {
      item = mutator(item);
      return maybeReset(); // biasanya false: resetKey tidak berubah
    },
    snapshot,
    get resetKey() {
      return lastResetKey;
    },
  };
}

describe("zero/empty input × resetKey-driven reset", () => {
  it("qty=0 & pricePerPackage='' tetap zero-state selama resetKey sama (walau refetch)", () => {
    __resetBeliDerivedMemo();
    const h = createBeliHarness({ item: BOTOL });

    h.setQty("0");
    h.setPricePerPackage("");
    const before = h.snapshot();
    expect(before.derived.pkgQ).toBe(0);
    expect(before.derived.price).toBe(0);
    expect(before.derived.baseAdded).toBe(0);
    expect(before.derived.totalCost).toBe(0);
    const codes = before.warnings.map((w) => w.code).sort();
    expect(codes).toContain("QTY_ZERO");
    expect(codes).toContain("PRICE_ZERO");

    // 10 refetch murni — resetKey TIDAK berubah, form tidak boleh di-reset.
    for (let i = 1; i <= 10; i++) {
      const didReset = h.refetch((it) => ({
        ...it,
        stock_base: it.stock_base + i,
        avg_cost_per_base: it.avg_cost_per_base + (i % 3),
      }));
      expect(didReset).toBe(false);
      const s = h.snapshot();
      expect(s.form.packageQty).toBe("0");
      expect(s.form.pricePerPackage).toBe("");
      expect(s.derived.pkgQ).toBe(0);
      expect(s.derived.totalCost).toBe(0);
      expect(s.warnings.map((w) => w.code)).toEqual(
        expect.arrayContaining(["QTY_ZERO", "PRICE_ZERO"]),
      );
    }
  });

  it("resetKey berubah (switch item) memulihkan qty ke '1' & derived/warnings mencerminkan default baru", () => {
    __resetBeliDerivedMemo();
    const h = createBeliHarness({ item: BOTOL });

    h.setQty("0");
    h.setPricePerPackage("0");
    const zeroSnap = h.snapshot();
    expect(zeroSnap.derived.pkgQ).toBe(0);
    expect(zeroSnap.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["QTY_ZERO", "PRICE_ZERO"]),
    );

    // Switch ke item lain — resetKey berubah, form di-reset.
    const didReset = h.switchItem(EMPTY_ITEM);
    expect(didReset).toBe(true);

    const after = h.snapshot();
    // Form kembali ke default reset.
    expect(after.form.packageQty).toBe("1");
    expect(after.form.pricePerPackage).toBe("");
    expect(after.form.priceMode).toBe("package"); // gram → package
    // Derived pakai item baru: package_size=1000, pkgQ=1, price=0 (harga kosong).
    expect(after.derived.effPackageType).toBe("gram");
    expect(after.derived.effectivePkgSize).toBe(1000);
    expect(after.derived.pkgQ).toBe(1);
    expect(after.derived.price).toBe(0);
    expect(after.derived.baseAdded).toBe(1000);
    expect(after.derived.totalCost).toBe(0);
    // Warnings: PRICE_ZERO tetap (harga default kosong), QTY_ZERO HILANG
    // (qty sekarang 1). BASE_ADDED_HUGE juga mungkin muncul karena
    // stock_base=0 → baseAdded (1000) >> HUGE_BASE_ADDED_RATIO*stock_base.
    const codesAfter = after.warnings.map((w) => w.code);
    expect(codesAfter).toContain("PRICE_ZERO");
    expect(codesAfter).not.toContain("QTY_ZERO");
  });

  it("stock_base=0 pada item baru: warning hanya berubah setelah resetKey berubah, bukan saat refetch", () => {
    __resetBeliDerivedMemo();
    const h = createBeliHarness({ item: BOTOL });
    h.setQty("1");
    h.setPricePerPackage("10000");
    const baseline = h.snapshot();
    const baselineCodes = new Set(baseline.warnings.map((w) => w.code));

    // Refetch: paksa stock_base menjadi 0 TANPA mengganti item (resetKey tetap).
    // Isi kunci-efektif untuk derived (package_type/size/base_unit) tidak
    // berubah — hanya stok yang jatuh ke nol.
    h.refetch((it) => ({ ...it, stock_base: 0 }));
    const afterRefetch = h.snapshot();

    // Bila resetKey belum berubah, form tidak di-reset → qty/harga
    // tetap seperti yang di-set user.
    expect(afterRefetch.form.packageQty).toBe("1");
    expect(afterRefetch.form.pricePerPackage).toBe("10000");
    // Derived output invarian karena kunci efektif tidak berubah dan
    // stock_base bukan bagian dari `derived`.
    expect(afterRefetch.derived).toEqual(baseline.derived);
    // Warnings BOLEH berubah (mereka baca stock_base), tapi hanya isi
    // spesifik — bukan karena reset form.
    const afterCodes = new Set(afterRefetch.warnings.map((w) => w.code));
    expect(afterCodes.has("QTY_ZERO")).toBe(false);
    expect(afterCodes.has("PRICE_ZERO")).toBe(false);

    // Sekarang switch ke item lain (resetKey berubah) → form di-reset.
    const didReset = h.switchItem(EMPTY_ITEM);
    expect(didReset).toBe(true);
    const s = h.snapshot();
    expect(s.form.packageQty).toBe("1");
    expect(s.form.pricePerPackage).toBe(""); // harga direset walau sempat "10000"
    expect(s.derived.price).toBe(0);
    expect(s.warnings.map((w) => w.code)).toContain("PRICE_ZERO");
    // Sanity: baseline codes untuk botol tidak bocor ke item gram baru.
    expect(baselineCodes.has("PRICE_ZERO")).toBe(false);
  });

  it("empty string di harga: derived konsisten (price=0) dan warnings mengandung PRICE_ZERO, konsisten lintas refetch", () => {
    __resetBeliDerivedMemo();
    const h = createBeliHarness({ item: BOTOL });
    h.setPricePerPackage(""); // kosong
    const first = h.snapshot();
    expect(first.derived.price).toBe(0);
    expect(first.derived.totalCost).toBe(0);
    expect(first.warnings.map((w) => w.code)).toContain("PRICE_ZERO");

    // 8 refetch → derived + warnings tidak berubah (kunci efektif stabil).
    for (let i = 1; i <= 8; i++) {
      h.refetch((it) => ({ ...it, stock_base: it.stock_base + i }));
      const s = h.snapshot();
      expect(s.derived).toEqual(first.derived);
      expect(s.warnings).toEqual(first.warnings);
    }
  });
});