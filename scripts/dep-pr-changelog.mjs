#!/usr/bin/env node
/**
 * Ringkasan perubahan dependency untuk PR otomatis (Dependabot/Renovate).
 *
 * - Membandingkan package.json base vs head (dependencies, devDependencies, overrides).
 * - Opsional membandingkan hasil `bun audit --json` sebelum/sesudah untuk
 *   menandai advisory keamanan yang benar-benar terperbaiki oleh PR ini.
 * - Menulis markdown ke stdout, ke --out <file>, dan ke $GITHUB_STEP_SUMMARY.
 *
 * Pemakaian:
 *   node scripts/dep-pr-changelog.mjs --base origin/main \
 *     [--audit-before before.json] [--audit-after after.json] [--out body.md]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const baseRef = flag("--base", "origin/main");
const outFile = flag("--out");
const auditBeforePath = flag("--audit-before");
const auditAfterPath = flag("--audit-after");

const FIELDS = ["dependencies", "devDependencies", "overrides"];

function readJsonFile(p) {
  if (!p || !existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readBasePackageJson() {
  try {
    const raw = execFileSync("git", ["show", `${baseRef}:package.json`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function flatten(pkg) {
  const out = new Map();
  if (!pkg) return out;
  for (const field of FIELDS) {
    const block = pkg[field];
    if (!block || typeof block !== "object") continue;
    for (const [name, range] of Object.entries(block)) {
      if (typeof range !== "string") continue;
      out.set(`${field}:${name}`, { field, name, range });
    }
  }
  return out;
}

function diffDeps(basePkg, headPkg) {
  const before = flatten(basePkg);
  const after = flatten(headPkg);
  const changed = [];
  const added = [];
  const removed = [];
  for (const [key, entry] of after) {
    const prev = before.get(key);
    if (!prev) added.push(entry);
    else if (prev.range !== entry.range) changed.push({ ...entry, from: prev.range, to: entry.range });
  }
  for (const [key, entry] of before) if (!after.has(key)) removed.push(entry);
  return { changed, added, removed };
}

/** Normalisasi output `bun audit --json` menjadi daftar advisory unik. */
function normalizeAudit(json) {
  const list = [];
  if (!json || typeof json !== "object") return list;
  const advisories = json.advisories ?? json.vulnerabilities ?? {};
  const entries = Array.isArray(advisories) ? advisories : Object.values(advisories);
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const items = Array.isArray(raw) ? raw : [raw];
    for (const adv of items) {
      if (!adv || typeof adv !== "object") continue;
      const severity = String(adv.severity ?? adv.cvss?.severity ?? "unknown").toLowerCase();
      const name = adv.module_name ?? adv.name ?? adv.package_name ?? "(tidak diketahui)";
      const title = adv.title ?? adv.summary ?? "Advisory keamanan";
      const url = adv.url ?? adv.advisory_url ?? (adv.id ? `https://github.com/advisories/${adv.id}` : null);
      const patched = adv.patched_versions ?? adv.fixed_in ?? null;
      list.push({ key: `${name}::${title}`, name, title, severity, url, patched });
    }
  }
  const seen = new Set();
  return list.filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true)));
}

const SEVERITY_ORDER = { critical: 0, high: 1, moderate: 2, medium: 2, low: 3, info: 4, unknown: 5 };
const SEVERITY_BADGE = {
  critical: "🟥 critical",
  high: "🟧 high",
  moderate: "🟨 moderate",
  medium: "🟨 moderate",
  low: "🟦 low",
  info: "⬜ info",
  unknown: "⬜ unknown",
};
const bySeverity = (a, b) =>
  (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || a.name.localeCompare(b.name);

function npmLink(name) {
  return `[\`${name}\`](https://www.npmjs.com/package/${name})`;
}

function changelogLink(name) {
  return `[changelog](https://www.npmjs.com/package/${name}?activeTab=versions)`;
}

function buildMarkdown() {
  const headPkg = readJsonFile("package.json");
  const basePkg = readBasePackageJson();
  const { changed, added, removed } = diffDeps(basePkg, headPkg);

  const before = normalizeAudit(readJsonFile(auditBeforePath));
  const after = normalizeAudit(readJsonFile(auditAfterPath));
  const afterKeys = new Set(after.map((a) => a.key));
  const beforeKeys = new Set(before.map((a) => a.key));
  const fixed = before.filter((a) => !afterKeys.has(a.key)).sort(bySeverity);
  const introduced = after.filter((a) => !beforeKeys.has(a.key)).sort(bySeverity);
  const remaining = after.filter((a) => beforeKeys.has(a.key)).sort(bySeverity);

  const lines = [];
  lines.push("## 📦 Ringkasan update dependency");
  lines.push("");

  if (!basePkg) {
    lines.push(`> Tidak bisa membaca \`package.json\` dari \`${baseRef}\`, jadi diff versi dilewati.`);
    lines.push("");
  }

  if (changed.length || added.length || removed.length) {
    lines.push("| Paket | Perubahan | Info |");
    lines.push("| --- | --- | --- |");
    for (const c of changed.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`| ${npmLink(c.name)} | \`${c.from}\` → \`${c.to}\` | ${changelogLink(c.name)} |`);
    }
    for (const a of added.sort((x, y) => x.name.localeCompare(y.name))) {
      lines.push(`| ${npmLink(a.name)} | baru \`${a.range}\` | ${changelogLink(a.name)} |`);
    }
    for (const r of removed.sort((x, y) => x.name.localeCompare(y.name))) {
      lines.push(`| \`${r.name}\` | dihapus (\`${r.range}\`) | — |`);
    }
    lines.push("");
  } else {
    lines.push("Tidak ada perubahan versi di `package.json` (kemungkinan hanya `bun.lock`).");
    lines.push("");
  }

  if (fixed.length) {
    lines.push(`### 🛡️ Security fix (${fixed.length})`);
    lines.push("");
    for (const a of fixed) {
      const patched = a.patched ? ` — aman di \`${a.patched}\`` : "";
      const link = a.url ? ` ([advisory](${a.url}))` : "";
      lines.push(`- **${SEVERITY_BADGE[a.severity] ?? a.severity}** \`${a.name}\`: ${a.title}${patched}${link}`);
    }
    lines.push("");
  } else if (auditBeforePath && auditAfterPath) {
    lines.push("### 🛡️ Security fix");
    lines.push("");
    lines.push("Tidak ada advisory yang hilang karena PR ini (update rutin, bukan security fix).");
    lines.push("");
  }

  if (introduced.length) {
    lines.push(`### ⚠️ Advisory baru muncul (${introduced.length})`);
    lines.push("");
    for (const a of introduced) {
      const link = a.url ? ` ([advisory](${a.url}))` : "";
      lines.push(`- **${SEVERITY_BADGE[a.severity] ?? a.severity}** \`${a.name}\`: ${a.title}${link}`);
    }
    lines.push("");
  }

  if (remaining.length) {
    lines.push(`<details><summary>Advisory yang masih tersisa (${remaining.length})</summary>`);
    lines.push("");
    for (const a of remaining) {
      lines.push(`- **${SEVERITY_BADGE[a.severity] ?? a.severity}** \`${a.name}\`: ${a.title}`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "Gate yang harus lolos sebelum merge: `Typecheck & Build`, `bun run audit:deps:ci`, dan `bun run audit:router-versions`.",
  );
  return lines.join("\n");
}

const markdown = buildMarkdown();
process.stdout.write(`${markdown}\n`);
if (outFile) writeFileSync(outFile, `${markdown}\n`, "utf8");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
