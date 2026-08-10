import { test, expect, type Page } from "@playwright/test";

/**
 * E2E — kartu dialog (`ui/dialog`) tidak boleh melorot atau terpotong di
 * WebView Android, termasuk saat layout viewport LEBIH TINGGI daripada
 * area yang benar-benar terlihat (toolbar browser, soft-keyboard, bilah
 * sistem). Kondisi itu ditiru dengan menyetel stub `window.visualViewport`
 * lalu memancarkan `resize`.
 */

const HARNESS = "/lovable/visual/dialog-viewport";

async function installVvStub(page: Page) {
  await page.addInitScript(() => {
    const state = { top: 0, height: window.innerHeight };
    const listeners: Record<string, Set<() => void>> = {};
    const vv = {
      get offsetTop() { return state.top; },
      get offsetLeft() { return 0; },
      get pageTop() { return state.top; },
      get width() { return window.innerWidth; },
      get height() { return state.height; },
      get scale() { return 1; },
      addEventListener: (ev: string, cb: () => void) => {
        (listeners[ev] ??= new Set()).add(cb);
      },
      removeEventListener: (ev: string, cb: () => void) => {
        listeners[ev]?.delete(cb);
      },
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => vv });
    (window as unknown as { __setVv: (t: number, h: number) => void }).__setVv = (t, h) => {
      state.top = t;
      state.height = h;
      for (const cb of listeners["resize"] ?? []) cb();
      for (const cb of listeners["scroll"] ?? []) cb();
    };
  });
}

async function setVv(page: Page, top: number, height: number) {
  await page.evaluate(
    ([t, h]) => (window as unknown as { __setVv: (t: number, h: number) => void }).__setVv(t, h),
    [top, height],
  );
  await page.waitForTimeout(600); // hook melakukan resample sampai 500ms
}

async function openDialog(page: Page, testId: string) {
  await page.goto(HARNESS);
  await page.waitForLoadState("networkidle");
  const dialog = page.getByTestId("hv-dialog");
  await expect(async () => {
    await page.getByTestId(testId).click();
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
}

/** Kartu harus utuh di layar dan (bila muat) di dalam area terlihat. */
async function assertVisible(page: Page, label: string, vvTop: number, vvHeight: number) {
  const dialog = page.getByTestId("hv-dialog");
  const vp = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(box, `${label}: bounding box ada`).toBeTruthy();

  expect(box.y, `${label}: atas kartu di layar`).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height, `${label}: bawah kartu di layar`).toBeLessThanOrEqual(vp.height + 1);
  expect(box.x, `${label}: kiri kartu`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label}: kanan kartu`).toBeLessThanOrEqual(vp.width + 1);

  // Muat di area terlihat → harus benar-benar berada di dalamnya.
  if (box.height <= vvHeight - 16) {
    expect(box.y, `${label}: atas kartu di area terlihat`).toBeGreaterThanOrEqual(vvTop - 1);
    expect(box.y + box.height, `${label}: bawah kartu di area terlihat`).toBeLessThanOrEqual(
      vvTop + vvHeight + 1,
    );
  }

  // Tidak ada overflow horizontal.
  const ox = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(ox, `${label}: overflow horizontal`).toBeLessThanOrEqual(1);

  // Judul & footer terjangkau setelah menggulir isi.
  await expect(page.getByTestId("hv-title"), `${label}: judul terlihat`).toBeVisible();
  await dialog.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const footer = page.getByTestId("hv-footer");
  await expect(footer, `${label}: footer terlihat`).toBeVisible();
  const fb = (await footer.boundingBox())!;
  expect(fb.y + fb.height, `${label}: footer tidak terpotong`).toBeLessThanOrEqual(vp.height + 1);
}

test.describe("Dialog di WebView Android — tidak melorot / terpotong", () => {
  test.beforeEach(async ({ page }) => { await installVvStub(page); });

  for (const variant of [
    { id: "btn-open-long", label: "isi panjang" },
    { id: "btn-open-short", label: "isi pendek" },
  ]) {
    test(`keyboard & toolbar (${variant.label})`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await openDialog(page, variant.id);
      await setVv(page, 0, 800);
      await assertVisible(page, `${variant.label} · normal`, 0, 800);

      // Soft-keyboard: area terlihat mengecil, layout viewport tetap.
      await setVv(page, 0, 420);
      await assertVisible(page, `${variant.label} · keyboard`, 0, 420);

      // Toolbar Android muncul: area terlihat digeser ke bawah.
      await setVv(page, 56, 640);
      await assertVisible(page, `${variant.label} · toolbar`, 56, 640);

      // Keyboard tertutup lagi.
      await setVv(page, 0, 800);
      await assertVisible(page, `${variant.label} · pulih`, 0, 800);
    });
  }

  test("landscape sempit + keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 360 });
    await openDialog(page, "btn-open-long");
    await setVv(page, 0, 360);
    await assertVisible(page, "landscape", 0, 360);
    await setVv(page, 0, 200);
    await assertVisible(page, "landscape · keyboard", 0, 200);
  });

  test("aksi tetap bisa ditekan saat area terlihat sempit", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openDialog(page, "btn-open-long");
    await setVv(page, 0, 380);
    await page.getByTestId("hv-dialog").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.getByTestId("hv-save").click();
    await expect(page.getByTestId("hv-dialog")).toBeHidden();
  });
});
