import { describe, it, expect } from "vitest";
import { computeBeliDerived, type BeliDerivedInput } from "./beli-derived";
import { BOTOL_PER_KARTON } from "./stock-format";

const gsBotol = {
  package_type: "botol",
  package_size: 100, // 100 g / botol (contoh GS)
  base_unit: "g",
};
const sprGram = {
  package_type: "gram",
  package_size: 500,
  base_unit: "g",
};
const pcsItem = {
  package_type: "pcs",
  package_size: 1,
  base_unit: "pcs",
};

function baseInput(overrides: Partial<BeliDerivedInput> = {}): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem: gsBotol,
    // sengaja kotor: nilai "barang baru" tidak boleh bocor ke mode existing
    newPackageType: "gram",
    newPackageSize: "999",
    packageQty: "1",
    pricePerPackage: "0",
    priceMode: "package",
    pricePerBase: "0",
    inputKarton: false,
    ...overrides,
  };
}

describe("computeBeliDerived — mode 'Barang yang ada'", () => {
  it("mengambil jenis kemasan/ukuran/base unit dari item terpilih, bukan default form 'barang baru'", () => {
    const d = computeBeliDerived(baseInput());
    expect(d.effPackageType).toBe("botol");
    expect(d.effBaseUnit).toBe("g");
    expect(d.effectivePkgSize).toBe(100);
    // Regresi: tidak boleh mewarisi "999" dari newPackageSize.
    expect(d.effectivePkgSize).not.toBe(999);
  });

  it("qty & baseAdded konsisten untuk item botol (100 botol × 100 g)", () => {
    const d = computeBeliDerived(baseInput({ packageQty: "100" }));
    expect(d.pkgQ).toBe(100);
    expect(d.baseAdded).toBe(100 * 100);
  });

  it("harga per kemasan dipakai apa adanya saat priceMode=package", () => {
    const d = computeBeliDerived(
      baseInput({ packageQty: "10", pricePerPackage: "5000", priceMode: "package" }),
    );
    expect(d.price).toBe(5000);
    expect(d.totalCost).toBe(10 * 5000);
  });

  it("priceMode=base mengalikan harga/gram dengan ukuran kemasan item terpilih", () => {
    const d = computeBeliDerived(
      baseInput({ packageQty: "3", priceMode: "base", pricePerBase: "50" }),
    );
    // 50/g × 100 g = 5000 per botol
    expect(d.price).toBe(50 * 100);
    expect(d.totalCost).toBe(3 * 50 * 100);
  });

  it("mode karton aktif hanya untuk botol dan menggandakan qty × BOTOL_PER_KARTON, harga ÷ BOTOL_PER_KARTON", () => {
    const d = computeBeliDerived(
      baseInput({ inputKarton: true, packageQty: "2", pricePerPackage: String(200 * BOTOL_PER_KARTON) }),
    );
    expect(d.kartonActive).toBe(true);
    expect(d.pkgQ).toBe(2 * BOTOL_PER_KARTON);
    expect(d.price).toBe(200);
    expect(d.totalCost).toBe(2 * BOTOL_PER_KARTON * 200);
    expect(d.baseAdded).toBe(2 * BOTOL_PER_KARTON * 100);
  });

  it("karton diabaikan bila item bukan botol (mis. gram) sehingga qty tidak ×100", () => {
    const d = computeBeliDerived(
      baseInput({ selectedItem: sprGram, inputKarton: true, packageQty: "4" }),
    );
    expect(d.effPackageType).toBe("gram");
    expect(d.effectivePkgSize).toBe(500);
    expect(d.kartonActive).toBe(false);
    expect(d.pkgQ).toBe(4);
    expect(d.baseAdded).toBe(4 * 500);
  });

  it("item pcs memaksa effectivePkgSize=1 walau state form berbeda", () => {
    const d = computeBeliDerived(
      baseInput({ selectedItem: pcsItem, newPackageSize: "999", packageQty: "7", pricePerPackage: "1500" }),
    );
    expect(d.effPackageType).toBe("pcs");
    expect(d.effBaseUnit).toBe("pcs");
    expect(d.effectivePkgSize).toBe(1);
    expect(d.baseAdded).toBe(7);
    expect(d.totalCost).toBe(7 * 1500);
  });

  it("mengganti item terpilih menghitung ulang ukuran/base — tidak ada nilai kacau yang bertahan", () => {
    const inp = baseInput({ packageQty: "2", pricePerPackage: "1000" });
    const first = computeBeliDerived(inp);
    expect(first.effectivePkgSize).toBe(100);
    expect(first.baseAdded).toBe(200);

    const switched = computeBeliDerived({ ...inp, selectedItem: sprGram });
    expect(switched.effPackageType).toBe("gram");
    expect(switched.effectivePkgSize).toBe(500);
    expect(switched.baseAdded).toBe(2 * 500);
    // tidak ada residu dari item botol sebelumnya
    expect(switched.effectivePkgSize).not.toBe(100);
  });

  it("mode 'new' tetap membaca dari state form dan tidak terpengaruh selectedItem yang tertinggal", () => {
    const d = computeBeliDerived(
      baseInput({ mode: "new", newPackageType: "sachet", newPackageSize: "10", packageQty: "5" }),
    );
    expect(d.effPackageType).toBe("sachet");
    expect(d.effBaseUnit).toBe("pcs");
    expect(d.effectivePkgSize).toBe(10);
    expect(d.baseAdded).toBe(50);
  });

  it("input kosong/NaN diperlakukan sebagai 0", () => {
    const d = computeBeliDerived(baseInput({ packageQty: "", pricePerPackage: "abc" as unknown as string }));
    expect(d.pkgQ).toBe(0);
    expect(d.price).toBe(0);
    expect(d.baseAdded).toBe(0);
    expect(d.totalCost).toBe(0);
  });
});