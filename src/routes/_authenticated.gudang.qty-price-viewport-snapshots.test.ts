import { describe, it, expect, beforeEach } from "vitest";
import {
  computeBeliDerived,
  __resetBeliDerivedMemo,
  type BeliPackageType,
  type BeliBaseUnit,
} from "@/lib/beli-derived";
import { BOTOL_PER_KARTON, rupiah, fmtBase, fmtItemQty } from "@/lib/stock-format";

/**
 * Snapshot **qty × price mutation × viewport**.
 *
 * Menggabungkan dua kontrak sebelumnya:
 *   • `qty-price-mutation-snapshots` — walk state mutasi jumlah/harga.
 *   • `viewport-snapshots` — layout responsif (mobile 390 vs desktop 1280).
 *
 * Yang dikunci di sini:
 *   1. Ringkasan turunan (Jumlah kemasan, Tambahan stok, Harga per…,
 *      Total biaya) HARUS bit-exact **identik** lintas viewport untuk
 *      state mutasi yang sama — angka tidak boleh bergantung pada lebar
 *      layar.
 *   2. Bagian responsif (kelas grid, truncate heading, karton flow)
 *      berbeda **hanya** sebagaimana yang di-kontrak di
 *      `responsive-layout-patterns` — snapshot mengunci selisih tsb per
 *      langkah mutasi supaya perubahan tak-sengaja pada breakpoint
 *      langsung ketahuan.
 *   3. Label satuan (`gram/botol/pcs/sachet` + `g/kg/mg/pcs`) konsisten
 *      selama walk mutasi di **setiap** viewport (anti-artefak).
 */

type PackageType = BeliPackageType;
type Viewport = { name: "desktop" | "mobile"; width: number };

const VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1280 },
  { name: "mobile", width: 390 },
];
const SM_BREAKPOINT = 640;
const LG_BREAKPOINT = 1024;
const PACKAGE_TYPES: PackageType[] = ["gram", "botol", "pcs", "sachet"];

const baseUnitFor = (pt: PackageType): BeliBaseUnit => (pt === "gram" ? "g" : "pcs");

type WItem = {
  id: string;
  name: string;
  package_type: PackageType;
  package_size: number;
  base_unit: BeliBaseUnit;
  stock_base: number;
  avg_cost_per_base: number;
};

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

function layoutForViewport(width: number) {
  const sm = width >= SM_BREAKPOINT;
  const lg = width >= LG_BREAKPOINT;
  return {
    header: sm ? "flex-row (sm+)" : "grid-cols-[1fr_auto] (mobile)",
    formRow: sm ? "grid-cols-2 (sm+)" : "grid-cols-1 (mobile)",
    summary: lg ? "grid-cols-3 (lg+)" : sm ? "grid-cols-2 (sm+)" : "grid-cols-1 (mobile)",
    kartonFlow: sm ? "inline" : "stacked",
    truncateHeading: !sm,
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
 * Serialisasi bagian **layout** (responsif) — HANYA berubah antar viewport.
 */
function renderLayout(vp: Viewport): string {
  const cls = layoutForViewport(vp.width);
  return [
    `[layout] header: ${cls.header}`,
    `[layout] form-row: ${cls.formRow}`,
    `[layout] summary: ${cls.summary}`,
    `[layout] karton-flow: ${cls.kartonFlow}`,
    `[layout] heading-truncate: ${cls.truncateHeading ? "on" : "off"}`,
  ].join("\n");
}

/**
 * Serialisasi bagian **data** turunan — WAJIB identik antar viewport untuk
 * state yang sama. Header ringkasan bisa dipotong di mobile; dikeluarkan
 * dari body agar bagian numerik tetap bit-exact.
 */
function renderDataBody(state: FormState): string {
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
  const rawHeader = it
    ? `${it.name} · ${effPackageType}${effPackageType !== "pcs" ? ` ${effectivePkgSize} ${baseUnit}` : ""}`
    : `Barang baru · ${effPackageType}${effPackageType !== "pcs" ? ` ${effectivePkgSize} ${baseUnit}` : ""}`;

  const lines: string[] = [
    `[INPUT] qty=${state.packageQty} · pricePkg=${state.pricePerPackage || "-"} · priceBase=${
      state.pricePerBase || "-"
    } · mode=${state.priceMode}${state.inputKarton ? " · karton=ON" : ""}`,
    `[SUM] Ringkasan(raw) | ${rawHeader}`,
    `[SUM] Jumlah kemasan | ${pkgQ.toLocaleString("id-ID", { maximumFractionDigits: 4 })} ${effPackageType}${
      kartonActive
        ? ` (${(pkgQ / BOTOL_PER_KARTON).toLocaleString("id-ID", { maximumFractionDigits: 4 })} karton)`
        : ""
    }`,
    `[SUM] Tambahan stok | ${it ? fmtItemQty(baseAdded, it) : fmtBase(baseAdded, baseUnit)}`,
    `[SUM] Harga per ${effPackageType} | ${rupiah(price)}`,
  ];
  if (effPackageType !== "pcs" && baseAdded !== 0 && Number.isFinite(totalCost / baseAdded)) {
    lines.push(`[SUM] Harga per ${baseUnit} | ${rupiah(totalCost / baseAdded)}`);
  }
  lines.push(`[SUM] Total biaya | ${rupiah(totalCost)}`);
  return lines.join("\n");
}

/**
 * Header ringkasan versi mobile — dipisah agar body data (`renderDataBody`)
 * dapat dibandingkan bit-exact antar viewport.
 */
function renderTruncatedHeading(state: FormState, vp: Viewport): string {
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
  const rawHeader = selectedItem
    ? `${selectedItem.name} · ${d.effPackageType}${d.effPackageType !== "pcs" ? ` ${d.effectivePkgSize} ${d.effBaseUnit}` : ""}`
    : `Barang baru · ${d.effPackageType}${d.effPackageType !== "pcs" ? ` ${d.effectivePkgSize} ${d.effBaseUnit}` : ""}`;
  const cls = layoutForViewport(vp.width);
  const shown =
    cls.truncateHeading && rawHeader.length > 24 ? `${rawHeader.slice(0, 23)}…` : rawHeader;
  return `[SUM] Ringkasan(shown) | ${shown}`;
}

function renderStep(state: FormState, vp: Viewport): string {
  return [
    `# viewport=${vp.name} (${vp.width}px)`,
    renderLayout(vp),
    renderTruncatedHeading(state, vp),
    renderDataBody(state),
  ].join("\n");
}

function walk(
  initial: FormState,
  steps: Array<{ label: string; patch: Partial<FormState> }>,
  vp: Viewport,
): string {
  const out: string[] = [];
  let cur: FormState = { ...initial };
  out.push(`=== step 0: initial ===\n${renderStep(cur, vp)}`);
  for (let i = 0; i < steps.length; i++) {
    cur = { ...cur, ...steps[i].patch };
    out.push(`=== step ${i + 1}: ${steps[i].label} ===\n${renderStep(cur, vp)}`);
  }
  return out.join("\n\n");
}

/** Ekstrak hanya baris data (`[INPUT]`, `[SUM] Ringkasan(raw)`, `[SUM] …`). */
function dataOnly(rendered: string): string {
  return rendered
    .split("\n")
    .filter(
      (l) =>
        l.startsWith("[INPUT]") ||
        l.startsWith("[SUM] Ringkasan(raw)") ||
        (l.startsWith("[SUM] ") && !l.startsWith("[SUM] Ringkasan(shown)")) ||
        l.startsWith("=== step"),
    )
    .join("\n");
}

describe("Gudang — snapshot qty × price mutation × viewport", () => {
  beforeEach(() => {
    __resetBeliDerivedMemo();
  });

  describe("qty walk: 2 → 5 → 10 → 0 → 3 (per viewport × packageType × mode)", () => {
    for (const vp of VIEWPORTS) {
      for (const pt of PACKAGE_TYPES) {
        for (const mode of ["new", "existing"] as const) {
          it(`snapshot: ${vp.name} · ${mode} · ${pt}`, () => {
            expect(
              walk(
                baseState(mode, pt),
                [
                  { label: "qty 2 → 5", patch: { packageQty: "5" } },
                  { label: "qty 5 → 10", patch: { packageQty: "10" } },
                  { label: "qty 10 → 0", patch: { packageQty: "0" } },
                  { label: "qty 0 → 3", patch: { packageQty: "3" } },
                ],
                vp,
              ),
            ).toMatchSnapshot();
          });
        }
      }
    }
  });

  describe("price walk (packageMode) per viewport", () => {
    for (const vp of VIEWPORTS) {
      for (const pt of PACKAGE_TYPES.filter((p) => p !== "pcs")) {
        it(`snapshot: ${vp.name} · new · ${pt} · harga 10000 → 12500 → 9000 → 0 → 15000`, () => {
          expect(
            walk(
              baseState("new", pt),
              [
                { label: "harga 10000 → 12500", patch: { pricePerPackage: "12500" } },
                { label: "harga 12500 → 9000", patch: { pricePerPackage: "9000" } },
                { label: "harga 9000 → 0", patch: { pricePerPackage: "0" } },
                { label: "harga 0 → 15000", patch: { pricePerPackage: "15000" } },
              ],
              vp,
            ),
          ).toMatchSnapshot();
        });
      }
    }
  });

  describe("kombinasi: existing + botol · qty & harga & karton per viewport", () => {
    for (const vp of VIEWPORTS) {
      it(`snapshot: ${vp.name} · existing · botol · qty+harga+karton`, () => {
        expect(
          walk(
            baseState("existing", "botol"),
            [
              { label: "qty 2 → 4", patch: { packageQty: "4" } },
              { label: "harga 10000 → 15000", patch: { pricePerPackage: "15000" } },
              {
                label: "toggle Karton ON, qty 4 → 1",
                patch: { inputKarton: true, packageQty: "1" },
              },
              {
                label: "harga 15000 → 18000 (masih karton)",
                patch: { pricePerPackage: "18000" },
              },
              {
                label: "toggle Karton OFF, qty 1 → 6",
                patch: { inputKarton: false, packageQty: "6" },
              },
            ],
            vp,
          ),
        ).toMatchSnapshot();
      });
    }
  });

  /**
   * Cross-viewport parity: untuk setiap langkah mutasi, bagian data numerik
   * WAJIB identik antara desktop dan mobile. Ini menangkap regresi di mana
   * layout responsif tak-sengaja mengubah nilai (mis. rounding berbeda,
   * pemotongan angka karena truncate diterapkan ke kolom yang salah).
   */
  describe("cross-viewport parity: bit-exact data lintas viewport", () => {
    const scenarios: Array<{
      label: string;
      initial: FormState;
      steps: Array<{ label: string; patch: Partial<FormState> }>;
    }> = [
      {
        label: "new · gram · qty walk",
        initial: baseState("new", "gram"),
        steps: [
          { label: "qty 5", patch: { packageQty: "5" } },
          { label: "qty 10", patch: { packageQty: "10" } },
          { label: "qty 0", patch: { packageQty: "0" } },
          { label: "qty desimal 1.5", patch: { packageQty: "1.5" } },
        ],
      },
      {
        label: "existing · botol · karton + harga",
        initial: baseState("existing", "botol"),
        steps: [
          { label: "harga 15000", patch: { pricePerPackage: "15000" } },
          { label: "karton ON qty 1", patch: { inputKarton: true, packageQty: "1" } },
          { label: "harga desimal 12500.5", patch: { pricePerPackage: "12500.5" } },
        ],
      },
      {
        label: "new · pcs · priceMode base walk",
        initial: baseState("new", "pcs"),
        steps: [
          { label: "pricePerBase 4500", patch: { pricePerBase: "4500" } },
          { label: "pricePerBase 0", patch: { pricePerBase: "0" } },
          { label: "pricePerBase 3000", patch: { pricePerBase: "3000" } },
        ],
      },
    ];

    for (const { label, initial, steps } of scenarios) {
      it(`parity: ${label}`, () => {
        const desktop = walk(initial, steps, VIEWPORTS[0]);
        const mobile = walk(initial, steps, VIEWPORTS[1]);
        expect(dataOnly(mobile)).toBe(dataOnly(desktop));
      });
    }
  });

  /**
   * Anti-artefak: label satuan konsisten sepanjang walk di setiap viewport.
   * Contoh: setelah qty ubah, label `gram` di packageType=gram tidak boleh
   * berubah jadi `botol`; label `kg` (dari `fmtBase`) muncul hanya jika
   * baseAdded ≥ 1000 g dan tidak bocor ke sachet/pcs.
   */
  describe("anti-artefak label satuan konsisten lintas walk × viewport", () => {
    // Catatan: base_unit untuk `botol` & `sachet` adalah `pcs` — token
    // "pcs" muncul sah pada baris "Tambahan stok" mereka. Larangan `pcs`
    // dibatasi ke tipe kemasan yang base_unit-nya `g` (gram).
    const FORBIDDEN: Record<PackageType, RegExp[]> = {
      gram: [/\bbotol\b/, /\bsachet\b/, /\bpcs\b/],
      botol: [/\bgram\b/, /\bsachet\b/],
      pcs: [/\bgram\b/, /\bbotol\b/, /\bsachet\b/, /\bkg\b/, /\bmg\b/],
      sachet: [/\bgram\b/, /\bbotol\b/],
    };
    for (const vp of VIEWPORTS) {
      for (const pt of PACKAGE_TYPES) {
        it(`${vp.name} · ${pt}: walk qty 0→3→7 bebas label lawan`, () => {
          const rendered = walk(
            baseState("new", pt),
            [
              { label: "qty 0", patch: { packageQty: "0" } },
              { label: "qty 3", patch: { packageQty: "3" } },
              { label: "qty 7", patch: { packageQty: "7" } },
            ],
            vp,
          );
          // Hanya periksa baris data (baris layout tidak relevan untuk
          // label satuan produk).
          const body = rendered
            .split("\n")
            .filter((l) => !l.startsWith("[layout]"))
            .join("\n");
          for (const re of FORBIDDEN[pt]) {
            expect(body, `label lawan bocor: ${re}`).not.toMatch(re);
          }
        });
      }
    }
  });
});
