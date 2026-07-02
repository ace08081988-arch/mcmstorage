import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliDerivedInput,
} from "./beli-derived";
import { fmtItemQty, fmtBase, rupiah } from "./stock-format";

/**
 * Menjamin perhitungan & output turunan (ringkasan, string yang dipakai
 * di pesan WA lewat `fmtItemQty`/`fmtBase`) selalu mengikuti Jenis
 * kemasan TERBARU — memo single-slot di `beli-derived.ts` HARUS
 * ter-invalidate saat `newPackageType` atau `selectedItem` berubah.
 */

function base(overrides?: Partial<BeliDerivedInput>): BeliDerivedInput {
  return {
    mode: "new",
    selectedItem: null,
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

describe("beli-derived — switch Jenis kemasan tidak menyisakan cache memo lama", () => {
  beforeEach(() => __resetBeliDerivedMemo());

  it("botol → gram: effPackageType/effBaseUnit dan angka turunan langsung ikut gram/g", () => {
    const botol = computeBeliDerived(base());
    expect(botol.effPackageType).toBe("botol");
    expect(botol.effBaseUnit).toBe("pcs");
    expect(botol.effectivePkgSize).toBe(500);
    expect(botol.baseAdded).toBe(1000); // 2 × 500 pcs

    const gram = computeBeliDerived(
      base({ newPackageType: "gram", newPackageSize: "1000", packageQty: "3", pricePerPackage: "5000" }),
    );
    // Referensi objek berbeda — memo tidak dipakai ulang.
    expect(gram).not.toBe(botol);
    expect(gram.effPackageType).toBe("gram");
    expect(gram.effBaseUnit).toBe("g");
    expect(gram.effectivePkgSize).toBe(1000);
    expect(gram.baseAdded).toBe(3000);
    expect(gram.totalCost).toBe(15000);
  });

  it("rapid-fire toggle botol↔gram↔pcs: setiap call mencerminkan pilihan terbaru", () => {
    const seq: Array<{ pt: "botol" | "gram" | "pcs"; size: string; qty: string; price: string }> = [
      { pt: "botol", size: "500", qty: "2", price: "10000" },
      { pt: "gram", size: "1000", qty: "3", price: "5000" },
      { pt: "pcs", size: "1", qty: "4", price: "3000" },
      { pt: "gram", size: "250", qty: "5", price: "2000" },
      { pt: "botol", size: "330", qty: "1", price: "8000" },
    ];
    const outs = seq.map((s) =>
      computeBeliDerived(
        base({ newPackageType: s.pt, newPackageSize: s.size, packageQty: s.qty, pricePerPackage: s.price }),
      ),
    );
    // Setiap output cocok dengan input pada indeks yang sama — bukan bocor dari langkah sebelumnya.
    outs.forEach((o, i) => {
      const s = seq[i];
      expect(o.effPackageType).toBe(s.pt);
      expect(o.effBaseUnit).toBe(s.pt === "gram" ? "g" : "pcs");
      const expSize = s.pt === "pcs" ? 1 : Number(s.size);
      expect(o.effectivePkgSize).toBe(expSize);
      expect(o.baseAdded).toBe(Number(s.qty) * expSize);
      expect(o.totalCost).toBe(Number(s.qty) * Number(s.price));
    });
  });

  it("string turunan (ringkasan & pesan WA lewat fmtItemQty/fmtBase) ikut ke gram/g setelah switch", () => {
    // Hitung untuk botol lebih dulu — priming memo.
    computeBeliDerived(base());
    const gram = computeBeliDerived(
      base({ newPackageType: "gram", newPackageSize: "1000", packageQty: "3", pricePerPackage: "5000" }),
    );

    // Simulasi item yang baru dibuat setelah submit gram.
    const newItem = {
      name: "Gula Curah",
      base_unit: gram.effBaseUnit as "g",
      package_type: gram.effPackageType,
      package_size: gram.effectivePkgSize,
    };

    const stokStr = fmtItemQty(gram.baseAdded, newItem);
    // Untuk 3 × 1000 g → "3 gram (= 3 kg)" — tidak boleh menampilkan botol/pcs.
    expect(stokStr).toMatch(/3 gram/);
    expect(stokStr).toMatch(/3 kg/);
    expect(stokStr).not.toMatch(/\bbotol\b/);
    expect(stokStr).not.toMatch(/\bpcs\b/);

    // Baris "Tambahan stok" saat item baru menggunakan fmtBase(baseAdded, baseUnit).
    const tambahan = fmtBase(gram.baseAdded, gram.effBaseUnit);
    expect(tambahan).toBe("3 kg");

    // Baris "Harga per gram" & "Harga per g".
    expect(rupiah(gram.price)).toMatch(/Rp\s?5\.000/);
    expect(rupiah(gram.totalCost / gram.baseAdded)).toMatch(/Rp\s?5\b/); // 15000 / 3000 = 5
  });

  it("existing mode: pindah dari item botol ke item gram → tidak menahan effBaseUnit=pcs", () => {
    const botolItem = { package_type: "botol", package_size: 500, base_unit: "g" };
    const gramItem = { package_type: "gram", package_size: 1000, base_unit: "g" };

    const a = computeBeliDerived(
      base({ mode: "existing", selectedItem: botolItem, packageQty: "2", pricePerPackage: "10000" }),
    );
    expect(a.effPackageType).toBe("botol");
    expect(a.effectivePkgSize).toBe(500);

    const b = computeBeliDerived(
      base({ mode: "existing", selectedItem: gramItem, packageQty: "2", pricePerPackage: "10000" }),
    );
    expect(b).not.toBe(a);
    expect(b.effPackageType).toBe("gram");
    expect(b.effBaseUnit).toBe("g");
    expect(b.effectivePkgSize).toBe(1000);
    expect(b.baseAdded).toBe(2000);
  });
});