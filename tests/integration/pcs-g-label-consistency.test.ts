/**
 * Guard konsistensi label & pesan validasi antara mode `base_unit === "pcs"`
 * dan `base_unit === "g"` di seluruh permukaan input yang aktif dipakai di
 * layar 411/390px (halaman penyiapan foto `/tugas` dan panel Ecer di
 * `ReadyPackagesPanel`). Tes ini bersifat statik — membaca sumber lalu
 * meng-assert string kanonik hadir — jadi tidak memerlukan browser/e2e dan
 * tetap valid untuk kedua breakpoint karena copy tak berubah oleh CSS.
 *
 * Alasan pendekatan snapshot-string, bukan render:
 * - `evaluateLine` & derivasi label (perUnitLabel/perUnitPlaceholder) di
 *   `_authenticated.tugas.tsx` bersifat lokal (tidak diekspor). Menariknya
 *   ke unit test butuh refactor besar; sementara aturan copy-nya sudah
 *   final.
 * - Playwright e2e untuk `/tugas` butuh sesi auth + data barang campuran
 *   (pcs + g), yang mahal untuk CI dan rentan flaky di 411/390px.
 *
 * Kalau salah satu string di bawah berubah, edit tes ini SEKALIGUS
 * memperbarui SEMUA permukaan (tugas summary, badge baris, placeholder,
 * helper text) supaya tetap sinkron.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const TUGAS = read("src/routes/_authenticated.tugas.tsx");
const READY_PANEL = read("src/components/ReadyPackagesPanel.tsx");

describe("konsistensi label pcs vs g — halaman penyiapan foto (/tugas)", () => {
  it("label kolom kanan pakai 'Jumlah / isi' untuk pcs dan 'Berat / unit' untuk g", () => {
    expect(TUGAS).toContain(`const perUnitLabel = isPcs ? "Jumlah / isi" : "Berat / unit";`);
  });

  it("placeholder input manual pakai '(pcs)' untuk pcs", () => {
    expect(TUGAS).toContain(`const perUnitPlaceholder = isPcs ? "isi manual (pcs)" : "isi manual";`);
  });

  it("helper teks mode manual membedakan 'jumlah/isi' vs 'berat'", () => {
    expect(TUGAS).toContain(`"Manual — isi jumlah/isi di kolom kanan"`);
    expect(TUGAS).toContain(`"Manual — isi berat di kolom kanan"`);
  });

  it("ringkasan 'Siap dikirim' menampilkan prefix 'Berat / unit' dan 'Jumlah / isi'", () => {
    // Cover skenario campuran: kedua prefix wajib ada di file.
    expect(TUGAS).toMatch(/Berat \/ unit\s*<\/span>/);
    expect(TUGAS).toMatch(/Jumlah \/ isi\s*<\/span>/);
  });
});

describe("konsistensi pesan validasi pcs vs g — evaluateLine", () => {
  it("pcs: pesan 'bilangan bulat' menyebut '(pcs)' bukan 'unit'", () => {
    expect(TUGAS).toContain(`"Jumlah / isi (pcs) harus bilangan bulat"`);
    // Jaga agar copy lama tidak muncul kembali.
    expect(TUGAS).not.toContain("Jumlah / unit harus bilangan bulat untuk item pcs");
  });

  it("pcs: pesan 'melebihi batas' pakai frasa 'Jumlah / isi (pcs)'", () => {
    expect(TUGAS).toMatch(/Jumlah \/ isi \(pcs\) melebihi batas \(\$\{MAX_PER_UNIT_PCS\}\)/);
    expect(TUGAS).not.toMatch(/Jumlah \/ unit melebihi batas \(\$\{MAX_PER_UNIT_PCS\}\)/);
  });

  it("g: pesan 'melebihi batas' pakai frasa 'Berat / unit (g)'", () => {
    expect(TUGAS).toMatch(/Berat \/ unit \(g\) melebihi batas \(\$\{MAX_PER_UNIT_G\} g\)/);
  });
});

describe("konsistensi label pcs vs g — ReadyPackagesPanel (Ecer)", () => {
  it("placeholder input preset pakai 'Isi (pcs)' untuk pcs, 'Berat (...)' untuk g", () => {
    expect(READY_PANEL).toContain(`? "Isi (pcs)"`);
    expect(READY_PANEL).toMatch(/`Berat \(\$\{item\.base_unit === "g" \? ecerUnit : item\.base_unit\}\)`/);
  });

  it("label 'Jumlah' kolom pcs berubah jadi 'Jumlah / isi'", () => {
    expect(READY_PANEL).toContain(`item.base_unit === "pcs" ? "Jumlah / isi" : "Jumlah"`);
  });

  it("contoh helper text preset membedakan pcs (isi) vs g (berat)", () => {
    expect(READY_PANEL).toMatch(/label <b>1P<\/b> isi <b>1<\/b> pcs/);
    expect(READY_PANEL).toMatch(/label <b>1G<\/b> berat <b>0\.90<\/b>/);
  });
});

describe("guard viewport 411/390px — copy tidak boleh dipangkas per breakpoint", () => {
  it("tidak ada varian ringkasan yang menyembunyikan salah satu prefix via kelas responsif", () => {
    // Larangan: <span class="... sm:hidden ...">Berat / unit</span> atau semacamnya
    // yang membuat label hilang di 411/390px. Kalau perlu memangkas nanti,
    // update tes ini secara sadar.
    const forbidden = [
      /sm:hidden[^"']*"[^>]*>\s*Berat \/ unit/,
      /sm:hidden[^"']*"[^>]*>\s*Jumlah \/ isi/,
      /max-sm:hidden[^"']*"[^>]*>\s*Berat \/ unit/,
      /max-sm:hidden[^"']*"[^>]*>\s*Jumlah \/ isi/,
    ];
    for (const re of forbidden) {
      expect(TUGAS).not.toMatch(re);
    }
  });
});