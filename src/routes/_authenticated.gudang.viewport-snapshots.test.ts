import { describe, it, expect } from "vitest";
import { computeBeliDerived } from "@/lib/beli-derived";
import { BOTOL_PER_KARTON, rupiah, fmtBase, fmtItemQty } from "@/lib/stock-format";

/**
 * Snapshot halaman **Gudang → Catat Pembelian** untuk beberapa ukuran layar.
 *
 * Karena `/gudang` di-gate `_authenticated`, snapshot render sesungguhnya
 * (via Playwright) berjalan lewat `scripts/snapshot-gudang-viewports.mjs`.
 * Di CI (tanpa sesi), test ini memakai *proxy snapshot*: mereplikasi
 * responsive contract yang ditulis di `_authenticated.gudang.tsx` menjadi
 * teks per-viewport, sehingga perbedaan tata-letak akibat pergantian
 * gram/botol/pcs/sachet langsung muncul di diff snapshot.
 *
 * Aturan yang di-mirror (baca `responsive-layout-patterns` di codebase):
 *  - Header form pakai `grid grid-cols-[minmax(0,1fr)_auto]` di mobile,
 *    naik ke `flex sm:flex-wrap sm:justify-between` di ≥ `sm` (640px).
 *  - Baris Jumlah/Harga: `grid-cols-1` di mobile, `sm:grid-cols-2`.
 *  - Toggle Karton (khusus botol) muncul inline di desktop, stack di mobile.
 *  - Ringkasan: `grid-cols-1` di mobile, `sm:grid-cols-2 lg:grid-cols-3`.
 */

type PackageType = "gram" | "pcs" | "botol" | "sachet";
type BaseUnit = "g" | "pcs";
type Viewport = { name: "desktop" | "mobile"; width: number };

const VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1280 },
  { name: "mobile", width: 390 },
];
const SM_BREAKPOINT = 640;
const LG_BREAKPOINT = 1024;
const PACKAGE_TYPES: PackageType[] = ["gram", "botol", "pcs", "sachet"];

const baseUnitFor = (pt: PackageType): BaseUnit => (pt === "gram" ? "g" : "pcs");

type WItem = {
  id: string;
  name: string;
  package_type: PackageType;
  package_size: number;
  base_unit: BaseUnit;
  stock_base: number;
  avg_cost_per_base: number;
};

function makeItem(pt: PackageType): WItem {
  return {
    id: `existing-${pt}`,
    name: `Item ${pt.toUpperCase()}`,
    package_type: pt,
    package_size: pt === "gram" ? 1000 : pt === "botol" ? 500 : 1,
    base_unit: baseUnitFor(pt),
    stock_base: 5000,
    avg_cost_per_base: 12,
  };
}

function classesForViewport(width: number) {
  const sm = width >= SM_BREAKPOINT;
  const lg = width >= LG_BREAKPOINT;
  return {
    headerLayout: sm ? "flex-row (sm+)" : "grid-cols-[1fr_auto] (mobile)",
    formRowCols: sm ? "grid-cols-2 (sm+)" : "grid-cols-1 (mobile)",
    summaryCols: lg ? "grid-cols-3 (lg+)" : sm ? "grid-cols-2 (sm+)" : "grid-cols-1 (mobile)",
    kartonToggleFlow: sm ? "inline" : "stacked",
    truncateHeading: !sm, // mobile: heading di-truncate
  };
}

function renderScreen(input: {
  viewport: Viewport;
  mode: "new" | "existing";
  packageType: PackageType;
  inputKarton?: boolean;
}): string {
  const { viewport, mode, packageType, inputKarton = false } = input;
  const selectedItem = mode === "existing" ? makeItem(packageType) : null;
  const packageSize = packageType === "gram" ? "1000" : packageType === "botol" ? "500" : "1";

  const d = computeBeliDerived({
    mode,
    selectedItem,
    newPackageType: packageType,
    newPackageSize: packageSize,
    packageQty: "2",
    pricePerPackage: "10000",
    priceMode: packageType === "pcs" ? "base" : "package",
    pricePerBase: "",
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
  const cls = classesForViewport(viewport.width);

  const lines: string[] = [];
  lines.push(`# viewport=${viewport.name} (${viewport.width}px) · mode=${mode} · pt=${effPackageType}`);
  lines.push(`[layout] header: ${cls.headerLayout}`);
  lines.push(`[layout] form-row: ${cls.formRowCols}`);
  lines.push(`[layout] summary: ${cls.summaryCols}`);
  lines.push(`[layout] karton-toggle-flow: ${cls.kartonToggleFlow}`);
  lines.push(`[layout] heading-truncate: ${cls.truncateHeading ? "on" : "off"}`);

  // ---- FORM ----
  lines.push(`[FORM] Jenis kemasan: ${effPackageType}`);
  if (mode === "new" && effPackageType !== "pcs") {
    lines.push(`[FORM] Isi/kemasan (${baseUnit}): ${effectivePkgSize}`);
    lines.push(`[FORM] Stok disimpan dalam ${baseUnit}`);
  }
  lines.push(
    `[FORM] Jumlah ${kartonActive ? "karton" : "kemasan"} (${effPackageType}): 2`,
  );
  lines.push(`[FORM] Harga beli / ${effPackageType}: 10000`);
  if (effPackageType !== "pcs") {
    lines.push(`[FORM] Toggle Harga per ${effPackageType} | Harga per ${baseUnit}`);
  } else {
    lines.push(`[FORM] Harga per ${baseUnit} (forced)`);
  }
  if (effPackageType === "botol") {
    lines.push(
      `[FORM] Karton toggle: ${inputKarton ? "ON" : "OFF"} (= ${BOTOL_PER_KARTON} botol) · flow=${cls.kartonToggleFlow}`,
    );
  }

  // ---- RINGKASAN ----
  const it = selectedItem;
  const rawHeader = it
    ? `${it.name} · ${effPackageType}${effPackageType !== "pcs" ? ` ${effectivePkgSize} ${baseUnit}` : ""}`
    : `Barang baru · ${effPackageType}${effPackageType !== "pcs" ? ` ${effectivePkgSize} ${baseUnit}` : ""}`;
  const header =
    cls.truncateHeading && rawHeader.length > 24 ? `${rawHeader.slice(0, 23)}…` : rawHeader;
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

describe("Gudang — viewport snapshot (desktop vs mobile) per Jenis kemasan", () => {
  for (const viewport of VIEWPORTS) {
    describe(`viewport: ${viewport.name} (${viewport.width}px)`, () => {
      for (const mode of ["new", "existing"] as const) {
        for (const pt of PACKAGE_TYPES) {
          it(`snapshot: ${mode} · ${pt}`, () => {
            expect(
              renderScreen({ viewport, mode, packageType: pt }),
            ).toMatchSnapshot();
          });
        }
      }
      // Kombinasi khusus botol + karton (hanya berpengaruh saat botol).
      it(`snapshot: existing · botol · karton ON`, () => {
        expect(
          renderScreen({ viewport, mode: "existing", packageType: "botol", inputKarton: true }),
        ).toMatchSnapshot();
      });
    });
  }

  describe("cross-viewport parity: nilai numerik identik lintas viewport", () => {
    for (const mode of ["new", "existing"] as const) {
      for (const pt of PACKAGE_TYPES) {
        it(`${mode} · ${pt}: numerik desktop == mobile`, () => {
          // Hilangkan baris [layout] & [header truncation] agar tersisa
          // konten data murni — harus identik antar viewport.
          const strip = (s: string) =>
            s
              .split("\n")
              .filter((l) => !l.startsWith("[layout]") && !l.startsWith("#"))
              .map((l) =>
                l
                  .replace(/…$/, "") // buang ellipsis mobile
                  .replace(/ · flow=(inline|stacked)$/, ""), // flow karton = layout-only
              )
              .join("\n");
          const desktop = strip(
            renderScreen({ viewport: VIEWPORTS[0], mode, packageType: pt }),
          );
          const mobile = strip(
            renderScreen({ viewport: VIEWPORTS[1], mode, packageType: pt }),
          );
          // Header ringkasan bisa dipotong di mobile; samakan dgn desktop
          // dengan memangkas keduanya ke 23 char yang dipakai truncation.
          const norm = (s: string) =>
            s.replace(/(\[SUM\] Ringkasan \| )([^\n]+)/, (_m, p, v) => `${p}${v.slice(0, 23)}`);
          expect(norm(mobile)).toBe(norm(desktop));
        });
      }
    }
  });

  describe("anti-leak label lawan per viewport", () => {
    const FORBIDDEN: Record<PackageType, RegExp[]> = {
      gram: [/\bbotol\b/, /\bsachet\b/, /(?<!p)cs\b/],
      botol: [/\bgram\b/, /\bg\/kemasan\b/, /\bsachet\b/, /(?<!p)cs\b/],
      pcs: [/\bgram\b/, /\bbotol\b/, /\bsachet\b/, /\bg\/kemasan\b/],
      sachet: [/\bgram\b/, /\bbotol\b/, /(?<!p)cs\b/, /\bg\/kemasan\b/],
    };
    for (const viewport of VIEWPORTS) {
      for (const pt of PACKAGE_TYPES) {
        for (const mode of ["new", "existing"] as const) {
          it(`${viewport.name} · ${mode} · ${pt}: bebas label lawan`, () => {
            const text = renderScreen({ viewport, mode, packageType: pt });
            for (const re of FORBIDDEN[pt]) {
              expect(text, `label lawan bocor: ${re}`).not.toMatch(re);
            }
          });
        }
      }
    }
  });
});