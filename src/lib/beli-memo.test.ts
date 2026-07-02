import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "./beli-derived";
import {
  computeBeliWarnings,
  __resetBeliWarningsMemo,
} from "./beli-warnings";
import { beliResetKey } from "./beli-reset-key";

const ITEM = {
  package_type: "botol",
  package_size: 500,
  base_unit: "g",
  stock_base: 10_000,
  avg_cost_per_base: 20,
  name: "Sirup",
};

function inp(overrides?: Partial<BeliDerivedInput>): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem: ITEM,
    newPackageType: "botol",
    newPackageSize: "500",
    packageQty: "2",
    pricePerPackage: "10000",
    priceMode: "package",
    pricePerBase: "",
    inputKarton: false,
    ...overrides,
  };
}

describe("computeBeliDerived — memo internal", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  it("mengembalikan referensi objek yang SAMA untuk input yang secara konten identik", () => {
    const a = computeBeliDerived(inp());
    const b = computeBeliDerived(inp());
    expect(b).toBe(a);
  });

  it("tetap sama saat selectedItem direfetch (referensi baru, isi sama)", () => {
    const a = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const b = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const c = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("alokasi baru saat input berubah (kontrol negatif)", () => {
    const a = computeBeliDerived(inp());
    const b = computeBeliDerived(inp({ packageQty: "3" }));
    expect(b).not.toBe(a);
    expect(b.pkgQ).toBe(3);
  });
});

describe("computeBeliWarnings — memo internal", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  it("mengembalikan array yang SAMA saat derived + input lain identik", () => {
    const d = computeBeliDerived(inp());
    const w1 = computeBeliWarnings({
      mode: "existing",
      selectedItem: ITEM,
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });
    const w2 = computeBeliWarnings({
      mode: "existing",
      selectedItem: ITEM,
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });
    expect(w2).toBe(w1);
  });

  it("stabil di lintas refetch: derived dari computeBeliDerived hit cache → warnings juga hit", () => {
    const d1 = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const w1 = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...ITEM },
      derived: d1,
      priceMode: "package",
      inputKarton: false,
    });
    const d2 = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const w2 = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...ITEM },
      derived: d2,
      priceMode: "package",
      inputKarton: false,
    });
    expect(d2).toBe(d1);
    expect(w2).toBe(w1);
  });

  it("alokasi baru saat input warnings berubah (mis. inputKarton)", () => {
    const d = computeBeliDerived(inp());
    const w1 = computeBeliWarnings({
      mode: "existing",
      selectedItem: ITEM,
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });
    const w2 = computeBeliWarnings({
      mode: "existing",
      selectedItem: ITEM,
      derived: d,
      priceMode: "package",
      inputKarton: true,
    });
    expect(w2).not.toBe(w1);
  });
});

// =============================================================
// TES NEGATIF — guard menahan reset/penghitungan ulang saat yang
// berubah hanya "object pendukung" (identitas item baru, metadata
// yang tidak relevan, item tambahan di daftar `items`, dst.).
// Bila salah satu tes ini gagal, artinya guard bocor: turunan akan
// alokasi baru / effect reset akan menembak padahal input efektif
// belum berubah.
// =============================================================
describe("guard menahan recompute untuk perubahan object pendukung", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  it("derived tetap referensi sama saat selectedItem menambah field metadata yang tidak dipakai", () => {
    // Field tambahan seperti `name`, `id`, `image_path`, `category`,
    // `updated_at` TIDAK masuk signature derivation — mengubahnya harus
    // tetap menghasilkan referensi yang sama.
    const a = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const b = computeBeliDerived(
      inp({
        selectedItem: {
          ...ITEM,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(({
            id: "abc-123",
            name: "Sirup (rev)",
            image_path: "s.png",
            category: "minuman",
            updated_at: "2026-07-02",
          } as any)),
        },
      }),
    );
    expect(b).toBe(a);
  });

  it("warnings tetap referensi sama saat metadata selectedItem yang tidak relevan berubah", () => {
    const d = computeBeliDerived(inp());
    const w1 = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...ITEM },
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });
    const w2 = computeBeliWarnings({
      mode: "existing",
      // metadata baru — bukan salah satu field di beliWarningsSig.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      selectedItem: { ...ITEM, ...(({ id: "x", name: "N", image_path: "p" } as any)) },
      derived: d,
      priceMode: "package",
      inputKarton: false,
    });
    expect(w2).toBe(w1);
  });

  it("derived hit cache saat referensi selectedItem baru tapi field efektif identik", () => {
    // Simulasi refetch: object item baru setiap render, isi field yang
    // dipakai persis sama.
    const a = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    for (let i = 0; i < 5; i++) {
      const next = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
      expect(next).toBe(a);
    }
  });

  it("resetKey stabil saat hanya metadata item / referensi berubah", () => {
    // resetKey hanya bergantung pada mode + itemId + packageType.
    // Perubahan pada nama, stok, harga rata-rata, atau referensi objek
    // TIDAK boleh menggeser resetKey → effect reset tidak menembak.
    const k1 = beliResetKey({ mode: "existing", itemId: "item-1", packageType: "botol" });
    const k2 = beliResetKey({ mode: "existing", itemId: "item-1", packageType: "botol" });
    expect(k2).toBe(k1);
    // packageType di sini adalah state "new" — untuk mode existing tidak
    // pengaruh. Perubahannya tetap harus menghasilkan resetKey yang sama.
    const k3 = beliResetKey({ mode: "existing", itemId: "item-1", packageType: "pcs" });
    expect(k3).toBe(k1);
  });

  it("kontrol positif: resetKey BERUBAH saat itemId berpindah (guarantee bukan false-negative)", () => {
    const k1 = beliResetKey({ mode: "existing", itemId: "item-1", packageType: "botol" });
    const k2 = beliResetKey({ mode: "existing", itemId: "item-2", packageType: "botol" });
    expect(k2).not.toBe(k1);
  });

  it("derived + warnings tetap stabil di sekuens refetch berulang dengan mutasi metadata acak", () => {
    // Skenario realistis: `items` di-refetch, tiap refetch object item
    // dapat identitas baru dan beberapa field metadata berubah (mis.
    // updated_at bergerak). Guard harus menahan agar turunan tidak
    // beralokasi — jika bocor, test ini gagal karena referensi berubah.
    const d0 = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const w0 = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...ITEM },
      derived: d0,
      priceMode: "package",
      inputKarton: false,
    });
    for (let i = 0; i < 10; i++) {
      const refetched = {
        ...ITEM,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(({ id: `rev-${i}`, name: `N-${i}`, updated_at: `t-${i}` } as any)),
      };
      const d = computeBeliDerived(inp({ selectedItem: refetched }));
      const w = computeBeliWarnings({
        mode: "existing",
        selectedItem: refetched,
        derived: d,
        priceMode: "package",
        inputKarton: false,
      });
      expect(d).toBe(d0);
      expect(w).toBe(w0);
    }
  });
});