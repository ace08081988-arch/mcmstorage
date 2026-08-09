/**
 * Pengujian split-screen & jendela browser kecil.
 *
 * Skenario nyata yang diuji:
 *  - Android/iPad split-screen: lebar normal tapi TINGGI sangat pendek
 *    (240–400 px), sehingga action bar & FAB mudah bertabrakan dengan
 *    gesture bar atau keluar viewport.
 *  - Jendela browser desktop yang dikecilkan (500x300, 640x360).
 *  - Keyboard terbuka di ruang sempit: `--app-keyboard-inset` di-override
 *    untuk memastikan bilah aksi ikut naik dan tetap terlihat.
 *
 * Asersi per elemen yang dipaku ke bawah:
 *   1. tepi bawah di atas zona gesture (vh - safe bottom - keyboard),
 *   2. tidak masuk cutout kiri/kanan,
 *   3. tetap berada di dalam viewport (tidak terpotong atas/samping),
 *   4. tinggi elemen tidak melebihi ruang terlihat.
 *
 * Jalankan: `bun run test:split-screen`
 */
import { test, expect, type Page } from "@playwright/test";

type Insets = { top: number; bottom: number; left: number; right: number };

const EPS = 1;

/** Di ruang sempit, sistem tetap memesan gesture bar / status bar. */
const insetsFor = (w: number, h: number): Insets =>
  w > h
    ? { top: 24, bottom: 21, left: 34, right: 34 }
    : { top: 32, bottom: 24, left: 0, right: 0 };

const VIEWPORTS = [
  // Split-screen HP (setengah layar atas/bawah)
  { name: "split-hp-320x240", width: 320, height: 240 },
  { name: "split-hp-360x320", width: 360, height: 320 },
  { name: "split-hp-412x360", width: 412, height: 360 },
  // Split-screen tablet & foldable
  { name: "split-tablet-768x400", width: 768, height: 400 },
  { name: "split-tablet-540x720", width: 540, height: 720 },
  // Jendela browser desktop kecil
  { name: "window-500x300", width: 500, height: 300 },
  { name: "window-640x360", width: 640, height: 360 },
];

const ROUTES = [
  "/lovable/visual/fab-clearance",
  "/lovable/visual/fab-clearance?bar=off",
  "/lovable/visual/bottom-bar-snap",
  "/pos-kasir",
];

/** 0 = tanpa keyboard, >0 = keyboard virtual menutupi bagian bawah. */
const KEYBOARD_CASES = [0, 140];

async function injectEnv(page: Page, insets: Insets, keyboard: number) {
  await page.addStyleTag({
    content: `:root{
      --app-safe-top:${insets.top}px !important;
      --app-safe-bottom:${insets.bottom}px !important;
      --app-safe-left:${insets.left}px !important;
      --app-safe-right:${insets.right}px !important;
      --app-keyboard-inset:${keyboard}px !important;
    }`,
  });
  await page.waitForTimeout(250);
}

const MEASURE = ({
  insets,
  keyboard,
  eps,
}: {
  insets: Insets;
  keyboard: number;
  eps: number;
}) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Batas bawah yang aman: gesture bar + area yang tertutup keyboard.
  const bottomLimit = vh - Math.max(insets.bottom, 0) - keyboard;
  const out: Array<{
    reason: string;
    label: string;
    rect: Record<string, number>;
    detail?: string;
  }> = [];

  const isPinnedBottom = (node: Element) => {
    let n: Element | null = node;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if ((cs.position === "fixed" || cs.position === "sticky") && cs.bottom !== "auto")
        return true;
      n = n.parentElement;
    }
    return false;
  };

  const marked = Array.from(document.querySelectorAll("[data-clearance]"));
  const pinned = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, a[href], [role='button'], input:not([type='hidden'])",
    ),
  ).filter((el) => isPinnedBottom(el));
  const targets = Array.from(new Set<Element>([...marked, ...pinned]));

  const navBar = document.querySelector(".app-static-bottom-bar");

  for (const el of targets) {
    if (el.closest("[data-skip-link], .sr-only, [aria-hidden='true']")) continue;
    if (navBar && navBar.contains(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom < 0 || r.top > vh) continue;

    const label =
      el.getAttribute("data-testid") ||
      el.getAttribute("aria-label") ||
      (el.textContent || "").trim().slice(0, 40) ||
      el.tagName.toLowerCase();
    const rect = {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };

    if (r.bottom > bottomLimit + eps)
      out.push({
        reason: keyboard > 0 ? "tertutup-keyboard" : "tertutup-gesture-bar",
        label,
        rect,
        detail: `bottom=${Math.round(r.bottom)} > batas=${Math.round(bottomLimit)}`,
      });

    if (r.left < insets.left - eps || r.right > vw - insets.right + eps)
      out.push({ reason: "masuk-cutout-samping", label, rect });

    if (r.top < -eps || r.right < eps || r.left > vw - eps)
      out.push({ reason: "keluar-viewport", label, rect });

    // Di ruang sangat pendek, bar tidak boleh memakan seluruh layar.
    if (r.height > vh - insets.top - insets.bottom + eps)
      out.push({
        reason: "lebih-tinggi-dari-area-terlihat",
        label,
        rect,
        detail: `h=${rect.h} > ${Math.round(vh - insets.top - insets.bottom)}`,
      });
  }
  return out.slice(0, 20);
};

for (const vp of VIEWPORTS) {
  test.describe(`Split-screen ${vp.name} (${vp.width}x${vp.height})`, () => {
    for (const route of ROUTES) {
      for (const keyboard of KEYBOARD_CASES) {
        // Keyboard 140px tidak realistis pada tinggi <260px (sistem
        // menampilkan keyboard mengambang), jadi kasus itu dilewati.
        if (keyboard > 0 && vp.height < 300) continue;
        const kbLabel = keyboard > 0 ? "keyboard terbuka" : "tanpa keyboard";
        test(`${route} — ${kbLabel}`, async ({ page }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          const res = await page.goto(route, { waitUntil: "domcontentloaded" });
          test.skip(!!res && res.status() >= 400, `rute ${route} tidak tersedia`);
          await page.waitForLoadState("networkidle").catch(() => {});
          const insets = insetsFor(vp.width, vp.height);
          await injectEnv(page, insets, keyboard);

          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(200);

          const violations = await page.evaluate(MEASURE, { insets, keyboard, eps: EPS });
          expect(
            violations,
            `Elemen bawah keluar area aman di ${route} @ ${vp.name} (${kbLabel}):\n` +
              JSON.stringify(violations, null, 2),
          ).toEqual([]);
        });
      }
    }
  });
}
