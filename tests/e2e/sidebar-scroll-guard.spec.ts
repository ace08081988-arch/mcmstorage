import { test, expect, devices } from "@playwright/test";

/**
 * E2E: sidebar navigation MUST NOT fire during / immediately after an
 * active scroll gesture — on both mobile (touch pointer) and desktop
 * (mouse + wheel). The real guard lives in `src/components/AppSidebar.tsx`
 * (`__scrollActiveUntil` + `NavLinkItem` pointer tracking).
 *
 * Rather than authenticating and driving the real sidebar, we mount a
 * self-contained harness page that reproduces the exact guard algorithm
 * (bump on scroll/wheel/touchmove for 250ms, tap only fires on
 * pointerup if !scrollActive and drift ≤ 10px and dt ≤ 600ms).
 *
 * ### Stabilitas di CI
 * Harness memakai **virtual clock** (`window.__now()`), bukan `Date.now()`,
 * sehingga cooldown 250ms dan durasi tap 600ms tidak lagi bergantung pada
 * wall-clock CI. Test mengontrol waktu lewat `window.__advance(ms)` alih-alih
 * `waitForTimeout`, dan menunggu efek DOM lewat `expect.poll` / auto-retry
 * locator — bukan sleep tetap. Auto-hide hint dihilangkan agar assertion
 * `.toHaveClass(/show/)` tidak balapan dengan timer pembersih.
 */

const HARNESS = /* html */ `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;font-family:system-ui;}
  #scroller{height:300px;overflow:auto;border:1px solid #ccc;}
  .item{padding:16px;border-bottom:1px solid #eee;user-select:none;touch-action:pan-y;}
  #log{padding:8px;font-family:monospace;font-size:12px;white-space:pre;}
  .spacer{height:1200px;}
  #hint{position:fixed;left:0;top:0;padding:4px 8px;font-size:11px;background:#111;color:#fff;border-radius:999px;pointer-events:none;opacity:0;}
  #hint.show{opacity:1;}
</style></head><body>
  <div id="scroller">
    <a class="item" data-testid="nav-home" href="#home">Home</a>
    <a class="item" data-testid="nav-sesi" href="#sesi">Sesi</a>
    <a class="item" data-testid="nav-chat" href="#chat">Chat</a>
    <div class="spacer"></div>
  </div>
  <div id="log"></div>
  <div id="hint" data-testid="scroll-guard-hint" role="status" aria-live="polite"></div>
  <script>
    // Virtual clock — tumbuh HANYA lewat window.__advance(ms). Semua batas
    // waktu guard (cooldown, durasi tap) ikut clock ini, jadi hasil test
    // deterministik dan tidak terpengaruh kecepatan CI.
    window.__clock = 1000;
    window.__now = () => window.__clock;
    window.__advance = (ms) => { window.__clock += ms; };
    let scrollActiveUntil = 0;
    const bump = () => { scrollActiveUntil = window.__now() + 250; };
    ["scroll","wheel","touchmove"].forEach(ev =>
      window.addEventListener(ev, bump, { capture: true, passive: true })
    );
    const scroller = document.getElementById("scroller");
    scroller.addEventListener("scroll", bump, { capture: true, passive: true });
    const log = document.getElementById("log");
    const hintEl = document.getElementById("hint");
    window.__hints = [];
    const showHint = (text, x, y) => {
      window.__hints.push(text);
      hintEl.textContent = text;
      hintEl.style.transform = "translate(" + (x + 8) + "px," + (y + 8) + "px)";
      hintEl.classList.add("show");
      // Auto-hide sengaja DIHILANGKAN di harness — assertion `.toHaveClass(/show/)`
      // di test tidak boleh balapan dengan timer real. Kelas dibersihkan hanya
      // saat hint berikutnya di-`showHint` dengan clear manual di sini juga
      // tidak perlu karena classList.add idempotent.
    };
    window.__navs = [];
    document.querySelectorAll(".item").forEach(el => {
      let start = null;
      el.addEventListener("pointerdown", e => {
        if (window.__now() < scrollActiveUntil) {
          start = null;
          showHint("Tunggu scroll selesai…", e.clientX, e.clientY);
          return;
        }
        start = { x: e.clientX, y: e.clientY, t: window.__now() };
      });
      el.addEventListener("pointermove", e => {
        if (!start) return;
        if (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10) start = null;
      });
      el.addEventListener("pointercancel", () => { start = null; });
      el.addEventListener("pointerup", e => {
        const s = start; start = null;
        if (!s) return;
        if (window.__now() < scrollActiveUntil) {
          showHint("Tunggu scroll selesai…", e.clientX, e.clientY);
          return;
        }
        const dx = Math.abs(e.clientX - s.x), dy = Math.abs(e.clientY - s.y);
        const dt = window.__now() - s.t;
        if (dx > 10 || dy > 10 || dt > 600) {
          showHint("Geser terdeteksi — tap dibatalkan", e.clientX, e.clientY);
          return;
        }
        e.preventDefault();
        const id = el.getAttribute("data-testid");
        window.__navs.push(id);
        log.textContent += "nav:" + id + "\\n";
      });
      // Prevent default anchor navigation from muddying results.
      el.addEventListener("click", e => e.preventDefault());
    });
  </script>
</body></html>`;

// Helpers deterministik — tidak ada `waitForTimeout`.
async function readNavs(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __navs: string[] }).__navs);
}
async function readHints(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __hints: string[] }).__hints);
}
async function advance(page: import("@playwright/test").Page, ms: number): Promise<void> {
  await page.evaluate((m) => (window as unknown as { __advance: (n: number) => void }).__advance(m), ms);
}

test.describe("sidebar scroll guard (mobile / touch)", () => {
  test.use({ ...devices["iPhone 14"], viewport: { width: 390, height: 844 }, hasTouch: true });

  test("tap tanpa scroll → navigasi terpicu", async ({ page }) => {
    await page.setContent(HARNESS);
    const target = page.getByTestId("nav-sesi");
    const box = (await target.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    // Auto-retry sampai handler pointerup selesai — tidak ada sleep tetap.
    await expect.poll(() => readNavs(page)).toEqual(["nav-sesi"]);
    // Tap diizinkan → tooltip guard TIDAK muncul.
    expect(await readHints(page)).toEqual([]);
    await expect(page.getByTestId("scroll-guard-hint")).not.toHaveClass(/show/);
  });

  test("scroll gesture di atas item → TIDAK navigasi", async ({ page }) => {
    await page.setContent(HARNESS);
    const target = page.getByTestId("nav-chat");
    const box = (await target.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Simulasi swipe scroll: pointerdown → gerak > 10px → pointerup.
    // Semua dispatch synchronous di dalam satu evaluate — tidak ada race
    // antara Playwright dan handler DOM.
    await page.evaluate(({ cx, cy }) => {
      const el = document.elementFromPoint(cx, cy)!;
      const opts = (x: number, y: number) => ({
        clientX: x, clientY: y, bubbles: true, cancelable: true,
        pointerId: 1, pointerType: "touch", isPrimary: true,
      });
      el.dispatchEvent(new PointerEvent("pointerdown", opts(cx, cy)));
      // Fire native scroll bumps by dispatching touchmove events too.
      for (let i = 1; i <= 6; i++) {
        el.dispatchEvent(new PointerEvent("pointermove", opts(cx, cy - i * 20)));
        window.dispatchEvent(new Event("touchmove"));
        document.getElementById("scroller")!.scrollTop = i * 20;
      }
      el.dispatchEvent(new PointerEvent("pointerup", opts(cx, cy - 120)));
    }, { cx, cy });
    expect(await readNavs(page)).toEqual([]);
    // Drift > 10px pada pointerup → hint "Geser terdeteksi" muncul.
    await expect
      .poll(() => readHints(page))
      .toContain("Geser terdeteksi — tap dibatalkan");
    await expect(page.getByTestId("scroll-guard-hint")).toHaveClass(/show/);
  });

  test("tap yang mendarat < 250ms setelah scroll berhenti → TIDAK navigasi", async ({ page }) => {
    await page.setContent(HARNESS);
    // Bump scrollActiveUntil (virtual clock TIDAK maju), lalu tap segera.
    // Karena __clock tetap, cooldown 250ms belum lewat → tap ditolak.
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    const target = page.getByTestId("nav-home");
    const box = (await target.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    expect(await readNavs(page)).toEqual([]);
    await expect.poll(() => readHints(page)).toContain("Tunggu scroll selesai…");
    await expect(page.getByTestId("scroll-guard-hint")).toHaveClass(/show/);
  });

  test("tap setelah scroll cooldown lewat (>250ms) → navigasi terpicu", async ({ page }) => {
    await page.setContent(HARNESS);
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    // Maju-kan virtual clock, bukan wall-clock — deterministik di CI.
    await advance(page, 320);
    const target = page.getByTestId("nav-sesi");
    const box = (await target.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => readNavs(page)).toEqual(["nav-sesi"]);
    expect(await readHints(page)).toEqual([]);
    await expect(page.getByTestId("scroll-guard-hint")).not.toHaveClass(/show/);
  });
});

test.describe("sidebar scroll guard (desktop / mouse + wheel)", () => {
  test.use({ ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } });

  test("klik biasa → navigasi terpicu", async ({ page }) => {
    await page.setContent(HARNESS);
    await page.getByTestId("nav-chat").click();
    await expect.poll(() => readNavs(page)).toEqual(["nav-chat"]);
    expect(await readHints(page)).toEqual([]);
    await expect(page.getByTestId("scroll-guard-hint")).not.toHaveClass(/show/);
  });

  test("wheel scroll aktif → klik dalam 250ms TIDAK navigasi", async ({ page }) => {
    await page.setContent(HARNESS);
    const target = page.getByTestId("nav-sesi");
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.wheel(0, 200);
    // Klik langsung: __clock TIDAK di-advance → cooldown belum lewat, guard tolak.
    await target.click({ noWaitAfter: true });
    expect(await readNavs(page)).toEqual([]);
    await expect.poll(() => readHints(page)).toContain("Tunggu scroll selesai…");
    await expect(page.getByTestId("scroll-guard-hint")).toHaveClass(/show/);
  });

  test("wheel scroll → tunggu cooldown → klik navigasi normal", async ({ page }) => {
    await page.setContent(HARNESS);
    const target = page.getByTestId("nav-home");
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.wheel(0, 200);
    await advance(page, 320);
    await target.click();
    await expect.poll(() => readNavs(page)).toEqual(["nav-home"]);
    expect(await readHints(page)).toEqual([]);
    await expect(page.getByTestId("scroll-guard-hint")).not.toHaveClass(/show/);
  });
});