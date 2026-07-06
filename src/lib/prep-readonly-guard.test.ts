import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guardrail: paket berstatus Riwayat Terkirim (sold_at != null) harus
 * benar-benar read-only. Bukan hanya menyembunyikan tombol Siapkan / Edit /
 * Kirim / Hapus, tapi juga memblokir eksekusi handler-nya di sumber
 * sehingga jalur alternatif (keyboard shortcut, state stale, race)
 * tidak bisa mengubah status kotak yang sudah sold.
 *
 * Test ini bekerja di level source-invariant (regex) supaya tidak butuh
 * mount penuh route/Supabase/router mocks. Jika seseorang menghapus salah
 * satu guard, test akan gagal dengan pesan yang jelas.
 */

const REQUEST_SRC = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated.request.tsx"),
  "utf8",
);
const ECER_SRC = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated.ecer.tsx"),
  "utf8",
);

const compact = (s: string) => s.replace(/\s+/g, " ");
const REQUEST = compact(REQUEST_SRC);
const ECER = compact(ECER_SRC);

describe("Request PrepCard — Kirim & Hapus tidak render/eksekusi saat sold", () => {
  it("mendeklarasikan `const sold = !!prep.sold_at`", () => {
    expect(REQUEST_SRC).toMatch(/const sold\s*=\s*!!prep\.sold_at/);
  });

  it("tombol Kirim hanya dirender di cabang !sold, bukan di sold", () => {
    // Ternary: {!sold ? ( <button …Kirim… </button> ) : ( <span …Terkirim… </span> )}
    expect(REQUEST).toMatch(
      /\{\s*!sold\s*\?\s*\(\s*<button\b[\s\S]*?Kirim\s*<\/button>\s*\)\s*:\s*\(\s*<span\b[\s\S]*?Terkirim/,
    );
  });

  it("tombol Hapus (Trash2) dibungkus {!sold && ...}", () => {
    expect(REQUEST).toMatch(
      /\{\s*!sold\s*&&\s*\(\s*<button[\s\S]*?aria-label="Hapus penyiapan"[\s\S]*?<Trash2/,
    );
  });

  it("SendPrepToCustomerDialog hanya di-mount saat !sold (blok jalur kirim ulang)", () => {
    expect(REQUEST).toMatch(
      /\{\s*!sold\s*&&\s*\(\s*<SendPrepToCustomerDialog\b/,
    );
  });

  it("kartu memiliki aria-readonly & data-readonly saat sold", () => {
    expect(REQUEST).toMatch(/aria-readonly=\{sold\s*\|\|\s*undefined\}/);
    expect(REQUEST).toMatch(/data-readonly=\{sold\s*\?\s*"true"\s*:\s*undefined\}/);
  });
});

describe("Request renderCard — guardedDelete/guardedSent memblokir aksi saat Riwayat Terkirim", () => {
  it("menghitung isReadOnly = inSent || !!p.sold_at sebagai sumber kebenaran", () => {
    expect(REQUEST_SRC).toMatch(
      /const isReadOnly\s*=\s*inSent\s*\|\|\s*!!p\.sold_at/,
    );
  });

  it("guardedDelete: if (isReadOnly) → toast.error + return SEBELUM onDelete", () => {
    expect(REQUEST).toMatch(
      /const guardedDelete\s*=\s*\(\s*\)\s*=>\s*\{\s*if\s*\(\s*isReadOnly\s*\)\s*\{\s*toast\.error\([^)]*Riwayat Terkirim[^)]*\)\s*;\s*return\s*;\s*\}\s*onDelete\(p\)/,
    );
  });

  it("guardedSent: if (isReadOnly) → toast.error + return SEBELUM setShowHistory", () => {
    expect(REQUEST).toMatch(
      /const guardedSent\s*=\s*\(\s*\)\s*=>\s*\{\s*if\s*\(\s*isReadOnly\s*\)\s*\{\s*toast\.error\([^)]*Riwayat Terkirim[^)]*\)\s*;\s*return\s*;\s*\}\s*setShowHistory\(true\)/,
    );
  });

  it("PrepCard menerima handler yang sudah dibungkus guard", () => {
    expect(REQUEST).toMatch(/onDelete=\{guardedDelete\}[\s\S]*?onSent=\{guardedSent\}/);
  });
});

describe("Ecer PrepBox — Edit/Hapus tidak render & onDelete diblokir saat sold", () => {
  it("mendeklarasikan sold = !!prep.sold_at dan readOnly = sold", () => {
    expect(ECER_SRC).toMatch(/const sold\s*=\s*!!prep\.sold_at/);
    expect(ECER_SRC).toMatch(/const readOnly\s*=\s*sold/);
  });

  it("tombol Edit (Edit3) dan Hapus (Trash2) dibungkus {!readOnly && (<>...</>)}", () => {
    expect(ECER).toMatch(
      /\{\s*!readOnly\s*&&\s*\(\s*<>[\s\S]*?<Edit3[\s\S]*?<Trash2[\s\S]*?<\/>\s*\)\s*\}/,
    );
  });

  it("selection-mode click handler dinonaktifkan saat readOnly", () => {
    expect(ECER).toMatch(/onClick=\{\s*selectionMode\s*&&\s*!readOnly\s*\?/);
  });

  it("onDelete: guard if (readOnly) → toast.error + return SEBELUM hapus", () => {
    expect(ECER).toMatch(
      /async function onDelete\(\)\s*\{\s*if\s*\(\s*readOnly\s*\)\s*\{\s*toast\.error\([^)]*Riwayat Terkirim[^)]*\)\s*;\s*return\s*;\s*\}/,
    );
  });

  it("kartu memiliki aria-readonly saat sold", () => {
    expect(ECER).toMatch(/aria-readonly=\{readOnly\s*\|\|\s*undefined\}/);
  });
});

describe("ReadyRequestSection — badge angka hanya menghitung yang belum sold", () => {
  it("query request_preparations memfilter sold_at IS NULL & count !sold_at", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/ReadyRequestSection.tsx"),
      "utf8",
    );
    // .from("request_preparations").select("…sold_at…").is("sold_at", null)
    expect(src).toMatch(
      /\.from\(\s*["']request_preparations["']\s*\)\s*\.select\([^)]*sold_at[^)]*\)\s*\.is\(\s*["']sold_at["']\s*,\s*null\s*\)/,
    );
    // Hitung prep_count hanya dari preps yang !sold_at (badge angka).
    expect(src).toMatch(/preps\.filter\([\s\S]*?!\s*p\.sold_at[\s\S]*?\)\.length/);
  });
});
