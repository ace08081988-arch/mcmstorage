/**
 * Pengujian visual otomatis: tombol mengambang (FAB) dan action bar lengket
 * tidak boleh tertutup gesture bar / home indicator, di berbagai lebar layar
 * dan orientasi (portrait & landscape).
 *
 * Notch/gesture inset disimulasikan dengan meng-override variabel
 * `--app-safe-*` (dipakai seluruh utility safe-area aplikasi) lewat <style>
 * ber-`!important` supaya tidak ditimpa `startSafeAreaRecalc()`.
 *
 * Asersi per elemen ber-`data-clearance` (dan setiap kontrol yang dipaku ke
 * bawah pada rute nyata):
 *   1. terlihat & punya ukuran,
 *   2. tepi bawahnya berada DI ATAS zona gesture (vh - safe bottom),
 *   3. tidak masuk area cutout kiri/kanan saat landscape,
 *   4. tidak tertutup bilah navigasi bawah (`.app-static-bottom-bar`).
 *
 * Jalankan: `bun run test:fab-clearance`
 */
import { test, expect, type Page } from "@playwright/test";

type Insets = { top: number; bottom: number; left: number; right: number };

/** Inset mengikuti perangkat nyata: cutout pindah ke sisi saat landscape. */
const insetsFor = (w: number, h: number): Insets =>
  w > h
    ? { top: 24, bottom: 21, left: 44, right: 44 }
    : { top: 44, bottom: 34, left: 0, right: 0 };

const EPS = 1;

const VIEWPORTS = [
  { name: "hp-320-portrait", width: 320, height: 640 },
  { name: "hp-360-portrait", width: 360, height: 740 },
  { name: "hp-390-portrait", width: 390, height: 844 },
  { name: "hp-411-portrait", width: 411, height: 893 },
  { name: "hp-844-landscape", width: 844, height: 390 },
  { name: "hp-740-landscape", width: 740, height: 360 },
  { name: "tablet-768-portrait", width: 768, height: 1024 },
  { name: "tablet-1024-landscape", width: 1024, height: 768 },
];

/** Rute yang punya FAB / action bar yang dipaku ke bawah. */
const ROUTES = [
  "/lovable/visual/fab-clearance",
  "/lovable/visual/fab-clearance?bar=off",
  "/lovable/visual/bottom-bar-snap",
  "/pos-kasir",
];

async function injectInsets(page: Page, insets: Insets) {
  await page.addStyleTag({
    content: `:root{
      --app-safe-top:${insets.top}px !important;
      --app-safe-bottom:${insets.bottom}px !important;
      --app-safe-left:${insets.left}px !important;
      --app-safe-right:${insets.right}px !important;
    }`,
  });
  await page.waitForTimeout(250);
}

const MEASURE = ({ insets, eps }: { insets: Insets; eps: number }) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
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
      if (
        (cs.position === "fixed" || cs.position === "sticky") &&
        cs.bottom !== "auto"
      )
        return true;
      n = n.parentElement;
    }
    return false;
  };

  const marked = Array.from(document.querySelectorAll("[data-clearance]"));
  const pinnedControls = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, a[href], [role='button'], input:not([type='hidden'])",
    ),
  ).filter((el) => isPinnedBottom(el));
  const targets = Array.from(new Set<Element>([...marked, ...pinnedControls]));

  // Bilah navigasi bawah tidak boleh menutupi FAB / action bar.
  const navBar = document.querySelector(".app-static-bottom-bar");
  const navRect =
    navBar && getComputedStyle(navBar).display !== "none"
      ? navBar.getBoundingClientRect()
      : null;

  for (const el of targets) {
    if (el.closest("[data-skip-link], .sr-only, [aria-hidden='true']")) continue;
    if (navBar && navBar.contains(el)) continue; // bilah nav diuji spec sendiri
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0")
      continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom < 0 || r.top > vh) continue; // di luar layar

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

    if (r.bottom > vh - insets.bottom + eps)
      out.push({
        reason: "tertutup-gesture-bar",
        label,
        rect,
        detail: `bottom=${Math.round(r.bottom)} > batas=${Math.round(vh - insets.bottom)}`,
      });

    if (r.left < insets.left - eps || r.right > vw - insets.right + eps)
      out.push({ reason: "masuk-cutout-samping", label, rect });

    if (r.top < -eps || r.right < eps || r.left > vw - eps)
      out.push({ reason: "keluar-viewport", label, rect });

    // Overlap dengan bilah navigasi hanya relevan untuk FAB/action bar yang
    // ditandai eksplisit. Overlay global (prompt izin, badge build) punya
    // aturan tumpuknya sendiri dan diuji spec lain.
    if (navRect && el.hasAttribute("data-clearance")) {
      const iy =
        Math.min(r.bottom, navRect.bottom) - Math.max(r.top, navRect.top);
      const ix =
        Math.min(r.right, navRect.right) - Math.max(r.left, navRect.left);
      if (iy > eps && ix > eps)
        out.push({ reason: "tertutup-bilah-navigasi", label, rect });
    }
  }
  return out.slice(0, 20);
};

for (const vp of VIEWPORTS) {
  test.describe(`FAB & action bar ${vp.name} (${vp.width}x${vp.height})`, () => {
    for (const route of ROUTES) {
      test(`bebas gesture/home indicator di ${route}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const res = await page.goto(route, { waitUntil: "domcontentloaded" });
        test.skip(!!res && res.status() >= 400, `rute ${route} tidak tersedia`);
        await page.waitForLoadState("networkidle").catch(() => {});
        const insets = insetsFor(vp.width, vp.height);
        await injectInsets(page, insets);

        // Gulir ke bawah: elemen yang dipaku harus tetap aman setelah scroll.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(200);

        const violations = await page.evaluate(MEASURE, { insets, eps: EPS });
        expect(
          violations,
          `FAB/action bar tertutup area sistem di ${route} @ ${vp.name}:\n` +
            JSON.stringify(violations, null, 2),
        ).toEqual([]);
      });
    }
  });
}