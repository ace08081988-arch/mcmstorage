import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guardrail: banner fallback (prefillFallback) di /tugas-baru WAJIB
 * menyediakan link "kembali ke Ecer" yang:
 *   1. Mengarah ke rute `/ecer` (bukan hash/anchor, bukan /ecer/xxx).
 *   2. Tidak meneruskan search param invalid (title_id / title_id_invalid)
 *      — supaya /ecer dibuka bersih, bukan membawa state rusak.
 *   3. Tersedia untuk kedua reason fallback: "invalid" & "not_found".
 *   4. Ada di dalam elemen banner `data-testid="tugas-baru-prefill-fallback"`.
 *
 * Tanpa test ini, regresi (mis. mengubah `to="/ecer"` jadi
 * `to="/ecer/$id"`, menambah `search={{ title_id: … }}`, atau menghapus
 * link) bisa membuat owner terjebak di form tanpa jalur balik.
 */
const src = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated.tugas-baru.tsx"),
  "utf8",
);

/** Ambil blok JSX banner fallback: dari `{prefillFallback ?` s/d penutupnya. */
function extractFallbackBanner(source: string): string {
  const testid = 'data-testid="tugas-baru-prefill-fallback"';
  const anchor = source.indexOf(testid);
  expect(anchor, "banner fallback tidak ditemukan").toBeGreaterThan(-1);
  const start = source.lastIndexOf("{prefillFallback", anchor);
  const end = source.indexOf(": null}", anchor);
  expect(start, "pembuka blok fallback tidak ditemukan").toBeGreaterThan(-1);
  expect(end, "penutup blok fallback tidak ditemukan").toBeGreaterThan(-1);
  return source.slice(start, end + ": null}".length);
}

describe("tugas-baru: banner fallback → link balik ke /ecer", () => {
  const block = extractFallbackBanner(src);

  it("banner memuat <Link to=\"/ecer\"> ke rute Ecer utama", () => {
    expect(block).toMatch(/<Link\s+to="\/ecer"/);
  });

  it("link balik TIDAK membawa search param (state invalid tidak diteruskan)", () => {
    // Cari fragmen <Link to="/ecer" ...> lalu pastikan tidak ada `search=` sampai `>`.
    const linkMatch = block.match(/<Link\s+to="\/ecer"[^>]*>/);
    expect(linkMatch, "tag <Link to=\"/ecer\"> tidak ditemukan").not.toBeNull();
    expect(linkMatch![0]).not.toMatch(/\bsearch\s*=/);
    expect(linkMatch![0]).not.toMatch(/title_id/);
  });

  it("teks link berbunyi 'kembali ke Ecer' (label jelas untuk owner)", () => {
    expect(block).toMatch(/<Link\s+to="\/ecer"[^>]*>\s*kembali ke Ecer\s*<\/Link>/);
  });

  it("banner menangani kedua reason: 'invalid' & 'not_found'", () => {
    expect(block).toMatch(/prefillFallback\.reason\s*===\s*"invalid"/);
    // Ada satu link balik yang dipakai bersama kedua reason (di luar ternary).
    const linkCount = (block.match(/<Link\s+to="\/ecer"/g) ?? []).length;
    expect(linkCount).toBe(1);
  });

  it("link balik berada di dalam banner ber-data-testid fallback", () => {
    const testidIdx = block.indexOf('data-testid="tugas-baru-prefill-fallback"');
    const linkIdx = block.indexOf('<Link to="/ecer"');
    expect(testidIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(testidIdx);
  });
});
