import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guardrail: saat `visibleShots.length === 0` (belum ada kiriman pegawai),
 * tombol hijau di header kartu "Kiriman pegawai" WAJIB berubah jadi
 * navigasi ke halaman tugas pegawai — BUKAN memanggil `sendWA`.
 *
 *   - linkedTask.share_token ada     → <Link to="/tugas"> "Tugas pegawai"
 *   - linkedTask.share_token kosong  → <Link to="/tugas-baru"
 *                                        search={{ title_id: title.id }}>
 *                                        "Buat tugas pegawai"
 *
 * Tanpa test ini, regresi ke tombol "Kirim WA" generik bisa masuk lagi
 * dan owner kehilangan jalur cepat ke tugas pegawai.
 */
const src = readFileSync(
  resolve(process.cwd(), "src/routes/_authenticated.ecer.tsx"),
  "utf8",
);

/** Ambil blok JSX <Button ...>…</Button> yang berisi cabang navigasi tugas. */
function extractSendButtonBlock(source: string): string {
  const anchor = source.indexOf("Buat tugas pegawai");
  expect(anchor, "Label 'Buat tugas pegawai' tidak ditemukan").toBeGreaterThan(-1);
  const start = source.lastIndexOf("<Button", anchor);
  const end = source.indexOf("</Button>", anchor);
  expect(start, "Opening <Button> tidak ditemukan").toBeGreaterThan(-1);
  expect(end, "Closing </Button> tidak ditemukan").toBeGreaterThan(-1);
  return source.slice(start, end + "</Button>".length);
}

describe("ecer: tombol kirim → navigasi tugas pegawai saat kiriman kosong", () => {
  const block = extractSendButtonBlock(src);

  it("onClick tombol tidak memanggil sendWA saat visibleShots kosong", () => {
    // Handler dijaga: ketika kosong `undefined`, ketika ada baru `sendWA`.
    expect(block).toMatch(
      /onClick=\{\s*visibleShots\.length\s*===\s*0\s*\?\s*undefined\s*:\s*sendWA\s*\}/,
    );
  });

  it("asChild aktif saat kosong supaya <Link> jadi target klik", () => {
    expect(block).toMatch(/asChild=\{\s*visibleShots\.length\s*===\s*0\s*\}/);
  });

  it("cabang kosong: pilih <Link to='/tugas'> vs <Link to='/tugas-baru'> berdasarkan linkedTask.share_token", () => {
    // Ternary luar berbasis visibleShots.length === 0.
    expect(block).toMatch(/visibleShots\.length\s*===\s*0\s*\?/);
    // Cabang ada tugas terhubung → /tugas.
    expect(block).toMatch(
      /linkedTask\?\.share_token\s*\?\s*\(\s*<Link\s+to="\/tugas"/,
    );
    expect(block).toMatch(/>\s*Tugas pegawai\s*</);
    // Cabang belum terhubung → /tugas-baru dengan title_id.
    expect(block).toMatch(
      /<Link\s+to="\/tugas-baru"\s+search=\{\{\s*title_id:\s*title\.id\s*\}\}\s*>/,
    );
    expect(block).toMatch(/>\s*Buat tugas pegawai\s*</);
  });

  it("cabang ada kiriman: tetap tombol 'Kirim WA' (tidak boleh regresi)", () => {
    expect(block).toMatch(/>\s*Kirim WA\s*</);
  });

  it("aria-label ikut berubah menjelaskan navigasi tugas saat kosong", () => {
    expect(block).toMatch(
      /visibleShots\.length\s*===\s*0[\s\S]{0,120}?Buka tugas pegawai untuk judul ini/,
    );
  });
});
