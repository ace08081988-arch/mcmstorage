import { describe, it, expect } from "vitest";
import { computeBeliDerived } from "@/lib/beli-derived";
import { BOTOL_PER_KARTON, rupiah, fmtBase, fmtItemQty } from "@/lib/stock-format";

/**
 * Snapshot mutasi **Jumlah** dan **Harga** pada form Catat Pembelian.
 *
 * Berbeda dengan `package-switch-snapshots` yang mengunci label per-Jenis-kemasan,
 * suite ini mengunci **ringkasan turunan** setelah user mengubah:
 *   • Jumlah kemasan (packageQty)
 *   • Harga per kemasan / per base (pricePerPackage vs pricePerBase + priceMode)
 *   • Toggle Karton (khusus botol)
 *
 * Tujuan:
 *   1. Snapshot per-langkah = "fresh" (Jumlah kemasan, Tambahan stok, Harga per …,
 *      Total biaya) — semua field turunan konsisten dengan state terbaru.
 *   2. Tidak ada artefak dari state sebelumnya yang tertinggal saat mutasi
 *      dilakukan berurutan (mis. qty lama, harga lama, atau angka "sisa memo"
 *      dari `computeBeliDerived`).
 *
 * Setiap perubahan angka hasil mutasi wajib update snapshot (`vitest -u`) dan
 * direview di PR.
 */

type PackageType = "gram" | "pcs" | "botol" | "sachet";
type BaseUnit = "g" | "pcs";

type WItem = {
  id: string;
  name: string;
  package_type: PackageType;
  package_size: number;
  base_unit: BaseUnit;
  stock_base: number;
  avg_cost_per_base: number;
};

const baseUnitFor = (pt: PackageType): BaseUnit => (pt === "gram" ? "g" : "pcs");

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

function renderDerived(state: FormState): string {
  const selectedItem =
    state.mode === "existing" ? makeItem(state.packageType, Number(state.packageSize) || 1) : null;

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

  const lines: string[] = [];
  lines.push(
    `[INPUT] qty=${state.packageQty} · pricePkg=${state.pricePerPackage || "-"} · priceBase=${
      state.pricePerBase || "-"
    } · mode=${state.priceMode}${state.inputKarton ? " · karton=ON" : ""}`,
  );
  lines.push(`[SUM] Ringkasan | ${header}`);
  lines.push(
    `[SUM] Jumlah kemasan | ${pkgQ.toLocaleString("id-ID")} ${effPackageType}${
      kartonActive ? ` (${(pkgQ / BOTOL_PER_KARTON).toLocaleString("id-ID")} karton)` : ""
    }`,
  );
  lines.push(
    `[SUM] Tambahan stok | ${it ? fmtItemQty(baseAdded, it) : fmtBase(baseAdded, baseUnit)}`,
  );
  lines.push(`[SUM] Harga per ${effPackageType} | ${rupiah(price)}`);
  if (effPackageType !== "pcs" && baseAdded > 0) {
    lines.push(`[SUM] Harga per ${baseUnit} | ${rupiah(totalCost / baseAdded)}`);
  }
  lines.push(`[SUM] Total biaya | ${rupiah(totalCost)}`);
  return lines.join("\n");
}

/** Base state factory untuk tiap Jenis kemasan. */
function baseState(mode: "new" | "existing", pt: PackageType): FormState {
  return {
    mode,
    packageType: pt,
    packageSize: pt === "gram" ? "1000" : pt === "botol" ? "500" : "1",
    packageQty: "2",
    pricePerPackage: "10000",
    priceMode: pt === "pcs" ? "base" : "package",
    pricePerBase: pt === "pcs" ? "3000" : "",
    inputKarton: false,
  };
}

/**
 * Simulasikan urutan mutasi. Tiap `step` adalah patch partial state.
 * Return array `[label, renderedString]` untuk semua state antara.
 */
function walk(
  initial: FormState,
  steps: Array<{ label: string; patch: Partial<FormState> }>,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let cur = { ...initial };
  out.push(["step 0: initial", renderDerived(cur)]);
  for (let i = 0; i < steps.length; i++) {
    cur = { ...cur, ...steps[i].patch };
    out.push([`step ${i + 1}: ${steps[i].label}`, renderDerived(cur)]);
  }
  return out;
}

function toSnapshot(entries: Array<[string, string]>): string {
  return entries.map(([label, body]) => `=== ${label} ===\n${body}`).join("\n\n");
}

describe("Gudang — snapshot ringkasan setelah mutasi Jumlah & Harga", () => {
  const PACKAGE_TYPES: PackageType[] = ["gram", "botol", "pcs", "sachet"];

  describe("Naikkan Jumlah kemasan bertahap", () => {
    for (const pt of PACKAGE_TYPES) {
      for (const mode of ["new", "existing"] as const) {
        it(`snapshot: ${mode} + ${pt} · qty 2 → 5 → 10 → 0 → 3`, () => {
          const entries = walk(baseState(mode, pt), [
            { label: "qty 2 → 5", patch: { packageQty: "5" } },
            { label: "qty 5 → 10", patch: { packageQty: "10" } },
            { label: "qty 10 → 0 (kosong)", patch: { packageQty: "0" } },
            { label: "qty 0 → 3", patch: { packageQty: "3" } },
          ]);
          expect(toSnapshot(entries)).toMatchSnapshot();
        });
      }
    }
  });

  describe("Ubah Harga bertahap", () => {
    for (const pt of PACKAGE_TYPES.filter((p) => p !== "pcs")) {
      it(`snapshot: new + ${pt} · harga/kemasan 10000 → 12500 → 9000`, () => {
        const entries = walk(baseState("new", pt), [
          { label: "harga 10000 → 12500", patch: { pricePerPackage: "12500" } },
          { label: "harga 12500 → 9000", patch: { pricePerPackage: "9000" } },
          { label: "harga 9000 → 0 (kosong)", patch: { pricePerPackage: "0" } },
          { label: "harga 0 → 15000", patch: { pricePerPackage: "15000" } },
        ]);
        expect(toSnapshot(entries)).toMatchSnapshot();
      });
    }

    it(`snapshot: new + pcs (priceMode base) · harga/pcs 3000 → 4500 → 2000`, () => {
      const entries = walk(baseState("new", "pcs"), [
        { label: "harga/pcs 3000 → 4500", patch: { pricePerBase: "4500" } },
        { label: "harga/pcs 4500 → 2000", patch: { pricePerBase: "2000" } },
        { label: "harga/pcs 2000 → 0", patch: { pricePerBase: "0" } },
        { label: "harga/pcs 0 → 5000", patch: { pricePerBase: "5000" } },
      ]);
      expect(toSnapshot(entries)).toMatchSnapshot();
    });
  });

  describe("Toggle priceMode (package ↔ base) + ubah harga", () => {
    for (const pt of ["gram", "botol", "sachet"] as const) {
      it(`snapshot: new + ${pt} · priceMode package → base → package`, () => {
        const entries = walk(baseState("new", pt), [
          {
            label: "switch priceMode → base + isi pricePerBase 25",
            patch: { priceMode: "base", pricePerBase: "25", pricePerPackage: "" },
          },
          {
            label: "ubah pricePerBase 25 → 40",
            patch: { pricePerBase: "40" },
          },
          {
            label: "switch balik → package + pricePerPackage 12000",
            patch: { priceMode: "package", pricePerPackage: "12000", pricePerBase: "" },
          },
        ]);
        expect(toSnapshot(entries)).toMatchSnapshot();
      });
    }
  });

  describe("Mutasi campuran Jumlah + Harga + Karton (botol)", () => {
    it("snapshot: existing + botol · qty & harga & karton berurutan", () => {
      const entries = walk(baseState("existing", "botol"), [
        { label: "qty 2 → 4", patch: { packageQty: "4" } },
        { label: "harga 10000 → 15000", patch: { pricePerPackage: "15000" } },
        { label: "toggle Karton ON, qty 4 → 1", patch: { inputKarton: true, packageQty: "1" } },
        { label: "harga 15000 → 18000 (masih karton)", patch: { pricePerPackage: "18000" } },
        { label: "toggle Karton OFF, qty 1 → 6", patch: { inputKarton: false, packageQty: "6" } },
      ]);
      expect(toSnapshot(entries)).toMatchSnapshot();
    });
  });

  /**
   * Anti-artefak: setelah mutasi, string turunan render TIDAK boleh mengandung
   * angka dari state sebelumnya. Kunci-nya: number-token yang ekslusif per step.
   * Ini menangkap kasus memo lama yang bocor walau snapshot ter-update tanpa review.
   */
  describe("anti-artefak: angka lama tidak bocor ke render step berikutnya", () => {
    it("mutasi qty tidak menyisakan angka qty lama di ringkasan", () => {
      // Setup: gram 1000 g/kemasan, harga 10.000/kemasan → base = qty * 1000 g,
      // total = qty * 10.000. Kita gunakan qty unik (2 → 7 → 13) supaya masing-masing
      // punya total unik: 20.000 / 70.000 / 130.000.
      const initial = baseState("new", "gram");
      const s1 = renderDerived({ ...initial, packageQty: "2" });
      const s2 = renderDerived({ ...initial, packageQty: "7" });
      const s3 = renderDerived({ ...initial, packageQty: "13" });

      // Format angka Rp Indonesia menggunakan pemisah titik.
      expect(s2).not.toMatch(/Rp\s*20\.000\b/);
      expect(s2).not.toMatch(/\b2\.000\s+g\b/); // baseAdded lama (2 * 1000)
      expect(s3).not.toMatch(/Rp\s*20\.000\b/);
      expect(s3).not.toMatch(/Rp\s*70\.000\b/);
      expect(s3).not.toMatch(/\b7\.000\s+g\b/);

      // Sanity: masing-masing state berisi angkanya sendiri.
      expect(s1).toMatch(/Rp\s*20\.000\b/);
      expect(s2).toMatch(/Rp\s*70\.000\b/);
      expect(s3).toMatch(/Rp\s*130\.000\b/);
    });

    it("mutasi harga tidak menyisakan harga lama di ringkasan", () => {
      const initial = baseState("new", "botol");
      // pkgSize 500, qty 2 → base = 1000; total = qty * pricePkg.
      const s1 = renderDerived({ ...initial, pricePerPackage: "10000" }); // total 20.000
      const s2 = renderDerived({ ...initial, pricePerPackage: "15000" }); // total 30.000
      const s3 = renderDerived({ ...initial, pricePerPackage: "9000" }); // total 18.000

      expect(s2).not.toMatch(/Rp\s*10\.000\b/);
      expect(s2).not.toMatch(/Rp\s*20\.000\b/);
      expect(s3).not.toMatch(/Rp\s*10\.000\b/);
      expect(s3).not.toMatch(/Rp\s*15\.000\b/);
      expect(s3).not.toMatch(/Rp\s*30\.000\b/);

      expect(s1).toMatch(/Rp\s*20\.000\b/);
      expect(s2).toMatch(/Rp\s*30\.000\b/);
      expect(s3).toMatch(/Rp\s*18\.000\b/);
    });

    it("switch priceMode tidak menyisakan angka mode lama", () => {
      const initial = baseState("new", "gram");
      // package mode: pricePkg 10.000, qty 2, size 1000 → total 20.000, per-g 10
      const sPkg = renderDerived({
        ...initial,
        priceMode: "package",
        pricePerPackage: "10000",
        pricePerBase: "",
      });
      // base mode: pricePerBase 25, qty 2, size 1000, base=2000 → total 50.000, per-g 25
      const sBase = renderDerived({
        ...initial,
        priceMode: "base",
        pricePerBase: "25",
        pricePerPackage: "",
      });

      expect(sBase).not.toMatch(/Rp\s*20\.000\b/); // total lama
      expect(sBase).not.toMatch(/Rp\s*10(?!\d)/); // per-g lama = 10 (guard: bukan bagian 10.000)
      expect(sPkg).not.toMatch(/Rp\s*50\.000\b/);
      expect(sPkg).not.toMatch(/Rp\s*25(?!\d)/);
    });

    it("karton toggle tidak menyisakan tampilan '(x karton)' saat OFF", () => {
      const initial = baseState("existing", "botol");
      const sOn = renderDerived({ ...initial, inputKarton: true, packageQty: "1" });
      const sOff = renderDerived({ ...initial, inputKarton: false, packageQty: "1" });
      expect(sOn).toMatch(/\(.*karton\)/);
      expect(sOff).not.toMatch(/\(.*karton\)/);
    });
  });
});