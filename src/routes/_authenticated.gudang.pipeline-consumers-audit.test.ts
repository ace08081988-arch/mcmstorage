import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ============================================================
// AUDIT konsistensi lintas rute:
//   1. Enumerate SEMUA file produksi di src/ yang mengimpor
//      computeBeliDerived / computeBeliWarnings (pipeline derived+
//      warnings).
//   2. Untuk setiap konsumen, PASTIKAN ada paket suite refetch-
//      stability yang setara — minimal:
//        - effective-fields-refetch (field non-efektif berubah → 0 recompute)
//        - effective-fields-deepequal-refetch (identitas baru, deep-equal)
//        - selecteditem-burst-refetch (burst tanpa perubahan efektif)
//        - warnings-only-recompute (asimetri derived vs warnings)
//   3. Kunci daftar konsumen — bila konsumen baru muncul, test ini
//      gagal sampai suite refetch-stability untuk konsumen tsb ditulis.
// ============================================================

const SRC = resolve(__dirname, "..");
const IMPORT_RE = /from\s+["']@\/lib\/beli-(derived|warnings)["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__snapshots__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function isProductionFile(p: string): boolean {
  // Buang test files & library sumber pipeline itu sendiri.
  if (/\.test\.(ts|tsx)$/.test(p)) return false;
  if (/[\\/]beli-(derived|warnings)\.ts$/.test(p)) return false;
  return true;
}

function pipelineConsumers(): string[] {
  const files = walk(SRC).filter(isProductionFile);
  return files
    .filter((p) => {
      const src = readFileSync(p, "utf8");
      return IMPORT_RE.test(src);
    })
    .map((p) => p.slice(SRC.length + 1).replaceAll("\\", "/"))
    .sort();
}

/** Suite refetch-stability yang WAJIB ada untuk setiap konsumen. */
const REQUIRED_SUITES = [
  "src/routes/_authenticated.gudang.effective-fields-refetch.test.ts",
  "src/routes/_authenticated.gudang.effective-fields-deepequal-refetch.test.ts",
  "src/routes/_authenticated.gudang.selecteditem-burst-refetch.test.ts",
  "src/routes/_authenticated.gudang.warnings-only-recompute.test.ts",
];

describe("audit konsumen pipeline derived+warnings", () => {
  it("konsumen produksi = tepat satu (BeliTab di _authenticated.gudang.tsx)", () => {
    const consumers = pipelineConsumers();
    // Snapshot terkunci — bila berubah, tambahkan suite refetch-stability
    // untuk konsumen baru lalu update array ini.
    expect(consumers).toEqual(["routes/_authenticated.gudang.tsx"]);
  });

  it("semua suite refetch-stability yang diwajibkan tersedia di src/", () => {
    const missing: string[] = [];
    for (const suite of REQUIRED_SUITES) {
      const abs = resolve(__dirname, "../../", suite);
      try {
        statSync(abs);
      } catch {
        missing.push(suite);
      }
    }
    expect(missing).toEqual([]);
  });

  it("setiap suite refetch-stability menguji BAIK computeBeliDerived MAUPUN computeBeliWarnings", () => {
    // Ini menjamin tidak ada suite yang hanya menyentuh salah satu compute.
    const gaps: { file: string; missing: string[] }[] = [];
    for (const suite of REQUIRED_SUITES) {
      const abs = resolve(__dirname, "../../", suite);
      const src = readFileSync(abs, "utf8");
      const missing: string[] = [];
      if (!/computeBeliDerived/.test(src)) missing.push("computeBeliDerived");
      if (!/computeBeliWarnings/.test(src)) missing.push("computeBeliWarnings");
      if (missing.length) gaps.push({ file: suite, missing });
    }
    expect(gaps).toEqual([]);
  });

  it("kontrak: konsumen adalah file produksi, bukan test/fixture", () => {
    const consumers = pipelineConsumers();
    for (const c of consumers) {
      expect(c.endsWith(".test.ts")).toBe(false);
      expect(c.endsWith(".test.tsx")).toBe(false);
      expect(c.includes("/fixtures/")).toBe(false);
    }
  });
});