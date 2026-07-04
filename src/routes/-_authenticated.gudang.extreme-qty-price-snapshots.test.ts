import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliPackageType,
  type BeliBaseUnit,
} from "@/lib/beli-derived";
import { BOTOL_PER_KARTON, rupiah, fmtBase, fmtItemQty } from "@/lib/stock-format";

/**
 * Snapshot **nilai ekstrem** untuk mutasi qty / price pada form Catat Pembelian.
 *
 * Melengkapi `qty-price-mutation-snapshots` (nilai normal) dengan skenario:
 *   • qty/harga = 0
 *   • qty/harga kosong ("" atau whitespace) — user menghapus isi field
 *   • qty/harga negatif ("-3", "-10000") — user salah ketik / paste
 *   • qty/harga desimal ("1.5", "0.25", "12500.75") — user pakai koma/titik
 *   • kombinasi ekstrem (negatif × desimal, 0 × desimal, dll.)
 *
 * Tujuan:
 *   1. Snapshot mengunci hasil deterministic: total, per-base, baseAdded,
 *      dan format `Rp` / `g` / `kg` / `mg` tetap benar (tidak `NaN`,
 *      tidak `"undefined"`, tidak `Rp -Infinity`).
 *   2. Tidak ada artefak dari step sebelumnya (memo `computeBeliDerived`
 *      di-reset lewat sig berubah — di sini juga eksplisit lewat
 *      `__resetBeliDerivedMemo` untuk immunity total).
 *   3. Format `rupiah()` tetap valid IDR meski input `0`, `NaN`, negatif,
 *      atau desimal; `fmtBase` fallback ke `kg` / `mg` sesuai magnitudo.
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

  const perBaseLine =
    effPackageType !== "pcs" && baseAdded !== 0 && Number.isFinite(totalCost / baseAdded)
      ? `[SUM] Harga per ${baseUnit} | ${rupiah(totalCost / baseAdded)}`
      : `[SUM] Harga per ${baseUnit} | —`;

  const lines: string[] = [
    `[INPUT] qty=${JSON.stringify(state.packageQty)} · pricePkg=${JSON.stringify(
      state.pricePerPackage,
    )} · priceBase=${JSON.stringify(state.pricePerBase)} · mode=${state.priceMode}${
      state.inputKarton ? " · karton=ON" : ""
    }`,
    `[SUM] Ringkasan | ${header}`,
    `[SUM] Jumlah kemasan | ${pkgQ.toLocaleString("id-ID", { maximumFractionDigits: 4 })} ${effPackageType}${
      kartonActive
        ? ` (${(pkgQ / BOTOL_PER_KARTON).toLocaleString("id-ID", { maximumFractionDigits: 4 })} karton)`
        : ""
    }`,
    `[SUM] Tambahan stok | ${it ? fmtItemQty(baseAdded, it) : fmtBase(baseAdded, baseUnit)}`,
    `[SUM] Harga per ${effPackageType} | ${rupiah(price)}`,
    perBaseLine,
    `[SUM] Total biaya | ${rupiah(totalCost)}`,
    `[RAW] pkgQ=${pkgQ} · price=${price} · baseAdded=${baseAdded} · totalCost=${totalCost}`,
  ];
  return lines.join("\n");
}

function base(pt: PackageType): FormState {
  return {
    mode: "new",
    packageType: pt,
    packageSize: pt === "gram" ? "1000" : pt === "botol" ? "500" : "1",
    packageQty: "2",
    pricePerPackage: "10000",
    priceMode: pt === "pcs" ? "base" : "package",
    pricePerBase: pt === "pcs" ? "3000" : "",
    inputKarton: false,
  };
}

function walk(
  initial: FormState,
  steps: Array<{ label: string; patch: Partial<FormState> }>,
): string {
  const out: string[] = [];
  let cur: FormState = { ...initial };
  out.push(`=== step 0: initial ===\n${renderDerived(cur)}`);
  for (let i = 0; i < steps.length; i++) {
    cur = { ...cur, ...steps[i].patch };
    out.push(`=== step ${i + 1}: ${steps[i].label} ===\n${renderDerived(cur)}`);
  }
  return out.join("\n\n");
}

describe("Gudang — snapshot nilai ekstrem qty/price", () => {
  beforeEach(() => {
    // Immunity total dari cross-test memo bleed (single-slot memo di
    // beli-derived). Sig-nya beda per test, tapi reset eksplisit = safety.
    __resetBeliDerivedMemo();
  });

  const PACKAGE_TYPES: PackageType[] = ["gram", "botol", "pcs", "sachet"];

  describe("qty ekstrem: 0, kosong, whitespace, negatif, desimal", () => {
    for (const pt of PACKAGE_TYPES) {
      it(`snapshot: new + ${pt} · qty urutan ekstrem`, () => {
        expect(
          walk(base(pt), [
            { label: "qty → 0", patch: { packageQty: "0" } },
            { label: "qty → '' (kosong)", patch: { packageQty: "" } },
            { label: "qty → '   ' (whitespace)", patch: { packageQty: "   " } },
            { label: "qty → '-3' (negatif)", patch: { packageQty: "-3" } },
            { label: "qty → '-10.5' (negatif desimal)", patch: { packageQty: "-10.5" } },
            { label: "qty → '1.5' (desimal)", patch: { packageQty: "1.5" } },
            { label: "qty → '0.25' (sub-1 desimal)", patch: { packageQty: "0.25" } },
            { label: "qty → '12.75' (desimal besar)", patch: { packageQty: "12.75" } },
            { label: "qty → '2' (kembali normal)", patch: { packageQty: "2" } },
          ]),
        ).toMatchSnapshot();
      });
    }
  });

  describe("price ekstrem: 0, kosong, negatif, desimal (priceMode=package)", () => {
    for (const pt of PACKAGE_TYPES.filter((p) => p !== "pcs")) {
      it(`snapshot: new + ${pt} · pricePerPackage urutan ekstrem`, () => {
        expect(
          walk(base(pt), [
            { label: "price → 0", patch: { pricePerPackage: "0" } },
            { label: "price → '' (kosong)", patch: { pricePerPackage: "" } },
            { label: "price → '-5000' (negatif)", patch: { pricePerPackage: "-5000" } },
            { label: "price → '12500.75' (desimal)", patch: { pricePerPackage: "12500.75" } },
            { label: "price → '0.01' (sen)", patch: { pricePerPackage: "0.01" } },
            { label: "price → '-0.5' (negatif desimal)", patch: { pricePerPackage: "-0.5" } },
            { label: "price → '10000' (normal)", patch: { pricePerPackage: "10000" } },
          ]),
        ).toMatchSnapshot();
      });
    }
  });

  describe("price ekstrem (priceMode=base) · new + pcs", () => {
    it("snapshot: pricePerBase 3000 → 0 → '' → -1500 → 4500.25", () => {
      expect(
        walk(base("pcs"), [
          { label: "pricePerBase → 0", patch: { pricePerBase: "0" } },
          { label: "pricePerBase → '' (kosong)", patch: { pricePerBase: "" } },
          { label: "pricePerBase → '-1500' (negatif)", patch: { pricePerBase: "-1500" } },
          { label: "pricePerBase → '4500.25' (desimal)", patch: { pricePerBase: "4500.25" } },
          { label: "pricePerBase → '0.5' (sub-1)", patch: { pricePerBase: "0.5" } },
          { label: "pricePerBase → '3000' (normal)", patch: { pricePerBase: "3000" } },
        ]),
      ).toMatchSnapshot();
    });
  });

  describe("kombinasi ekstrem qty × price", () => {
    it("snapshot: new + gram · qty & price bergantian ekstrem", () => {
      expect(
        walk(base("gram"), [
          { label: "qty=0 & price=0", patch: { packageQty: "0", pricePerPackage: "0" } },
          { label: "qty='' & price=''", patch: { packageQty: "", pricePerPackage: "" } },
          {
            label: "qty='-2' & price='-3000'",
            patch: { packageQty: "-2", pricePerPackage: "-3000" },
          },
          {
            label: "qty='1.5' & price='12500.75'",
            patch: { packageQty: "1.5", pricePerPackage: "12500.75" },
          },
          {
            label: "qty='0.25' & price='0.5' (semua sub-1)",
            patch: { packageQty: "0.25", pricePerPackage: "0.5" },
          },
          {
            label: "qty='-1.5' & price='4000.5' (negatif × desimal)",
            patch: { packageQty: "-1.5", pricePerPackage: "4000.5" },
          },
          {
            label: "qty='3' & price='9500' (kembali normal)",
            patch: { packageQty: "3", pricePerPackage: "9500" },
          },
        ]),
      ).toMatchSnapshot();
    });

    it("snapshot: existing + botol · qty/price + karton toggle ekstrem", () => {
      expect(
        walk({ ...base("botol"), mode: "existing" }, [
          { label: "qty='' & karton ON", patch: { packageQty: "", inputKarton: true } },
          {
            label: "qty='-1' & karton ON (negatif berkalikan 100)",
            patch: { packageQty: "-1" },
          },
          {
            label: "qty='0.5' & karton ON (desimal berkalikan 100)",
            patch: { packageQty: "0.5" },
          },
          {
            label: "price='-15000' & karton ON",
            patch: { pricePerPackage: "-15000" },
          },
          {
            label: "price='12000.99' desimal & karton OFF",
            patch: { pricePerPackage: "12000.99", inputKarton: false, packageQty: "2" },
          },
        ]),
      ).toMatchSnapshot();
    });
  });

  /**
   * Anti-artefak numerik: pastikan render nilai ekstrem TIDAK menghasilkan
   * token racun (`NaN`, `undefined`, `Infinity`) dan format `rupiah` tetap
   * membentuk currency IDR yang valid.
   */
  describe("guard: token racun tidak muncul di render nilai ekstrem", () => {
    const cases: Array<{ label: string; state: FormState }> = [
      { label: "qty empty", state: { ...base("gram"), packageQty: "" } },
      { label: "qty whitespace", state: { ...base("gram"), packageQty: "   " } },
      { label: "qty negative", state: { ...base("gram"), packageQty: "-3" } },
      { label: "qty decimal", state: { ...base("gram"), packageQty: "1.5" } },
      { label: "qty sub-1", state: { ...base("gram"), packageQty: "0.25" } },
      { label: "price empty", state: { ...base("botol"), pricePerPackage: "" } },
      { label: "price negative", state: { ...base("botol"), pricePerPackage: "-5000" } },
      { label: "price decimal", state: { ...base("botol"), pricePerPackage: "12500.75" } },
      {
        label: "priceBase negative (pcs)",
        state: { ...base("pcs"), pricePerBase: "-1500" },
      },
      {
        label: "priceBase decimal (pcs)",
        state: { ...base("pcs"), pricePerBase: "4500.25" },
      },
    ];

    for (const { label, state } of cases) {
      it(`no NaN/undefined/Infinity in render — ${label}`, () => {
        const s = renderDerived(state);
        expect(s).not.toMatch(/\bNaN\b/);
        expect(s).not.toMatch(/\bundefined\b/);
        expect(s).not.toMatch(/\bInfinity\b/i);
        // `rupiah()` selalu memakai simbol Rp di locale id-ID.
        expect(s).toMatch(/Rp/);
      });
    }

    it("qty kosong ↔ '0' menghasilkan output identik (nullish→0 defensive)", () => {
      const empty = renderDerived({ ...base("gram"), packageQty: "" });
      const zero = renderDerived({ ...base("gram"), packageQty: "0" });
      // Baris [INPUT] beda (menampilkan raw string), tapi baris [SUM]/[RAW]
      // harus identik: `Number("") || 0` === `Number("0") || 0`.
      const stripInput = (s: string) => s.replace(/^\[INPUT\].*\n/, "");
      expect(stripInput(empty)).toBe(stripInput(zero));
    });

    it("qty whitespace ↔ '0' juga identik untuk field turunan", () => {
      const ws = renderDerived({ ...base("gram"), packageQty: "   " });
      const zero = renderDerived({ ...base("gram"), packageQty: "0" });
      const stripInput = (s: string) => s.replace(/^\[INPUT\].*\n/, "");
      expect(stripInput(ws)).toBe(stripInput(zero));
    });

    it("mutasi extreme→normal tidak menyisakan angka extreme di ringkasan", () => {
      // gram 1000 g, harga 10.000/kemasan.
      const initial = base("gram");
      // Step A: qty desimal 1.5 → total = 1.5 * 10.000 = 15.000; baseAdded = 1500 g = 1,5 kg
      const sA = renderDerived({ ...initial, packageQty: "1.5" });
      // Step B: qty negatif -3 → total = -30.000; baseAdded = -3000 g
      const sB = renderDerived({ ...initial, packageQty: "-3" });
      // Step C: kembali qty 2 → total = 20.000; baseAdded = 2000 g = 2 kg
      const sC = renderDerived({ ...initial, packageQty: "2" });

      // Step C (normal) tidak boleh berisi angka dari step A/B.
      expect(sC).not.toMatch(/Rp\s*15\.000\b/); // total step A
      expect(sC).not.toMatch(/-30\.000/); // total step B (magnitude)
      expect(sC).not.toMatch(/1,5\s*kg\b/); // baseAdded step A
      expect(sC).not.toMatch(/-3\.000\s*g\b/); // baseAdded step B

      // Sanity: masing-masing step memuat angkanya sendiri.
      expect(sA).toMatch(/Rp\s*15\.000\b/);
      expect(sA).toMatch(/1,5\s*kg\b/);
      expect(sB).toMatch(/Rp\s*-?30\.000\b|-Rp\s*30\.000\b/);
      expect(sC).toMatch(/Rp\s*20\.000\b/);
      expect(sC).toMatch(/2\s*kg\b/);
    });
  });
});
