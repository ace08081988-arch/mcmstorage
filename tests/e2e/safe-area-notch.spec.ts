/**
 * Pengujian otomatis: konten tidak boleh masuk area notch / status bar.
 *
 * Chromium headless tidak punya notch fisik, jadi inset disimulasikan
 * dengan meng-override variabel `--app-safe-*` (dipakai seluruh utility
 * safe-area aplikasi) lewat <style> ber-`!important` supaya tidak ditimpa
 * oleh `startSafeAreaRecalc()` yang menulis inline style.
 *
 * Asersi: setiap elemen DAUN yang terlihat (teks / kontrol interaktif)
 * harus berada di dalam kotak aman viewport. Latar/pembungkus (elemen
 * yang punya anak elemen) sengaja dilewati karena memang boleh melebar
 * sampai tepi layar — yang dilarang adalah KONTEN-nya masuk area sistem.
 *
 * Jalankan: `bun run test:safe-area`
 */
import { test, expect, type Page } from "@playwright/test";

/**
 * Inset disesuaikan orientasi seperti perangkat nyata: notch/status bar di
 * atas saat portrait, cutout pindah ke sisi kiri/kanan saat landscape.
 */
const insetsFor = (w: number, h: number) =>
  w > h
    ? { top: 24, bottom: 21, left: 44, right: 44 }
    : { top: 44, bottom: 34, left: 0, right: 0 };
type Insets = ReturnType<typeof insetsFor>;
const EPS = 1;

const VIEWPORTS = [
  { name: "hp-320", width: 320, height: 640 },
  { name: "hp-390", width: 390, height: 844 },
  { name: "hp-411", width: 411, height: 893 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "tablet-landscape-1024", width: 1024, height: 768 },
];

const ROUTES = [
  "/produk",
  "/harga",
  "/faq",
  "/auth",
  "/download",
  "/pos-kasir",
  "/lovable/visual/gudang-shell",
  "/lovable/visual/bottom-bar-snap",
];

async function injectNotch(page: Page, INSETS: Insets) {
  await page.addStyleTag({
    content: `:root{
      --app-safe-top:${INSETS.top}px !important;
      --app-safe-bottom:${INSETS.bottom}px !important;
      --app-safe-left:${INSETS.left}px !important;
      --app-safe-right:${INSETS.right}px !important;
    }`,
  });
  await page.waitForTimeout(200);
}

const MEASURE = ({ insets, eps }: { insets: Insets; eps: number }) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out: Array<{ sides: string; tag: string; label: string; rect: Record<string, number> }> = [];
  const isPinned = (node: Element) => {
    let n: Element | null = node;
    while (n && n !== document.body) {
      const cs2 = getComputedStyle(n);
      // Hanya elemen yang benar-benar dipaku ke tepi bawah layar
      // (fixed, atau sticky dengan offset `bottom`) yang bisa menutupi
      // gesture bar. Panel `sticky top-*` yang panjang tetap menggulir.
      if (cs2.position === "fixed") return true;
      if (cs2.position === "sticky" && cs2.bottom !== "auto") return true;
      n = n.parentElement;
    }
    return false;
  };
  /** Elemen di dalam wadah yang menggulir horizontal (tabel, carousel)
   *  boleh melewati tepi layar — itu scroll, bukan tertutup notch. */
  const inHScroll = (node: Element) => {
    let n: Element | null = node.parentElement;
    while (n && n !== document.body) {
      const c = getComputedStyle(n);
      if (/(auto|scroll)/.test(c.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
      n = n.parentElement;
    }
    return false;
  };
  const nodes = document.querySelectorAll("body *");
  for (const el of nodes) {
    if (el.closest("[data-skip-link], .sr-only, [aria-live], [aria-hidden='true']")) continue;
    if (el.children.length > 0) continue; // hanya elemen daun (konten nyata)
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
    const text = (el.textContent || "").trim();
    const interactive = el.matches("button,a[href],input,select,textarea,[role='button'],img,svg");
    if (!text && !interactive) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue; // di luar layar / bawah lipatan
    const pinned = isPinned(el);
    const hscroll = inHScroll(el);
    const bad: string[] = [];
    if (r.top < insets.top - eps && r.bottom > 0) bad.push("top");
    if (!hscroll && r.left < insets.left - eps) bad.push("left");
    if (!hscroll && r.right > vw - insets.right + eps) bad.push("right");
    // Konten yang menggulir wajar melewati tepi bawah; hanya elemen yang
    // dipaku (fixed/sticky) yang benar-benar menutupi gesture bar.
    if (pinned && r.bottom > vh - insets.bottom + eps && r.top < vh) bad.push("bottom");
    if (!bad.length) continue;
    out.push({
      sides: bad.join(","),
      tag: el.tagName.toLowerCase(),
      label: (el.getAttribute("aria-label") || text).slice(0, 50),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    });
  }
  return out.slice(0, 20);
};

for (const vp of VIEWPORTS) {
  test.describe(`safe-area ${vp.name} (${vp.width}x${vp.height})`, () => {
    for (const route of ROUTES) {
      test(`konten tidak masuk area sistem di ${route}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const res = await page.goto(route, { waitUntil: "domcontentloaded" });
        test.skip(!!res && res.status() >= 400, `rute ${route} tidak tersedia`);
        await page.waitForLoadState("networkidle").catch(() => {});
        const INSETS = insetsFor(vp.width, vp.height);
        await injectNotch(page, INSETS);

        const violations = await page.evaluate(MEASURE, { insets: INSETS, eps: EPS });
        expect(
          violations,
          `Konten menembus area notch/status bar di ${route} @ ${vp.name}:\n` +
            JSON.stringify(violations, null, 2),
        ).toEqual([]);
      });
    }
  });
}
