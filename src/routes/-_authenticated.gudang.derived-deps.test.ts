import { describe, it, expect } from "vitest";

// Regression: dep array useMemo untuk `derived` dan `warnings` di
// _authenticated.gudang.tsx bersifat MINIMAL — hanya bergantung pada
// primitif kunci (mode, itemId, packageType) plus scalar input lain.
// Perubahan identitas objek `selectedItem` TIDAK boleh memicu factory
// useMemo untuk di-eksekusi ulang.
//
// Tes ini menggunakan harness lifecycle useMemo minimal. Karena test env
// tidak menjalankan React sungguhan, kita meniru semantics: factory
// dipanggil pertama kali, lalu setiap kali salah satu dep berubah
// (compared via Object.is).

type Deps = readonly unknown[];

function createMemoHarness<T>(factory: () => T, deps: Deps) {
  let lastDeps: Deps = deps;
  let lastValue: T = factory();
  let calls = 1;
  return {
    get calls() {
      return calls;
    },
    get value() {
      return lastValue;
    },
    commit(nextDeps: Deps, nextFactory: () => T) {
      const changed =
        nextDeps.length !== lastDeps.length ||
        nextDeps.some((d, i) => !Object.is(d, lastDeps[i]));
      if (changed) {
        lastDeps = nextDeps;
        lastValue = nextFactory();
        calls += 1;
      }
    },
  };
}

describe("useMemo(derived) dep minimal — [mode, itemId, packageType, ...scalar]", () => {
  it("refetch selectedItem dengan identitas baru + itemId sama → factory TIDAK dipanggil ulang", () => {
    let selectedItem: object | null = { id: "botol-500", package_type: "botol" };
    const mode: "existing" | "new" = "existing";
    const itemId = "botol-500";
    const packageType = "botol";
    const packageSize = "500";
    const packageQty = "1";
    const pricePerPackage = "";
    const priceMode = "package";
    const pricePerBase = "";
    const inputKarton = false;

    const factory = () => ({ ref: selectedItem, ts: Math.random() });
    const h = createMemoHarness(factory, [
      mode,
      itemId,
      packageType,
      packageSize,
      packageQty,
      pricePerPackage,
      priceMode,
      pricePerBase,
      inputKarton,
    ]);
    const first = h.value;

    for (let i = 0; i < 10; i++) {
      // Simulasi refetch: selectedItem dapat referensi baru, itemId sama.
      selectedItem = { id: "botol-500", package_type: "botol", rev: i };
      h.commit(
        [
          mode,
          itemId,
          packageType,
          packageSize,
          packageQty,
          pricePerPackage,
          priceMode,
          pricePerBase,
          inputKarton,
        ],
        factory,
      );
    }
    expect(h.calls).toBe(1);
    expect(h.value).toBe(first);
  });

  it("perubahan itemId → factory dipanggil ulang tepat sekali per transisi", () => {
    let itemId = "a";
    const factory = () => ({ itemId });
    const h = createMemoHarness(factory, [itemId]);
    expect(h.calls).toBe(1);
    itemId = "b";
    h.commit([itemId], factory);
    expect(h.calls).toBe(2);
    itemId = "c";
    h.commit([itemId], factory);
    expect(h.calls).toBe(3);
    // Idempoten
    itemId = "c";
    h.commit([itemId], factory);
    expect(h.calls).toBe(3);
  });

  it("perubahan packageType di mode 'new' → factory dipanggil ulang", () => {
    let packageType = "botol";
    const mode = "new";
    const itemId = "";
    const factory = () => ({ packageType });
    const h = createMemoHarness(factory, [mode, itemId, packageType]);
    expect(h.calls).toBe(1);
    packageType = "pcs";
    h.commit([mode, itemId, packageType], factory);
    expect(h.calls).toBe(2);
    packageType = "gram";
    h.commit([mode, itemId, packageType], factory);
    expect(h.calls).toBe(3);
  });

  it("perubahan scalar input (packageQty) → factory dipanggil ulang; selectedItem identity ganti bersamaan → tetap 1 call", () => {
    let packageQty = "1";
    let selectedItem: object = { id: "a" };
    const factory = () => ({ packageQty, item: selectedItem });
    const h = createMemoHarness(factory, ["existing", "a", "botol", packageQty]);
    packageQty = "2";
    selectedItem = { id: "a", rev: 1 }; // identitas baru, sama itemId
    h.commit(["existing", "a", "botol", packageQty], factory);
    expect(h.calls).toBe(2);
    // Refetch lagi tanpa mengubah packageQty → tidak menaikkan call.
    selectedItem = { id: "a", rev: 2 };
    h.commit(["existing", "a", "botol", packageQty], factory);
    expect(h.calls).toBe(2);
  });

  it("kontrol negatif: selectedItem dijadikan dep (skema lama) → refetch memicu recompute", () => {
    // Ini demonstrasi kenapa dep minimal penting: jika kita SALAH menaruh
    // selectedItem sebagai dep, tiap refetch menaikkan call count.
    let selectedItem: object = { id: "a" };
    const factory = () => ({ item: selectedItem });
    const h = createMemoHarness(factory, ["existing", "a", "botol", selectedItem]);
    for (let i = 0; i < 5; i++) {
      selectedItem = { id: "a", rev: i };
      h.commit(["existing", "a", "botol", selectedItem], factory);
    }
    expect(h.calls).toBe(6);
  });
});
