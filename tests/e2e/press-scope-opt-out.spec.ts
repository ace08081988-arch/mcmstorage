import { test, expect, type Locator } from "@playwright/test";

/**
 * Verifikasi: di dalam root `data-press-scope="on"`, hanya elemen
 * baseline yang mendapat efek animasi press (scale + filter). Elemen
 * dengan `data-no-press` — termasuk Radix Dialog (trigger, overlay,
 * content, close) dan sortable handle — HARUS tetap netral saat
 * `:active` (identity transform, filter `none`).
 *
 * Strategi:
 * - Buka harness `/lovable/visual/press-scope`.
 * - Untuk elemen yang diuji: tekan pointer (tanpa release) supaya
 *   pseudo-class `:active` aktif, lalu baca `getComputedStyle`.
 * - Baseline: transform 0.97 (matrix dengan a≈0.97) dan filter
 *   mengandung `brightness`.
 * - Opt-out: transform `none` atau matrix identity, filter `none`.
 */

async function pressAndReadStyle(page: import("@playwright/test").Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("target element has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Beri waktu transition mencapai stabil (~150ms + margin).
  await page.waitForTimeout(220);
  const style = await locator.evaluate((el) => {
    const cs = getComputedStyle(el as Element);
    return { transform: cs.transform, filter: cs.filter };
  });
  await page.mouse.up();
  return style;
}

function parseScaleX(transform: string): number {
  if (!transform || transform === "none") return 1;
  // matrix(a, b, c, d, tx, ty) — a = scaleX bila tidak ada rotasi.
  const m = transform.match(/matrix\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
  return parts[0] ?? 1;
}

test.describe("press scope — data-no-press opt-out", () => {
  test("baseline elemen ikut menyusut & difilter saat :active", async ({ page }) => {
    await page.goto("/lovable/visual/press-scope");
    const style = await pressAndReadStyle(page, page.getByTestId("press-yes"));
    expect(parseScaleX(style.transform)).toBeLessThan(0.99);
    expect(parseScaleX(style.transform)).toBeGreaterThan(0.9);
    expect(style.filter).toContain("brightness");
  });

  test("tombol dengan data-no-press tetap netral", async ({ page }) => {
    await page.goto("/lovable/visual/press-scope");
    const style = await pressAndReadStyle(page, page.getByTestId("press-no"));
    expect(parseScaleX(style.transform)).toBeCloseTo(1, 3);
    expect(style.filter === "none" || style.filter === "").toBe(true);
  });

  test("sortable handle (data-no-press) tetap netral", async ({ page }) => {
    await page.goto("/lovable/visual/press-scope");
    const style = await pressAndReadStyle(page, page.getByTestId("press-sortable-handle"));
    expect(parseScaleX(style.transform)).toBeCloseTo(1, 3);
    expect(style.filter === "none" || style.filter === "").toBe(true);
  });

  test("Radix Dialog trigger tidak ikut animasi press", async ({ page }) => {
    await page.goto("/lovable/visual/press-scope");
    const style = await pressAndReadStyle(page, page.getByTestId("press-dialog-trigger"));
    expect(parseScaleX(style.transform)).toBeCloseTo(1, 3);
    expect(style.filter === "none" || style.filter === "").toBe(true);
  });

  test("Radix Dialog overlay, content, dan close bebas dari press", async ({ page }) => {
    await page.goto("/lovable/visual/press-scope");
    await page.getByTestId("press-dialog-trigger").click();

    // Overlay & content muncul di portal — pastikan visible.
    const overlay = page.getByTestId("press-dialog-overlay");
    const content = page.getByTestId("press-dialog-content");
    const closeBtn = page.getByTestId("press-dialog-close");
    await expect(content).toBeVisible();
    await expect(overlay).toBeVisible();

    // Content tidak boleh mendapat scale saat ditekan.
    // Radix mengeset transform sendiri untuk centering; kita periksa
    // bahwa filter tetap `none` — properti yang khas dari :active rule.
    const contentStyle = await pressAndReadStyle(page, content);
    expect(contentStyle.filter === "none" || contentStyle.filter === "").toBe(true);

    // Overlay: transform harus tetap none.
    const overlayStyle = await pressAndReadStyle(page, overlay);
    expect(parseScaleX(overlayStyle.transform)).toBeCloseTo(1, 3);
    expect(overlayStyle.filter === "none" || overlayStyle.filter === "").toBe(true);

    // Tombol close: opt-out juga.
    const closeStyle = await pressAndReadStyle(page, closeBtn);
    expect(parseScaleX(closeStyle.transform)).toBeCloseTo(1, 3);
    expect(closeStyle.filter === "none" || closeStyle.filter === "").toBe(true);
  });
});