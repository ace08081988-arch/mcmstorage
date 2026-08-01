#!/usr/bin/env bun
/**
 * CI guard: jalankan `bun audit --json` dan gagalkan build bila ada
 * temuan severity high/critical.
 *
 * Bun mengeluarkan format bulk-advisory ala npm:
 *   { "<package>": [ { severity, title, url, vulnerable_versions, ... } ] }
 * Beberapa versi membungkusnya dalam { advisories: {...} }, jadi kedua
 * bentuk ditangani. Output non-JSON (mis. registry mirror tanpa endpoint
 * audit) dilaporkan sebagai error eksplisit, bukan lolos diam-diam.
 */
import { spawnSync } from "node:child_process";

const BLOCKING = new Set(["high", "critical"]);

const res = spawnSync("bun", ["audit", "--json"], { encoding: "utf8" });
const raw = `${res.stdout ?? ""}`;
const stderr = `${res.stderr ?? ""}`;

const start = raw.indexOf("{");
if (start === -1) {
  console.error("❌ `bun audit --json` tidak mengembalikan JSON.");
  console.error(raw.trim() || stderr.trim() || "(tidak ada output)");
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw.slice(start));
} catch (err) {
  console.error("❌ Gagal mem-parse output `bun audit --json`:", err.message);
  console.error(raw.slice(start, start + 2000));
  process.exit(1);
}

const advisories = parsed.advisories ?? parsed;
const findings = [];
for (const [pkg, list] of Object.entries(advisories)) {
  if (!Array.isArray(list)) continue;
  for (const adv of list) {
    const severity = String(adv?.severity ?? "").toLowerCase();
    if (!BLOCKING.has(severity)) continue;
    findings.push({
      pkg,
      severity,
      title: adv?.title ?? "(tanpa judul)",
      patched: adv?.patched_versions ?? adv?.patchedVersions ?? "-",
      url: adv?.url ?? "",
    });
  }
}

if (findings.length === 0) {
  console.log("✅ Tidak ada temuan high/critical pada dependensi.");
  process.exit(0);
}

findings.sort((a, b) => (a.severity === b.severity ? a.pkg.localeCompare(b.pkg) : a.severity === "critical" ? -1 : 1));
console.error(`❌ Ditemukan ${findings.length} kerentanan high/critical:\n`);
for (const f of findings) {
  console.error(`  [${f.severity.toUpperCase()}] ${f.pkg} — ${f.title}`);
  console.error(`      patched: ${f.patched}${f.url ? `  ${f.url}` : ""}`);
}
console.error("\nPerbaiki dengan menaikkan versi paket di package.json (atau `overrides`), lalu regenerasi bun.lock.");
process.exit(1);
