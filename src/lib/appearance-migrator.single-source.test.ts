import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static-source guard: memastikan setiap jalur impor payload
 * `mcm.appearance-settings` di aplikasi produksi memakai satu-satunya
 * migrator `migrateImportedAppearance` — tidak ada "inline migrator"
 * atau `JSON.parse` payload appearance di jalur lain (file / paste / URL).
 *
 * Aturan yang dijaga:
 *   1. `_authenticated.pengaturan-tampilan.tsx` hanya boleh punya SATU
 *      pemanggilan `migrateImportedAppearance(...)`.
 *   2. Ketiga jalur (`importSettings`/file, `importFromPaste`, `importFromUrl`)
 *      wajib menyalurkan payload lewat helper terpusat `runImportFromText`.
 *   3. Tidak boleh ada file lain di `src/` yang mem-parse literal
 *      `"mcm.appearance-settings"` sendiri (di luar migrator + fixtures +
 *      harness + test), yang akan menandakan migrator paralel.
 */

const ROOT = join(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function countOccurrences(hay: string, needle: string): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

describe("appearance import · satu migrator untuk semua jalur", () => {
  const settingsFile = "src/routes/_authenticated.pengaturan-tampilan.tsx";
  const src = read(settingsFile);

  it("hanya ada satu pemanggilan `migrateImportedAppearance(` di halaman", () => {
    expect(countOccurrences(src, "migrateImportedAppearance(")).toBe(1);
  });

  it("helper terpusat `runImportFromText` didefinisikan", () => {
    expect(src).toMatch(/const\s+runImportFromText\s*=/);
  });

  it("jalur file / paste / URL semua memanggil `runImportFromText`", () => {
    // Tiga tag sumber wajib muncul sebagai argumen kedua. Regex non-greedy
    // supaya toleran terhadap tanda kurung di argumen pertama (mis.
    // `String(reader.result ?? "{}")`).
    expect(src).toMatch(/runImportFromText\([\s\S]*?,\s*"file"\s*\)/);
    expect(src).toMatch(/runImportFromText\([\s\S]*?,\s*"paste"\s*\)/);
    expect(src).toMatch(/runImportFromText\([\s\S]*?,\s*"url"\s*\)/);
  });

  it("ketiga handler impor terdaftar di halaman", () => {
    expect(src).toMatch(/const\s+importSettings\s*=/);
    expect(src).toMatch(/const\s+importFromPaste\s*=/);
    expect(src).toMatch(/const\s+importFromUrl\s*=/);
  });

  it("tidak ada `JSON.parse` payload appearance di luar helper terpusat", () => {
    // Halaman hanya boleh punya SATU JSON.parse — di dalam `runImportFromText`.
    // (Jika suatu saat helper dipindah ke modul terpisah, test ini akan
    //  menemani migrasi tersebut dengan pesan yang jelas.)
    expect(countOccurrences(src, "JSON.parse(")).toBe(1);
  });

  it("literal `mcm.appearance-settings` hanya ada di modul migrator + fixtures + harness + test", () => {
    // Whitelist file yang BOLEH menyebut string tipe skema. Semua file lain
    // di src/ yang menyebut literal ini menandakan migrator paralel.
    const allowed = new Set([
      "src/lib/appearance-migrator.ts",
      "src/lib/appearance-migrator.fixtures.ts",
      "src/lib/appearance-migrator.test.ts",
      "src/lib/appearance-migrator.single-source.test.ts",
      "src/routes/lovable.visual.appearance-import.tsx",
    ]);

    // Enumerasi file .ts/.tsx di src/ tanpa dependency eksternal.
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const results: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        const st = statSync(abs);
        if (st.isDirectory()) walk(abs);
        else if (/\.(ts|tsx)$/.test(name)) results.push(abs);
      }
    };
    walk(join(ROOT, "src"));

    const offenders = results
      .map((abs) => ({ abs, rel: abs.slice(ROOT.length + 1).replace(/\\/g, "/") }))
      .filter(({ abs, rel }) => {
        if (allowed.has(rel)) return false;
        const body = readFileSync(abs, "utf8");
        return body.includes('"mcm.appearance-settings"') ||
          body.includes("'mcm.appearance-settings'");
      })
      .map((x) => x.rel);

    expect(offenders).toEqual([]);
  });
});