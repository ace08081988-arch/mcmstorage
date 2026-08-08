#!/usr/bin/env bun
/**
 * CI guard: jalankan `bun audit --json` dan gagalkan build bila ada
 * temuan severity high/critical.
 *
 * Flag:
 *   --soft   audit tidak bisa dijalankan (offline / registry tanpa endpoint
 *            audit) => peringatan saja, exit 0. Temuan high/critical TETAP
 *            menggagalkan build. Dipakai di `prebuild` lokal.
 *   (default / --strict) audit yang gagal dijalankan = build gagal. Dipakai di CI.
 *
 * Bun mengeluarkan format bulk-advisory ala npm:
 *   { "<package>": [ { severity, title, url, vulnerable_versions, ... } ] }
 * Beberapa versi membungkusnya dalam { advisories: {...} }, jadi kedua
 * bentuk ditangani. Output non-JSON (mis. registry mirror tanpa endpoint
 * audit) dilaporkan sebagai error eksplisit, bukan lolos diam-diam.
 */
import { spawnSync } from "node:child_process";

const BLOCKING = new Set(["high", "critical"]);
const argv = process.argv.slice(2);
const SOFT = argv.includes("--soft") && !argv.includes("--strict");

function unavailable(message, detail) {
  if (SOFT) {
    console.warn(`⚠️  Lewati audit dependensi: ${message}`);
    if (detail) console.warn(detail.slice(0, 500));
    process.exit(0);
  }
  console.error(`❌ ${message}`);
  if (detail) console.error(detail.slice(0, 2000));
  process.exit(1);
}

const res = spawnSync("bun", ["audit", "--json"], { encoding: "utf8" });
const raw = `${res.stdout ?? ""}`;
const stderr = `${res.stderr ?? ""}`;

const start = raw.indexOf("{");
if (start === -1) {
  unavailable(
    "`bun audit --json` tidak mengembalikan JSON.",
    raw.trim() || stderr.trim() || "(tidak ada output)",
  );
}

let parsed;
try {
  parsed = JSON.parse(raw.slice(start));
} catch (err) {
  unavailable(`Gagal mem-parse output \`bun audit --json\`: ${err.message}`, raw.slice(start));
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

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "## ❌ Audit dependensi gagal",
    "",
    "| Paket | Severity | Masalah | Patched |",
    "| --- | --- | --- | --- |",
    ...findings.map((f) => `| \`${f.pkg}\` | ${f.severity} | ${String(f.title).replace(/\|/g, "\\|")} | ${f.patched} |`),
    "",
  ];
  try {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  } catch {
    /* summary opsional */
  }
}

console.error("\nPerbaiki dengan menaikkan versi paket di package.json (atau `overrides`), lalu regenerasi bun.lock.");
process.exit(1);
