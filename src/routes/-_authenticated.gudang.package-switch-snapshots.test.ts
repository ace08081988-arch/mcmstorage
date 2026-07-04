import { describe, it, expect } from "vitest";
import { computeBeliDerived } from "@/lib/beli-derived";
import { BOTOL_PER_KARTON, rupiah, fmtBase, fmtItemQty } from "@/lib/stock-format";

/**
 * Snapshot test halaman **Gudang → Catat Pembelian** untuk semua kombinasi
 * Jenis kemasan (gram/botol/pcs/sachet) di mode `new` dan `existing`.
 *
 * Kami tidak mem-boot browser: kami render ulang ke STRING setiap label &
 * ringkasan yang tampil di layar (lihat komponen di
 * `src/routes/_authenticated.gudang.tsx` — panel Form barang baru, baris
 * Jumlah/Harga, toggle Karton/Harga per…, dan panel Ringkasan) dengan
 * mengikuti `displayPackageType`/`displayBaseUnit` yang sama.
 *
 * Snapshot memvalidasi bahwa saat kombinasi berubah, tidak ada artefak label
 * lama (mis. "botol"/"pcs" bocor ke render gram, atau "gram"/"g" muncul di
 * render botol). Setiap perubahan label harus melalui update snapshot
 * (`vitest -u`) yang wajib direview di PR.
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

function makeItem(pt: PackageType): WItem {
  const base = baseUnitFor(pt);
  return {
    id: `existing-${pt}`,
    name: `Item ${pt.toUpperCase()}`,
    package_type: pt,
    package_size: pt === "gram" ? 1000 : pt === "botol" ? 500 : 1,
    base_unit: base,
    stock_base: 5000,
    avg_cost_per_base: 12,
  };
}

/** Render seluruh label & ringkasan yang bergantung pada Jenis kemasan. */
function renderScreen(input: {
  mode: "new" | "existing";
  packageType: PackageType;
  packageSize?: string;
  packageQty?: string;
  pricePerPackage?: string;
  priceMode?: "package" | "base";
  pricePerBase?: string;
  inputKarton?: boolean;
}): string {
  const {
    mode,
    packageType,
    packageSize = packageType === "gram" ? "1000" : packageType === "botol" ? "500" : "1",
    packageQty = "2",
    pricePerPackage = "10000",
    priceMode = packageType === "pcs" ? "base" : "package",
    pricePerBase = "",
    inputKarton = false,
  } = input;

  const selectedItem = mode === "existing" ? makeItem(packageType) : null;

  const d = computeBeliDerived({
    mode,
    selectedItem,
    newPackageType: packageType,
    newPackageSize: packageSize,
    packageQty,
    pricePerPackage,
    priceMode,
    pricePerBase,
    inputKarton,
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

  const lines: string[] = [];
  // ---- FORM ----
  lines.push(`[FORM] Mode: ${mode}`);
  lines.push(`[FORM] Jenis kemasan: ${effPackageType}`);
  if (mode === "new" && effPackageType !== "pcs") {
    lines.push(`[FORM] Isi/kemasan (${baseUnit}): ${effectivePkgSize}`);
    lines.push(`[FORM] Stok disimpan dalam ${baseUnit}`);
  }
  lines.push(
    `[FORM] Jumlah ${kartonActive ? "karton" : "kemasan"} (${effPackageType}): ${packageQty}`,
  );
  lines.push(`[FORM] Harga beli / ${effPackageType}: ${pricePerPackage || "-"}`);
  if (effPackageType !== "pcs") {
    lines.push(`[FORM] Harga beli / ${baseUnit}: ${pricePerBase || "-"}`);
    lines.push(`[FORM] Toggle Harga per ${effPackageType} | Harga per ${baseUnit}`);
  } else {
    lines.push(`[FORM] Harga per ${baseUnit} (forced)`);
  }
  if (effPackageType === "botol") {
    lines.push(`[FORM] Karton toggle: ${inputKarton ? "ON" : "OFF"} (= ${BOTOL_PER_KARTON} botol)`);
  } else {
    lines.push(`[FORM] Karton toggle: hidden`);
  }

  // ---- RINGKASAN ----
  const it = selectedItem;
  const header = it
    ? `${it.name} · ${effPackageType}${effPackageType !== "pcs" ? ` ${effectivePkgSize} ${baseUnit}` : ""}`
    : `Barang baru · ${effPackageType}${effPackageType !== "pcs" ? ` ${effectivePkgSize} ${baseUnit}` : ""}`;
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

const PACKAGE_TYPES: PackageType[] = ["gram", "botol", "pcs", "sachet"];

describe("Gudang — snapshot label & ringkasan per Jenis kemasan", () => {
  describe("mode: new (Barang baru)", () => {
    for (const pt of PACKAGE_TYPES) {
      it(`snapshot: new + ${pt}`, () => {
        expect(renderScreen({ mode: "new", packageType: pt })).toMatchSnapshot();
      });
    }
  });

  describe("mode: existing (pilih item gudang)", () => {
    for (const pt of PACKAGE_TYPES) {
      it(`snapshot: existing + ${pt}`, () => {
        expect(renderScreen({ mode: "existing", packageType: pt })).toMatchSnapshot();
      });
    }
  });

  describe("kombinasi tambahan (karton, priceMode base)", () => {
    it("snapshot: existing + botol + karton ON", () => {
      expect(
        renderScreen({ mode: "existing", packageType: "botol", inputKarton: true, packageQty: "1" }),
      ).toMatchSnapshot();
    });
    it("snapshot: new + gram + priceMode=base", () => {
      expect(
        renderScreen({
          mode: "new",
          packageType: "gram",
          priceMode: "base",
          pricePerPackage: "",
          pricePerBase: "20",
        }),
      ).toMatchSnapshot();
    });
    it("snapshot: existing + pcs (priceMode forced base)", () => {
      expect(
        renderScreen({ mode: "existing", packageType: "pcs", pricePerPackage: "", pricePerBase: "3000" }),
      ).toMatchSnapshot();
    });
  });

  describe("anti-bocor label lawan", () => {
    // Untuk tiap Jenis kemasan target, render TIDAK boleh memuat label
    // eksklusif Jenis kemasan lain (mis. gram → tidak boleh ada 'botol'/'pcs',
    // botol → tidak boleh ada 'gram'/'g '/'pcs'). Ini mengunci snapshot supaya
    // regresi 'artefak lama' langsung terdeteksi walau snapshot ter-update tanpa review.
    const FORBIDDEN: Record<PackageType, RegExp[]> = {
      gram: [/\bbotol\b/, /\bsachet\b/, /(?<!p)cs\b/],
      botol: [/\bgram\b/, /\bg\/kemasan\b/, /\bsachet\b/, /(?<!p)cs\b/],
      pcs: [/\bgram\b/, /\bbotol\b/, /\bsachet\b/, /\bg\/kemasan\b/],
      sachet: [/\bgram\b/, /\bbotol\b/, /(?<!p)cs\b/, /\bg\/kemasan\b/],
    };
    for (const pt of PACKAGE_TYPES) {
      for (const mode of ["new", "existing"] as const) {
        it(`${mode} + ${pt}: bebas label lawan`, () => {
          const text = renderScreen({ mode, packageType: pt });
          for (const re of FORBIDDEN[pt]) {
            expect(text, `label lawan bocor: ${re}`).not.toMatch(re);
          }
        });
      }
    }
  });
});