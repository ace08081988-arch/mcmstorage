/**
 * Regresi UX: tombol footer (Batal, Simpan) PhotoEditor HARUS tetap
 * berada di dalam visualViewport ketika:
 *   1. Soft-keyboard terbuka (mis. dialog Teks) → visualViewport shrink.
 *   2. Orientasi berubah (portrait ↔ landscape).
 *
 * visualViewport tidak bisa dipicu langsung di headless Chromium tanpa
 * keyboard fisik. Spec ini mem-override `window.visualViewport` di
 * halaman via `addInitScript` supaya kita bisa memancarkan event
 * `resize` sintetik dan mengukur `bottom` root editor + posisi tombol.
 */
import { test, expect, devices } from "@playwright/test";

test.use({ ...devices["Pixel 5"], viewport: { width: 411, height: 740 } });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // Ganti visualViewport dengan versi terkontrol yang bisa di-emit
    // manual dari test via `(window as any).__setVV({...})`.
    const w = window as unknown as {
      __vv: { height: number; offsetTop: number; listeners: Record<string, Set<() => void>> };
      __setVV: (patch: { height?: number; offsetTop?: number }) => void;
    };
    w.__vv = {
      height: window.innerHeight,
      offsetTop: 0,
      listeners: { resize: new Set(), scroll: new Set() },
    };
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      get() {
        return {
          get height() { return w.__vv.height; },
          get offsetTop() { return w.__vv.offsetTop; },
          addEventListener(ev: string, cb: () => void) { w.__vv.listeners[ev]?.add(cb); },
          removeEventListener(ev: string, cb: () => void) { w.__vv.listeners[ev]?.delete(cb); },
        };
      },
    });
    w.__setVV = (patch) => {
      if (patch.height !== undefined) w.__vv.height = patch.height;
      if (patch.offsetTop !== undefined) w.__vv.offsetTop = patch.offsetTop;
      for (const cb of w.__vv.listeners.resize) cb();
    };
  });
});

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/lovable/visual/photo-editor");
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('[data-testid="harness-status"]')?.dataset.status === "open",
  );
  await page.waitForSelector("canvas");
}

test("footer editor tetap dalam visualViewport saat keyboard terbuka", async ({ page }) => {
  await openEditor(page);
  const save = page.getByRole("button", { name: "Simpan", exact: true });
  const before = await save.boundingBox();
  expect(before).not.toBeNull();
  expect(before!.y + before!.height).toBeLessThanOrEqual(740);

  // Simulasi keyboard 300px terbuka
  await page.evaluate(() => (window as unknown as { __setVV: (p: { height: number }) => void }).__setVV({ height: 440 }));
  await page.waitForFunction(() => {
    // Root editor (fixed) harus punya bottom style ~300px.
    const root = document.querySelector('[aria-label="Toolbar editor foto"]')?.closest('.fixed');
    if (!root) return false;
    const bottom = parseFloat((root as HTMLElement).style.bottom || "0");
    return bottom >= 250;
  });

  // Tombol Simpan sekarang harus berada di atas keyboard: y+h ≤ 440 (visualViewport bottom).
  const after = await save.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.y + after!.height).toBeLessThanOrEqual(440 + 2); // toleransi sub-pixel
});

test("footer kembali ke bawah viewport saat keyboard tertutup", async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => (window as unknown as { __setVV: (p: { height: number }) => void }).__setVV({ height: 440 }));
  await page.waitForFunction(() => {
    const r = document.querySelector('[aria-label="Toolbar editor foto"]')?.closest('.fixed') as HTMLElement | null;
    return !!r && parseFloat(r.style.bottom || "0") > 200;
  });
  await page.evaluate(() => (window as unknown as { __setVV: (p: { height: number }) => void }).__setVV({ height: 740 }));
  await page.waitForFunction(() => {
    const r = document.querySelector('[aria-label="Toolbar editor foto"]')?.closest('.fixed') as HTMLElement | null;
    return !!r && parseFloat(r.style.bottom || "0") < 2;
  });
});

test("perubahan orientasi memperbarui bottom root editor", async ({ page }) => {
  await openEditor(page);
  // Simulasikan rotasi ke landscape: innerHeight tidak bisa diubah dari
  // JS di real Chromium, jadi kita andalkan event orientationchange dan
  // biarkan hook membaca visualViewport terbaru.
  await page.setViewportSize({ width: 740, height: 411 });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("orientationchange"));
    (window as unknown as { __setVV: (p: { height: number }) => void }).__setVV({ height: 411 });
  });
  // Setelah rotasi tanpa keyboard, tidak ada keyboard inset → bottom = 0
  await page.waitForFunction(() => {
    const r = document.querySelector('[aria-label="Toolbar editor foto"]')?.closest('.fixed') as HTMLElement | null;
    return !!r && parseFloat(r.style.bottom || "0") < 2;
  });
  const save = page.getByRole("button", { name: "Simpan", exact: true });
  const box = await save.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(411);
});
