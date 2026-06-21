#!/usr/bin/env node
/**
 * Fetches Supabase database linter findings via the Management API and
 * fails the build on any finding NOT covered by .github/supabase-lint-allowlist.json.
 *
 * Required env:
 *   SUPABASE_ACCESS_TOKEN  personal/CI access token (https://supabase.com/dashboard/account/tokens)
 *   SUPABASE_PROJECT_REF   project ref (e.g. abcd1234...)
 * Optional env:
 *   FAIL_ON_LEVEL          minimum level that fails the build (default: WARN; values: INFO|WARN|ERROR)
 */
import { readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
const FAIL_ON_LEVEL = (process.env.FAIL_ON_LEVEL || "WARN").toUpperCase();
const LEVEL_RANK = { INFO: 0, WARN: 1, ERROR: 2 };

if (!TOKEN || !REF) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF env vars.");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const allowlistPath = resolve(here, "..", ".github", "supabase-lint-allowlist.json");
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));

/** Build a quick lookup: name -> { level, functions:Set<string> } */
const allowIndex = new Map();
for (const entry of allowlist.allow || []) {
  allowIndex.set(entry.name, {
    level: (entry.level || "WARN").toUpperCase(),
    functions: new Set(entry.functions || []),
  });
}

const res = await fetch(
  `https://api.supabase.com/v1/projects/${REF}/database/lints`,
  { headers: { Authorization: `Bearer ${TOKEN}` } },
);
if (!res.ok) {
  console.error(`Supabase API ${res.status}: ${await res.text()}`);
  process.exit(2);
}
const findings = await res.json();

const unexpected = [];
const suppressed = [];

for (const f of findings) {
  const level = (f.level || "WARN").toUpperCase();
  if ((LEVEL_RANK[level] ?? 1) < (LEVEL_RANK[FAIL_ON_LEVEL] ?? 1)) {
    continue; // below threshold
  }
  const rule = allowIndex.get(f.name);
  // Try to extract the function/object identifier from metadata
  const md = f.metadata || {};
  const ident =
    (md.schema && md.name && `${md.schema}.${md.name}`) ||
    md.name ||
    md.entity ||
    md.object ||
    null;

  const matched =
    rule &&
    rule.level === level &&
    (rule.functions.size === 0 || (ident && rule.functions.has(ident)));

  if (matched) suppressed.push({ ...f, ident });
  else unexpected.push({ ...f, ident });
}

console.log(
  `Supabase linter: ${findings.length} total, ${suppressed.length} allowlisted, ${unexpected.length} unexpected (fail threshold: ${FAIL_ON_LEVEL}).`,
);

// ---------- GitHub Actions summary ----------
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const lines = [];
  lines.push(`# Supabase Security Linter`);
  lines.push("");
  lines.push(`**Project:** \`${REF}\` &nbsp; **Fail threshold:** \`${FAIL_ON_LEVEL}\``);
  lines.push("");
  lines.push(`| Metric | Count |`);
  lines.push(`| --- | ---: |`);
  lines.push(`| Total findings returned | ${findings.length} |`);
  lines.push(`| ✅ Matched allowlist (suppressed) | ${suppressed.length} |`);
  lines.push(`| ❌ Unexpected (new) findings | ${unexpected.length} |`);
  lines.push("");

  if (unexpected.length) {
    lines.push(`## ❌ Unexpected findings (build will fail)`);
    lines.push("");
    lines.push(`| Level | Rule | Identifier | Description |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const f of unexpected) {
      const desc = (f.description?.split("\n")[0] || "").replace(/\|/g, "\\|");
      lines.push(`| \`${f.level}\` | \`${f.name}\` | \`${f.ident || "—"}\` | ${desc} |`);
    }
    lines.push("");
    lines.push(
      `> If any of these are intentional, document and add them to \`.github/supabase-lint-allowlist.json\`.`,
    );
    lines.push("");
  } else {
    lines.push(`## ✅ No unexpected findings`);
    lines.push("");
  }

  if (suppressed.length) {
    // Group suppressed by rule name for a compact view
    const byRule = new Map();
    for (const f of suppressed) {
      if (!byRule.has(f.name)) byRule.set(f.name, []);
      byRule.get(f.name).push(f);
    }
    lines.push(`<details><summary>Allowlist matches (${suppressed.length})</summary>`);
    lines.push("");
    for (const [rule, items] of byRule) {
      lines.push(`### \`${rule}\` — ${items.length} match${items.length === 1 ? "" : "es"}`);
      lines.push("");
      lines.push(`| Level | Identifier |`);
      lines.push(`| --- | --- |`);
      for (const f of items) {
        lines.push(`| \`${f.level}\` | \`${f.ident || "—"}\` |`);
      }
      lines.push("");
    }
    lines.push(`</details>`);
    lines.push("");
  }

  // Allowlist coverage: entries declared but not seen in this scan
  const seenIdents = new Set(suppressed.map((f) => f.ident).filter(Boolean));
  const unusedEntries = [];
  for (const entry of allowlist.allow || []) {
    for (const fn of entry.functions || []) {
      if (!seenIdents.has(fn)) unusedEntries.push({ rule: entry.name, fn });
    }
  }
  if (unusedEntries.length) {
    lines.push(
      `<details><summary>Allowlist entries not matched by this scan (${unusedEntries.length})</summary>`,
    );
    lines.push("");
    lines.push(`| Rule | Identifier |`);
    lines.push(`| --- | --- |`);
    for (const u of unusedEntries) lines.push(`| \`${u.rule}\` | \`${u.fn}\` |`);
    lines.push("");
    lines.push(`> These may be stale entries safe to remove from the allowlist.`);
    lines.push("");
    lines.push(`</details>`);
    lines.push("");
  }

  appendFileSync(summaryPath, lines.join("\n") + "\n");
}

if (unexpected.length) {
  console.error("\n❌ Unexpected findings:");
  for (const f of unexpected) {
    console.error(
      `  - [${f.level}] ${f.name}${f.ident ? ` @ ${f.ident}` : ""}\n      ${f.description?.split("\n")[0] || ""}`,
    );
  }
  console.error(
    "\nIf any of these are intentional, document and add them to .github/supabase-lint-allowlist.json.",
  );
  process.exit(1);
}

if (suppressed.length) {
  console.log("\nAllowlisted (informational):");
  for (const f of suppressed) {
    console.log(`  - [${f.level}] ${f.name}${f.ident ? ` @ ${f.ident}` : ""}`);
  }
}
console.log("\n✅ No unexpected Supabase linter findings.");