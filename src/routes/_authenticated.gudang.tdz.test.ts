import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Regression test untuk mencegah TS2448 (Block-scoped variable used before
// declaration) dan TS2454 (Variable used before being assigned) pada
// `selectedItem` di BeliTab. Sebelumnya, urutan deklarasi/pemakaian
// selectedItem sempat rentan bila hook lain disisipkan di atasnya.

const FILE = join(process.cwd(), "src/routes/_authenticated.gudang.tsx");
const src = readFileSync(FILE, "utf8");

describe("gudang.tsx — selectedItem TDZ guard", () => {
  it("mendeklarasikan selectedItem dengan anotasi WItem | null", () => {
    expect(src).toMatch(/const\s+selectedItem\s*:\s*WItem\s*\|\s*null\s*=/);
  });

  it("menginisialisasi selectedItem via useMemo dengan dep [mode, items, itemId]", () => {
    const m = src.match(
      /const\s+selectedItem\s*:\s*WItem\s*\|\s*null\s*=\s*useMemo\([\s\S]*?\[\s*mode\s*,\s*items\s*,\s*itemId\s*\]\s*,?\s*\)/,
    );
    expect(m, "selectedItem harus dibungkus useMemo([mode, items, itemId])").toBeTruthy();
  });

  it("mendefinisikan type guard isWItem untuk menyempitkan WItem | null", () => {
    expect(src).toMatch(/isWItem\s*=\s*\(v\s*:\s*WItem\s*\|\s*null\)\s*:\s*v\s+is\s+WItem/);
  });

  it("semua akses properti selectedItem.<x> dilindungi type guard di baris yang sama atau di atasnya", () => {
    const lines = src.split("\n");
    // Baris yang membaca properti langsung: selectedItem.name / .package_type / dst.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/\bselectedItem\.\w/.test(line)) continue;
      // Cari guard di baris yang sama (ternary/&&/if) ATAU dalam 6 baris sebelumnya
      // (mis. `if (!isWItem(selectedItem)) return;`).
      const windowSrc = lines.slice(Math.max(0, i - 6), i + 1).join("\n");
      const guarded =
        /isWItem\(selectedItem\)/.test(windowSrc) ||
        /selectedItem\s*\?/.test(windowSrc) ||
        /selectedItem\s*&&/.test(windowSrc) ||
        /if\s*\(\s*!selectedItem\s*\)/.test(windowSrc);
      expect(guarded, `selectedItem.<prop> di baris ${i + 1} tidak dilindungi type guard:\n${line}`).toBe(true);
    }
  });

  it("semua pemakaian selectedItem terjadi setelah deklarasinya", () => {
    const declIdx = src.search(/const\s+selectedItem\s*:/);
    expect(declIdx).toBeGreaterThan(-1);
    // Cari kemunculan token `selectedItem` selain baris deklarasi.
    const re = /\bselectedItem\b/g;
    let match: RegExpExecArray | null;
    const positions: number[] = [];
    while ((match = re.exec(src))) positions.push(match.index);
    // Semua kemunculan lain harus setelah declIdx.
    for (const p of positions) {
      if (p === declIdx) continue;
      expect(p, `selectedItem dipakai di offset ${p} sebelum deklarasi (${declIdx})`).toBeGreaterThan(declIdx);
    }
  });

  it("typecheck tsgo tidak melaporkan TS2448/TS2454 pada file gudang", () => {
    const res = spawnSync("bunx", ["tsgo", "--noEmit"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    const offenders = out
      .split("\n")
      .filter((l) => /_authenticated\.gudang\.tsx/.test(l) && /TS2448|TS2454/.test(l));
    expect(offenders, offenders.join("\n")).toEqual([]);
  }, 60_000);
});

// Regression: mengunci dependency array useMemo/useEffect yang berkaitan
// dengan selectedItem → derived → warnings. Jika salah satu dependency
// hilang, ringkasan real-time dan warnings bisa stale, atau state karton /
// priceMode dari item sebelumnya ikut terbawa.

function extractDepArray(pattern: RegExp): string[] {
  const m = src.match(pattern);
  if (!m) return [];
  const raw = m[1] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("gudang.tsx — dependency arrays selectedItem/derived/warnings", () => {
  it("selectedItem = useMemo(..., [mode, items, itemId])", () => {
    const deps = extractDepArray(
      /const\s+selectedItem\s*:\s*WItem\s*\|\s*null\s*=\s*useMemo\(\s*\(\)\s*=>[\s\S]*?,\s*\[([^\]]*)\]\s*,?\s*\)/,
    );
    expect(deps.sort()).toEqual(["items", "itemId", "mode"].sort());
  });

  it("derived = useMemo mencakup SEMUA input computeBeliDerived", () => {
    const deps = extractDepArray(
      /const\s+derived\s*=\s*useMemo\(\s*\(\)\s*=>\s*[\s\S]*?computeBeliDerived\(\{[\s\S]*?\}\)\s*,\s*\[([^\]]*)\]\s*,?\s*\)/,
    );
    // Semua state dan input yang dipakai computeBeliDerived harus muncul —
    // menghapus salah satu = risiko ringkasan stale.
    const required = [
      "mode",
      "selectedItem",
      "packageType",
      "packageSize",
      "packageQty",
      "pricePerPackage",
      "priceMode",
      "pricePerBase",
      "inputKarton",
    ];
    for (const dep of required) {
      expect(deps, `dep '${dep}' harus ada di useMemo(derived)`).toContain(dep);
    }
  });

  it("warnings = useMemo(..., [mode, selectedItem, derived, priceMode, inputKarton])", () => {
    const deps = extractDepArray(
      /const\s+warnings\s*=\s*useMemo\(\s*\(\)\s*=>\s*[\s\S]*?computeBeliWarnings\(\{[\s\S]*?\}\)[\s\S]*?,\s*\[([^\]]*)\]\s*,?\s*\)/,
    );
    expect(deps.sort()).toEqual(
      ["mode", "selectedItem", "derived", "priceMode", "inputKarton"].sort(),
    );
  });

  it("effect karton/priceMode berdep [selectedItem, inputKarton, priceMode]", () => {
    const deps = extractDepArray(
      /if\s*\(!isWItem\(selectedItem\)\)\s*return;[\s\S]*?\}\s*,\s*\[([^\]]*)\]\s*\)/,
    );
    expect(deps.sort()).toEqual(["selectedItem", "inputKarton", "priceMode"].sort());
  });

  it("effect reset HANYA bergantung pada resetKey (nilai lain lewat ref) agar tidak refire", () => {
    // Effect reset sekarang membaca priceMode default via `nextPriceModeRef`,
    // sehingga dep array minimal — hanya `resetKey`. Ini memastikan reset
    // benar-benar hanya jalan saat trigger (mode/itemId/packageType) berubah.
    const deps = extractDepArray(
      /setPriceMode\(nextPriceModeRef\.current\);\s*\}\s*,\s*\[([^\]]*)\]\s*\)/,
    );
    expect(deps).toEqual(["resetKey"]);
    // Body tidak lagi memakai `items.find` / `selectedItem` / `mode` /
    // `packageType` secara langsung, jadi TIDAK boleh masuk dep array.
    expect(deps).not.toContain("items");
    expect(deps).not.toContain("selectedItem");
    expect(deps).not.toContain("mode");
    expect(deps).not.toContain("packageType");
  });
});