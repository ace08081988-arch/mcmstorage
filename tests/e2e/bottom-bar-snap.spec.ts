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

/**
 * Bilah bawah sengaja `md:hidden` — hanya tampil di breakpoint ponsel.
 * Di tablet/desktop invarian yang berlaku berbeda: bar TIDAK tampil dan
 * spacer harus 0 supaya tidak ada ruang kosong di dasar halaman.
 */
const barShown = (page: Page) => nav(page).isVisible();

const spacerPx = (page: Page) =>
  page.evaluate(
    () =>
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--app-bottom-bar-space",
        ),
      ) || 0,
  );

/** Invarian saat bar disembunyikan (tablet/desktop): tidak ada spacer sisa. */
async function assertHiddenBarInvariants(page: Page, label: string) {
  expect(await spacerPx(page), `spacer harus 0 saat bar tersembunyi (${label})`)
    .toBeLessThanOrEqual(TOL);
}

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
  // Bar hanya tampil di breakpoint ponsel (`md:hidden`); di tablet/desktop
  // cukup pastikan harness ter-render.
  await expect(page.getByTestId("dynamic-list")).toBeVisible();
  // Tunggu hidrasi React selesai: sebelum hidrasi, klik tombol tidak
  // memicu handler apa pun sehingga test jadi flaky.
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const el = document.querySelector("[data-bottom-bar-harness]");
          return el
            ? Object.keys(el).some((k) => k.startsWith("__reactFiber$"))
            : false;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("bilah bawah menempel di dasar layar saat halaman dimuat", async ({ page }) => {
  if (!(await barShown(page))) {
    await assertHiddenBarInvariants(page, "muat awal");
    return;
  }
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
  if (!(await barShown(page))) {
    await page.evaluate(() =>
      window.scrollTo({ top: 2400, behavior: "instant" as ScrollBehavior }),
    );
    await page.waitForTimeout(120);
    await assertHiddenBarInvariants(page, "scroll");
    return;
  }
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
  if (!(await barShown(page))) {
    await page.getByTestId("go-next-page").click();
    await expect(page.getByTestId("page-label")).toContainText("Halaman 2");
    await assertHiddenBarInvariants(page, "pindah halaman");
    return;
  }
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
  if (!(await barShown(page))) {
    await page.getByTestId("add-rows").click();
    await page.waitForTimeout(150);
    await assertHiddenBarInvariants(page, "konten dinamis");
    return;
  }
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

test("bilah bawah & spacer diukur ulang saat orientasi berubah", async ({ page }) => {
  // (lihat juga uji loading & render bertahap di bawah)
  const readVars = () =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        navH: parseFloat(cs.getPropertyValue("--app-bottom-nav-h")) || 0,
        space: parseFloat(cs.getPropertyValue("--app-bottom-bar-space")) || 0,
      };
    });

  /** Landscape ponsel bisa melewati breakpoint `md` sehingga bar mobile
   *  disembunyikan — yang penting variabel spacer ikut disesuaikan. */
  const assertConsistent = async (label: string) => {
    const vars = await readVars();
    const visible = await nav(page).isVisible();
    if (visible) {
      const box = await nav(page).boundingBox();
      expect(Math.abs(await bottomGap(page)), `bar bergeser (${label})`).toBeLessThanOrEqual(TOL);
      expect(Math.abs(vars.navH - box!.height), `--app-bottom-nav-h basi (${label})`).toBeLessThanOrEqual(TOL);
      expect(vars.space).toBeCloseTo(vars.navH, 0);
    } else {
      expect(vars.space, `spacer harus 0 saat bar tersembunyi (${label})`).toBeLessThanOrEqual(TOL);
    }
  };

  const portrait = page.viewportSize()!;
  await assertConsistent("orientasi awal");

  // Portrait -> landscape
  await page.setViewportSize({ width: portrait.height, height: portrait.width });
  await page.waitForTimeout(1200); // tunggu burst pengukuran selesai
  await assertConsistent("landscape");

  // Kembali ke portrait
  await page.setViewportSize(portrait);
  await page.waitForTimeout(1200);
  await assertConsistent("kembali ke portrait");

  // Konten terakhir tetap tidak tertutup bar setelah rotasi bolak-balik.
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior }),
  );
  await page.waitForTimeout(150);
  const lastRow2 = page.getByTestId("dynamic-list").locator("li").last();
  if (await barShown(page)) {
    const [r, n] = await Promise.all([lastRow2.boundingBox(), nav(page).boundingBox()]);
    expect(r!.y + r!.height).toBeLessThanOrEqual(n!.y + TOL);
  }
});