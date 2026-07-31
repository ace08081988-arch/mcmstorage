/**
 * E2E: sinkronisasi objectFit/objectPosition antara video remote & preview
 * lokal di CallScreen, termasuk saat swap besar/kecil dan swap kamera
 * front↔back tanpa reload.
 *
 * Harness: /lovable/visual/call-video-stage — dua `<video>` mengonsumsi
 * helper yang SAMA dengan CallScreen (`computeVideoStyle` +
 * `videoFitClassFor`). Test memvalidasi via `getComputedStyle` — bukan
 * inline attribute — supaya juga menangkap regresi CSS yang menimpa
 * style inline (mis. utility Tailwind bocor mengoverride objectFit).
 */
import { test, expect, type Page } from "@playwright/test";

const URL = "/lovable/visual/call-video-stage";

async function computed(page: Page, testid: string) {
  return await page.locator(`[data-testid="${testid}"]`).evaluate((el) => {
    const s = getComputedStyle(el as HTMLElement);
    return { fit: s.objectFit, pos: s.objectPosition };
  });
}
async function assertSynced(page: Page, message: string) {
  const r = await computed(page, "remote");
  const l = await computed(page, "local");
  expect(r.fit, `objectFit desync di step: ${message}`).toBe(l.fit);
  expect(r.pos, `objectPosition desync di step: ${message}`).toBe(l.pos);
  return r;
}

test.describe("Call video · objectFit/objectPosition sync", () => {
  test("remote ↔ preview lokal tetap sinkron di semua transisi (fit/pos/swap/flip)", async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByTestId("stage-state")).toBeVisible();

    // Baseline: cover + 50% 50%.
    let s = await assertSynced(page, "initial");
    expect(s.fit).toBe("cover");
    expect(s.pos).toBe("50% 50%");

    // Toggle Fit (contain) — helper WAJIB kunci posisi ke 50% 50%.
    await page.getByTestId("btn-toggle-fit").click();
    s = await assertSynced(page, "toggle → contain");
    expect(s.fit).toBe("contain");
    expect(s.pos).toBe("50% 50%");

    // Toggle balik ke cover.
    await page.getByTestId("btn-toggle-fit").click();
    s = await assertSynced(page, "toggle → cover");
    expect(s.fit).toBe("cover");

    // Siklus preset posisi — kedua video harus ikut.
    await page.getByTestId("btn-cycle-pos").click(); // center → top
    s = await assertSynced(page, "cycle → top");
    expect(s.pos).toBe("50% 0%");

    // Drag custom (20,80).
    await page.getByTestId("btn-drag").click();
    s = await assertSynced(page, "drag custom (20,80)");
    expect(s.pos).toBe("20% 80%");

    // Swap besar/kecil — locator testid MENGIKUTI peran (bukan posisi
    // fisik), jadi remote tetap remote setelah swap; keduanya wajib
    // tetap punya style yang sama.
    await page.getByTestId("btn-swap").click();
    s = await assertSynced(page, "swap besar/kecil");
    expect(s.pos).toBe("20% 80%");

    // Swap balik.
    await page.getByTestId("btn-swap").click();
    await assertSynced(page, "swap balik");

    // Flip kamera → kamera belakang (state fresh, posisi kembali default).
    await page.getByTestId("btn-flip").click();
    s = await assertSynced(page, "flip → environment");
    expect(s.pos).toBe("50% 50%");
    expect(s.fit).toBe("cover");

    // Ubah preset kamera belakang → 'top'.
    await page.getByTestId("btn-cycle-pos").click();
    s = await assertSynced(page, "back: cycle → top");
    expect(s.pos).toBe("50% 0%");

    // Flip balik → kamera depan; state front (custom 20,80) harus kembali.
    await page.getByTestId("btn-flip").click();
    s = await assertSynced(page, "flip → user (state front pulih)");
    expect(s.pos).toBe("20% 80%");

    // Kombinasi terakhir: swap + toggle fit + swap; posisi harus reset ke
    // 50% 50% karena fit=contain, dan tetap sinkron.
    await page.getByTestId("btn-swap").click();
    await page.getByTestId("btn-toggle-fit").click();
    s = await assertSynced(page, "swap + contain");
    expect(s.fit).toBe("contain");
    expect(s.pos).toBe("50% 50%");
    await page.getByTestId("btn-swap").click();
    await assertSynced(page, "swap kembali");
  });
});