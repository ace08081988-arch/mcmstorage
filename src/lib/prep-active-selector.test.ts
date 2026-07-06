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
  __resetPrepActiveMemoForTest,
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
    // Query select ecer_preparations WAJIB melewati withActivePrepsFilter,
    // BUKAN literal .is("sold_at", null) ad-hoc (dilarang juga oleh
    // ESLint no-restricted-syntax).
    const compact = src.replace(/\s+/g, " ");
    expect(compact).toMatch(
      /withActivePrepsFilter\(\s*sb\.from\(\s*["']ecer_preparations["']/,
    );
    expect(src).not.toMatch(/\.is\(\s*["']sold_at["']\s*,\s*null\s*\)/);
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

// -----------------------------------------------------------------------
// Audit: tidak ada lagi literal `!!x.sold_at` / `!x.sold_at` sebagai
// predikat sent/active di komponen atau route. Semua HARUS lewat helper.
// -----------------------------------------------------------------------
describe("Audit literal !!.sold_at / !.sold_at di call site", () => {
  const AUDITED = [
    "src/components/ReadyRequestSection.tsx",
    "src/components/ReadyEcerSection.tsx",
    "src/routes/_authenticated.request.tsx",
    "src/routes/_authenticated.ecer.tsx",
    "src/lib/prep-readonly-guard.ts",
  ] as const;

  it.each(AUDITED)("%s tidak memakai !!x.sold_at sebagai predikat", (path) => {
    const src = readSrc(path);
    // Cari pola `!!<ident>.sold_at` di mana pun — regex ini melarang
    // pemakaian sebagai boolean, bukan pembacaan nilai (mis. formatWhen).
    const bad = src.match(/!!\s*[A-Za-z_$][\w$]*\.sold_at\b/g);
    expect(bad, `${path} masih memakai literal !!.sold_at: ${bad?.join(", ")}`).toBeNull();
  });

  it.each(AUDITED)("%s tidak memakai !x.sold_at sebagai predikat", (path) => {
    const src = readSrc(path);
    // Batasi: `!<ident>.sold_at` dalam konteks predikat (diikuti spasi/tanda
    // logika / paren tutup). Hindari false positive pada `!== null`.
    const bad = src.match(/(?<![=!])!\s*[A-Za-z_$][\w$]*\.sold_at\s*(?=[)&|?,\s])/g);
    expect(bad, `${path} masih memakai literal !.sold_at: ${bad?.join(", ")}`).toBeNull();
  });
});

// -----------------------------------------------------------------------
// Memoization: hasil turunan dipakai ulang selama referensi array sama.
// -----------------------------------------------------------------------
import { beforeEach } from "vitest";

describe("Memoization selector — referensi array sebagai kunci cache", () => {
  beforeEach(() => __resetPrepActiveMemoForTest());

  it("countActiveByTitle: Map identik secara referensi untuk preps yang sama", () => {
    const preps = [
      A({ id: "1", title_id: "t1", sold_at: null }),
      A({ id: "2", title_id: "t1", sold_at: null }),
      A({ id: "3", title_id: "t2", sold_at: null }),
    ];
    const first = countActiveByTitle(preps);
    const second = countActiveByTitle(preps);
    // Referensi identik → downstream memo/useEffect tak menganggapnya
    // berubah → tidak ada re-render berlebih.
    expect(second).toBe(first);
  });

  it("filterActivePreps / filterSentPreps stabil per referensi array", () => {
    const preps = [
      A({ id: "1", sold_at: null }),
      A({ id: "2", sold_at: "2026-07-06T09:15:00.000Z" }),
    ];
    expect(filterActivePreps(preps)).toBe(filterActivePreps(preps));
    expect(filterSentPreps(preps)).toBe(filterSentPreps(preps));
  });

  it("countActivePreps memoized per referensi (bukti cache dipakai)", () => {
    const preps = [A({ sold_at: null }), A({ sold_at: null }), A({ sold_at: "x" })];
    const a = countActivePreps(preps);
    // Mutasi in-place: konsumen selector tidak diijinkan melakukan ini di
    // produksi (state React selalu bikin array baru), tapi di sini menjadi
    // sentinel bahwa panggilan kedua BENAR-BENAR hit cache alih-alih
    // menghitung ulang.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (preps[2] as any).sold_at = null;
    const b = countActivePreps(preps);
    expect(a).toBe(2);
    expect(b).toBe(2);
  });

  it("array baru (referensi berbeda) → hitung ulang", () => {
    const p1 = [A({ title_id: "t1", sold_at: null })];
    const p2 = [
      A({ title_id: "t1", sold_at: null }),
      A({ title_id: "t1", sold_at: null }),
    ];
    expect(countActiveByTitle(p1).get("t1")).toBe(1);
    expect(countActiveByTitle(p2).get("t1")).toBe(2);
  });

  it("cache per-fungsi: countActiveByTitle tidak mengotori cache filter", () => {
    const preps = [A({ id: "1", sold_at: null }), A({ id: "2", sold_at: "x" })];
    countActiveByTitle(preps);
    const active = filterActivePreps(preps);
    expect(active.map((p) => p.id)).toEqual(["1"]);
  });

  it("__resetPrepActiveMemoForTest membuang referensi lama", () => {
    const preps = [A({ title_id: "t1", sold_at: null })];
    const first = countActiveByTitle(preps);
    __resetPrepActiveMemoForTest();
    const afterReset = countActiveByTitle(preps);
    // Nilai sama, tapi Map baru — bukti cache di-flush.
    expect(afterReset).not.toBe(first);
    expect(afterReset.get("t1")).toBe(first.get("t1"));
  });
});
