import { describe, it, expect, vi } from "vitest";
import {
  computeBeliDerived as realComputeDerived,
  type BeliDerivedInput,
} from "@/lib/beli-derived";
import { computeBeliWarnings as realComputeWarnings } from "@/lib/beli-warnings";
import { beliResetKey } from "@/lib/beli-reset-key";

// ============================================================
// Konsistensi derived + warnings saat `resetKey` berubah cepat
// berturut-turut DAN refetch item (identitas baru, isi non-efektif
// bergeser) terjadi di sela-selanya.
//
// Invarian yang diuji:
//   1. Nilai `derived` dan `warnings` di setiap commit SELALU sama
//      dengan hasil compute murni (fresh) untuk resetKey aktif —
//      refetch di tengah tidak boleh "menempel" hasil lama.
//   2. Compute hanya dipanggil ulang saat resetKey / kunci memo
//      benar-benar berubah, tidak saat refetch murni.
//   3. Ketika resetKey kembali ke nilai sebelumnya, hasil identik
//      dengan snapshot pertama untuk kunci tersebut (idempoten).
// ============================================================

type Deps = readonly unknown[];
function createMemo<T>(initial: { deps: Deps; factory: () => T }) {
  let lastDeps: Deps = initial.deps;
  let lastValue: T = initial.factory();
  return {
    get value() {
      return lastValue;
    },
    commit(nextDeps: Deps, nextFactory: () => T): boolean {
      const changed =
        nextDeps.length !== lastDeps.length ||
        nextDeps.some((d, i) => !Object.is(d, lastDeps[i]));
      if (changed) {
        lastDeps = nextDeps;
        lastValue = nextFactory();
      }
      return changed;
    },
  };
}

type PT = "botol" | "gram" | "pcs";
type Item = {
  id: string;
  package_type: PT;
  package_size: number;
  base_unit: "g" | "pcs";
  stock_base?: number;
  avg_cost_per_base?: number;
  name?: string;
};

const ITEMS: Record<string, Item> = {
  "botol-500": {
    id: "botol-500",
    package_type: "botol",
    package_size: 500,
    base_unit: "g",
    stock_base: 10_000,
    avg_cost_per_base: 20,
  },
  "gram-1000": {
    id: "gram-1000",
    package_type: "gram",
    package_size: 1000,
    base_unit: "g",
    stock_base: 5_000,
    avg_cost_per_base: 15,
  },
  "pcs-1": {
    id: "pcs-1",
    package_type: "pcs",
    package_size: 1,
    base_unit: "pcs",
    stock_base: 200,
    avg_cost_per_base: 3000,
  },
};

function refetch(id: string, seed: number): Item {
  // Refetch: identitas objek baru; hanya field yang TIDAK dipakai oleh
  // derived maupun warnings yang bergeser (stock_base & name). Dengan
  // begitu memoisasi berbasis resetKey harus selalu identik dengan
  // fresh compute untuk resetKey aktif.
  const src = ITEMS[id];
  return {
    ...src,
    stock_base: (src.stock_base ?? 0) + seed,
    name: `${id}-r${seed}`,
  };
}

function baseInp(item: Item): BeliDerivedInput {
  return {
    mode: "existing",
    selectedItem: item,
    newPackageType: item.package_type,
    newPackageSize: String(item.package_size),
    packageQty: "2",
    pricePerPackage: "10000",
    priceMode: "package",
    pricePerBase: String(item.base_unit === "g" ? "" : ""),
    inputKarton: false,
  };
}

describe("resetKey burst + refetch interleave: derived & warnings konsisten", () => {
  it("nilai selalu cocok dengan compute murni untuk resetKey aktif", () => {
    const spyDerived = vi.fn(realComputeDerived);
    const spyWarn = vi.fn(realComputeWarnings);

    let itemId: keyof typeof ITEMS = "botol-500";
    let item: Item = refetch(itemId, 0);
    const mode = "existing" as const;

    let resetKey = beliResetKey({ mode, itemId, packageType: item.package_type });

    const memoDerived = createMemo({
      deps: [resetKey],
      factory: () => spyDerived(baseInp(item)),
    });
    const memoWarn = createMemo({
      deps: [resetKey],
      factory: () =>
        spyWarn({
          mode,
          selectedItem: item,
          derived: memoDerived.value,
          priceMode: "package",
          inputKarton: false,
        }),
    });

    // Skenario: 40 langkah, 60% refetch murni, 40% switch item
    // (⇒ resetKey berubah). Setelah tiap langkah, bandingkan memoized
    // vs fresh compute — HARUS identik untuk resetKey saat itu.
    const order: (keyof typeof ITEMS)[] = ["botol-500", "gram-1000", "pcs-1"];
    let orderIdx = 0;
    let seed = 1;
    const snapshots = new Map<string, { derived: unknown; warn: unknown }>();

    for (let step = 0; step < 40; step++) {
      const isSwitch = step % 5 === 0 && step > 0;
      if (isSwitch) {
        orderIdx = (orderIdx + 1) % order.length;
        itemId = order[orderIdx];
      }
      item = refetch(itemId, seed++);
      resetKey = beliResetKey({ mode, itemId, packageType: item.package_type });

      memoDerived.commit([resetKey], () => spyDerived(baseInp(item)));
      memoWarn.commit([resetKey], () =>
        spyWarn({
          mode,
          selectedItem: item,
          derived: memoDerived.value,
          priceMode: "package",
          inputKarton: false,
        }),
      );

      // Fresh compute pakai item SAMA yang baru saja di-commit.
      const freshDerived = realComputeDerived(baseInp(item));
      const freshWarn = realComputeWarnings({
        mode,
        selectedItem: item,
        derived: freshDerived,
        priceMode: "package",
        inputKarton: false,
      });

      // Field efektif (effPackageType, effectivePkgSize, pkgQ, price,
      // baseAdded, totalCost) harus identik dengan fresh — snapshot
      // memo tidak boleh "menempel" dari resetKey sebelumnya.
      expect(memoDerived.value).toEqual(freshDerived);
      expect(memoWarn.value).toEqual(freshWarn);

      // Simpan snapshot pertama utk setiap resetKey.
      if (!snapshots.has(resetKey)) {
        snapshots.set(resetKey, {
          derived: memoDerived.value,
          warn: memoWarn.value,
        });
      }
    }

    // Kembali ke resetKey pertama → hasil harus identik snapshot pertama.
    itemId = "botol-500";
    item = refetch(itemId, 999);
    resetKey = beliResetKey({ mode, itemId, packageType: item.package_type });
    memoDerived.commit([resetKey], () => spyDerived(baseInp(item)));
    memoWarn.commit([resetKey], () =>
      spyWarn({
        mode,
        selectedItem: item,
        derived: memoDerived.value,
        priceMode: "package",
        inputKarton: false,
      }),
    );
    const first = snapshots.get(resetKey)!;
    expect(memoDerived.value).toEqual(first.derived);
    expect(memoWarn.value).toEqual(first.warn);
  });

  it("compute hanya dipanggil ulang saat resetKey berubah, bukan saat refetch murni", () => {
    const spyDerived = vi.fn(realComputeDerived);

    let itemId: keyof typeof ITEMS = "botol-500";
    let item = refetch(itemId, 0);
    const mode = "existing" as const;
    let resetKey = beliResetKey({ mode, itemId, packageType: item.package_type });

    const memo = createMemo({
      deps: [resetKey],
      factory: () => spyDerived(baseInp(item)),
    });
    expect(spyDerived).toHaveBeenCalledTimes(1);

    // Fase A: 15 refetch murni (resetKey tetap) → 0 tambahan.
    for (let i = 1; i <= 15; i++) {
      item = refetch(itemId, i);
      memo.commit([resetKey], () => spyDerived(baseInp(item)));
    }
    expect(spyDerived).toHaveBeenCalledTimes(1);

    // Fase B: switch cepat A → B → C → A → B (4 transisi resetKey),
    // masing-masing diselingi 3 refetch murni.
    const seq: (keyof typeof ITEMS)[] = [
      "gram-1000",
      "pcs-1",
      "botol-500",
      "gram-1000",
    ];
    let extraExpected = 0;
    let seed = 100;
    for (const nextId of seq) {
      itemId = nextId;
      item = refetch(itemId, seed++);
      resetKey = beliResetKey({ mode, itemId, packageType: item.package_type });
      memo.commit([resetKey], () => spyDerived(baseInp(item)));
      extraExpected += 1;
      expect(spyDerived).toHaveBeenCalledTimes(1 + extraExpected);

      // 3 refetch murni di tengah — TIDAK menambah panggilan.
      for (let k = 0; k < 3; k++) {
        item = refetch(itemId, seed++);
        memo.commit([resetKey], () => spyDerived(baseInp(item)));
      }
      expect(spyDerived).toHaveBeenCalledTimes(1 + extraExpected);
    }

    // Total: 1 mount + 4 switch = 5 panggilan.
    expect(spyDerived).toHaveBeenCalledTimes(5);
  });
});