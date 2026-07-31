// E2E: kontrak Batal auto-Kirim.
//
// Invariant yang di-e2e-kan:
//   1. Menekan tombol Batal pada AutoSendConfirmDialog TIDAK PERNAH
//      membuka dialog verifikasi pembayaran (sensor:
//      `[data-testid="payment-dialog-ecer"]` tidak boleh muncul, dan
//      `payment-open-state[data-open]` tetap "0").
//   2. Menutup dialog konfirmasi via Esc / overlay (jalur `onCancel`
//      yang sama) juga tidak membuka dialog pembayaran.
//   3. Sepanjang jalur Batal, TIDAK ADA request jaringan ke endpoint
//      pembayaran/penjualan (`sales`, `customer_payment`, `record_sale`,
//      `wa.me`, dsb) — sensor `[data-testid="payment-fetch-log"]` harus
//      kosong. Regresi guard: kalau seseorang menyisipkan panggilan
//      RPC penjualan / share WA di jalur Batal, spec langsung merah.
//   4. Positive control: jalur Lanjut ke pembayaran WAJIB membuka
//      dialog stub — memastikan sensor memang mendeteksi bukaan asli
//      dan bukan hanya "tidak pernah ada apa-apa".
//
// Harness: /lovable/visual/auto-send-cancel (publik, no-auth). Harness
// mengimpor AutoSendConfirmDialog + AutoSendCancelReasonDialog yang
// SAMA dengan yang dipakai halaman /ecer produksi — non-tautological.
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/auto-send-cancel";

test.describe("Batal auto-send: tidak pernah buka dialog pembayaran / hit endpoint pembayaran", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId("open-auto-send-confirm")).toBeVisible();
  });

  test("Batal → dialog pembayaran tidak muncul & fetch log pembayaran kosong", async ({
    page,
  }) => {
    // Sensor state pre-condition: dialog pembayaran belum pernah dibuka.
    await expect(page.getByTestId("payment-open-state")).toHaveAttribute(
      "data-open",
      "0",
    );
    await expect(page.getByTestId("payment-dialog-ecer")).toHaveCount(0);

    // Buka modal konfirmasi auto-send.
    await page.getByTestId("open-auto-send-confirm").click();
    await expect(page.getByTestId("auto-send-confirm")).toBeVisible();

    // Verifikasi daftar kotak yang dipilih terlihat (produk, judul, item).
    await expect(page.getByTestId("auto-send-list")).toBeVisible();
    await expect(page.getByTestId("auto-send-list-item")).toHaveCount(3);

    // Tekan Batal — inilah aksi yang WAJIB tidak menyentuh pembayaran.
    await page.getByTestId("auto-send-confirm-cancel").click();

    // Modal konfirmasi menghilang, dialog alasan (jalur cancel) muncul.
    await expect(page.getByTestId("auto-send-confirm")).toHaveCount(0);
    await expect(page.getByTestId("auto-send-cancel-reason")).toBeVisible();

    // Dialog pembayaran TIDAK PERNAH muncul.
    await expect(page.getByTestId("payment-dialog-ecer")).toHaveCount(0);
    await expect(page.getByTestId("payment-open-state")).toHaveAttribute(
      "data-open",
      "0",
    );

    // Fetch log pembayaran kosong (tidak ada RPC / WA send).
    await expect(page.getByTestId("payment-fetch-log")).toHaveText("");

    // Tutup dialog alasan via Lewati — tetap tidak membuka pembayaran.
    await page.getByRole("button", { name: "Lewati" }).click();
    await expect(page.getByTestId("auto-send-cancel-reason")).toHaveCount(0);
    await expect(page.getByTestId("payment-dialog-ecer")).toHaveCount(0);
    await expect(page.getByTestId("payment-fetch-log")).toHaveText("");
  });

  test("Dismiss via Esc (overlay onCancel) juga tidak membuka dialog pembayaran", async ({
    page,
  }) => {
    await page.getByTestId("open-auto-send-confirm").click();
    await expect(page.getByTestId("auto-send-confirm")).toBeVisible();

    // Esc memicu onOpenChange(false) → onCancel — jalur yang sama.
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("auto-send-confirm")).toHaveCount(0);
    await expect(page.getByTestId("payment-dialog-ecer")).toHaveCount(0);
    await expect(page.getByTestId("payment-open-state")).toHaveAttribute(
      "data-open",
      "0",
    );
    await expect(page.getByTestId("payment-fetch-log")).toHaveText("");
  });

  test("Positive control: Lanjut ke pembayaran MEMANG membuka dialog stub (sensor tidak tumpul)", async ({
    page,
  }) => {
    await page.getByTestId("open-auto-send-confirm").click();
    await expect(page.getByTestId("auto-send-confirm")).toBeVisible();

    await page.getByTestId("auto-send-confirm-continue").click();

    // Sensor menyala saat jalur yang benar dipakai — membuktikan bahwa
    // assertion "tidak pernah muncul" pada test cancel bukan false
    // negative dari sensor yang tidak pernah bisa berubah.
    await expect(page.getByTestId("payment-dialog-ecer")).toBeVisible();
    await expect(page.getByTestId("payment-open-state")).toHaveAttribute(
      "data-open",
      "1",
    );
  });
});