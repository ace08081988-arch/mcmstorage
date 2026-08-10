// E2E: setelah menekan "Kirim WA" pada dialog konfirmasi pembayaran, UI
// harus menyegarkan badge Aktif/Terkirim dan memindahkan item ke section
// "Riwayat Terkirim" tanpa reload halaman.
//
// Harness: /lovable/visual/ready-badges-selector (no-auth, in-memory state).
// Dialog pembayaran di harness mensimulasikan alur `SendEcerPrepsDialog`:
// pilih metode (Lunas/Hutang/Sebagian) → tombol "Kirim WA" → sold_at diisi
// synchronously. Spec memverifikasi bahwa:
//   1. Badge Aktif turun 1 & Terkirim naik 1 pada title terkait.
//   2. Row prep pindah dari daftar aktif ke section Riwayat Terkirim.
//   3. Tidak ada full navigation (URL tetap; document tidak reload).
//   4. Surface lain tidak ikut berubah.
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

test.describe("Kirim WA dari dialog pembayaran → refresh badge + Riwayat Terkirim", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Ecer: klik Kirim WA → badge segar, item pindah ke Riwayat, tanpa reload", async ({ page }) => {
    // Sensor untuk mendeteksi reload halaman: variabel di window sengaja
    // di-set sekali; kalau document di-reload nilainya hilang.
    await page.evaluate(() => {
      (window as unknown as { __noReload?: boolean }).__noReload = true;
    });

    const beforeActive = Number(
      await page.getByTestId("badge-active-ecer-e-X").textContent(),
    );
    const beforeSent = Number(
      await page.getByTestId("badge-sent-ecer-e-X").textContent(),
    );
    expect(beforeActive).toBeGreaterThan(0);

    // ep1 adalah prep aktif di e-X pada seed.
    await expect(page.getByTestId("riwayat-item-ecer-ep1")).toHaveCount(0);

    // Buka dialog konfirmasi pembayaran.
    await page.getByTestId("send-wa-ep1").click();
    await expect(page.getByTestId("payment-dialog-ecer")).toBeVisible();

    // Pilih metode "Bayar sebagian" hanya untuk membuktikan tombol metode
    // memengaruhi state, tidak memblokir Kirim WA.
    await page.getByTestId("payment-method-partial").click();

    // Klik Kirim WA — inilah aksi yang harus menyegarkan UI seketika.
    await page.getByTestId("payment-send-wa").click();

    // Dialog tertutup.
    await expect(page.getByTestId("payment-dialog-ecer")).toHaveCount(0);

    // Badge Aktif turun 1, Terkirim naik 1 pada e-X.
    await expect(page.getByTestId("badge-active-ecer-e-X")).toHaveText(
      String(beforeActive - 1),
    );
    await expect(page.getByTestId("badge-sent-ecer-e-X")).toHaveText(
      String(beforeSent + 1),
    );

    // ep1 kini muncul di Riwayat Terkirim (ecer).
    await expect(page.getByTestId("riwayat-item-ecer-ep1")).toBeVisible();

    // Tombol Kirim WA untuk ep1 sekarang disabled (sudah terkirim).
    await expect(page.getByTestId("send-wa-ep1")).toBeDisabled();

    // Surface Request tidak ikut berubah — badge r-A tetap seperti awal.
    // (Kita tidak memakai nilai numerik spesifik, cukup verifikasi tidak
    // ada prep ecer yang bocor ke Riwayat request.)
    await expect(page.getByTestId("riwayat-item-request-ep1")).toHaveCount(0);

    // TIDAK ada reload: sentinel window masih ada, URL tetap.
    const stillMounted = await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload === true,
    );
    expect(stillMounted, "halaman tidak boleh reload").toBe(true);
    expect(new URL(page.url()).pathname).toBe(URL);
  });

  test("Metode Lunas juga memicu refresh badge + pindah Riwayat pada Request", async ({ page }) => {
    await page.evaluate(() => {
      (window as unknown as { __noReload?: boolean }).__noReload = true;
    });

    const beforeActive = Number(
      await page.getByTestId("badge-active-request-r-A").textContent(),
    );
    const beforeSent = Number(
      await page.getByTestId("badge-sent-request-r-A").textContent(),
    );

    await page.getByTestId("send-wa-rp1").click();
    await expect(page.getByTestId("payment-dialog-request")).toBeVisible();
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    await expect(page.getByTestId("badge-active-request-r-A")).toHaveText(
      String(beforeActive - 1),
    );
    await expect(page.getByTestId("badge-sent-request-r-A")).toHaveText(
      String(beforeSent + 1),
    );
    await expect(page.getByTestId("riwayat-item-request-rp1")).toBeVisible();

    const stillMounted = await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload === true,
    );
    expect(stillMounted).toBe(true);
  });

  test("Batal pada dialog: tidak ada perubahan badge maupun Riwayat", async ({ page }) => {
    const beforeActive = await page.getByTestId("badge-active-ecer-e-Y").textContent();
    const beforeSent = await page.getByTestId("badge-sent-ecer-e-Y").textContent();

    await page.getByTestId("send-wa-ep4").click();
    await expect(page.getByTestId("payment-dialog-ecer")).toBeVisible();
    await page.getByTestId("payment-cancel").click();
    await expect(page.getByTestId("payment-dialog-ecer")).toHaveCount(0);

    await expect(page.getByTestId("badge-active-ecer-e-Y")).toHaveText(beforeActive ?? "");
    await expect(page.getByTestId("badge-sent-ecer-e-Y")).toHaveText(beforeSent ?? "");
    await expect(page.getByTestId("riwayat-item-ecer-ep4")).toHaveCount(0);
    await expect(page.getByTestId("send-wa-ep4")).toBeEnabled();
  });
});