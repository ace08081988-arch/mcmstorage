// E2E: skenario pembayaran "Bayar sebagian" pada dialog konfirmasi.
//
// Memverifikasi:
//   1. Panel input muncul saat metode "Sebagian" dipilih; total & sisa
//      terhitung reaktif terhadap nominal.
//   2. Nominal invalid (0, negatif, >= total) → tombol "Kirim WA" dikunci.
//   3. Nominal valid → Kirim WA aktif; setelah klik, badge Aktif turun 1,
//      Terkirim naik 1, dan row muncul di "Riwayat Terkirim" dengan
//      nominal yang dibayar tercatat pada badge Riwayat.
//   4. Tombol Kirim WA row tersebut TERKUNCI (disabled) setelah sukses.
//   5. Row tetap berada di Riwayat Terkirim setelah interaksi lain
//      (mis. Tandai prep lain) — tidak "kabur" saat state di-render ulang.
//   6. Tidak ada reload halaman.
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

test.describe("Pembayaran Sebagian → kirim WA mengunci row & tetap di Riwayat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __noReload?: boolean }).__noReload = true;
    });
  });

  test("Ecer ep1: sebagian 4000 → Kirim WA, row terkunci & bertahan di Riwayat", async ({ page }) => {
    const beforeActive = Number(
      await page.getByTestId("badge-active-ecer-e-X").textContent(),
    );
    const beforeSent = Number(
      await page.getByTestId("badge-sent-ecer-e-X").textContent(),
    );
    expect(beforeActive).toBeGreaterThan(0);

    await page.getByTestId("send-wa-ep1").click();
    await expect(page.getByTestId("payment-dialog-ecer")).toBeVisible();

    // Panel partial belum tampil sampai metode "Sebagian" dipilih.
    await expect(page.getByTestId("payment-partial-panel-ecer")).toHaveCount(0);
    await page.getByTestId("payment-method-partial").click();
    await expect(page.getByTestId("payment-partial-panel-ecer")).toBeVisible();

    // Nominal kosong → invalid → tombol dikunci.
    const sendBtn = page.getByTestId("payment-send-wa");
    await expect(sendBtn).toBeDisabled();

    // Nominal 0 → invalid.
    const amountInput = page.getByTestId("payment-partial-amount-ecer");
    await amountInput.fill("0");
    await expect(page.getByTestId("payment-partial-error-ecer")).toBeVisible();
    await expect(sendBtn).toBeDisabled();

    // Nominal ≥ total → invalid.
    await amountInput.fill("10000");
    await expect(sendBtn).toBeDisabled();

    // Nominal valid → sisa terhitung, tombol aktif.
    await amountInput.fill("4000");
    await expect(page.getByTestId("payment-partial-sisa-ecer")).toHaveText(
      "Rp6.000",
    );
    await expect(page.getByTestId("payment-partial-error-ecer")).toHaveCount(0);
    await expect(sendBtn).toBeEnabled();

    await sendBtn.click();

    // Dialog tertutup, badge menyegar sinkron.
    await expect(page.getByTestId("payment-dialog-ecer")).toHaveCount(0);
    await expect(page.getByTestId("badge-active-ecer-e-X")).toHaveText(
      String(beforeActive - 1),
    );
    await expect(page.getByTestId("badge-sent-ecer-e-X")).toHaveText(
      String(beforeSent + 1),
    );

    // Row muncul di Riwayat dengan nominal yang dibayar.
    const riwayat = page.getByTestId("riwayat-item-ecer-ep1");
    await expect(riwayat).toBeVisible();
    await expect(page.getByTestId("riwayat-paid-ecer-ep1")).toHaveText("Rp4.000");

    // Tombol Kirim WA terkunci untuk row yang sudah terkirim.
    await expect(page.getByTestId("send-wa-ep1")).toBeDisabled();
    await expect(page.getByTestId("mark-sent-ep1")).toBeDisabled();

    // Interaksi lain (Tandai prep aktif lain) tidak memindahkan ep1
    // keluar dari Riwayat maupun mengubah nominal tercatat.
    await page.getByTestId("mark-sent-ep2").click();
    await expect(page.getByTestId("riwayat-item-ecer-ep1")).toBeVisible();
    await expect(page.getByTestId("riwayat-paid-ecer-ep1")).toHaveText("Rp4.000");
    await expect(page.getByTestId("send-wa-ep1")).toBeDisabled();

    // Batalkan ep2 lagi — ep1 tetap terkirim.
    await page.getByTestId("cancel-sent-ep2").click();
    await expect(page.getByTestId("riwayat-item-ecer-ep1")).toBeVisible();
    await expect(page.getByTestId("send-wa-ep1")).toBeDisabled();

    // Tidak ada reload.
    const stillMounted = await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload === true,
    );
    expect(stillMounted, "halaman tidak boleh reload").toBe(true);
    expect(new URL(page.url()).pathname).toBe(URL);
  });

  test("Ganti metode partial → kas menonaktifkan validasi partial", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-request").fill("0");
    await expect(page.getByTestId("payment-send-wa")).toBeDisabled();

    // Switch ke Lunas — panel partial hilang, tombol aktif.
    await page.getByTestId("payment-method-kas").click();
    await expect(page.getByTestId("payment-partial-panel-request")).toHaveCount(0);
    await expect(page.getByTestId("payment-send-wa")).toBeEnabled();
  });
});