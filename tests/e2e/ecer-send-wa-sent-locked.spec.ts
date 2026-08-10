// E2E: untuk item yang statusnya "Sudah Dikirim" (sold_at !== null),
// tombol "Kirim WA" harus terkunci dan tidak ada tautan wa.me maupun
// pesan WA baru yang bisa dibentuk — bahkan jika pengguna mencoba
// memaksa klik atau berpindah ke dialog konfirmasi.
//
// Invarian yang di-e2e-kan:
//   1. Tombol `send-wa-<id>` untuk prep terkirim adalah `disabled`.
//   2. Klik paksa pada tombol tersebut TIDAK membuka
//      `payment-dialog-<scope>`.
//   3. `last-wa-url-<scope>` tetap kosong / tanpa `href` untuk surface
//      yang belum pernah mengirim item aktif.
//   4. `last-wa-message-<scope>` tetap kosong pada kondisi awal.
//   5. Section Riwayat Terkirim untuk item tersebut TIDAK mengekspos
//      tombol/link Kirim WA baru.
//   6. Setelah kita mengirim item aktif lain di surface yang sama,
//      state Kirim-WA-terkunci untuk item yang sebelumnya sudah
//      terkirim tetap tidak berubah — tak ada URL/message baru yang
//      dibuat untuk item itu.
//
// Seed relevan (lihat harness):
//   - Request terkirim: rp3, rp5, rp6
//   - Ecer terkirim   : ep3, ep5
import { test, expect } from "@playwright/test";

const URL = "/lovable/visual/ready-badges-selector";

const SENT_IDS = {
  request: ["rp3", "rp5", "rp6"] as const,
  ecer: ["ep3", "ep5"] as const,
};

test.describe("Item 'Sudah Dikirim': tombol Kirim WA terkunci & tidak menghasilkan link/pesan", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByRole("heading", { name: /Ready Badges/i })).toBeVisible();
  });

  test("Kondisi awal: prep terkirim → send-wa disabled, dialog tak terbuka, tidak ada href wa.me", async ({ page }) => {
    // Sanity: state awal, tidak ada pesan/URL WA di kedua surface.
    for (const scope of ["request", "ecer"] as const) {
      await expect(page.getByTestId(`last-wa-message-${scope}`)).toHaveText("");
      // Elemen `last-wa-url-<scope>` awalnya adalah <span hidden> tanpa href.
      const href = await page
        .getByTestId(`last-wa-url-${scope}`)
        .getAttribute("href");
      expect(href, `href awal untuk ${scope} harus null`).toBeNull();
    }

    for (const scope of ["request", "ecer"] as const) {
      for (const id of SENT_IDS[scope]) {
        const btn = page.getByTestId(`send-wa-${id}`);
        await expect(btn, `send-wa-${id} harus disabled`).toBeDisabled();
        // Tombol bukan <a>, tidak boleh punya href yang mengarah ke wa.me.
        const href = await btn.getAttribute("href");
        expect(href, `send-wa-${id} tidak boleh punya href`).toBeNull();

        // Klik paksa tombol disabled — tidak boleh membuka dialog
        // pembayaran, dan tidak boleh menghasilkan pesan/URL baru.
        await btn.click({ force: true }).catch(() => {
          /* klik paksa boleh gagal — yang penting tidak ada side effect */
        });
        await expect(page.getByTestId(`payment-dialog-${scope}`)).toHaveCount(0);
        await expect(page.getByTestId(`last-wa-message-${scope}`)).toHaveText("");
        const hrefAfter = await page
          .getByTestId(`last-wa-url-${scope}`)
          .getAttribute("href");
        expect(hrefAfter).toBeNull();
      }
    }
  });

  test("Section Riwayat Terkirim tidak mengekspos tombol/link Kirim WA baru", async ({ page }) => {
    for (const scope of ["request", "ecer"] as const) {
      const riwayat = page.getByTestId(`riwayat-${scope}`);
      await expect(riwayat).toBeVisible();

      // Cari semua elemen di dalam Riwayat yang bisa membuka WA.
      const kirimBtnCount = await riwayat
        .getByRole("button", { name: /Kirim WA/i })
        .count();
      expect(kirimBtnCount, `Riwayat ${scope} tak boleh punya tombol Kirim WA`).toBe(0);

      const waAnchor = riwayat.locator('a[href*="wa.me"]');
      expect(await waAnchor.count(), `Riwayat ${scope} tak boleh punya link wa.me`).toBe(0);
    }
  });

  test("Mengetik catatan sebelum klik send-wa (yang disabled) tidak menghasilkan pesan WA", async ({ page }) => {
    // Skenario: user melihat item terkirim, mencoba fokus ke sekitarnya,
    // dan sebelumnya sempat mengetik draf catatan pada satu-satunya
    // input yang tersedia (di dialog untuk item aktif — tapi karena
    // dialog tak terbuka untuk item terkirim, tidak ada input catatan
    // yang bisa disentuh). Pastikan tidak ada input catatan yang
    // tersedia untuk item terkirim.
    for (const scope of ["request", "ecer"] as const) {
      for (const id of SENT_IDS[scope]) {
        await page.getByTestId(`send-wa-${id}`).click({ force: true }).catch(() => {});
        await expect(page.getByTestId(`payment-dialog-${scope}`)).toHaveCount(0);
        // Field catatan hanya ada di dalam dialog — dialog tak terbuka,
        // field pun tak ada.
        await expect(page.getByTestId(`payment-note-${scope}`)).toHaveCount(0);
      }
    }

    // Pesan/URL WA tetap kosong.
    for (const scope of ["request", "ecer"] as const) {
      await expect(page.getByTestId(`last-wa-message-${scope}`)).toHaveText("");
      const href = await page
        .getByTestId(`last-wa-url-${scope}`)
        .getAttribute("href");
      expect(href).toBeNull();
    }
  });

  test("Setelah mengirim item aktif lain, item yang sudah terkirim tetap terkunci", async ({ page }) => {
    // Kirim ep1 (aktif) dengan catatan — memastikan pesan WA valid
    // hanya menyertakan ep1.
    await page.getByTestId("send-wa-ep1").click();
    await page.getByTestId("payment-note-ecer").fill("kirim sore");
    await page.getByTestId("payment-method-kas").click();
    await page.getByTestId("payment-send-wa").click();

    // Snapshot pesan & URL setelah ep1 dikirim.
    const msgAfterActive = (
      await page.getByTestId("last-wa-message-ecer").textContent()
    ) ?? "";
    const hrefAfterActive = await page
      .getByTestId("last-wa-url-ecer")
      .getAttribute("href");
    expect(msgAfterActive).toContain("Catatan: kirim sore");
    expect(hrefAfterActive).toMatch(/^https:\/\/wa\.me\/\?text=/);

    // Coba paksa klik send-wa untuk item yang sudah terkirim (ep3, ep5).
    for (const id of SENT_IDS.ecer) {
      const btn = page.getByTestId(`send-wa-${id}`);
      await expect(btn).toBeDisabled();
      await btn.click({ force: true }).catch(() => {});
      // Dialog tak boleh terbuka untuk item terkirim.
      await expect(page.getByTestId("payment-dialog-ecer")).toHaveCount(0);
    }

    // Pesan & URL WA TIDAK berubah — tidak ada pesan baru yang dibuat
    // dari item yang sudah terkirim.
    await expect(page.getByTestId("last-wa-message-ecer")).toHaveText(
      msgAfterActive,
    );
    const hrefStable = await page
      .getByTestId("last-wa-url-ecer")
      .getAttribute("href");
    expect(hrefStable).toBe(hrefAfterActive);

    // Dan pesan tidak menyebut ID/customer prep yang sudah terkirim
    // sebelum sesi ini (ep3 → Rina, ep5 → Wati).
    expect(msgAfterActive).not.toContain("Rina");
    expect(msgAfterActive).not.toContain("Wati");
  });
});