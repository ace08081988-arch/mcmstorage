import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReadOnlyToast, describeSoldStatus } from "./prep-readonly-guard";

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
  it("mendeklarasikan `const sold = isSentPrep(prep)` (SSOT)", () => {
    // Definisi "sent" hanya boleh diambil dari selector — bukan literal
    // `!!prep.sold_at`. Ini mengunci audit refactor: kalau ada yang
    // menulis balik literalnya, test gagal.
    expect(REQUEST_SRC).toMatch(/const sold\s*=\s*isSentPrep\(prep\)/);
    expect(REQUEST_SRC).not.toMatch(/const sold\s*=\s*!!prep\.sold_at/);
  });

  it("tombol Kirim hanya dirender di cabang !sold, bukan di sold", () => {
    // Ternary: {!sold ? ( <button …Kirim… </button> ) : ( <>…<span …Terkirim… )}
    expect(REQUEST).toMatch(
      /\{\s*!sold\s*\?\s*\(\s*<button\b[\s\S]*?Kirim\s*<\/button>\s*\)\s*:\s*\(\s*(?:<>\s*)?<span\b[\s\S]*?Terkirim/,
    );
  });

  it("tombol Hapus tetap tersedia saat sold, dengan label arsip", () => {
    // Produk: arsip Terkirim HARUS bisa dihapus (permintaan user), jadi
    // tombol tidak lagi disembunyikan — hanya labelnya yang berubah dan
    // dialog konfirmasi menjelaskan konsekuensinya.
    expect(REQUEST).toMatch(
      /aria-label=\{sold\s*\?\s*"Hapus arsip penyiapan"\s*:\s*"Hapus penyiapan"\}/,
    );
    expect(REQUEST).toMatch(/deleteTargetSold\s*\?\s*"Hapus arsip terkirim\?"/);
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
  it("menghitung isReadOnly = inSent || isSentPrep(p) sebagai sumber kebenaran", () => {
    expect(REQUEST_SRC).toMatch(
      /const isReadOnly\s*=\s*inSent\s*\|\|\s*isSentPrep\(p\)/,
    );
    expect(REQUEST_SRC).not.toMatch(/const isReadOnly\s*=\s*inSent\s*\|\|\s*!!p\.sold_at/);
  });

  it("guardedDelete meneruskan ke onDelete (hapus arsip diizinkan)", () => {
    expect(REQUEST).toMatch(
      /const guardedDelete\s*=\s*\(\s*\)\s*=>\s*\{\s*onDelete\(p\)\s*;\s*\}/,
    );
  });

  it("guardedSent: if (isReadOnly) → toast.error + return SEBELUM setShowHistory", () => {
    expect(REQUEST).toMatch(
      /const guardedSent\s*=\s*\(\s*\)\s*=>\s*\{\s*if\s*\(\s*isReadOnly\s*\)\s*\{[\s\S]*?buildReadOnlyToast\(\s*["']resend["']\s*,\s*p\s*\)[\s\S]*?toast\.error\([\s\S]*?description[\s\S]*?\)\s*;\s*return\s*;\s*\}\s*setShowHistory\(true\)/,
    );
  });

  it("PrepCard menerima handler yang sudah dibungkus guard", () => {
    expect(REQUEST).toMatch(/onDelete=\{guardedDelete\}[\s\S]*?onSent=\{guardedSent\}/);
  });
});

describe("Ecer PrepBox — Edit/Hapus tidak render & onDelete diblokir saat sold", () => {
  it("mendeklarasikan sold = isSentPrep(prep) dan readOnly = sold", () => {
    expect(ECER_SRC).toMatch(/const sold\s*=\s*isSentPrep\(prep\)/);
    expect(ECER_SRC).toMatch(/const readOnly\s*=\s*sold/);
    expect(ECER_SRC).not.toMatch(/const sold\s*=\s*!!prep\.sold_at/);
  });

  it("tombol Edit (Edit3) dan Hapus (Trash2) dibungkus {!readOnly && (<>...</>)}", () => {
    expect(ECER).toMatch(
      /\{\s*!readOnly\s*&&\s*\(\s*<>[\s\S]*?<Edit3[\s\S]*?<Trash2[\s\S]*?<\/>\s*\)\s*\}/,
    );
  });

  it("selection-mode click handler dinonaktifkan saat readOnly", () => {
    expect(ECER).toMatch(/onClick=\{\s*selectionMode\s*&&\s*!readOnly\s*\?/);
  });

  it("onDelete membuka dialog konfirmasi, dengan salinan khusus arsip", () => {
    // Hapus arsip Terkirim diizinkan; pengamannya dialog konfirmasi.
    expect(ECER).toMatch(
      /async function onDelete\(\)\s*\{\s*setDeleteStep\("idle"\)\s*;\s*setDeleteOpen\(true\)\s*;\s*\}/,
    );
    expect(ECER).toMatch(/readOnly\s*\?\s*"Hapus arsip terkirim\?"/);
  });

  it("kartu memiliki aria-readonly saat sold", () => {
    expect(ECER).toMatch(/aria-readonly=\{readOnly\s*\|\|\s*undefined\}/);
  });
});

describe("ReadyRequestSection — badge angka hanya menghitung yang belum sold", () => {
  it("badge memakai selector tunggal (withActivePrepsFilter + countActiveByTitle)", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/ReadyRequestSection.tsx"),
      "utf8",
    );
    // Filter server-side lewat helper (bukan literal .is("sold_at", null)).
    expect(src).toMatch(
      /withActivePrepsFilter\(\s*sb\.from\(\s*["']request_preparations["']\s*\)[\s\S]*?\)\s*,?\s*\n/,
    );
    // Badge dibaca dari Map yang dibangun helper, bukan filter ad-hoc.
    expect(src).toContain("countActiveByTitle(");
    expect(src).toMatch(/activeCountByTitle\.get\(t\.id\)\s*\?\?\s*0/);
  });
});

// -----------------------------------------------------------------------
// Unit test isi pesan toast — pastikan alasan aksi + status paket
// (metode bayar, nominal, pelanggan, tanggal) benar-benar disebutkan.
// -----------------------------------------------------------------------
describe("describeSoldStatus — ringkas status paket sold", () => {
  it("kembalikan null bila paket belum sold (guard salah dipanggil)", () => {
    expect(describeSoldStatus({ sold_at: null })).toBeNull();
    expect(describeSoldStatus({})).toBeNull();
  });

  it("Lunas (kas) → sebut 'Lunas', nominal, pelanggan, dan waktu", () => {
    const s = describeSoldStatus({
      sold_at: "2026-07-06T09:15:00.000Z",
      sold_payment_method: "kas",
      sold_total: 125000,
      sold_party_name: "Bu Rina",
    });
    expect(s).not.toBeNull();
    expect(s).toContain("Lunas");
    expect(s).toMatch(/125\.000|125,000/); // rupiah id-ID
    expect(s).toContain("ke Bu Rina");
  });

  it("Piutang (hutang) → sebut 'Piutang' dan total", () => {
    const s = describeSoldStatus({
      sold_at: "2026-07-06T09:15:00.000Z",
      sold_payment_method: "hutang",
      sold_total: 90000,
      sold_party_name: "Pak Andi",
    });
    expect(s).toContain("Piutang");
    expect(s).toMatch(/90\.000|90,000/);
    expect(s).toContain("ke Pak Andi");
  });

  it("Bayar sebagian → tampilkan dibayar, total, DAN sisa piutang", () => {
    const s = describeSoldStatus({
      sold_at: "2026-07-06T09:15:00.000Z",
      sold_payment_method: "partial",
      sold_total: 200000,
      sold_paid_amount: 75000,
      sold_party_name: "Toko Sinar",
    });
    expect(s).toContain("Bayar sebagian");
    expect(s).toMatch(/dibayar/i);
    expect(s).toMatch(/75\.000|75,000/);
    expect(s).toMatch(/200\.000|200,000/);
    // Sisa = 200k - 75k = 125k
    expect(s).toMatch(/sisa piutang/i);
    expect(s).toMatch(/125\.000|125,000/);
  });

  it("tanpa nominal → tetap sebut label metode (fallback 'Terkirim')", () => {
    const s = describeSoldStatus({ sold_at: "2026-07-06T09:15:00.000Z" });
    expect(s).toContain("Terkirim");
  });
});

describe("buildReadOnlyToast — pesan aksi ditolak", () => {
  const sold = {
    sold_at: "2026-07-06T09:15:00.000Z",
    sold_payment_method: "partial" as const,
    sold_total: 200000,
    sold_paid_amount: 75000,
    sold_party_name: "Toko Sinar",
  };

  it("delete: title menyebut 'Riwayat Terkirim' + kata kerja 'menghapus'", () => {
    const t = buildReadOnlyToast("delete", sold);
    expect(t.title).toContain("Riwayat Terkirim");
    expect(t.title).toContain("menghapus");
  });

  it("resend: kata kerja 'mengirim ulang'", () => {
    const t = buildReadOnlyToast("resend", sold);
    expect(t.title).toContain("mengirim ulang");
  });

  it("edit: kata kerja 'mengubah'", () => {
    const t = buildReadOnlyToast("edit", sold);
    expect(t.title).toContain("mengubah");
  });

  it("description memuat status saat ini (metode, nominal, pelanggan)", () => {
    const t = buildReadOnlyToast("delete", sold);
    expect(t.description).toBeTruthy();
    expect(t.description!).toMatch(/Status saat ini/i);
    expect(t.description!).toContain("Bayar sebagian");
    expect(t.description!).toContain("Toko Sinar");
  });

  it("description undefined bila paket belum sold (fallback pesan judul saja)", () => {
    const t = buildReadOnlyToast("delete", { sold_at: null });
    expect(t.description).toBeUndefined();
  });
});
