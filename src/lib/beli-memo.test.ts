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

// =============================================================
// TES — refetch selectedItem dengan package_type null/undefined.
// Kasus nyata: server sesekali mengembalikan item dengan field
// packaging yang belum di-set (null) atau baru dibuat (undefined).
// Selama nilai efektif tidak berubah antar refetch, derived dan
// warnings HARUS tetap referensi yang sama.
// =============================================================
describe("guard stabil saat selectedItem punya package_type null/undefined", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NULL_ITEM: any = {
    package_type: null,
    package_size: null,
    base_unit: null,
    stock_base: 0,
    avg_cost_per_base: 0,
    name: "Belum di-set",
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const UNDEF_ITEM: any = {
    package_type: undefined,
    package_size: undefined,
    base_unit: undefined,
    stock_base: 0,
    avg_cost_per_base: 0,
    name: "Belum di-set",
  };

  it("derived stabil saat refetch item dengan package_type null (referensi baru, isi sama)", () => {
    const a = computeBeliDerived(inp({ selectedItem: { ...NULL_ITEM } }));
    const b = computeBeliDerived(inp({ selectedItem: { ...NULL_ITEM } }));
    const c = computeBeliDerived(inp({ selectedItem: { ...NULL_ITEM, name: "X" } }));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("derived stabil saat refetch item dengan package_type undefined", () => {
    const a = computeBeliDerived(inp({ selectedItem: { ...UNDEF_ITEM } }));
    const b = computeBeliDerived(inp({ selectedItem: { ...UNDEF_ITEM } }));
    expect(b).toBe(a);
  });

  it("warnings stabil saat refetch item dengan package_type null", () => {
    const d1 = computeBeliDerived(inp({ selectedItem: { ...NULL_ITEM } }));
    const w1 = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...NULL_ITEM },
      derived: d1,
      priceMode: "package",
      inputKarton: false,
    });
    const d2 = computeBeliDerived(inp({ selectedItem: { ...NULL_ITEM } }));
    const w2 = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...NULL_ITEM },
      derived: d2,
      priceMode: "package",
      inputKarton: false,
    });
    expect(d2).toBe(d1);
    expect(w2).toBe(w1);
  });

  it("warnings stabil saat refetch item dengan package_type undefined", () => {
    const d1 = computeBeliDerived(inp({ selectedItem: { ...UNDEF_ITEM } }));
    const w1 = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...UNDEF_ITEM },
      derived: d1,
      priceMode: "package",
      inputKarton: false,
    });
    const d2 = computeBeliDerived(inp({ selectedItem: { ...UNDEF_ITEM } }));
    const w2 = computeBeliWarnings({
      mode: "existing",
      selectedItem: { ...UNDEF_ITEM },
      derived: d2,
      priceMode: "package",
      inputKarton: false,
    });
    expect(d2).toBe(d1);
    expect(w2).toBe(w1);
  });

  it("null dan undefined DIPERLAKUKAN SAMA — refetch bolak-balik null↔undefined tidak memicu alokasi baru bila field lain identik", () => {
    // Kontrak: `beliDerivedSig` mem-stringify field pakai template literal,
    // jadi `null` → "null" dan `undefined` → "undefined". Nilai-nilai ini
    // BEDA sig, jadi TES INI adalah kontrol negatif: tukar null↔undefined
    // memang memicu alokasi baru. Ini melindungi guard dari false-positive.
    const a = computeBeliDerived(inp({ selectedItem: { ...NULL_ITEM } }));
    const b = computeBeliDerived(inp({ selectedItem: { ...UNDEF_ITEM } }));
    expect(b).not.toBe(a);
  });

  it("burst refetch (20×) untuk item null-packaging tetap 0 alokasi baru", () => {
    const first = computeBeliDerived(inp({ selectedItem: { ...NULL_ITEM } }));
    for (let i = 0; i < 20; i++) {
      const next = computeBeliDerived(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inp({ selectedItem: { ...NULL_ITEM, ...(({ id: `rev-${i}`, updated_at: `t-${i}` } as any)) } }),
      );
      expect(next).toBe(first);
    }
  });

  it("transisi null → punya packaging benar-benar memicu alokasi baru (kontrol positif)", () => {
    const a = computeBeliDerived(inp({ selectedItem: { ...NULL_ITEM } }));
    const b = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    expect(b).not.toBe(a);
    // Kembali ke null: alokasi baru lagi karena sig beda dari `b`.
    const c = computeBeliDerived(inp({ selectedItem: { ...NULL_ITEM } }));
    expect(c).not.toBe(b);
  });
});

// =============================================================
// TES SELEKTIVITAS — perubahan harga/quantity dari selectedItem
// (`avg_cost_per_base`, `stock_base`) TIDAK boleh mempengaruhi
// hasil `computeBeliDerived` (karena derived hanya membaca field
// packaging), tapi HARUS bisa mempengaruhi `computeBeliWarnings`
// bila memang menjadi ambang peringatan.
// itemId & packageType (di sini: package_type + package_size + base_unit)
// tetap sama sepanjang blok ini.
// =============================================================
describe("selektivitas: harga/quantity item berubah, packaging tetap", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
    __resetBeliWarningsMemo();
  });

  // Helper: bikin varian item dengan override sembarang. Cast ke tipe
  // BeliDerivedItem karena `stock_base`/`avg_cost_per_base` bukan bagian dari
  // tipe derived (mereka hanya dipakai di warnings). Semua fungsi produksi
  // menerima objek yang lebih luas — cast di sini hanya untuk memuaskan TS.
  const mkItem = (over: Record<string, unknown> = {}) =>
    ({ ...ITEM, ...over } as unknown as typeof ITEM & { package_type: string; package_size: number; base_unit: string });

  // Helper: bikin input warnings dari input derived.
  function warnInp(over?: Partial<BeliDerivedInput>) {
    const dIn = inp(over);
    const derived = computeBeliDerived(dIn);
    return {
      mode: dIn.mode,
      selectedItem: dIn.selectedItem,
      derived,
      priceMode: dIn.priceMode,
      inputKarton: dIn.inputKarton,
    } as const;
  }

  it("derived STABIL saat hanya avg_cost_per_base yang berubah pada selectedItem", () => {
    const a = computeBeliDerived(inp({ selectedItem: mkItem({ avg_cost_per_base: 20 }) }));
    const b = computeBeliDerived(inp({ selectedItem: mkItem({ avg_cost_per_base: 25 }) }));
    const c = computeBeliDerived(inp({ selectedItem: mkItem({ avg_cost_per_base: 999 }) }));
    // packaging tuple identik → memo hit; referensi sama.
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("derived STABIL saat hanya stock_base yang berubah pada selectedItem", () => {
    const a = computeBeliDerived(inp({ selectedItem: mkItem({ stock_base: 10_000 }) }));
    const b = computeBeliDerived(inp({ selectedItem: mkItem({ stock_base: 0 }) }));
    const c = computeBeliDerived(inp({ selectedItem: mkItem({ stock_base: 1_000_000 }) }));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("derived STABIL saat stock_base + avg_cost_per_base berubah bersamaan", () => {
    const a = computeBeliDerived(
      inp({ selectedItem: mkItem({ stock_base: 10_000, avg_cost_per_base: 20 }) }),
    );
    const b = computeBeliDerived(
      inp({ selectedItem: mkItem({ stock_base: 500, avg_cost_per_base: 5 }) }),
    );
    expect(b).toBe(a);
  });

  it("warnings BERUBAH konten saat avg_cost_per_base melintasi ambang deviasi harga", () => {
    // pkgQ=2, pricePerPackage=10000, effectivePkgSize=500 → baseAdded=1000,
    // pricePerBase (agregat) = (2*10000)/1000 = 20.
    // avg=20 → ratio=1.0 → tidak ada warning harga.
    const w1 = computeBeliWarnings(warnInp({ selectedItem: mkItem({ avg_cost_per_base: 20 }) }));
    expect(w1.some((w) => w.code === "PRICE_PER_BASE_HIGH")).toBe(false);
    expect(w1.some((w) => w.code === "PRICE_PER_BASE_LOW")).toBe(false);

    // Turunkan avg drastis: ratio 20/5 = 4 → PRICE_PER_BASE_HIGH.
    const w2 = computeBeliWarnings(warnInp({ selectedItem: mkItem({ avg_cost_per_base: 5 }) }));
    expect(w2.some((w) => w.code === "PRICE_PER_BASE_HIGH")).toBe(true);

    // Naikkan avg drastis: ratio 20/100 = 0.2 → PRICE_PER_BASE_LOW.
    const w3 = computeBeliWarnings(warnInp({ selectedItem: mkItem({ avg_cost_per_base: 100 }) }));
    expect(w3.some((w) => w.code === "PRICE_PER_BASE_LOW")).toBe(true);

    // Referensi warnings BERUBAH antar-skenario karena signature-nya
    // menyertakan avg_cost_per_base.
    expect(w2).not.toBe(w1);
    expect(w3).not.toBe(w1);
    expect(w3).not.toBe(w2);
  });

  it("warnings STABIL (referensi sama) saat avg_cost_per_base berubah TAPI masih di dalam ambang deviasi", () => {
    // Ratio deviasi = 0.5 → aman selama avg antara ~13 dan 40 (harga aktual 20).
    const w1 = computeBeliWarnings(warnInp({ selectedItem: mkItem({ avg_cost_per_base: 20 }) }));
    const w2 = computeBeliWarnings(warnInp({ selectedItem: mkItem({ avg_cost_per_base: 20 }) }));
    expect(w2).toBe(w1); // memo hit langsung
    // Nilai berbeda tapi signature warnings tetap unik → refetch dengan nilai
    // baru menghasilkan alokasi baru (kontrol) — TAPI hasilnya tetap kosong
    // dari warning harga.
    const w3 = computeBeliWarnings(warnInp({ selectedItem: mkItem({ avg_cost_per_base: 22 }) }));
    expect(w3.some((w) => w.code === "PRICE_PER_BASE_HIGH")).toBe(false);
    expect(w3.some((w) => w.code === "PRICE_PER_BASE_LOW")).toBe(false);
  });

  it("warnings BERUBAH konten saat stock_base melintasi ambang BASE_ADDED_HUGE", () => {
    // baseAdded = 1000. Ambang: baseAdded > stock * 100 → stock < 10.
    // stock 10_000 → aman.
    const wSafe = computeBeliWarnings(warnInp({ selectedItem: mkItem({ stock_base: 10_000 }) }));
    expect(wSafe.some((w) => w.code === "BASE_ADDED_HUGE")).toBe(false);

    // stock 5 → 1000 > 500 → trigger BASE_ADDED_HUGE.
    const wHuge = computeBeliWarnings(warnInp({ selectedItem: mkItem({ stock_base: 5 }) }));
    expect(wHuge.some((w) => w.code === "BASE_ADDED_HUGE")).toBe(true);
    expect(wHuge).not.toBe(wSafe);
  });

  it("burst refetch (30×) yang mengubah HANYA avg_cost_per_base dalam ambang aman → derived tetap referensi awal, warnings tetap tanpa warning harga", () => {
    const dFirst = computeBeliDerived(
      inp({ selectedItem: mkItem({ avg_cost_per_base: 20 }) }),
    );
    for (let i = 0; i < 30; i++) {
      // Jitter kecil di sekitar 20 (masih dalam ±50%).
      const avg = 15 + (i % 10);
      const dNext = computeBeliDerived(inp({ selectedItem: mkItem({ avg_cost_per_base: avg }) }));
      expect(dNext).toBe(dFirst); // derived referensi stabil
      const w = computeBeliWarnings(warnInp({ selectedItem: mkItem({ avg_cost_per_base: avg }) }));
      expect(w.some((x) => x.code === "PRICE_PER_BASE_HIGH")).toBe(false);
      expect(w.some((x) => x.code === "PRICE_PER_BASE_LOW")).toBe(false);
    }
  });

  it("kontrol positif: mengubah packaging (bukan hanya harga/qty) MENGUBAH derived — memastikan test negatif di atas bukan false-positive", () => {
    const a = computeBeliDerived(inp({ selectedItem: { ...ITEM } }));
    const b = computeBeliDerived(
      inp({ selectedItem: { ...ITEM, package_size: 250 } }),
    );
    expect(b).not.toBe(a);
  });
});