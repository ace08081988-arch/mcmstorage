import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
  type BeliPackageType,
} from "@/lib/beli-derived";
import { fmtBase, fmtItemQty, rupiah } from "@/lib/stock-format";

/**
 * Memastikan single-slot memo di `computeBeliDerived` tidak pernah menahan
 * output lama saat SALAH SATU input (mode, item, jenis kemasan, ukuran,
 * qty, harga, priceMode, karton) berubah. Setiap field diuji terpisah
 * agar regresi (mis. lupa memasukkan field ke signature) langsung
 * ketahuan skenario mana yang bocor.
 *
 * Juga menguji bahwa string yang diformat (fmtBase/fmtItemQty/rupiah)
 * di-*derive* ulang dari output segar — bukan disimpan sebagai referensi
 * lama di sisi konsumen.
 */

const BASE: BeliDerivedInput = {
  mode: "new",
  selectedItem: null,
  newPackageType: "gram",
  newPackageSize: "1000",
  packageQty: "2",
  pricePerPackage: "10000",
  priceMode: "package",
  pricePerBase: "",
  inputKarton: false,
};

beforeEach(() => __resetBeliDerivedMemo());

describe("computeBeliDerived — memo freshness (per-field invalidation)", () => {
  it("hit memo saat input identik (byte-for-byte)", () => {
    const a = computeBeliDerived(BASE);
    const b = computeBeliDerived({ ...BASE });
    expect(b).toBe(a); // referential equality = memo hit
  });

  const CHANGES: Array<{
    name: string;
    patch: Partial<BeliDerivedInput>;
    expect: (before: ReturnType<typeof computeBeliDerived>, after: ReturnType<typeof computeBeliDerived>) => void;
  }> = [
    {
      name: "newPackageType: gram → botol",
      patch: { newPackageType: "botol", newPackageSize: "500" },
      expect: (before, after) => {
        expect(before.effPackageType).toBe("gram");
        expect(after.effPackageType).toBe("botol");
        // defaultBaseUnit(botol) = "pcs" (hanya "gram" yang default ke "g")
        expect(after.effBaseUnit).toBe("pcs");
      },
    },
    {
      name: "newPackageType: gram → pcs (baseUnit ikut berubah)",
      patch: { newPackageType: "pcs" },
      expect: (_b, after) => {
        expect(after.effPackageType).toBe("pcs");
        expect(after.effBaseUnit).toBe("pcs");
        expect(after.effectivePkgSize).toBe(1);
      },
    },
    {
      name: "newPackageType: gram → sachet",
      patch: { newPackageType: "sachet" },
      expect: (_b, after) => {
        expect(after.effPackageType).toBe("sachet");
        expect(after.effBaseUnit).toBe("pcs");
      },
    },
    {
      name: "newPackageSize berubah",
      patch: { newPackageSize: "250" },
      expect: (b, a) => expect(a.effectivePkgSize).not.toBe(b.effectivePkgSize),
    },
    {
      name: "packageQty berubah",
      patch: { packageQty: "5" },
      expect: (b, a) => {
        expect(a.pkgQ).toBe(5);
        expect(a.pkgQ).not.toBe(b.pkgQ);
      },
    },
    {
      name: "pricePerPackage berubah",
      patch: { pricePerPackage: "25000" },
      expect: (b, a) => expect(a.totalCost).not.toBe(b.totalCost),
    },
    {
      name: "priceMode: package → base",
      patch: { priceMode: "base", pricePerBase: "20", pricePerPackage: "" },
      expect: (b, a) => expect(a.price).not.toBe(b.price),
    },
    {
      name: "pricePerBase berubah (di mode base)",
      patch: { priceMode: "base", pricePerBase: "40", pricePerPackage: "" },
      expect: (_b, a) => expect(a.price).toBe(40 * a.effectivePkgSize),
    },
    {
      name: "inputKarton berubah (jenis botol)",
      patch: { newPackageType: "botol", newPackageSize: "500", inputKarton: true },
      expect: (_b, a) => expect(a.kartonActive).toBe(true),
    },
    {
      name: "mode: new → existing (selectedItem ikut)",
      patch: {
        mode: "existing",
        selectedItem: {
          id: "x",
          name: "Botol",
          package_type: "botol",
          package_size: 500,
          base_unit: "g",
          avg_cost_per_base: 10,
        } as any,
      },
      expect: (_b, a) => {
        expect(a.effPackageType).toBe("botol");
        expect(a.effBaseUnit).toBe("g");
      },
    },
  ];

  for (const c of CHANGES) {
    it(`invalidasi memo ketika: ${c.name}`, () => {
      const before = computeBeliDerived(BASE);
      const after = computeBeliDerived({ ...BASE, ...c.patch });
      // Referensi WAJIB berbeda → tidak menahan referensi lama.
      expect(after).not.toBe(before);
      c.expect(before, after);
    });
  }

  it("recompute setelah rangkaian perubahan cepat tetap konsisten (tidak menahan referensi lama)", () => {
    const seq: BeliPackageType[] = ["gram", "botol", "pcs", "sachet", "gram"];
    const outputs = seq.map((pt) =>
      computeBeliDerived({ ...BASE, newPackageType: pt, newPackageSize: pt === "botol" ? "500" : "1000" }),
    );
    // Semua langkah adalah instance BARU (tidak ada memo hit lintas jenis).
    const uniq = new Set(outputs);
    expect(uniq.size).toBe(outputs.length);
    outputs.forEach((o, i) => {
      expect(o.effPackageType).toBe(seq[i]);
      // Hanya "gram" yang punya defaultBaseUnit "g"; sisanya "pcs".
      expect(o.effBaseUnit).toBe(seq[i] === "gram" ? "g" : "pcs");
    });
  });
});

describe("Format string turunan tidak menyimpan referensi lama", () => {
  it("fmtBase/fmtItemQty/rupiah mengikuti output derivasi terbaru", () => {
    const g = computeBeliDerived({ ...BASE, newPackageType: "gram", newPackageSize: "1000", packageQty: "2" });
    const gramStr = fmtBase(g.baseAdded, g.effBaseUnit);

    const p = computeBeliDerived({ ...BASE, newPackageType: "pcs", packageQty: "3" });
    const pcsStr = fmtBase(p.baseAdded, p.effBaseUnit);

    // Setelah beralih ke pcs, string TIDAK boleh masih memuat unit gram.
    expect(gramStr).not.toBe(pcsStr);
    expect(pcsStr).not.toMatch(/\bg\b/);
    expect(pcsStr).toMatch(/pcs/);

    // Kembali ke gram: string harus segar lagi (bukan referensi pcs).
    const g2 = computeBeliDerived({ ...BASE, newPackageType: "gram", newPackageSize: "1000", packageQty: "2" });
    const gramStr2 = fmtBase(g2.baseAdded, g2.effBaseUnit);
    expect(gramStr2).not.toMatch(/pcs/);
  });

  it("fmtItemQty untuk item existing memakai base_unit item terkini, bukan snapshot lama", () => {
    const itemBotol = {
      id: "b",
      name: "Botol",
      package_type: "botol",
      package_size: 500,
      base_unit: "g" as const,
      avg_cost_per_base: 10,
    };
    const itemPcs = {
      id: "p",
      name: "Sikat",
      package_type: "pcs",
      package_size: 1,
      base_unit: "pcs" as const,
      avg_cost_per_base: 3000,
    };
    const dA = computeBeliDerived({ ...BASE, mode: "existing", selectedItem: itemBotol as any });
    const dB = computeBeliDerived({ ...BASE, mode: "existing", selectedItem: itemPcs as any });
    const sA = fmtItemQty(dA.baseAdded, itemBotol as any);
    const sB = fmtItemQty(dB.baseAdded, itemPcs as any);
    expect(sA).not.toBe(sB);
    expect(sB).toMatch(/pcs/);
    expect(sA).not.toMatch(/pcs/);
  });

  it("rupiah selalu berasal dari totalCost segar, bukan cache lama", () => {
    const a = computeBeliDerived({ ...BASE, packageQty: "1", pricePerPackage: "1000" });
    const b = computeBeliDerived({ ...BASE, packageQty: "1", pricePerPackage: "9000" });
    expect(rupiah(a.totalCost)).not.toBe(rupiah(b.totalCost));
    expect(rupiah(b.totalCost)).toMatch(/9\.000/);
  });
});