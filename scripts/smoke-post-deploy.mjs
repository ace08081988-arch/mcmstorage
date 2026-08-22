#!/usr/bin/env node
/**
 * Smoke test pasca deploy.
 *
 * Memastikan endpoint utama benar-benar merespons 200 (bukan sekadar
 * "publish sukses"), termasuk halaman yang terkait data produk dan
 * halaman diagnostik paket yang dipakai untuk status kirim WA.
 *
 * Pakai:
 *   node scripts/smoke-post-deploy.mjs --base https://mcmstorage.app
 *   node scripts/smoke-post-deploy.mjs --base http://localhost:8080 --json out.json
 *
 * Exit code 1 bila ada endpoint wajib yang gagal.
 */
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const BASE = (arg("base", process.env.SMOKE_BASE_URL || "https://mcmstorage.app")).replace(/\/+$/, "");
const ATTEMPTS = Number(arg("attempts", "6"));
const DELAY_MS = Number(arg("delay", "10000")) || 10000;
const TIMEOUT_MS = Number(arg("timeout", "25000")) || 25000;
const JSON_OUT = arg("json", null);

/**
 * expect: substring wajib ada di HTML (case-insensitive) — menjaga agar
 * halaman tidak sekadar 200 tapi shell kosong / error page.
 */
const CHECKS = [
  { path: "/", label: "Beranda", expect: "<html" },
  { path: "/produk", label: "Produk (data produk)", expect: "produk" },
  { path: "/harga", label: "Harga" },
  { path: "/katalog", label: "Katalog (index publik)", optional: true },
  { path: "/diagnostik/paket", label: "Diagnostik paket (status kirim WA)", expect: "paket" },
  { path: "/download", label: "Download APK" },
  { path: "/faq", label: "FAQ" },
  { path: "/terms", label: "Ketentuan" },
  { path: "/trust", label: "Trust" },
  { path: "/auth", label: "Masuk" },
  { path: "/sitemap.xml", label: "Sitemap", expect: "<urlset", contentType: "xml" },
  { path: "/robots.txt", label: "Robots", expect: "user-agent", contentType: "text" },
];

async function fetchOnce(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "ace-smoke-post-deploy/1.0", "cache-control": "no-cache" },
    });
    const body = await res.text();
    return { status: res.status, body, ms: Date.now() - started, error: null };
  } catch (e) {
    return { status: 0, body: "", ms: Date.now() - started, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function evaluate(check, r) {
  if (r.status !== 200) return `HTTP ${r.status || "n/a"}${r.error ? ` (${r.error})` : ""}`;
  if (r.body.length < 200) return `body terlalu kecil (${r.body.length}b)`;
  const needle = check.expect ?? "<html";
  if (!r.body.toLowerCase().includes(needle.toLowerCase())) return `konten tidak memuat "${needle}"`;
  return null;
}

async function runCheck(check) {
  const url = `${BASE}${check.path}`;
  let last = null;
  for (let i = 1; i <= ATTEMPTS; i++) {
    const r = await fetchOnce(url);
    const problem = evaluate(check, r);
    last = { ...check, url, status: r.status, ms: r.ms, attempts: i, problem };
    if (!problem) return { ...last, ok: true };
    if (i < ATTEMPTS) await new Promise((res) => setTimeout(res, DELAY_MS));
  }
  return { ...last, ok: false };
}

const results = [];
for (const check of CHECKS) {
  const r = await runCheck(check);
  results.push(r);
  const icon = r.ok ? "✅" : r.optional ? "⚠️" : "❌";
  console.log(
    `${icon} ${r.label.padEnd(34)} ${r.path.padEnd(20)} ${r.status || "-"} ${r.ms}ms${r.problem ? ` — ${r.problem}` : ""}`,
  );
}

const failed = results.filter((r) => !r.ok && !r.optional);
const summary = {
  base: BASE,
  when: new Date().toISOString(),
  total: results.length,
  passed: results.filter((r) => r.ok).length,
  failed: failed.length,
  results,
};

if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    failed.length ? "## ❌ Smoke test pasca deploy GAGAL" : "## ✅ Smoke test pasca deploy OK",
    "",
    `- Base: ${BASE}`,
    `- Lulus: ${summary.passed}/${summary.total}`,
    "",
    "| Endpoint | Status | Latensi | Catatan |",
    "| --- | --- | --- | --- |",
    ...results.map(
      (r) => `| \`${r.path}\` | ${r.ok ? "✅" : r.optional ? "⚠️" : "❌"} ${r.status || "-"} | ${r.ms}ms | ${r.problem || "-"} |`,
    ),
  ];
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", { flag: "a" });
}

console.log(`\n${summary.passed}/${summary.total} lulus di ${BASE}`);
if (failed.length) {
  console.error(`Gagal: ${failed.map((f) => f.path).join(", ")}`);
  process.exit(1);
}
