// E2E: catatan pelanggan tidak boleh terduplikasi di pesan WA saat
// pengguna mengubah nilainya, batal, atau membuka kembali dialog
// konfirmasi.
//
// Skenario yang ditutup:
//   1. Edit → send: hanya nilai terakhir yang muncul, tidak berlapis.
//   2. Ganti metode berkali-kali sambil isi catatan: tetap satu baris.
//   3. Cancel lalu buka lagi: field catatan kosong (tidak "kotor"),
//      dan setelah send hanya satu baris "Catatan:".
//   4. Kirim item A, buka dialog item B: catatan A tidak bocor;
//      pesan terakhir hanya menampilkan catatan item B (atau kosong).
//   5. Catatan yang secara literal berisi teks "Catatan: ..." di dalamnya
//      tetap hanya menghasilkan SATU baris yang diawali "Catatan:"
//      (prefix hanya ditambahkan sekali oleh formatter).
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

function countCatatanLines(msg: string): number {
  return msg.split("\n").filter((l) => /^Catatan:/.test(l)).length;
}

test.describe("Catatan pelanggan tidak dobel di pesan WA", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Edit catatan berkali-kali lalu kirim: hanya nilai terakhir yang muncul", async ({ page }) => {
    await page.getByTestId("send-wa-ep1").click();
    const noteInput = page.getByTestId("payment-note-ecer");

    await noteInput.fill("draft awal");
    await noteInput.fill("revisi kedua");
    await noteInput.fill("catatan final");
    await expect(noteInput).toHaveValue("catatan final");

    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(countCatatanLines(msg)).toBe(1);
    expect(msg).toContain("Catatan: catatan final");
    expect(msg).not.toContain("draft awal");
    expect(msg).not.toContain("revisi kedua");
  });

  test("Ganti metode berkali-kali sambil isi catatan: tetap satu baris", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    await page.getByTestId("payment-note-request").fill("kirim sore");

    // Toggle beberapa metode — state note dipertahankan, tidak ditumpuk.
    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-request").fill("3000");
    await page.getByTestId("payment-method-kas").click();

    await expect(page.getByTestId("payment-note-request")).toHaveValue("kirim sore");
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatanLines(msg)).toBe(1);
    expect(msg).toContain("Catatan: kirim sore");
  });

  test("Cancel lalu buka lagi: field catatan reset kosong; pesan berikutnya hanya satu baris", async ({ page }) => {
    // Buka pertama, isi lalu Batal.
    await page.getByTestId("send-wa-ep2").click();
    await page.getByTestId("payment-note-ecer").fill("dibatalkan");
    await page.getByTestId("payment-cancel").click();
    await expect(page.getByTestId("payment-dialog-ecer")).toHaveCount(0);

    // Buka lagi untuk prep yang sama — field harus kosong lagi.
    await page.getByTestId("send-wa-ep2").click();
    await expect(page.getByTestId("payment-note-ecer")).toHaveValue("");

    await page.getByTestId("payment-note-ecer").fill("catatan baru");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(countCatatanLines(msg)).toBe(1);
    expect(msg).toContain("Catatan: catatan baru");
    expect(msg).not.toContain("dibatalkan");
  });

  test("Kirim item A → buka dialog item B: catatan A tidak bocor ke pesan/dialog B", async ({ page }) => {
    // Item A (rp1) dengan catatan A.
    await page.getByTestId("send-wa-rp1").click();
    await page.getByTestId("payment-note-request").fill("catatan A");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    let msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatanLines(msg)).toBe(1);
    expect(msg).toContain("Catatan: catatan A");

    // Item B (rp2) — field harus kosong.
    await page.getByTestId("send-wa-rp2").click();
    await expect(page.getByTestId("payment-note-request")).toHaveValue("");

    // Kirim tanpa isi catatan.
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatanLines(msg)).toBe(0);
    expect(msg).not.toContain("catatan A");

    // Item C (rp4) dengan catatan B — hanya baris B yang muncul.
    await page.getByTestId("send-wa-rp4").click();
    await expect(page.getByTestId("payment-note-request")).toHaveValue("");
    await page.getByTestId("payment-note-request").fill("catatan B");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(countCatatanLines(msg)).toBe(1);
    expect(msg).toContain("Catatan: catatan B");
    expect(msg).not.toContain("catatan A");
  });

  test("Catatan yang berisi teks 'Catatan:' di dalamnya tetap menghasilkan satu prefix", async ({ page }) => {
    await page.getByTestId("send-wa-ep4").click();
    // Nilai note-nya sendiri mengandung substring "Catatan:" — regresi
    // klasik kalau prefix formatter dipakai untuk mendeteksi duplikasi.
    const trickyNote = "Catatan: mohon konfirmasi ulang, terima kasih";
    await page.getByTestId("payment-note-ecer").fill(trickyNote);
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    // Hanya SATU baris yang diawali "Catatan:" (yang ditambahkan
    // formatter). Substring "Catatan:" di dalam nilai note tidak
    // memulai baris baru karena user tidak mengetik newline.
    expect(countCatatanLines(msg)).toBe(1);
    expect(msg).toContain(`Catatan: ${trickyNote}`);
  });
});