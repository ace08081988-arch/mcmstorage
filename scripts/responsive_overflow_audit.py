#!/usr/bin/env python3
"""Responsive overflow audit.

Untuk tiap kombinasi (URL harness × container width × zoom level),
skrip ini mengukur bounding box setiap kontrol interaktif dan
memverifikasi bahwa seluruh kotaknya berada di dalam viewport
(tidak terpotong horizontal/vertikal) serta tidak tumpang tindih
lebih dari 50% dengan kontrol lain.

Jalankan lokal:
  BASE_URL=http://localhost:8080 python scripts/responsive_overflow_audit.py

Exit 1 jika ada pelanggaran; report JSON + screenshot ditulis ke
`$AUDIT_OUT` (default: /tmp/responsive-audit/).
"""
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
OUT = Path(os.environ.get("AUDIT_OUT", "/tmp/responsive-audit"))

# Public visual harnesses (rute teknis) — tambahkan surface baru di sini.
TARGETS = [
    {"name": "photo-editor",         "path": "/lovable/visual/photo-editor?v=2"},
    {"name": "prep-loc-buttons",     "path": "/lovable/visual/prep-loc-buttons?variant=prep&state=filled"},
    {"name": "prep-loc-buttons-req", "path": "/lovable/visual/prep-loc-buttons?variant=request&state=idle"},
    {"name": "tap-targets",          "path": "/lovable/visual/tap-targets"},
    {"name": "gudang-shell",         "path": "/lovable/visual/gudang-shell"},
    {"name": "dialog-viewport",      "path": "/lovable/visual/dialog-viewport"},
    {"name": "komponen-review",      "path": "/lovable/visual/komponen-review"},
    {"name": "design-tokens",        "path": "/lovable/visual/design-tokens"},
    {"name": "menu-variants",        "path": "/lovable/visual/menu-variants"},
    {"name": "bottom-bar-snap",      "path": "/lovable/visual/bottom-bar-snap"},
    {"name": "toast-layout",         "path": "/lovable/visual/toast-layout"},
    {"name": "produk-list",          "path": "/lovable/visual/produk-list"},
    # Rute aplikasi utama yang bisa dibuka tanpa sesi.
    {"name": "produk",               "path": "/produk"},
    {"name": "harga",                "path": "/harga"},
    {"name": "faq",                  "path": "/faq"},
    {"name": "trust",                "path": "/trust"},
    {"name": "terms",                "path": "/terms"},
    {"name": "refund",               "path": "/refund"},
    {"name": "auth",                 "path": "/auth"},
    {"name": "reset-password",       "path": "/reset-password"},
    {"name": "download",             "path": "/download"},
    {"name": "pos-kasir",            "path": "/pos-kasir"},
    {"name": "pratinjau-tema",       "path": "/pratinjau-tema"},
]

# Lebar kritis Android/iOS + tablet portrait.
WIDTHS = [int(w) for w in os.environ.get("AUDIT_WIDTHS", "320,360,390,411,768").split(",")]
# WCAG 1.4.10 mensyaratkan reflow sampai 400% pada 320 CSS px; kita uji sampai 2×.
ZOOMS = [float(z) for z in os.environ.get("AUDIT_ZOOMS", "1.0,1.5,2.0").split(",")]
EPS = 1  # toleransi sub-pixel rounding

CONTROL_SELECTOR = ",".join([
    "button:not([disabled])",
    "a[href]",
    'input:not([type="hidden"])',
    "select",
    "textarea",
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    "[data-testid]",
])

MEASURE_JS = r"""
({sel, eps}) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const nodes = Array.from(document.querySelectorAll(sel));
  const seen = [];
  const out = [];
  const isInsideScrollable = (node) => {
    // Halaman yang menggulir secara normal bukan "terpotong": konten di
    // bawah lipatan tetap terjangkau dengan scroll dokumen.
    const de = document.scrollingElement || document.documentElement;
    if (de && de.scrollHeight > de.clientHeight + 1) return true;
    let n = node.parentElement;
    while (n && n !== document.body) {
      const c = getComputedStyle(n);
      if (/(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight) return true;
      n = n.parentElement;
    }
    return false;
  };
  for (const el of nodes) {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    // Skip-link & pemberitahuan a11y sengaja diparkir di luar layar sampai
    // menerima fokus keyboard — bukan komponen terpotong.
    if (el.closest("[data-skip-link], .sr-only, [aria-live]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right < -eps || r.bottom < -eps) continue; // off-screen (sr-only)

    const overRight = r.right - vw;
    const overBottom = r.bottom - vh;
    const overLeft = -r.left;
    const overTop = -r.top;
    const clipped =
      overRight > eps ||
      overLeft > eps ||
      overTop > eps ||
      (overBottom > eps && !isInsideScrollable(el));

    const label =
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      (el.textContent || "").trim().slice(0, 60);

    if (clipped) {
      out.push({
        reason: "clipped", tag: el.tagName.toLowerCase(), label,
        rect: {x: r.x, y: r.y, w: r.width, h: r.height},
        viewport: {w: vw, h: vh},
        overflow: {
          left: Math.max(0, overLeft), right: Math.max(0, overRight),
          top: Math.max(0, overTop), bottom: Math.max(0, overBottom),
        },
      });
      continue;
    }

    for (const prev of seen) {
      const ix = Math.max(0, Math.min(r.right, prev.r.right) - Math.max(r.left, prev.r.left));
      const iy = Math.max(0, Math.min(r.bottom, prev.r.bottom) - Math.max(r.top, prev.r.top));
      const inter = ix * iy;
      if (!inter) continue;
      const minArea = Math.min(r.width * r.height, prev.r.width * prev.r.height);
      if (inter / minArea > 0.5) {
        out.push({
          reason: "overlap", tag: el.tagName.toLowerCase(), label,
          overlapsWith: prev.label,
          rect: {x: r.x, y: r.y, w: r.width, h: r.height},
        });
        break;
      }
    }
    seen.push({r, label});
  }
  return out;
}
"""


async def audit_one(browser, target, width, zoom):
    context = await browser.new_context(viewport={"width": width, "height": 900})
    page = await context.new_page()
    url = BASE.rstrip("/") + target["path"]
    try:
        await page.goto(url, wait_until="networkidle", timeout=15000)
    except Exception as e:
        await context.close()
        return [{"reason": "load-failed", "label": str(e)[:200]}]
    await page.evaluate("(z) => { document.documentElement.style.zoom = String(z); }", zoom)
    await page.wait_for_timeout(150)

    violations = await page.evaluate(MEASURE_JS, {"sel": CONTROL_SELECTOR, "eps": EPS})

    if violations:
        shot = OUT / f"{target['name']}_w{width}_z{str(zoom).replace('.', '-')}.png"
        try:
            await page.screenshot(path=str(shot))
        except Exception:
            pass
    await context.close()
    return violations


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = []
    failed = 0
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            for target in TARGETS:
                for w in WIDTHS:
                    for z in ZOOMS:
                        vios = await audit_one(browser, target, w, z)
                        report.append({"target": target["name"], "width": w, "zoom": z, "violations": vios})
                        if vios:
                            failed += len(vios)
                            print(f"✗ {target['name']} w={w} z={z} → {len(vios)} pelanggaran", file=sys.stderr)
                            for v in vios[:3]:
                                print(f"   · {v.get('reason')}: [{v.get('tag','?')}] \"{v.get('label','')}\"", file=sys.stderr)
                        else:
                            print(f"✓ {target['name']} w={w} z={z}")
        finally:
            await browser.close()

    (OUT / "report.json").write_text(json.dumps(report, indent=2))
    print(f"\nLaporan: {OUT / 'report.json'}")
    if failed:
        print(f"Total pelanggaran: {failed}", file=sys.stderr)
        sys.exit(1)
    print("Semua kontrol tetap di dalam viewport.")


if __name__ == "__main__":
    asyncio.run(main())