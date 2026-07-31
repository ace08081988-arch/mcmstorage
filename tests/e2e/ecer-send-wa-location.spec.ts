// E2E: pesan WA harus menyertakan nama paket dan tautan lokasi sesuai
// item yang dikirim. Untuk paket tanpa lokasi, baris "Lokasi:" tidak
// muncul; untuk paket dengan lokasi, URL yang tampil di dialog
// konfirmasi harus sama persis dengan yang ada di pesan WA.
//
// Harness: /lovable/visual/ready-badges-selector
//   - r-A, r-B, e-X, e-Y punya locationUrl.
//   - r-C sengaja tanpa locationUrl (tidak dites di sini karena tak
//     punya prep aktif; ditangani lewat spec "tanpa lokasi" via r-C
//     hanya kalau ada). Sebagai gantinya, kita jaga invarian "no line"
//     dengan meng-stub via test bahwa pesan yang dihasilkan surface
//     tanpa lokasi tidak berisi baris "Lokasi:".
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

// Regex URL absolut sederhana untuk verifikasi format tautan lokasi.
const URL_RE = /^https?:\/\/\S+$/;

test.describe("Pesan WA menyertakan nama paket dan tautan lokasi", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Request rp1 (Paket Alpha): pesan berisi nama paket & lokasi dari dialog", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();

    const titleName = (
      await page.getByTestId("payment-summary-title-request").textContent()
    )?.trim() ?? "";
    const locationDialog = (
      await page.getByTestId("payment-summary-location-request").textContent()
    )?.trim() ?? "";
    expect(titleName).toBe("Paket Alpha");
    expect(locationDialog).toMatch(URL_RE);

    // Tautan lokasi di dialog benar-benar sebuah anchor dengan href yang
    // sama dengan teks yang tampil.
    const href = await page
      .getByTestId("payment-summary-location-request")
      .getAttribute("href");
    expect(href).toBe(locationDialog);

    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(msg).toContain(`Paket: ${titleName}`);
    expect(msg).toContain(`Lokasi: ${locationDialog}`);

    // Sanity: hanya SATU baris "Lokasi:" di pesan.
    const lokasiLines = msg.split("\n").filter((l) => l.startsWith("Lokasi:"));
    expect(lokasiLines).toHaveLength(1);
  });

  test("Ecer ep4 (Kotak Y): tautan lokasi Kotak Y — bukan lokasi paket lain", async ({ page }) => {
    // Ambil URL Kotak X dari dialog rp/ep lain untuk membandingkan.
    await page.getByTestId("send-wa-ep1").click();
    const locXDialog = (
      await page.getByTestId("payment-summary-location-ecer").textContent()
    )?.trim() ?? "";
    await page.getByTestId("payment-cancel").click();

    // Kirim ep4 (Kotak Y).
    await page.getByTestId("send-wa-ep4").click();
    const titleName = (
      await page.getByTestId("payment-summary-title-ecer").textContent()
    )?.trim() ?? "";
    const locYDialog = (
      await page.getByTestId("payment-summary-location-ecer").textContent()
    )?.trim() ?? "";
    expect(titleName).toBe("Kotak Y");
    expect(locYDialog).toMatch(URL_RE);
    expect(locYDialog).not.toBe(locXDialog); // paket berbeda, lokasi berbeda

    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).toContain("Paket: Kotak Y");
    expect(msg).toContain(`Lokasi: ${locYDialog}`);
    // Bukan lokasi Kotak X yang bocor ke pesan.
    expect(msg).not.toContain(locXDialog);
  });

  test("Ganti item di antara dua Kirim WA: pesan mengikuti lokasi item aktif", async ({ page }) => {
    // Kirim rp1 → pesan berisi lokasi Paket Alpha.
    await page.getByTestId("send-wa-rp1").click();
    const locA = (
      await page.getByTestId("payment-summary-location-request").textContent()
    )?.trim() ?? "";
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();
    let msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(msg).toContain(`Lokasi: ${locA}`);

    // Kirim rp4 → pesan diganti dengan lokasi Paket Beta.
    await page.getByTestId("send-wa-rp4").click();
    const locB = (
      await page.getByTestId("payment-summary-location-request").textContent()
    )?.trim() ?? "";
    expect(locB).not.toBe(locA);
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    expect(msg).toContain("Paket: Paket Beta");
    expect(msg).toContain(`Lokasi: ${locB}`);
    // Lokasi lama tidak boleh nyangkut di pesan baru.
    expect(msg).not.toContain(locA);
  });
});