/**
 * Regression guard: PhotoEditor MUST work on Android/mobile touch devices.
 *
 * Latar: pada emulasi Android Chrome (dan sebagian Android WebView) event
 * `pointerdown` di-supress oleh browser saat CSS `touch-action: none`
 * dipasang dan `touchstart` mendahului. Kalau kanvas hanya mendengarkan
 * pointer events, `onPointerDown` tidak pernah jalan → `drawingRef` tidak
 * pernah diinisialisasi → SEMUA tool (Coret, Kotak, Lingkaran, Panah,
 * Select drag) gagal senyap.
 *
 * Spec ini mengarahkan Playwright touchscreen (CDP `Input.dispatchTouchEvent`)
 * ke harness publik `/lovable/visual/photo-editor` dan mem-verifikasi bahwa
 * tiap tool benar-benar meninggalkan piksel pada kanvas.
 */
import { test, expect, devices } from "@playwright/test";

test.use({ ...devices["Pixel 7"] });

async function waitCanvas(page: import("@playwright/test").Page) {
  await page.goto("/lovable/visual/photo-editor");
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>('[data-testid="harness-status"]')?.dataset.status === "open",
  );
  await page.waitForFunction(
    () =>
      !!document.querySelector("canvas") &&
      !document.querySelector('[aria-label="Menyiapkan kanvas"]'),
  );
}

async function canvasBox(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const r = document.querySelector("canvas")!.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

async function redPixelCount(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!c) return 0;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 200 && d[i + 1] < 120 && d[i + 2] < 120 && d[i + 3] > 0) n++;
    }
    return n;
  });
}

async function touchDrag(cdp: import("@playwright/test").CDPSession, x1: number, y1: number, x2: number, y2: number, steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: x1, y: y1, id: 1, force: 0.5 }],
  });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, id: 1, force: 0.5 },
      ],
    });
    await new Promise((r) => setTimeout(r, 15));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function touchTap(cdp: import("@playwright/test").CDPSession, x: number, y: number) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1, force: 0.5 }],
  });
  await new Promise((r) => setTimeout(r, 30));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("PhotoEditor: Coret drag meninggalkan piksel di kanvas Android", async ({ page, context }) => {
  await waitCanvas(page);
  const cdp = await context.newCDPSession(page);
  const box = await canvasBox(page);
  await page.getByRole("button", { name: "Coret", exact: true }).click({ force: true });
  const before = await redPixelCount(page);
  await touchDrag(cdp, box.x + box.w * 0.3, box.y + box.h * 0.5, box.x + box.w * 0.7, box.y + box.h * 0.6);
  await page.waitForTimeout(200);
  const after = await redPixelCount(page);
  expect(after - before).toBeGreaterThan(500);
});

test("PhotoEditor: Kotak tap-only menempatkan default rect", async ({ page, context }) => {
  await waitCanvas(page);
  const cdp = await context.newCDPSession(page);
  const box = await canvasBox(page);
  await page.getByRole("button", { name: "Kotak", exact: true }).click({ force: true });
  const before = await redPixelCount(page);
  await touchTap(cdp, box.x + box.w * 0.5, box.y + box.h * 0.5);
  await page.waitForTimeout(200);
  const after = await redPixelCount(page);
  expect(after - before).toBeGreaterThan(500);
});

test("PhotoEditor: Lingkaran tap-only menempatkan default circle", async ({ page, context }) => {
  await waitCanvas(page);
  const cdp = await context.newCDPSession(page);
  const box = await canvasBox(page);
  await page.getByRole("button", { name: "Lingkaran", exact: true }).click({ force: true });
  const before = await redPixelCount(page);
  await touchTap(cdp, box.x + box.w * 0.5, box.y + box.h * 0.5);
  await page.waitForTimeout(200);
  const after = await redPixelCount(page);
  expect(after - before).toBeGreaterThan(500);
});

test("PhotoEditor: pointercancel mid-drag tidak membekukan tool berikutnya", async ({ page, context }) => {
  await waitCanvas(page);
  const cdp = await context.newCDPSession(page);
  const box = await canvasBox(page);
  // Mulai drag lalu batalkan
  await page.getByRole("button", { name: "Coret", exact: true }).click({ force: true });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + 40, y: box.y + 40, id: 1, force: 0.5 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: box.x + 60, y: box.y + 60, id: 1, force: 0.5 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await page.waitForTimeout(100);
  // Sekarang gunakan Kotak — HARUS tetap bekerja
  await page.getByRole("button", { name: "Kotak", exact: true }).click({ force: true });
  const before = await redPixelCount(page);
  await touchDrag(cdp, box.x + box.w * 0.2, box.y + box.h * 0.3, box.x + box.w * 0.5, box.y + box.h * 0.5);
  await page.waitForTimeout(200);
  const after = await redPixelCount(page);
  expect(after - before).toBeGreaterThan(500);
});

test("PhotoEditor: Stiker tombol emoji langsung menempel di tengah kanvas", async ({ page }) => {
  await waitCanvas(page);
  await page.getByRole("button", { name: "Stiker", exact: true }).click({ force: true });
  const before = await page.evaluate(() => {
    const c = document.querySelector("canvas") as HTMLCanvasElement;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) n++;
    return n;
  });
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "⭐");
    if (!btn) return false;
    (btn as HTMLElement).click();
    return true;
  });
  expect(clicked).toBe(true);
  await page.waitForTimeout(200);
  // Layer ⭐ ditambahkan → Simpan menghasilkan blob dengan bytes > baseline
  await page.getByRole("button", { name: "Simpan", exact: true }).click({ force: true });
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('[data-testid="harness-status"]')?.dataset.status === "saved",
    { timeout: 15000 },
  );
  const savedText = await page.getByTestId("harness-saved").innerText();
  // Baseline (tanpa layer apa pun) ≈ 11 KB; setelah menambah emoji, ukuran naik.
  const bytes = Number(savedText.match(/Tersimpan:\s+(\d+)/)?.[1] ?? "0");
  expect(bytes).toBeGreaterThan(11800);
  expect(before).toBeGreaterThan(0);
});