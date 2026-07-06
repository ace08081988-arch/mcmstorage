import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isActivePrep,
  isSentPrep,
  filterActivePreps,
  filterSentPreps,
  countActivePreps,
  countActiveByTitle,
  withActivePrepsFilter,
} from "./prep-active-selector";

/**
 * Selector tunggal untuk paket AKTIF (belum Riwayat Terkirim). Tes ini
 * membekukan kontrak logikanya DAN memaksa call site memakai helper —
 * bukan literal `!p.sold_at` / `.is("sold_at", null)` yang mudah bergeser.
 */

const A = (over: Partial<{ id: string; title_id: string; sold_at: string | null }> = {}) => ({
  id: over.id ?? "a",
  title_id: over.title_id ?? "t1",
  sold_at: over.sold_at ?? null,
});

describe("isActivePrep / isSentPrep — dua sisi mata uang yang sama", () => {
  it("sold_at null / undefined / '' → aktif", () => {
    expect(isActivePrep({ sold_at: null })).toBe(true);
    expect(isActivePrep({})).toBe(true);
    expect(isActivePrep({ sold_at: "" })).toBe(true);
  });

  it("sold_at berisi ISO string → sent, bukan aktif", () => {
    const p = { sold_at: "2026-07-06T09:15:00.000Z" };
    expect(isActivePrep(p)).toBe(false);
    expect(isSentPrep(p)).toBe(true);
  });

  it("keduanya SELALU saling mengeksklusi (property test kecil)", () => {
    for (const v of [null, undefined, "", "2026-01-01T00:00:00Z"] as const) {
      const p = { sold_at: v as string | null };
      expect(isActivePrep(p)).toBe(!isSentPrep(p));
    }
  });
});

describe("filterActivePreps / filterSentPreps", () => {
  const preps = [
    A({ id: "a", sold_at: null }),
    A({ id: "b", sold_at: "2026-07-06T09:15:00.000Z" }),
    A({ id: "c", sold_at: null }),
  ];
  it("partisi lengkap: active ∪ sent = semua, active ∩ sent = ∅", () => {
    const active = filterActivePreps(preps);
    const sent = filterSentPreps(preps);
    expect(active.map((p) => p.id)).toEqual(["a", "c"]);
    expect(sent.map((p) => p.id)).toEqual(["b"]);
    expect(active.length + sent.length).toBe(preps.length);
  });
});

describe("countActivePreps", () => {
  it("nol untuk array kosong", () => {
    expect(countActivePreps([])).toBe(0);
  });
  it("hanya menghitung yang sold_at null", () => {
    expect(countActivePreps([
      A({ sold_at: null }),
      A({ sold_at: "2026-07-06T09:15:00.000Z" }),
      A({ sold_at: null }),
      A({ sold_at: "2026-07-06T09:16:00.000Z" }),
    ])).toBe(2);
  });
});

describe("countActiveByTitle — kontrak badge kartu ringkasan", () => {
  it("kelompokkan per title_id, abaikan yang sold, abaikan title_id kosong", () => {
    const map = countActiveByTitle([
      A({ id: "1", title_id: "t1", sold_at: null }),
      A({ id: "2", title_id: "t1", sold_at: null }),
      A({ id: "3", title_id: "t1", sold_at: "2026-07-06T09:15:00.000Z" }),
      A({ id: "4", title_id: "t2", sold_at: null }),
      A({ id: "5", title_id: "", sold_at: null }),
    ]);
    expect(map.get("t1")).toBe(2);
    expect(map.get("t2")).toBe(1);
    expect(map.has("")).toBe(false);
  });

  it("title tanpa prep aktif → tidak muncul di map (caller pakai `?? 0`)", () => {
    const map = countActiveByTitle([
      A({ title_id: "t1", sold_at: "2026-07-06T09:15:00.000Z" }),
    ]);
    expect(map.has("t1")).toBe(false);
    expect(map.get("t1") ?? 0).toBe(0);
  });
});

describe("withActivePrepsFilter — chain server-side ke query builder Supabase", () => {
  it("panggil .is('sold_at', null) sekali dan return builder yang sama untuk chaining", () => {
    const is = vi.fn().mockReturnThis();
    const builder = { is } as unknown as { is: typeof is };
    const out = withActivePrepsFilter(builder);
    expect(is).toHaveBeenCalledTimes(1);
    expect(is).toHaveBeenCalledWith("sold_at", null);
    expect(out).toBe(builder);
  });
});

// -----------------------------------------------------------------------
// Guardrail: SEMUA call site badge harus memakai selector, bukan literal.
// -----------------------------------------------------------------------
const readSrc = (rel: string) =>
  readFileSync(resolve(process.cwd(), rel), "utf8");

const CALL_SITES = [
  "src/components/ReadyRequestSection.tsx",
  "src/components/ReadyEcerSection.tsx",
  "src/routes/_authenticated.request.tsx",
  "src/routes/_authenticated.ecer.tsx",
] as const;

describe("Call site badge angka pakai selector tunggal", () => {
  it.each(CALL_SITES)("%s mengimpor helper dari @/lib/prep-active-selector", (path) => {
    const src = readSrc(path);
    expect(src).toMatch(/from\s+["']@\/lib\/prep-active-selector["']/);
  });

  it("ReadyRequestSection: badge pakai countActiveByTitle + withActivePrepsFilter", () => {
    const src = readSrc("src/components/ReadyRequestSection.tsx");
    expect(src).toContain("withActivePrepsFilter(");
    expect(src).toContain("countActiveByTitle(");
    // Literal lama tidak boleh muncul lagi.
    expect(src).not.toMatch(/preps\.filter\([^)]*!\s*p\.sold_at[^)]*\)\.length/);
  });

  it("ReadyEcerSection: query ecer_preparations difilter server-side dan hitung pakai helper", () => {
    const src = readSrc("src/components/ReadyEcerSection.tsx");
    // Query select ecer_preparations WAJIB is("sold_at", null).
    const compact = src.replace(/\s+/g, " ");
    expect(compact).toMatch(
      /\.from\(\s*["']ecer_preparations["']\s*\)[\s\S]*?\.is\(\s*["']sold_at["']\s*,\s*null\s*\)/,
    );
    expect(src).toContain("countActiveByTitle(");
    // Tidak ada lagi countMap manual yang menambah setiap row tanpa cek sold.
    expect(src).not.toMatch(/countMap\.set\(p\.title_id,\s*\(countMap\.get\(p\.title_id\)/);
  });

  it("_authenticated.request.tsx: partisi active/sent pakai helper", () => {
    const src = readSrc("src/routes/_authenticated.request.tsx");
    expect(src).toContain("filterActivePreps(preps)");
    expect(src).toContain("filterSentPreps(preps)");
  });

  it("_authenticated.ecer.tsx: partisi active/sent pakai helper", () => {
    const src = readSrc("src/routes/_authenticated.ecer.tsx");
    expect(src).toContain("filterActivePreps(preps)");
    expect(src).toContain("filterSentPreps(preps)");
  });
});
