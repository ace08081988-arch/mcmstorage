import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: bilah bawah (MobileBottomNav) HARUS selalu menempel ("snap") ke
 * dasar layar — tidak ikut bergeser saat:
 *   1. konten digulir,
 *   2. pindah halaman (navigasi client-side),
 *   3. konten dinamis bertambah (tinggi dokumen berubah).
 *
 * Regresi yang dijaga: `filter`/`transform` pada ancestor yang membuat
 * elemen `position: fixed` jadi ikut menggulir (containing block), serta
 * kompensasi visual viewport di `.app-static-bottom-bar`.
 *
 * Harness: /lovable/visual/bottom-bar-snap (publik, tanpa auth) memakai
 * komponen bottom nav ASLI.
 */

const HARNESS = "/lovable/visual/bottom-bar-snap?rows=60";
/** Toleransi sub-pixel (rounding devicePixelRatio / safe-area). */
const TOL = 1.5;

const nav = (page: Page) => page.getByRole("navigation", { name: "Navigasi utama" });

async function bottomGap(page: Page): Promise<number> {
  const box = await nav(page).boundingBox();
  expect(box, "bilah bawah harus terlihat").not.toBeNull();
  const viewportH = await page.evaluate(
    () => window.visualViewport?.height ?? window.innerHeight,
  );
  return viewportH - (box!.y + box!.height);
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS, { waitUntil: "domcontentloaded" });
  await expect(nav(page)).toBeVisible();
});

test("bilah bawah menempel di dasar layar saat halaman dimuat", async ({ page }) => {
  expect(Math.abs(await bottomGap(page))).toBeLessThanOrEqual(TOL);

  // Posisi harus `fixed`, dan tidak boleh ada ancestor yang menjadikan
  // dirinya containing block (filter/transform/perspective/contain:paint).
  const info = await nav(page).evaluate((el) => {
    const cs = getComputedStyle(el);
    const offenders: string[] = [];
    let p = el.parentElement;
    while (p) {
      const s = getComputedStyle(p);
      if (
        s.filter !== "none" ||
        s.transform !== "none" ||
        s.perspective !== "none" ||
        s.backdropFilter === "none" === false ||
        s.willChange.includes("transform") ||
        s.contain.includes("paint")
      ) {
        offenders.push(p.tagName.toLowerCase() + (p.id ? `#${p.id}` : ""));
      }
      p = p.parentElement;
    }
    return { position: cs.position, offenders };
  });
  expect(info.position).toBe("fixed");
  expect(info.offenders, "tidak boleh ada ancestor containing block").toEqual([]);
});

test("bilah bawah tetap snap saat konten digulir", async ({ page }) => {
  const before = await bottomGap(page);
  for (const y of [200, 600, 1200, 2400]) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" as ScrollBehavior }), y);
    await page.waitForTimeout(80);
    const gap = await bottomGap(page);
    expect(
      Math.abs(gap - before),
      `bilah bergeser ${gap - before}px setelah scroll ke ${y}`,
    ).toBeLessThanOrEqual(TOL);
  }
  // Kembali ke atas juga tidak menggeser bar.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
  await page.waitForTimeout(80);
  expect(Math.abs((await bottomGap(page)) - before)).toBeLessThanOrEqual(TOL);
});

test("bilah bawah tetap snap saat pindah halaman", async ({ page }) => {
  const before = await bottomGap(page);
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("go-next-page").click();
    await expect(page.getByTestId("page-label")).toContainText(`Halaman ${((i + 1) % 3) + 1}`);
    await page.waitForTimeout(80);
    await expect(nav(page)).toBeVisible();
    expect(Math.abs((await bottomGap(page)) - before)).toBeLessThanOrEqual(TOL);
  }
});

test("bilah bawah tetap snap saat konten dinamis bertambah", async ({ page }) => {
  const before = await bottomGap(page);
  const rowsBefore = await page.getByTestId("dynamic-list").locator("li").count();

  for (let i = 1; i <= 3; i++) {
    await page.getByTestId("add-rows").click();
    await expect(page.getByTestId("dynamic-list").locator("li")).toHaveCount(
      rowsBefore + i * 40,
    );
    await page.waitForTimeout(80);
    expect(
      Math.abs((await bottomGap(page)) - before),
      "bilah bergeser saat konten bertambah",
    ).toBeLessThanOrEqual(TOL);
  }

  // Gulir ke dasar dokumen yang baru — bar tetap di posisi yang sama.
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior }));
  await page.waitForTimeout(120);
  expect(Math.abs((await bottomGap(page)) - before)).toBeLessThanOrEqual(TOL);

  // Konten terakhir tidak boleh tertutup bar (spacer otomatis bekerja).
  const lastRow = page.getByTestId("dynamic-list").locator("li").last();
  const [rowBox, navBox] = await Promise.all([lastRow.boundingBox(), nav(page).boundingBox()]);
  expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(navBox!.y + TOL);
});