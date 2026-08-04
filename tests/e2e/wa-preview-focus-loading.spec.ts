import { test, expect, type Page } from "@playwright/test";

/**
 * E2E — focus trap dialog pratinjau WA saat konten dimuat bertahap.
 *
 * Skenario: dialog dibuka dengan foto belum lengkap, lalu tombol
 * "Ambil ulang" memicu state loading (tombol disabled/hilang sementara)
 * dan foto ditambahkan bertahap. Elemen yang sedang fokus bisa dilepas
 * dari DOM saat itu — fokus TIDAK boleh lolos ke <body> atau ke konten di
 * belakang overlay.
 *
 * Kontrak yang diuji:
 *  1. Selama loading, fokus tetap berada di dalam dialog.
 *  2. Setelah konten baru masuk, fokus masih di dalam dialog.
 *  3. Tab & Shift+Tab tetap bergulung di dalam dialog (tidak ke <body>).
 *  4. Tab saat loading berlangsung tidak memindahkan fokus keluar dialog.
 *  5. Setelah semua konten dimuat, menutup lewat "Batal" mengembalikan
 *     fokus ke tombol pemicu di halaman.
 */

const HARNESS = "/lovable/visual/wa-preview-rotate";

async function focusInsideDialog(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="wa-preview-dialog"]');
    const active = document.activeElement;
    if (!dialog || !active) return false;
    if (active === document.body) return false;
    return dialog.contains(active);
  });
}

async function activeInfo(page: Page) {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return a ? `${a.tagName.toLowerCase()}#${a.id}.${a.className}`.slice(0, 120) : "null";
  });
}

test.describe("Pratinjau WA — focus trap saat loading & konten bertahap", () => {
  test("fokus tetap terkunci selama retry foto dan setelah konten bertambah", async ({ page }) => {
    await page.goto(HARNESS);
    await page.getByTestId("btn-open-preview-progressive").click();

    const dialog = page.getByTestId("wa-preview-dialog");
    await expect(dialog).toBeVisible();
    expect(await focusInsideDialog(page), "fokus awal di dalam dialog").toBe(true);

    // ── Putaran 1: klik "Ambil ulang" → state loading → foto menyusul.
    const retry = page.getByRole("button", { name: /Ambil ulang/i });
    await expect(retry).toBeVisible();
    await retry.focus();
    await retry.click();

    // 1) Saat loading masih berjalan, fokus tidak boleh lompat keluar.
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(200);
      expect(
        await focusInsideDialog(page),
        `fokus tetap di dialog saat loading (cek ${i + 1}, aktif=${await activeInfo(page)})`,
      ).toBe(true);
    }

    // 4) Tab di tengah loading tetap berputar di dalam dialog.
    await page.keyboard.press("Tab");
    expect(await focusInsideDialog(page), "Tab saat loading tetap di dialog").toBe(true);

    // 2) Konten baru masuk (jumlah foto bertambah) — fokus masih di dialog.
    await expect(page.getByTestId("wa-preview-footer")).toContainText(/2 foto/);
    expect(
      await focusInsideDialog(page),
      `fokus setelah konten bertambah (aktif=${await activeInfo(page)})`,
    ).toBe(true);

    // ── Putaran 2: retry lagi, konten bertambah 2 foto sekaligus.
    const retry2 = page.getByRole("button", { name: /Ambil ulang/i });
    if (await retry2.count()) {
      await retry2.first().focus();
      await retry2.first().click();
      await page.waitForTimeout(150);
      expect(await focusInsideDialog(page), "fokus terkunci pada retry kedua").toBe(true);
      await expect(page.getByTestId("wa-preview-footer")).toContainText(/4 foto/);
      expect(await focusInsideDialog(page), "fokus setelah batch kedua").toBe(true);
    }

    // 3) Tab & Shift+Tab bergulung di dalam dialog.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await focusInsideDialog(page), `Tab #${i + 1} tetap di dialog`).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusInsideDialog(page), `Shift+Tab #${i + 1} tetap di dialog`).toBe(true);
    }

    // 5) Tutup lewat "Batal" → fokus kembali ke tombol pemicu.
    await page.getByRole("button", { name: /^Batal$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("preview-result")).toHaveText("batal");
    await page.waitForTimeout(400);
    const restored = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.getAttribute("data-testid") ?? "null",
    );
    expect(restored, "fokus pulih ke tombol pemicu").toBe("btn-open-preview-progressive");
  });
});
