/**
 * Regresi UX: seluruh tombol toolbar PhotoEditor (Pilih, Coret, Teks,
 * Stiker, Panah, Kotak, Lingkaran) DAN footer (Batal, Simpan) HARUS:
 *  - berada di dalam viewport (tidak terpotong sisi bawah)
 *  - lolos hit-test aktual: `elementFromPoint` di titik tengah tombol
 *    mengembalikan tombol itu sendiri (atau turunannya) — BUKAN span
 *    badge status "Pilih (P) aktif" yang berada tepat di atas toolbar
 *  - benar-benar mengubah state ketika di-click (aria-pressed=true)
 *
 * Diuji pada beberapa viewport, termasuk 411×740 yang sempat memicu
 * regresi "tombol Lingkaran terpotong" sebelum panel toolbar
 * di-scrollable.
 *
 * Catatan false-positive: percobaan manual sebelumnya memakai
 * regex/text matcher "Pilih" tanpa scope, dan cocok dengan badge
 * status di atas toolbar → elementFromPoint mengembalikan span badge.
 * Spec ini memilih tombol via `data-testid` stabil yang HANYA dipasang
 * di ToolBtn, sehingga tidak mungkin cocok dengan badge/hint teks.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "320x568", w: 320, h: 568 },
  { name: "360x640", w: 360, h: 640 },
  { name: "411x740", w: 411, h: 740 }, // regresi guard
  { name: "411x878", w: 411, h: 878 },
  { name: "411x893", w: 411, h: 893 },
  { name: "768x1024", w: 768, h: 1024 },
];

const TOOL_LABELS = ["Pilih", "Coret", "Teks", "Stiker", "Panah", "Kotak", "Lingkaran"] as const;

async function openEditor(page: Page) {
  await page.goto("/lovable/visual/photo-editor");
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>('[data-testid="harness-status"]')?.dataset.status ===
      "open",
  );
  await page.waitForSelector("canvas");
}

async function inViewport(locator: Locator, vw: number, vh: number) {
  const box = await locator.boundingBox();
  expect(box, "bounding box missing").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vw);
  return box!;
}

/**
 * Hit-test yang MEMBEDAKAN tombol dari badge status: elementFromPoint
 * pada titik tengah bbox harus jatuh di dalam `expectedEl` (locator).
 * Kalau jatuh di badge status ("Pilih aktif — ..."), kita gagalkan
 * dengan pesan diagnostik eksplisit — bukan sekedar "not clickable".
 */
async function assertTopmost(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const handle = await locator.elementHandle();
  expect(handle, "element handle missing").not.toBeNull();
  const box = await locator.boundingBox();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  const diag = await page.evaluate(
    ({ x, y, target }) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit) return { ok: false, reason: "no-element-at-point" as const };
      const inTarget = target === hit || target.contains(hit);
      // Deteksi khusus tabrakan dengan badge status di atas toolbar.
      const status = hit.closest('[role="status"]');
      const description =
        (hit as HTMLElement).outerHTML?.slice(0, 200) ?? String(hit.nodeName);
      return {
        ok: inTarget,
        reason: inTarget
          ? ("ok" as const)
          : status
            ? ("obscured-by-status-badge" as const)
            : ("obscured-by-other" as const),
        hitDescription: description,
      };
    },
    { x: cx, y: cy, target: handle! },
  );
  expect(diag, `Hit-test gagal: ${JSON.stringify(diag)}`).toEqual(
    expect.objectContaining({ ok: true }),
  );
}

for (const vp of VIEWPORTS) {
  test.describe(`PhotoEditor toolbar @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });

    test("tombol tool: dalam viewport + topmost + click mengubah state", async ({ page }) => {
      await openEditor(page);

      for (const label of TOOL_LABELS) {
        // Locator stabil — HANYA cocok dengan ToolBtn, tidak mungkin
        // menangkap badge status "Pilih aktif" atau hint teks.
        const btn = page.getByTestId(`photo-editor-tool-${label.toLowerCase()}`);
        await inViewport(btn, vp.w, vp.h);
        await assertTopmost(page, btn);
        await btn.click();
        await expect(btn).toHaveAttribute("aria-pressed", "true");
      }

      const cancel = page.getByRole("button", { name: "Batal", exact: true });
      const save = page.getByRole("button", { name: "Simpan", exact: true });
      await inViewport(cancel, vp.w, vp.h);
      await assertTopmost(page, cancel);
      await inViewport(save, vp.w, vp.h);
      await assertTopmost(page, save);
    });

    test("badge status di atas toolbar TIDAK menutupi tombol Pilih", async ({ page }) => {
      await openEditor(page);
      const pilih = page.getByTestId("photo-editor-tool-pilih");
      await pilih.click(); // pastikan badge "Pilih (P) aktif" muncul
      const badge = page.locator('[role="status"]', { hasText: /Pilih.*aktif/ });
      await expect(badge).toBeVisible();
      // Titik tengah tombol Pilih HARUS mengembalikan tombol itu sendiri,
      // BUKAN badge — kegagalan di sini persis false-positive yang dulu.
      await assertTopmost(page, pilih);
    });
  });
}
