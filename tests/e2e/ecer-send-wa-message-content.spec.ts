// E2E: pesan WhatsApp yang "dikirim" saat menekan tombol Kirim WA harus
// memuat ringkasan yang ditampilkan di dialog konfirmasi — nama
// pelanggan, total tagihan, dan jenis pembayaran (termasuk rincian
// nominal partial + sisa untuk metode "Bayar sebagian").
//
// Harness: /lovable/visual/ready-badges-selector — pesan terakhir yang
// dibangun dari state dialog dirender ke `data-testid="last-wa-message-<scope>"`.
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

test.describe("Pesan WA memuat ringkasan dialog konfirmasi", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Metode Lunas: pesan berisi pelanggan, paket, total, dan 'Lunas'", async ({ page }) => {
    await page.getByTestId("send-wa-ep1").click();

    const customer = (await page.getByTestId("payment-summary-customer-ecer").textContent())?.trim();
    const titleName = (await page.getByTestId("payment-summary-title-ecer").textContent())?.trim();
    const total = (await page.getByTestId("payment-summary-total-ecer").textContent())?.trim();
    expect(customer).toBeTruthy();
    expect(titleName).toBeTruthy();
    expect(total).toBe("Rp10.000");

    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).toContain(customer!);
    expect(msg).toContain(titleName!);
    expect(msg).toContain("Total: Rp10.000");
    expect(msg).toContain("Pembayaran: Lunas");
    // Field partial tidak ikut untuk metode Lunas.
    expect(msg).not.toContain("Dibayar:");
    expect(msg).not.toContain("Sisa:");
  });

  test("Metode Hutang: pesan berisi 'Hutang' dan total tanpa rincian dibayar", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();
    const customer = (await page.getByTestId("payment-summary-customer-request").textContent())?.trim();
    const titleName = (await page.getByTestId("payment-summary-title-request").textContent())?.trim();

    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(msg).toContain(customer!);
    expect(msg).toContain(titleName!);
    expect(msg).toContain("Total: Rp10.000");
    expect(msg).toContain("Pembayaran: Hutang");
    expect(msg).not.toMatch(/Dibayar:/);
  });

  test("Metode Sebagian: pesan berisi nominal Dibayar & Sisa sesuai input", async ({ page }) => {
    await page.getByTestId("send-wa-ep4").click();
    const customer = (await page.getByTestId("payment-summary-customer-ecer").textContent())?.trim();
    const titleName = (await page.getByTestId("payment-summary-title-ecer").textContent())?.trim();

    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-ecer").fill("3500");
    await expect(page.getByTestId("payment-partial-sisa-ecer")).toHaveText("Rp6.500");

    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).toContain(customer!);
    expect(msg).toContain(titleName!);
    expect(msg).toContain("Total: Rp10.000");
    expect(msg).toContain("Pembayaran: Bayar sebagian");
    expect(msg).toContain("Dibayar: Rp3.500");
    expect(msg).toContain("Sisa: Rp6.500");
  });

  test("Pesan awal kosong; hanya terisi setelah Kirim WA (bukan setelah pilih metode)", async ({ page }) => {
    await expect(page.getByTestId("last-wa-message-ecer")).toHaveText("");
    await page.getByTestId("send-wa-ep1").click();
    await page.getByTestId("payment-method-hutang").click();
    // Mengubah metode saja tidak boleh menulis pesan.
    await expect(page.getByTestId("last-wa-message-ecer")).toHaveText("");
    await page.getByTestId("payment-cancel").click();
    // Batal juga tidak menulis pesan.
    await expect(page.getByTestId("last-wa-message-ecer")).toHaveText("");
  });
});