#!/usr/bin/env node
/**
 * Bundle report — daftar chunk terberat + perbandingan (diff) terhadap
 * baseline sebelumnya, sehingga dampak setiap perubahan terlihat jelas.
 *
 * Pemakaian:
 *   node scripts/bundle-report.mjs              # laporan + diff vs baseline
 *   node scripts/bundle-report.mjs --save       # simpan hasil sebagai baseline
 *   node scripts/bundle-report.mjs --json       # keluaran JSON (untuk CI)
 *   node scripts/bundle-report.mjs --top 30
 *
 * Catatan: skrip ini hanya MEMBACA hasil build (tidak menjalankan build).
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "bundle-report");
const BASELINE = path.join(OUT_DIR, "baseline.json");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const topN = Number(args[args.indexOf("--top") + 1]) || 20;

const CANDIDATES = [".output/public", "dist/client", "dist", ".nitro/dist/public"];

function findClientDir() {
  for (const c of CANDIDATES) {
    const p = path.join(ROOT, c);
    if (existsSync(p) && existsSync(path.join(p, "assets"))) return p;
  }
  return null;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push({ file: p, size: st.size });
  }
  return acc;
}

/** Hilangkan hash konten agar chunk bisa dibandingkan antar build. */
function stableName(rel) {
  return rel.replace(/-[A-Za-z0-9_-]{8,}(\.\w+)$/, "$1");
}

const fmt = (b) => (b >= 1024 * 1024 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`);
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

function collect() {
  const dir = findClientDir();
  if (!dir) {
    console.error("Hasil build tidak ditemukan. Jalankan `bun run build` dulu.");
    process.exit(1);
  }
  const files = walk(dir)
    .filter((f) => /\.(m?js|css)$/.test(f.file))
    .map((f) => {
      const rel = path.relative(dir, f.file).split(path.sep).join("/");
      let gzip = 0;
      try { gzip = gzipSync(readFileSync(f.file)).length; } catch { /* abaikan */ }
      return { name: stableName(rel), raw: f.size, gzip, kind: rel.endsWith(".css") ? "css" : "js" };
    });
  files.sort((a, b) => b.raw - a.raw);
  const total = files.reduce((s, f) => s + f.raw, 0);
  const totalGzip = files.reduce((s, f) => s + f.gzip, 0);
  return { dir: path.relative(ROOT, dir), at: new Date().toISOString(), total, totalGzip, count: files.length, files };
}

function diff(current, base) {
  const byName = new Map(base.files.map((f) => [f.name, f]));
  const rows = [];
  for (const f of current.files) {
    const prev = byName.get(f.name);
    rows.push({ name: f.name, raw: f.raw, gzip: f.gzip, deltaRaw: prev ? f.raw - prev.raw : f.raw, isNew: !prev });
    byName.delete(f.name);
  }
  for (const [name, f] of byName) rows.push({ name, raw: 0, gzip: 0, deltaRaw: -f.raw, removed: true });
  return rows;
}

const current = collect();

if (has("--save")) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(BASELINE, JSON.stringify(current, null, 2));
  console.log(`Baseline disimpan: bundle-report/baseline.json (${fmt(current.total)} / ${fmt(current.totalGzip)} gzip)`);
  process.exit(0);
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;

if (has("--json")) {
  console.log(JSON.stringify({ current, baseline: base ? { at: base.at, total: base.total, totalGzip: base.totalGzip } : null, changes: base ? diff(current, base).filter((r) => r.deltaRaw !== 0) : null }, null, 2));
  process.exit(0);
}

console.log(`\nBundle report — ${current.dir} (${current.count} file)`);
console.log(`Total: ${fmt(current.total)} raw · ${fmt(current.totalGzip)} gzip`);
if (base) {
  const d = current.total - base.total;
  const dg = current.totalGzip - base.totalGzip;
  console.log(`Baseline ${base.at}: ${fmt(base.total)} raw · ${fmt(base.totalGzip)} gzip`);
  console.log(`Delta   : ${sign(Math.round(d / 1024))} KB raw · ${sign(Math.round(dg / 1024))} KB gzip`);
} else {
  console.log("(belum ada baseline — jalankan dengan --save untuk membuatnya)");
}

console.log(`\n${topN} chunk terberat:`);
console.log("  raw        gzip       chunk");
for (const f of current.files.slice(0, topN)) {
  console.log(`  ${fmt(f.raw).padEnd(10)} ${fmt(f.gzip).padEnd(10)} ${f.name}`);
}

if (base) {
  const changes = diff(current, base).filter((r) => Math.abs(r.deltaRaw) >= 1024).sort((a, b) => Math.abs(b.deltaRaw) - Math.abs(a.deltaRaw)).slice(0, topN);
  console.log(`\nPerubahan vs baseline (>=1 KB):`);
  if (!changes.length) console.log("  (tidak ada perubahan berarti)");
  for (const c of changes) {
    const tag = c.isNew ? "[baru]   " : c.removed ? "[hilang] " : "         ";
    console.log(`  ${tag}${sign(Math.round(c.deltaRaw / 1024)).padStart(7)} KB  ${c.name}`);
  }
}
console.log("");
