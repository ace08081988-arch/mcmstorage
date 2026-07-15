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

const FAIL_ON_LEVEL = (process.env.FAIL_ON_LEVEL || "WARN").toUpperCase();
const LEVEL_RANK = { INFO: 0, WARN: 1, ERROR: 2 };

const here = dirname(fileURLToPath(import.meta.url));
const allowlistPath = resolve(here, "..", ".github", "supabase-lint-allowlist.json");
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));

// ---------- Allowlist schema validation ----------
// Every entry MUST declare: name, level, category (non-empty, unique per rule),
// reason (substantive, >= 40 chars), and a non-empty functions[] with unique,
// schema-qualified identifiers. No function may appear twice under the same
// rule (duplicate suppression hides regressions).
const VALID_LEVELS = new Set(["INFO", "WARN", "ERROR"]);
const MIN_REASON_LEN = 40;
const schemaValidationErrors = [];
const seenCategoryPerRule = new Map(); // rule -> Set<category>
const seenFunctionPerRule = new Map(); // rule -> Map<fn, category>

if (!Array.isArray(allowlist.allow)) {
  schemaValidationErrors.push("`allow` must be an array.");
}

(allowlist.allow || []).forEach((entry, idx) => {
  const loc = `allow[${idx}]${entry?.category ? ` (category=${entry.category})` : ""}`;
  if (!entry || typeof entry !== "object") {
    schemaValidationErrors.push(`${loc}: entry must be an object.`);
    return;
  }
  if (!entry.name || typeof entry.name !== "string") {
    schemaValidationErrors.push(`${loc}: missing/empty 'name' (linter rule id).`);
  }
  const level = (entry.level || "").toUpperCase();
  if (!VALID_LEVELS.has(level)) {
    schemaValidationErrors.push(
      `${loc}: 'level' must be one of ${[...VALID_LEVELS].join("|")} (got '${entry.level}').`,
    );
  }
  if (!entry.category || typeof entry.category !== "string" || !entry.category.trim()) {
    schemaValidationErrors.push(`${loc}: 'category' is required and must be a non-empty string.`);
  }
  if (!entry.reason || typeof entry.reason !== "string" || !entry.reason.trim()) {
    schemaValidationErrors.push(`${loc}: 'reason' is required and must be a non-empty string.`);
  } else if (entry.reason.trim().length < MIN_REASON_LEN) {
    schemaValidationErrors.push(
      `${loc}: 'reason' too short (${entry.reason.trim().length} chars, need >= ${MIN_REASON_LEN}). Justification must be substantive.`,
    );
  }
  if (!Array.isArray(entry.functions) || entry.functions.length === 0) {
    schemaValidationErrors.push(`${loc}: 'functions' must be a non-empty array.`);
  }

  // Uniqueness: category per rule
  if (entry.name && entry.category) {
    const cats = seenCategoryPerRule.get(entry.name) || new Set();
    if (cats.has(entry.category)) {
      schemaValidationErrors.push(
        `${loc}: duplicate category '${entry.category}' for rule '${entry.name}'. Merge into a single entry.`,
      );
    }
    cats.add(entry.category);
    seenCategoryPerRule.set(entry.name, cats);
  }

  // Uniqueness + shape: functions within entry and across entries per rule
  if (Array.isArray(entry.functions) && entry.name) {
    const seenInEntry = new Set();
    const perRule = seenFunctionPerRule.get(entry.name) || new Map();
    for (const fn of entry.functions) {
      if (typeof fn !== "string" || !fn.trim()) {
        schemaValidationErrors.push(`${loc}: functions[] contains empty/non-string value.`);
        continue;
      }
      if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(fn)) {
        schemaValidationErrors.push(
          `${loc}: function '${fn}' must be schema-qualified (e.g. 'public.my_fn').`,
        );
      }
      if (seenInEntry.has(fn)) {
        schemaValidationErrors.push(`${loc}: function '${fn}' listed twice in same entry.`);
        continue;
      }
      seenInEntry.add(fn);
      if (perRule.has(fn)) {
        schemaValidationErrors.push(
          `${loc}: function '${fn}' already allowlisted under category '${perRule.get(fn)}' for rule '${entry.name}'. A function must belong to exactly one bucket.`,
        );
      } else {
        perRule.set(fn, entry.category || "(uncategorised)");
      }
    }
    seenFunctionPerRule.set(entry.name, perRule);
  }
});

if (schemaValidationErrors.length) {
  console.error("\n❌ Allowlist schema validation failed:");
  for (const err of schemaValidationErrors) console.error(`  - ${err}`);
  console.error(
    `\nFix .github/supabase-lint-allowlist.json — every entry needs a unique category, a substantive reason (>= ${MIN_REASON_LEN} chars), and no duplicate function suppressions.`,
  );
  const summaryPathEarly = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPathEarly) {
    appendFileSync(
      summaryPathEarly,
      [
        "# Supabase Security Linter",
        "",
        "## ❌ Allowlist schema validation failed",
        "",
        ...schemaValidationErrors.map((e) => `- ${e}`),
        "",
      ].join("\n") + "\n",
    );
  }
  process.exit(1);
}

/** Build a quick lookup: name -> { level, functions:Set<string> } */
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN || !REF) {
  // Allow VALIDATE_ONLY mode: schema validation above already ran & passed.
  if (process.env.VALIDATE_ONLY === "1") {
    console.log("✅ Allowlist schema validation passed (VALIDATE_ONLY).");
    process.exit(0);
  }
  console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF env vars.");
  process.exit(2);
}

const allowIndex = new Map();
for (const entry of allowlist.allow || []) {
  const level = (entry.level || "WARN").toUpperCase();
  const existing = allowIndex.get(entry.name);
  if (existing) {
    if (existing.level !== level) {
      console.warn(
        `Allowlist: level mismatch for rule '${entry.name}' (${existing.level} vs ${level}); keeping ${existing.level}.`,
      );
    }
    for (const fn of entry.functions || []) existing.functions.add(fn);
  } else {
    allowIndex.set(entry.name, {
      level,
      functions: new Set(entry.functions || []),
    });
  }
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