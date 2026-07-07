// E2E: catatan pelanggan dengan karakter spesial (tanda baca, emoji,
// baris baru) harus:
//   1. Terpelihara apa adanya di teks pesan yang ditampilkan
//      (`data-testid="last-wa-message-<scope>"`), termasuk newline.
//   2. Ter-encode dengan benar di URL wa.me
//      (`data-testid="last-wa-url-<scope>"` — atribut href), mengikuti
//      aturan `encodeURIComponent`:
//        - "\n"  → "%0A"
//        - "&"   → "%26"
//        - "#"   → "%23"
//        - "?"   → "%3F"
//        - " "   → "%20" (bukan "+")
//        - Emoji (UTF-8 multi-byte) → "%F0%9F..." dsb.
//
// Harness: /lovable/visual/ready-badges-selector.
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

test.describe("Encoding catatan pelanggan di pesan WA", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Tanda baca & simbol reserved: & # ? = / muncul apa adanya di teks, %-encoded di URL", async ({ page }) => {
    await page.getByTestId("send-wa-ep1").click();

    const note = "Bayar via QR & scan #123; url ?ref=abc/def";
    await page.getByTestId("payment-note-ecer").fill(note);
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    // Pesan mentah menyimpan simbol reserved apa adanya.
    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).toContain(`Catatan: ${note}`);

    // URL wa.me di-encode via encodeURIComponent.
    const href = await page
      .getByTestId("last-wa-url-ecer")
      .getAttribute("href");
    expect(href, "wa.me href harus ada").toBeTruthy();
    expect(href!).toMatch(/^https:\/\/wa\.me\/\?text=/);

    const expectedEncoded = encodeURIComponent(msg);
    expect(href).toBe(`https://wa.me/?text=${expectedEncoded}`);

    // Spot-check simbol reserved individual.
    expect(href!).toContain("%26"); // &
    expect(href!).toContain("%23"); // #
    expect(href!).toContain("%3F"); // ?
    expect(href!).toContain("%3D"); // =
    expect(href!).toContain("%2F"); // /
    // Spasi harus %20 (encodeURIComponent), bukan '+' (form-encoding).
    expect(href!).toContain("%20");
    expect(href!).not.toMatch(/text=[^&]*\+/);
  });

  test("Emoji multi-byte diproses utuh: tampil di teks, %-encoded UTF-8 di URL", async ({ page }) => {
    await page.getByTestId("send-wa-rp1").click();

    const note = "Terima kasih 🙏🎉 sampai jumpa 👋";
    await page.getByTestId("payment-note-request").fill(note);
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-request").textContent()) ?? "";
    // Emoji tampil apa adanya di teks (tidak jadi "?").
    expect(msg).toContain("🙏");
    expect(msg).toContain("🎉");
    expect(msg).toContain("👋");
    expect(msg).toContain(`Catatan: ${note}`);

    const href = await page
      .getByTestId("last-wa-url-request")
      .getAttribute("href");
    expect(href).toBe(`https://wa.me/?text=${encodeURIComponent(msg)}`);

    // Setiap emoji harus ter-encode sebagai byte UTF-8 %XX yang cocok
    // dengan hasil encodeURIComponent atas emoji itu sendiri.
    for (const e of ["🙏", "🎉", "👋"]) {
      const enc = encodeURIComponent(e);
      expect(enc).toMatch(/^(%[0-9A-F]{2}){4}$/i); // 4-byte UTF-8
      expect(href!).toContain(enc);
      // Pastikan tidak ada karakter mentah non-ASCII yang bocor ke URL.
      expect(href!).not.toContain(e);
    }
  });

  test("Baris baru dalam catatan: '\\n' → '%0A' di URL, tetap multi-line di teks", async ({ page }) => {
    await page.getByTestId("send-wa-ep4").click();

    const note = "Baris 1\nBaris 2\nBaris 3";
    await page.getByTestId("payment-note-ecer").fill(note);
    await page.getByTestId("payment-method-partial").click();
    await page.getByTestId("payment-partial-amount-ecer").fill("2000");
    await page.getByTestId("payment-send-wa").click();

    // Teks pesan mempertahankan tiap baris catatan.
    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).toContain("Catatan: Baris 1");
    expect(msg).toContain("Baris 2");
    expect(msg).toContain("Baris 3");
    // Setidaknya dua newline dari catatan + newline pemisah baris pesan.
    expect((msg.match(/\n/g) ?? []).length).toBeGreaterThanOrEqual(4);

    const href = await page
      .getByTestId("last-wa-url-ecer")
      .getAttribute("href");
    expect(href).toBe(`https://wa.me/?text=${encodeURIComponent(msg)}`);

    // '\n' harus jadi '%0A' — tidak boleh ada literal newline di URL,
    // dan tidak boleh jadi '%0D%0A' (CRLF) atau dihilangkan.
    expect(href!).not.toContain("\n");
    expect(href!).not.toContain("\r");
    const nlCount = (href!.match(/%0A/g) ?? []).length;
    expect(nlCount).toBeGreaterThanOrEqual(4);
  });

  test("Kutip, backslash, dan karakter kontrol: encode konsisten dengan encodeURIComponent", async ({ page }) => {
    await page.getByTestId("send-wa-ep2").click();

    // Sengaja gabungkan berbagai karakter yang sering bikin regresi.
    const note = `He said "hai" — it's ok\\path ; +1 (rp) 100%`;
    await page.getByTestId("payment-note-ecer").fill(note);
    await page.getByTestId("payment-method-hutang").click();
    await page.getByTestId("payment-send-wa").click();

    const msg = (await page.getByTestId("last-wa-message-ecer").textContent()) ?? "";
    expect(msg).toContain(`Catatan: ${note}`);

    const href = await page
      .getByTestId("last-wa-url-ecer")
      .getAttribute("href");
    // Kesetaraan dengan encodeURIComponent adalah invarian utama —
    // menutupi seluruh matrix karakter tanpa hardcode setiap byte.
    expect(href).toBe(`https://wa.me/?text=${encodeURIComponent(msg)}`);

    // Spot-check: '%' sendiri harus jadi '%25' (bukan dibiarkan mentah).
    expect(href!).toContain("%25");
    // '+' harus jadi '%2B' (encodeURIComponent, bukan form-encoding).
    expect(href!).toContain("%2B");
    // '"' → '%22'.
    expect(href!).toContain("%22");
  });
});