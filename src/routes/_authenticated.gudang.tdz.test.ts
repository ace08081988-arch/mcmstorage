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