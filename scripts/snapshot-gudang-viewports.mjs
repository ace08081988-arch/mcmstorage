#!/usr/bin/env node
/**
 * Snapshot halaman /gudang di beberapa viewport (desktop + mobile) untuk
 * mendeteksi perbedaan rendering saat pergantian Jenis kemasan
 * gram/botol/pcs/sachet, di tema light DAN dark.
 *
 * Jalankan lokal (dev server hidup di http://localhost:8080 dan sesi
 * Supabase terinjeksi lewat `LOVABLE_BROWSER_SUPABASE_*` env vars):
 *
 *   node scripts/snapshot-gudang-viewports.mjs
 *
 * Output PNG:
 *   current  → /tmp/browser/gudang-snapshots/current/<viewport>/<theme>/<mode>-<pt>.png
 *   baseline → /tmp/browser/gudang-snapshots/baseline/<viewport>/<theme>/<mode>-<pt>.png
 *   diff     → /tmp/browser/gudang-snapshots/diff/<viewport>/<theme>/<mode>-<pt>.png
 *
 * Pixel-diff (pixelmatch):
 *   Setelah semua screenshot diambil, script membandingkan `current/` vs
 *   `baseline/` per file. Ambang default (bisa di-override lewat env):
 *     - PIXELMATCH_THRESHOLD = 0.1   (0..1, sensitivitas per-piksel; makin
 *                                    tinggi = makin toleran anti-aliasing)
 *     - MAX_DIFF_RATIO       = 0.005 (fraksi piksel berbeda; > 0.5% = FAIL)
 *   Piksel yang berbeda dicoret merah dan disimpan di `diff/`. Exit code:
 *     0 = di bawah ambang, 1 = ada regresi signifikan, 2 = auth issue.
 *
 *   Update baseline (setelah design system change yang memang disengaja):
 *     UPDATE_BASELINE=1 node scripts/snapshot-gudang-viewports.mjs
 *   Ini menyalin hasil `current/` ke `baseline/` dan skip diff.
 *
 *   Fokus subset:
 *     SNAPSHOT_VIEWPORTS=mobile,mobile-lg SNAPSHOT_THEMES=dark \
 *     SNAPSHOT_MODES=existing SNAPSHOT_PTS=botol \
 *     node scripts/snapshot-gudang-viewports.mjs
 *
 * Script ini SENGAJA tidak dijalankan di CI karena butuh sesi login.
 * Untuk deteksi regresi otomatis di CI, lihat
 * `src/routes/_authenticated.gudang.viewport-snapshots.test.ts` dan
 * `src/routes/_authenticated.gudang.dark-mode-snapshots.test.ts`.
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile, copyFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const BASE = process.env.SNAPSHOT_BASE_URL ?? "http://localhost:8080";
const ROOT = "/tmp/browser/gudang-snapshots";
const CURRENT_DIR = path.join(ROOT, "current");
const BASELINE_DIR = path.join(ROOT, "baseline");
const DIFF_DIR = path.join(ROOT, "diff");

const PIXELMATCH_THRESHOLD = Number(process.env.PIXELMATCH_THRESHOLD ?? 0.1);
const MAX_DIFF_RATIO = Number(process.env.MAX_DIFF_RATIO ?? 0.005);
const UPDATE_BASELINE = process.env.UPDATE_BASELINE === "1";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 1800 },
  { name: "tablet", width: 768, height: 1600 },
  { name: "mobile-lg", width: 411, height: 1600 },
  { name: "mobile", width: 390, height: 1600 },
  { name: "mobile-xs", width: 360, height: 1600 },
  { name: "mobile-xxs", width: 320, height: 1600 },
];
const PACKAGE_TYPES = ["gram", "botol", "pcs", "sachet"];
const MODES = ["new", "existing"];
const THEMES = ["light", "dark"];

function filterList(list, envVar) {
  const raw = process.env[envVar];
  if (!raw) return list;
  const wanted = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.filter((x) => wanted.includes(typeof x === "string" ? x : x.name));
}

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
  const label = mode === "new" ? /Barang baru/i : /Pilih dari gudang|Item gudang/i;
  const trigger = page.getByRole("tab", { name: label });
  if (await trigger.count()) await trigger.first().click();
}

async function pickPackageType(page, pt) {
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

async function applyTheme(page, theme) {
  await page.evaluate((t) => {
    const d = document.documentElement;
    if (t === "dark") d.classList.add("dark");
    else d.classList.remove("dark");
    try { localStorage.setItem("app-theme", t); } catch {}
  }, theme);
  await page.waitForTimeout(50);
}

async function fileExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function loadPng(p) {
  const buf = await readFile(p);
  return PNG.sync.read(buf);
}

async function walkPngs(root) {
  const out = [];
  async function rec(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await rec(full);
      else if (e.isFile() && e.name.endsWith(".png")) out.push(full);
    }
  }
  await rec(root);
  return out;
}

/**
 * Bandingkan satu pasang PNG.
 * @returns {{status: "ok"|"fail"|"size-mismatch"|"missing-baseline", diffPixels: number, total: number, ratio: number, reason?: string}}
 */
async function diffOne(currentPath, baselinePath, diffPath) {
  if (!(await fileExists(baselinePath))) {
    return { status: "missing-baseline", diffPixels: 0, total: 0, ratio: 0 };
  }
  const [cur, base] = await Promise.all([loadPng(currentPath), loadPng(baselinePath)]);
  if (cur.width !== base.width || cur.height !== base.height) {
    return {
      status: "size-mismatch",
      diffPixels: 0,
      total: cur.width * cur.height,
      ratio: 1,
      reason: `current=${cur.width}x${cur.height} baseline=${base.width}x${base.height}`,
    };
  }
  const { width, height } = cur;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(cur.data, base.data, diff.data, width, height, {
    threshold: PIXELMATCH_THRESHOLD,
    includeAA: false,
    diffColor: [255, 0, 0],
    alpha: 0.4,
  });
  const total = width * height;
  const ratio = diffPixels / total;
  await mkdir(path.dirname(diffPath), { recursive: true });
  await writeFile(diffPath, PNG.sync.write(diff));
  return { status: ratio <= MAX_DIFF_RATIO ? "ok" : "fail", diffPixels, total, ratio };
}

async function copyDirectory(src, dst) {
  const files = await walkPngs(src);
  for (const f of files) {
    const rel = path.relative(src, f);
    const target = path.join(dst, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(f, target);
  }
  return files.length;
}

async function runDiff() {
  const files = (await walkPngs(CURRENT_DIR)).sort();
  const results = [];
  for (const cur of files) {
    const rel = path.relative(CURRENT_DIR, cur);
    const baseline = path.join(BASELINE_DIR, rel);
    const diff = path.join(DIFF_DIR, rel);
    results.push({ rel, ...(await diffOne(cur, baseline, diff)) });
  }
  const fails = results.filter((r) => r.status === "fail" || r.status === "size-mismatch");
  const missing = results.filter((r) => r.status === "missing-baseline");
  console.log("\n[diff] pixelmatch summary");
  console.log(`  threshold per-pixel : ${PIXELMATCH_THRESHOLD}`);
  console.log(`  max diff ratio      : ${(MAX_DIFF_RATIO * 100).toFixed(3)}%`);
  console.log(`  files compared      : ${results.length - missing.length}/${results.length}`);
  for (const r of results) {
    if (r.status === "missing-baseline") {
      console.log(`  ? MISSING baseline  ${r.rel}`);
    } else if (r.status === "size-mismatch") {
      console.log(`  ✗ SIZE MISMATCH     ${r.rel}  ${r.reason}`);
    } else if (r.status === "fail") {
      console.log(
        `  ✗ FAIL              ${r.rel}  diff=${r.diffPixels}/${r.total} (${(r.ratio * 100).toFixed(3)}%)`,
      );
    } else {
      console.log(
        `  ✓ ok                ${r.rel}  diff=${r.diffPixels} (${(r.ratio * 100).toFixed(4)}%)`,
      );
    }
  }
  if (missing.length) {
    console.log(
      `\n[diff] ${missing.length} file tanpa baseline. Jalankan ulang dengan UPDATE_BASELINE=1 untuk seed.`,
    );
  }
  if (fails.length) {
    console.error(`\n[diff] ${fails.length} regresi visual signifikan.`);
    process.exit(1);
  }
  console.log(`\n[diff] semua di bawah ambang. OK.`);
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
  const activeViewports = filterList(VIEWPORTS, "SNAPSHOT_VIEWPORTS");
  const activeThemes = filterList(THEMES, "SNAPSHOT_THEMES");
  const activeModes = filterList(MODES, "SNAPSHOT_MODES");
  const activePts = filterList(PACKAGE_TYPES, "SNAPSHOT_PTS");
  try {
    for (const vp of activeViewports) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      await restoreSupabaseSession(context, page);
      await page.goto(`${BASE}/gudang`, { waitUntil: "networkidle" });

      for (const theme of activeThemes) {
        await applyTheme(page, theme);
        for (const mode of activeModes) {
          await pickMode(page, mode);
          for (const pt of activePts) {
            await pickPackageType(page, pt);
            // Beri waktu React re-render + memo revalidate.
            await page.waitForTimeout(200);
            const out = path.join(CURRENT_DIR, vp.name, theme, `${mode}-${pt}.png`);
            await shoot(page, out);
            console.log(`[snapshot-gudang] ${vp.name}/${theme}/${mode}-${pt} → ${out}`);
          }
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (UPDATE_BASELINE) {
    const n = await copyDirectory(CURRENT_DIR, BASELINE_DIR);
    console.log(`\n[baseline] ${n} file disalin ke ${BASELINE_DIR}. Skip diff.`);
    return;
  }
  await runDiff();
})();