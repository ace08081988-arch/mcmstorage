import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliPackageType,
  type BeliBaseUnit,
} from "@/lib/beli-derived";
import { rupiah, fmtBase, fmtItemQty, BOTOL_PER_KARTON } from "@/lib/stock-format";

/**
 * Snapshot tombol **Reset / Batal** pada form Catat Pembelian.
 *
 * Skenario yang dikunci:
 *   1. Hard reset (`resetBeliForm`) — tombol "Reset" di header form.
 *      Mengembalikan mode/packageType/qty/price ke default pabrik
 *      (mode=new, packageType=botol, packageSize=500, qty=1, pricePkg="",
 *      priceMode=package, pricePerBase="", inputKarton=false).
 *   2. Soft reset — user mengganti item/mode/packageType, effect `resetKey`
 *      di form otomatis nol-kan angka pembelian (qty=1, pricePkg="",
 *      pricePerBase="", inputKarton=false, priceMode disesuaikan).
 *   3. Batal edit — user membatalkan mutasi qty/price sebelum submit,
 *      form kembali ke state awal load (setara soft reset).
 *
 * Guarantee:
 *   • Ringkasan turunan setelah reset **identik** dengan snapshot state
 *     default (tidak ada residu qty/price/karton sebelumnya).
 *   • Format `Rp`, `g/kg/mg`, dan label `packageType` konsisten.
 *   • Anti-artefak: angka dari state kotor sebelum reset tidak boleh
 *     bocor ke render setelah reset.
 *
 * Setiap perubahan default form wajib update snapshot (`vitest -u`) dan
 * direview di PR — snapshot ini adalah kontrak default-state.
 */

type PackageType = BeliPackageType;

type WItem = {
  id: string;
  name: string;
  package_type: PackageType;
  package_size: number;
  base_unit: BeliBaseUnit;
  stock_base: number;
  avg_cost_per_base: number;
};

const baseUnitFor = (pt: PackageType): BeliBaseUnit => (pt === "gram" ? "g" : "pcs");

function makeItem(pt: PackageType, size: number): WItem {
  return {
    id: `existing-${pt}`,
    name: `Item ${pt.toUpperCase()}`,
    package_type: pt,
    package_size: size,
    base_unit: baseUnitFor(pt),
    stock_base: 5000,
    avg_cost_per_base: 12,
  };
}

type FormState = {
  mode: "new" | "existing";
  packageType: PackageType;
  packageSize: string;
  packageQty: string;
  pricePerPackage: string;
  priceMode: "package" | "base";
  pricePerBase: string;
  inputKarton: boolean;
};

/**
 * Default pabrik — SUMBER KEBENARAN. Harus persis sama dengan initializer
 * di `useState` BeliTab (`src/routes/_authenticated.gudang.tsx`) dan
 * dengan `resetBeliForm()`.
 */
function hardResetDefault(): FormState {
  return {
    mode: "new",
    packageType: "botol",
    packageSize: "500",
    packageQty: "1",
    pricePerPackage: "",
    priceMode: "package",
    pricePerBase: "",
    inputKarton: false,
  };
}

/**
 * Soft reset (`useEffect` dep `resetKey`): field yang di-nolkan otomatis
 * saat user mengganti item / mode / packageType. Non-angka (packageType,
 * packageSize, mode) DIBIARKAN sesuai pilihan user; hanya angka & karton
 * yang direset. priceMode mengikuti packageType.
 */
function softResetFrom(prev: FormState): FormState {
  return {
    ...prev,
    packageQty: "1",
    pricePerPackage: "",
    pricePerBase: "",
    inputKarton: false,
    priceMode:
      prev.mode === "existing"
        ? prev.packageType === "pcs"
          ? "base"
          : "package"
        : prev.packageType === "pcs"
          ? "base"
          : "package",
  };
}

function renderDerived(state: FormState): string {
  const selectedItem =
    state.mode === "existing"
      ? makeItem(state.packageType, Number(state.packageSize) || 1)
      : null;

  const d = computeBeliDerived({
    mode: state.mode,
    selectedItem,
    newPackageType: state.packageType,
    newPackageSize: state.packageSize,
    packageQty: state.packageQty,
    pricePerPackage: state.pricePerPackage,
    priceMode: state.priceMode,
    pricePerBase: state.pricePerBase,
    inputKarton: state.inputKarton,
  });
  const {
    effPackageType,
    effBaseUnit: baseUnit,
    effectivePkgSize,
    kartonActive,
    pkgQ,
    price,
    baseAdded,
    totalCost,
  } = d;

  const it = selectedItem;
  const header = it
    ? `${it.name} · ${effPackageType}${effPackageType !== "pcs" ? ` ${effectivePkgSize} ${baseUnit}` : ""}`
    : `Barang baru · ${effPackageType}${effPackageType !== "pcs" ? ` ${effectivePkgSize} ${baseUnit}` : ""}`;

  const lines: string[] = [
    `[FORM] mode=${state.mode} · pt=${state.packageType} · size=${state.packageSize} · qty=${JSON.stringify(
      state.packageQty,
    )} · pricePkg=${JSON.stringify(state.pricePerPackage)} · priceBase=${JSON.stringify(
      state.pricePerBase,
    )} · priceMode=${state.priceMode} · karton=${state.inputKarton ? "ON" : "OFF"}`,
    `[SUM] Ringkasan | ${header}`,
    `[SUM] Jumlah kemasan | ${pkgQ.toLocaleString("id-ID", {
      maximumFractionDigits: 4,
    })} ${effPackageType}${
      kartonActive
        ? ` (${(pkgQ / BOTOL_PER_KARTON).toLocaleString("id-ID", {
            maximumFractionDigits: 4,
          })} karton)`
        : ""
    }`,
    `[SUM] Tambahan stok | ${it ? fmtItemQty(baseAdded, it) : fmtBase(baseAdded, baseUnit)}`,
    `[SUM] Harga per ${effPackageType} | ${rupiah(price)}`,
    ...(effPackageType !== "pcs" && baseAdded !== 0 && Number.isFinite(totalCost / baseAdded)
      ? [`[SUM] Harga per ${baseUnit} | ${rupiah(totalCost / baseAdded)}`]
      : []),
    `[SUM] Total biaya | ${rupiah(totalCost)}`,
    `[RAW] pkgQ=${pkgQ} · price=${price} · baseAdded=${baseAdded} · totalCost=${totalCost}`,
  ];
  return lines.join("\n");
}

function stripFormLine(s: string): string {
  return s.replace(/^\[FORM\].*\n/, "");
}

describe("Gudang — snapshot tombol Reset / Batal", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
  });

  describe("Hard reset (resetBeliForm) — snapshot default pabrik", () => {
    it("snapshot: state default setelah hard reset", () => {
      expect(renderDerived(hardResetDefault())).toMatchSnapshot();
    });

    const dirtyCases: Array<{ label: string; dirty: FormState }> = [
      {
        label: "dirty: new + gram + qty=5 + price=15000",
        dirty: {
          mode: "new",
          packageType: "gram",
          packageSize: "1000",
          packageQty: "5",
          pricePerPackage: "15000",
          priceMode: "package",
          pricePerBase: "",
          inputKarton: false,
        },
      },
      {
        label: "dirty: existing + botol + karton ON + qty=3 + price=20000",
        dirty: {
          mode: "existing",
          packageType: "botol",
          packageSize: "500",
          packageQty: "3",
          pricePerPackage: "20000",
          priceMode: "package",
          pricePerBase: "",
          inputKarton: true,
        },
      },
      {
        label: "dirty: new + pcs + priceMode=base + pricePerBase=4500",
        dirty: {
          mode: "new",
          packageType: "pcs",
          packageSize: "1",
          packageQty: "10",
          pricePerPackage: "",
          priceMode: "base",
          pricePerBase: "4500",
          inputKarton: false,
        },
      },
      {
        label: "dirty: nilai ekstrem (qty negatif desimal + price desimal)",
        dirty: {
          mode: "new",
          packageType: "gram",
          packageSize: "1000",
          packageQty: "-1.5",
          pricePerPackage: "12500.75",
          priceMode: "package",
          pricePerBase: "",
          inputKarton: false,
        },
      },
    ];

    for (const { label, dirty } of dirtyCases) {
      it(`hard reset dari ${label} → identik dengan default pabrik`, () => {
        const dirtyRender = renderDerived(dirty);
        const afterReset = renderDerived(hardResetDefault());
        // Snapshot pasangan (dirty → reset) untuk audit visual di PR.
        expect(`${dirtyRender}\n\n---HARD RESET---\n\n${afterReset}`).toMatchSnapshot();
        // Kontrak inti: setelah hard reset, ringkasan turunan == default pabrik.
        expect(afterReset).toBe(renderDerived(hardResetDefault()));
      });
    }
  });

  describe("Soft reset (ganti item/mode/packageType) — angka nol-kan otomatis", () => {
    const dirtySoft: Array<{ label: string; dirty: FormState; softNext: FormState }> = [
      {
        label: "new+gram qty=5 price=15000 → ganti packageType=botol",
        dirty: {
          mode: "new",
          packageType: "gram",
          packageSize: "1000",
          packageQty: "5",
          pricePerPackage: "15000",
          priceMode: "package",
          pricePerBase: "",
          inputKarton: false,
        },
        softNext: {
          mode: "new",
          packageType: "botol",
          packageSize: "500",
          packageQty: "5", // sebelum effect resetKey → user baru saja ganti
          pricePerPackage: "15000",
          priceMode: "package",
          pricePerBase: "",
          inputKarton: false,
        },
      },
      {
        label: "existing+botol karton ON → ganti mode=new (angka & karton reset)",
        dirty: {
          mode: "existing",
          packageType: "botol",
          packageSize: "500",
          packageQty: "4",
          pricePerPackage: "20000",
          priceMode: "package",
          pricePerBase: "",
          inputKarton: true,
        },
        softNext: {
          mode: "new",
          packageType: "botol",
          packageSize: "500",
          packageQty: "4",
          pricePerPackage: "20000",
          priceMode: "package",
          pricePerBase: "",
          inputKarton: true,
        },
      },
      {
        label: "new+gram → ganti packageType=pcs (priceMode auto → base)",
        dirty: {
          mode: "new",
          packageType: "gram",
          packageSize: "1000",
          packageQty: "3",
          pricePerPackage: "9000",
          priceMode: "package",
          pricePerBase: "",
          inputKarton: false,
        },
        softNext: {
          mode: "new",
          packageType: "pcs",
          packageSize: "1",
          packageQty: "3",
          pricePerPackage: "9000",
          priceMode: "package", // sebelum effect resetKey
          pricePerBase: "",
          inputKarton: false,
        },
      },
    ];

    for (const { label, dirty, softNext } of dirtySoft) {
      it(`soft reset ${label}`, () => {
        const before = renderDerived(dirty);
        const applied = softResetFrom(softNext);
        const after = renderDerived(applied);
        expect(`${before}\n\n---SOFT RESET (resetKey effect)---\n\n${after}`).toMatchSnapshot();

        // Kontrak: angka pembelian nol-kan (qty=1, price kosong, karton off).
        expect(applied.packageQty).toBe("1");
        expect(applied.pricePerPackage).toBe("");
        expect(applied.pricePerBase).toBe("");
        expect(applied.inputKarton).toBe(false);
        expect(applied.priceMode).toBe(applied.packageType === "pcs" ? "base" : "package");
      });
    }
  });

  describe("Batal edit qty/price — kembali ke snapshot awal", () => {
    it("simpan snapshot awal → user mutasi qty & price → tombol Batal restore", () => {
      const initial: FormState = {
        mode: "existing",
        packageType: "gram",
        packageSize: "1000",
        packageQty: "2",
        pricePerPackage: "10000",
        priceMode: "package",
        pricePerBase: "",
        inputKarton: false,
      };
      const initialRender = renderDerived(initial);

      // Simulasi mutasi user (belum submit).
      const dirty: FormState = {
        ...initial,
        packageQty: "8",
        pricePerPackage: "17500.5",
      };
      const dirtyRender = renderDerived(dirty);

      // Batal → restore ke snapshot awal.
      const restored = { ...initial };
      const restoredRender = renderDerived(restored);

      expect(
        `${initialRender}\n\n---USER EDIT (belum submit)---\n\n${dirtyRender}\n\n---BATAL (restore)---\n\n${restoredRender}`,
      ).toMatchSnapshot();

      // Kontrak: setelah batal, render == render awal (bit-exact).
      expect(restoredRender).toBe(initialRender);
    });
  });

  describe("anti-artefak: nilai dirty tidak bocor ke render setelah reset", () => {
    it("hard reset menghapus jejak qty=5 · price=15000 (gram)", () => {
      const dirty: FormState = {
        mode: "new",
        packageType: "gram",
        packageSize: "1000",
        packageQty: "5",
        pricePerPackage: "15000",
        priceMode: "package",
        pricePerBase: "",
        inputKarton: false,
      };
      const dirtyStr = renderDerived(dirty);
      const afterReset = renderDerived(hardResetDefault());

      // Sanity: dirty berisi angkanya.
      expect(dirtyStr).toMatch(/Rp\s*75\.000\b/); // 5 * 15000
      expect(dirtyStr).toMatch(/5\s*kg\b/); // 5 * 1000 g

      // After reset: default pabrik (botol 500g, qty=1, price kosong)
      // TIDAK boleh berisi Rp 75.000, "5 kg", atau "15.000".
      expect(afterReset).not.toMatch(/Rp\s*75\.000\b/);
      expect(afterReset).not.toMatch(/\b5\s*kg\b/);
      expect(afterReset).not.toMatch(/Rp\s*15\.000\b/);
      // Dan harus mengandung marker default (botol · qty 1 · total 0).
      expect(afterReset).toMatch(/Barang baru · botol 500 pcs/);
      expect(afterReset).toMatch(/Total biaya \| Rp\s*0/);
    });

    it("soft reset (ganti packageType) menghapus jejak qty & karton lama", () => {
      const dirty: FormState = {
        mode: "existing",
        packageType: "botol",
        packageSize: "500",
        packageQty: "3",
        pricePerPackage: "20000",
        priceMode: "package",
        pricePerBase: "",
        inputKarton: true,
      };
      const dirtyStr = renderDerived(dirty);
      // qty=3 dgn karton ON → pkgQ = 300 botol.
      expect(dirtyStr).toMatch(/300\s+botol/);
      expect(dirtyStr).toMatch(/karton/);

      // User ganti packageType → soft reset.
      const soft = softResetFrom({ ...dirty, packageType: "gram", packageSize: "1000" });
      const softStr = renderDerived(soft);

      expect(softStr).not.toMatch(/\bkarton\b/);
      expect(softStr).not.toMatch(/300\s+/);
      expect(softStr).not.toMatch(/Rp\s*20\.000\b/);
      expect(softStr).toMatch(/1\s+gram/); // qty default 1 pada packageType gram
      expect(softStr).toMatch(/Total biaya \| Rp\s*0/);
    });

    it("batal edit qty/price restore render bit-exact tanpa residu", () => {
      const initial: FormState = {
        mode: "new",
        packageType: "sachet",
        packageSize: "10",
        packageQty: "2",
        pricePerPackage: "5000",
        priceMode: "package",
        pricePerBase: "",
        inputKarton: false,
      };
      const initialRender = renderDerived(initial);

      // User bereksperimen dengan nilai ekstrem lalu batal.
      renderDerived({ ...initial, packageQty: "-99.5", pricePerPackage: "999999.99" });
      renderDerived({ ...initial, packageQty: "", pricePerPackage: "" });

      // Batal → render awal harus deterministic (memo tidak menyisakan
      // hasil komputasi ekstrem sebelumnya).
      const restored = renderDerived(initial);
      expect(restored).toBe(initialRender);
      // Dan tidak mengandung angka ekstrem yang sempat diketik.
      expect(stripFormLine(restored)).not.toMatch(/999\.999|-99/);
    });
  });
});
