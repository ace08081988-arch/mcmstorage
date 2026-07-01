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
 * pointerup if !scrollActive and drift ≤ 10px and dt ≤ 600ms). This
 * keeps the invariant testable without backend/session.
 */

const HARNESS = /* html */ `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;font-family:system-ui;}
  #scroller{height:300px;overflow:auto;border:1px solid #ccc;}
  .item{padding:16px;border-bottom:1px solid #eee;user-select:none;touch-action:pan-y;}
  #log{padding:8px;font-family:monospace;font-size:12px;white-space:pre;}
  .spacer{height:1200px;}
  #hint{position:fixed;left:0;top:0;padding:4px 8px;font-size:11px;background:#111;color:#fff;border-radius:999px;pointer-events:none;opacity:0;transition:opacity .12s;}
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
    let scrollActiveUntil = 0;
    const bump = () => { scrollActiveUntil = Date.now() + 250; };
    ["scroll","wheel","touchmove"].forEach(ev =>
      window.addEventListener(ev, bump, { capture: true, passive: true })
    );
    const scroller = document.getElementById("scroller");
    scroller.addEventListener("scroll", bump, { capture: true, passive: true });
    const log = document.getElementById("log");
    const hintEl = document.getElementById("hint");
    let hintTimer = 0;
    window.__hints = [];
    const showHint = (text, x, y) => {
      window.__hints.push(text);
      hintEl.textContent = text;
      hintEl.style.transform = "translate(" + (x + 8) + "px," + (y + 8) + "px)";
      hintEl.classList.add("show");
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hintEl.classList.remove("show"), 1200);
    };
    window.__navs = [];
    document.querySelectorAll(".item").forEach(el => {
      let start = null;
      el.addEventListener("pointerdown", e => {
        if (Date.now() < scrollActiveUntil) {
          start = null;
          showHint("Tunggu scroll selesai…", e.clientX, e.clientY);
          return;
        }
        start = { x: e.clientX, y: e.clientY, t: Date.now() };
      });
      el.addEventListener("pointermove", e => {
        if (!start) return;
        if (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10) start = null;
      });
      el.addEventListener("pointercancel", () => { start = null; });
      el.addEventListener("pointerup", e => {
        const s = start; start = null;
        if (!s) return;
        if (Date.now() < scrollActiveUntil) {
          showHint("Tunggu scroll selesai…", e.clientX, e.clientY);
          return;
        }
        const dx = Math.abs(e.clientX - s.x), dy = Math.abs(e.clientY - s.y);
        const dt = Date.now() - s.t;
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

test.describe("sidebar scroll guard (mobile / touch)", () => {
  test.use({ ...devices["iPhone 14"], viewport: { width: 390, height: 844 }, hasTouch: true });

  test("tap tanpa scroll → navigasi terpicu", async ({ page }) => {
    await page.setContent(HARNESS);
    const target = page.getByTestId("nav-sesi");
    const box = (await target.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.evaluate(() => (window as any).__navs)).toEqual(["nav-sesi"]);
  });

  test("scroll gesture di atas item → TIDAK navigasi", async ({ page }) => {
    await page.setContent(HARNESS);
    const target = page.getByTestId("nav-chat");
    const box = (await target.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Simulasi swipe scroll: pointerdown → gerak > 10px → pointerup.
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
    expect(await page.evaluate(() => (window as any).__navs)).toEqual([]);
  });

  test("tap yang mendarat < 250ms setelah scroll berhenti → TIDAK navigasi", async ({ page }) => {
    await page.setContent(HARNESS);
    // Bump scrollActiveUntil, lalu tap segera.
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    const target = page.getByTestId("nav-home");
    const box = (await target.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.evaluate(() => (window as any).__navs)).toEqual([]);
  });

  test("tap setelah scroll cooldown lewat (>250ms) → navigasi terpicu", async ({ page }) => {
    await page.setContent(HARNESS);
    await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
    await page.waitForTimeout(320);
    const target = page.getByTestId("nav-sesi");
    const box = (await target.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.evaluate(() => (window as any).__navs)).toEqual(["nav-sesi"]);
  });
});

test.describe("sidebar scroll guard (desktop / mouse + wheel)", () => {
  test.use({ ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } });

  test("klik biasa → navigasi terpicu", async ({ page }) => {
    await page.setContent(HARNESS);
    await page.getByTestId("nav-chat").click();
    expect(await page.evaluate(() => (window as any).__navs)).toEqual(["nav-chat"]);
  });

  test("wheel scroll aktif → klik dalam 250ms TIDAK navigasi", async ({ page }) => {
    await page.setContent(HARNESS);
    const target = page.getByTestId("nav-sesi");
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.wheel(0, 200);
    // Klik langsung: guard harus menolak karena scrollActiveUntil belum lewat.
    await target.click({ noWaitAfter: true });
    expect(await page.evaluate(() => (window as any).__navs)).toEqual([]);
  });

  test("wheel scroll → tunggu cooldown → klik navigasi normal", async ({ page }) => {
    await page.setContent(HARNESS);
    const target = page.getByTestId("nav-home");
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(320);
    await target.click();
    expect(await page.evaluate(() => (window as any).__navs)).toEqual(["nav-home"]);
  });
});