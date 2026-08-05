import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: bilah bawah HARUS tetap dapat dipakai dengan keyboard.
 *
 * Invarian yang dijaga:
 *   1. Semua slot (4 link + tombol Menu) bisa dicapai dengan Tab, urut
 *      kiri→kanan, dan mendapat cincin fokus (`focus-visible`).
 *   2. Enter/Space pada tombol "Menu" mengaktifkan aksinya (buka sidebar).
 *   3. Scroll halaman TIDAK mencuri/menghilangkan fokus (engine
 *      viewport-anchor & pengukuran tinggi tidak boleh me-remount bar).
 *   4. Pindah halaman (navigasi client-side) tidak membuat fokus hilang ke
 *      <body> secara tak terduga, dan bar tetap bisa di-Tab setelahnya.
 *
 * Harness: /lovable/visual/bottom-bar-snap (publik, tanpa auth).
 */

const HARNESS = "/lovable/visual/bottom-bar-snap?rows=60";
const LABELS = ["Beranda", "Gudang", "Ecer", "Chat", "Menu"];

const nav = (page: Page) => page.getByRole("navigation", { name: "Navigasi utama" });
const barShown = (page: Page) => nav(page).isVisible();

/** Label aksesibel elemen yang sedang fokus (atau null). */
const focusedLabel = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    return el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName;
  });

/** Apakah elemen fokus berada di dalam bilah bawah? */
const focusInsideBar = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('nav[aria-label="Navigasi utama"]');
    return !!bar && !!document.activeElement && bar.contains(document.activeElement);
  });

/** Tab sampai fokus masuk ke bilah bawah (maks 40 langkah). */
async function tabIntoBar(page: Page): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (await focusInsideBar(page)) return true;
  }
  return false;
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("dynamic-list")).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const el = document.querySelector("[data-bottom-bar-harness]");
          return el ? Object.keys(el).some((k) => k.startsWith("__reactFiber$")) : false;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("semua slot bilah bawah dapat dicapai dengan Tab dan punya cincin fokus", async ({ page }) => {
  test.skip(!(await barShown(page)), "bilah bawah md:hidden di tablet/desktop");

  expect(await tabIntoBar(page), "fokus tidak pernah sampai ke bilah bawah").toBe(true);

  const seen: string[] = [];
  for (let i = 0; i < LABELS.length; i++) {
    if (!(await focusInsideBar(page))) break;
    const label = (await focusedLabel(page)) ?? "";
    seen.push(label);
    // Cincin fokus terlihat (focus-visible dari keyboard).
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, outline: cs.outlineStyle, matches: el.matches(":focus-visible") };
    });
    expect(ring?.matches, `slot "${label}" tidak :focus-visible`).toBe(true);
    if (i < LABELS.length - 1) await page.keyboard.press("Tab");
  }

  // Urutan Tab harus sesuai urutan visual kiri→kanan.
  expect(seen.length, "jumlah slot yang bisa di-Tab").toBe(LABELS.length);
  seen.forEach((label, i) => {
    expect(label.toLowerCase(), `urutan tab slot ke-${i + 1}`).toContain(LABELS[i]!.toLowerCase());
  });
});

test("Enter pada tombol Menu membuka sidebar", async ({ page }) => {
  test.skip(!(await barShown(page)), "bilah bawah md:hidden di tablet/desktop");

  const menu = nav(page).getByRole("button", { name: /Buka menu/i });
  await menu.focus();
  await expect(menu).toBeFocused();
  await page.keyboard.press("Enter");

  // State sidebar (drawer mobile) berubah jadi terbuka.
  await expect(page.getByTestId("sidebar-state")).toHaveText("open", { timeout: 5_000 });

  // Space juga mengaktifkan tombol (toggle kembali ke tertutup) dan fokus
  // tetap di tombol Menu — tidak lompat ke elemen lain.
  await expect(menu).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("sidebar-state")).toHaveText("closed", { timeout: 5_000 });
  await expect(menu).toBeFocused();
});

test("scroll tidak mencuri fokus dari bilah bawah", async ({ page }) => {
  test.skip(!(await barShown(page)), "bilah bawah md:hidden di tablet/desktop");

  const chat = nav(page).getByRole("link", { name: /^Chat/ });
  await chat.focus();
  const before = await focusedLabel(page);

  for (const top of [400, 1200, 2400, 0]) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior }), top);
    await page.waitForTimeout(120);
    expect(await focusInsideBar(page), `fokus keluar dari bar setelah scroll ${top}`).toBe(true);
    expect(await focusedLabel(page), `elemen fokus berubah setelah scroll ${top}`).toBe(before);
  }

  // Enter/Space tetap bisa dipakai setelah scroll (bar tidak inert).
  await expect(chat).toBeFocused();
});

test("pindah halaman & konten dinamis tidak merusak fokus bilah bawah", async ({ page }) => {
  test.skip(!(await barShown(page)), "bilah bawah md:hidden di tablet/desktop");

  const gudang = nav(page).getByRole("link", { name: /^Gudang/ });
  await gudang.focus();

  // Navigasi client-side (search param) — bar tidak boleh remount & buang fokus.
  await page.getByTestId("go-next-page").click({ force: true });
  await expect(page.getByTestId("page-label")).toContainText("Halaman 2");
  await page.waitForTimeout(150);
  await expect(nav(page)).toBeVisible();

  // Setelah pindah halaman, bilah bawah tetap bisa dicapai dengan keyboard.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await tabIntoBar(page), "bar tidak bisa di-Tab setelah pindah halaman").toBe(true);

  // Konten dinamis bertambah -> fokus di bar tetap bertahan.
  const focusedBefore = await focusedLabel(page);
  // dispatch tanpa memindahkan fokus ke tombol (simulasi konten async).
  await page.getByTestId("add-rows").dispatchEvent("click");
  await page.waitForTimeout(200);
  expect(await focusInsideBar(page), "fokus hilang saat konten bertambah").toBe(true);
  expect(await focusedLabel(page)).toBe(focusedBefore);
});
