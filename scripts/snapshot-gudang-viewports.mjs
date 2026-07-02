#!/usr/bin/env node
/**
 * Snapshot halaman /gudang di beberapa viewport (desktop + mobile) untuk
 * mendeteksi perbedaan rendering saat pergantian Jenis kemasan
 * gram/botol/pcs/sachet.
 *
 * Jalankan lokal (dev server harus hidup di http://localhost:8080 dan
 * sesi Supabase terinjeksi lewat `LOVABLE_BROWSER_SUPABASE_*` env vars):
 *
 *   node scripts/snapshot-gudang-viewports.mjs
 *
 * Output PNG: /tmp/browser/gudang-snapshots/<viewport>/<mode>-<pt>.png
 *
 * Script ini SENGAJA tidak dijalankan di CI karena butuh sesi login.
 * Untuk deteksi regresi otomatis di CI, lihat
 * `src/routes/_authenticated.gudang.viewport-snapshots.test.ts`.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.SNAPSHOT_BASE_URL ?? "http://localhost:8080";
const OUT = "/tmp/browser/gudang-snapshots";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 1800 },
  { name: "mobile", width: 390, height: 1600 },
];
const PACKAGE_TYPES = ["gram", "botol", "pcs", "sachet"];
const MODES = ["new", "existing"];

async function restoreSupabaseSession(context, page) {
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  const cookiesJson = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;
  if (cookiesJson) {
    const cookies = JSON.parse(cookiesJson).map((c) => ({ ...c, url: BASE }));
    await context.addCookies(cookies);
  }
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  if (storageKey && sessionJson) {
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k, v),
      [storageKey, sessionJson],
    );
  }
}

async function shoot(page, outFile) {
  await mkdir(path.dirname(outFile), { recursive: true });
  await page.screenshot({ path: outFile });
}

async function pickMode(page, mode) {
  // Convention: tab "Barang baru" untuk mode=new, "Pilih dari gudang" untuk mode=existing.
  const label = mode === "new" ? /Barang baru/i : /Pilih dari gudang|Item gudang/i;
  const trigger = page.getByRole("tab", { name: label });
  if (await trigger.count()) await trigger.first().click();
}

async function pickPackageType(page, pt) {
  // Convention: control select/segmented dengan aria-label "Jenis kemasan".
  const control = page.getByLabel(/Jenis kemasan/i).first();
  if (await control.count()) {
    const tag = await control.evaluate((el) => el.tagName);
    if (tag === "SELECT") {
      await control.selectOption(pt);
    } else {
      await control.click();
      await page.getByRole("option", { name: new RegExp(`^${pt}$`, "i") }).click();
    }
  }
}

(async () => {
  const authStatus = process.env.LOVABLE_BROWSER_AUTH_STATUS;
  if (authStatus && authStatus !== "injected") {
    console.error(
      `[snapshot-gudang] LOVABLE_BROWSER_AUTH_STATUS=${authStatus}. Login lewat preview dulu, lalu ulang.`,
    );
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      await restoreSupabaseSession(context, page);
      await page.goto(`${BASE}/gudang`, { waitUntil: "networkidle" });

      for (const mode of MODES) {
        await pickMode(page, mode);
        for (const pt of PACKAGE_TYPES) {
          await pickPackageType(page, pt);
          // Beri waktu React re-render + memo revalidate.
          await page.waitForTimeout(200);
          const out = path.join(OUT, vp.name, `${mode}-${pt}.png`);
          await shoot(page, out);
          console.log(`[snapshot-gudang] ${vp.name}/${mode}-${pt} → ${out}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
})();