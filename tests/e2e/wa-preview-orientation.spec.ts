import { test, expect, type Page } from "@playwright/test";

/**
 * E2E — dialog pratinjau WA saat perangkat dirotasi portrait ↔ landscape.
 *
 * Regresi yang dijaga: pada landscape (tinggi ~411px) dialog pernah
 * melampaui viewport sehingga footer (Batal / Kirim via MCM) dan baris
 * "Lokasi ambil" terpotong. Kontrak yang diuji di SETIAP orientasi:
 *
 *  1. Kotak dialog berada penuh di dalam viewport (tidak ada bagian yang
 *     keluar layar atas/bawah/kiri/kanan).
 *  2. Tidak ada overflow horizontal — teks membungkus, bukan terpotong.
 *  3. Footer terlihat & tombol kirim actionable (di dalam viewport).
 *  4. Area isi bisa di-scroll sampai elemen terakhir terlihat penuh.
 *  5. Rotasi dilakukan SAAT dialog terbuka (bukan buka ulang), meniru
 *     user memutar HP di tengah proses.
 */

const PORTRAIT = { width: 411, height: 893 } as const;
const LANDSCAPE = { width: 893, height: 411 } as const;
const PORTRAIT_SMALL = { width: 360, height: 640 } as const;
const LANDSCAPE_SMALL = { width: 640, height: 360 } as const;

const HARNESS = "/lovable/visual/wa-preview-rotate";

async function assertNoClipping(page: Page, label: string) {
  const dialog = page.getByTestId("wa-preview-dialog");
  await expect(dialog, `${label}: dialog terlihat`).toBeVisible();

  const vp = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box, `${label}: bounding box dialog ada`).toBeTruthy();

  // 1) Dialog utuh di dalam viewport (toleransi 1px pembulatan).
  expect(box.x, `${label}: sisi kiri dialog`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${label}: sisi atas dialog`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label}: sisi kanan dialog`).toBeLessThanOrEqual(vp.width + 1);
  expect(box.y + box.height, `${label}: sisi bawah dialog`).toBeLessThanOrEqual(vp.height + 1);

  // 2) Tidak ada overflow horizontal di dialog maupun area scroll.
  for (const id of ["wa-preview-dialog", "wa-preview-scroll", "wa-preview-footer"]) {
    const overflowX = await page.getByTestId(id).evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflowX, `${label}: overflow horizontal ${id}`).toBeLessThanOrEqual(1);
  }

  // 3) Footer + tombol aksi terlihat penuh di dalam viewport.
  const footer = page.getByTestId("wa-preview-footer");
  await expect(footer, `${label}: footer terlihat`).toBeVisible();
  const fb = (await footer.boundingBox())!;
  expect(fb.y + fb.height, `${label}: footer tidak terpotong bawah`).toBeLessThanOrEqual(
    vp.height + 1,
  );
  const kirim = page.getByRole("button", { name: /Kirim/i }).first();
  const batal = page.getByRole("button", { name: /^Batal$/ });
  for (const [name, btn] of [["Kirim", kirim], ["Batal", batal]] as const) {
    await expect(btn, `${label}: tombol ${name} terlihat`).toBeVisible();
    const bb = (await btn.boundingBox())!;
    expect(bb.width, `${label}: lebar tombol ${name}`).toBeGreaterThan(40);
    expect(bb.y + bb.height, `${label}: tombol ${name} di dalam layar`).toBeLessThanOrEqual(
      vp.height + 1,
    );
  }

  // 4) Teks pesan membungkus (bukan terpotong horizontal) dan bisa
  //    di-scroll vertikal sampai baris terakhir.
  const textEl = page.getByTestId("wa-preview-text");
  if (await textEl.count()) {
    const m = await textEl.evaluate((el) => ({
      ox: el.scrollWidth - el.clientWidth,
      scrollable: el.scrollHeight > el.clientHeight,
    }));
    expect(m.ox, `${label}: teks pesan tidak overflow horizontal`).toBeLessThanOrEqual(1);
    if (m.scrollable) {
      const reached = await textEl.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      });
      expect(reached, `${label}: baris terakhir teks bisa dijangkau`).toBe(true);
    }
  }

  // 5) Area isi bisa discroll penuh — elemen terakhir (checkbox "jangan
  //    tampilkan lagi") harus bisa terlihat setelah scroll.
  const scroll = page.getByTestId("wa-preview-scroll");
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const last = page.getByText(/Jangan tampilkan pratinjau ini lagi/i);
  await expect(last, `${label}: baris terakhir isi terlihat`).toBeInViewport({ ratio: 0.9 });
}

async function openDialog(page: Page, testId: string) {
  await page.goto(HARNESS);
  await page.getByTestId(testId).click();
  await expect(page.getByTestId("wa-preview-dialog")).toBeVisible();
}

test.describe("Pratinjau WA — rotasi portrait ↔ landscape", () => {
  for (const variant of [
    { id: "btn-open-preview", label: "teks + foto" },
    { id: "btn-open-preview-text", label: "teks saja" },
  ]) {
    test(`rotasi saat dialog terbuka (${variant.label}) — tidak ada teks terpotong`, async ({
      page,
    }) => {
      await page.setViewportSize({ ...PORTRAIT });
      await openDialog(page, variant.id);
      await assertNoClipping(page, `${variant.label} · portrait`);

      // Rotasi ke landscape tanpa menutup dialog.
      await page.setViewportSize({ ...LANDSCAPE });
      await page.waitForTimeout(250);
      await assertNoClipping(page, `${variant.label} · landscape`);

      // Kembali ke portrait.
      await page.setViewportSize({ ...PORTRAIT });
      await page.waitForTimeout(250);
      await assertNoClipping(page, `${variant.label} · portrait (kembali)`);
    });
  }

  test("layar kecil 360×640 ↔ 640×360 — dialog tetap utuh", async ({ page }) => {
    await page.setViewportSize({ ...PORTRAIT_SMALL });
    await openDialog(page, "btn-open-preview");
    await assertNoClipping(page, "kecil · portrait");

    await page.setViewportSize({ ...LANDSCAPE_SMALL });
    await page.waitForTimeout(250);
    await assertNoClipping(page, "kecil · landscape");
  });

  test("aksi tetap berfungsi setelah rotasi", async ({ page }) => {
    await page.setViewportSize({ ...PORTRAIT });
    await openDialog(page, "btn-open-preview");
    await page.setViewportSize({ ...LANDSCAPE });
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: /Kirim/i }).first().click();
    await expect(page.getByTestId("preview-result")).toHaveText("kirim");
  });
});