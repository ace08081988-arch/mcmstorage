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
import Ajv from "ajv";

const FAIL_ON_LEVEL = (process.env.FAIL_ON_LEVEL || "WARN").toUpperCase();
const LEVEL_RANK = { INFO: 0, WARN: 1, ERROR: 2 };

const here = dirname(fileURLToPath(import.meta.url));
const allowlistPath = resolve(here, "..", ".github", "supabase-lint-allowlist.json");
const schemaPath = resolve(here, "..", ".github", "supabase-lint-allowlist.schema.json");
const allowlistRaw = readFileSync(allowlistPath, "utf8");
const allowlist = JSON.parse(allowlistRaw);
const allowlistSchema = JSON.parse(readFileSync(schemaPath, "utf8"));

// Relative path used in GitHub annotations. `::error file=<path>::` needs a
// path relative to the repository root; the checker always runs from repo
// root in CI, and locally the annotation is harmless.
const ALLOWLIST_REL_PATH = ".github/supabase-lint-allowlist.json";
const IS_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === "true";

/**
 * Scan the raw JSON text once and build a line map:
 *   - rootKeyLines: Map<rootKey, line>  (e.g. "schemaVersion" -> 3)
 *   - entries:      Array<{ startLine, keyLines: Map<entryKey, line> }>
 *
 * The scan is a small state machine that tracks quote/escape state, brace
 * depth, and array depth. When we're at depth "allow[]" we record the line
 * of every `{` (entry start) and every `"key":` inside that entry. This
 * lets validation errors point at the exact offending field in CI
 * annotations instead of dumping "allow[3]" into logs.
 */
function buildAllowlistLineMap(text) {
  const rootKeyLines = new Map();
  const entries = [];
  // Precompute line-of-index so peeking never miscounts newlines.
  let ln = 1;
  const lineAt = new Int32Array(text.length + 1);
  for (let i = 0; i < text.length; i++) {
    lineAt[i] = ln;
    if (text[i] === "\n") ln++;
  }
  lineAt[text.length] = ln;

  // path stack: entries are { type: 'obj'|'arr', key?: string }
  const stack = [];
  let inStr = false;
  let esc = false;
  let strStart = -1;
  let expectKey = false; // right after '{' or ',' inside an object

  const inAllowArray = () =>
    stack.length >= 2 &&
    stack[0].type === "obj" &&
    stack[1].type === "arr" &&
    stack[1].key === "allow";
  const inAllowEntry = () =>
    stack.length >= 3 &&
    stack[0].type === "obj" &&
    stack[1].type === "arr" &&
    stack[1].key === "allow" &&
    stack[2].type === "obj";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        // String closed. Peek next non-whitespace char.
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        const isKey = text[j] === ":";
        if (isKey && expectKey) {
          const rawKey = text.slice(strStart + 1, i);
          const keyLine = lineAt[strStart];
          if (stack.length === 1) {
            rootKeyLines.set(rawKey, keyLine);
          } else if (inAllowEntry()) {
            const entry = entries[entries.length - 1];
            if (entry) entry.keyLines.set(rawKey, keyLine);
          }
          expectKey = false;
        }
        inStr = false;
        strStart = -1;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      strStart = i;
      continue;
    }
    if (ch === "{") {
      // Opening object. If we're inside `allow` array, this is a new entry.
      if (inAllowArray()) {
        entries.push({ startLine: lineAt[i], keyLines: new Map() });
      }
      stack.push({ type: "obj" });
      expectKey = true;
      continue;
    }
    if (ch === "[") {
      // Opening array — inherit the last-seen key from parent object.
      // We know we're opening `allow` when parent object saw "allow" key.
      // Track that by remembering the last key on the parent frame.
      const parent = stack[stack.length - 1];
      const key = parent?.pendingArrayKey;
      stack.push({ type: "arr", key });
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      expectKey = false;
      continue;
    }
    if (ch === ":") {
      // The most-recent string was a key; remember it on parent frame so
      // that if the value is `[`, we can label the array with that key.
      // (Cheap heuristic: only stash for the root-level `allow` key.)
      const parent = stack[stack.length - 1];
      if (parent && parent.type === "obj" && stack.length === 1) {
        // Look back for the most recent key name we stored on this object.
        // We know it because `expectKey` just flipped false when we closed
        // the key string, but we didn't keep the name here. Re-scan the
        // small window between the previous ',' or '{' and this ':'.
        const start = Math.max(
          text.lastIndexOf("{", i - 1),
          text.lastIndexOf(",", i - 1),
        );
        const slice = text.slice(start + 1, i);
        const m = slice.match(/"([^"\\]+)"\s*$/);
        if (m) parent.pendingArrayKey = m[1];
      }
      continue;
    }
    if (ch === ",") {
      const parent = stack[stack.length - 1];
      if (parent?.type === "obj") expectKey = true;
      continue;
    }
  }
  return { rootKeyLines, entries };
}

const lineMap = buildAllowlistLineMap(allowlistRaw);

/**
 * Resolve the best line number for a validation error.
 *   - entryIdx + key: line of that field inside the entry (fallback: entry start)
 *   - entryIdx only:  line of the entry's opening `{`
 *   - rootKey:        line of that root-level key
 * Falls back to 1 so annotations never point at a bogus line.
 */
function resolveLine({ entryIdx, key, rootKey }) {
  if (typeof entryIdx === "number") {
    const entry = lineMap.entries[entryIdx];
    if (entry) {
      if (key && entry.keyLines.has(key)) return entry.keyLines.get(key);
      return entry.startLine;
    }
  }
  if (rootKey && lineMap.rootKeyLines.has(rootKey)) {
    return lineMap.rootKeyLines.get(rootKey);
  }
  return 1;
}

/**
 * Emit a GitHub Actions error annotation. Silently no-ops when not running
 * under Actions so local invocations stay quiet.
 * See https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
 */
function emitAnnotation({ file, line, title, message }) {
  if (!IS_GITHUB_ACTIONS) return;
  const escProp = (s) =>
    String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C");
  const escData = (s) =>
    String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const params = [`file=${escProp(file)}`, `line=${line}`];
  if (title) params.push(`title=${escProp(title)}`);
  // eslint-disable-next-line no-console
  console.log(`::error ${params.join(",")}::${escData(message)}`);
}

// ---------- Schema version compatibility ----------
// The validator only accepts allowlist files whose `schemaVersion` matches
// this constant. When a future change adds/renames/removes fields in a way
// that old checkouts cannot understand, bump BOTH this constant AND the
// `const` value under `schemaVersion` in the JSON Schema. That way an old
// script running against a newer file (or vice-versa) fails loudly instead
// of silently accepting a stale format. Additive, backwards-compatible
// changes do NOT require a bump — extend the schema properties instead.
const SUPPORTED_ALLOWLIST_SCHEMA_VERSION = 1;

if (allowlist.schemaVersion !== SUPPORTED_ALLOWLIST_SCHEMA_VERSION) {
  const got =
    allowlist.schemaVersion === undefined
      ? "missing (legacy pre-v1 file)"
      : JSON.stringify(allowlist.schemaVersion);
  const versionMsg =
    `Allowlist schemaVersion mismatch: expected ${SUPPORTED_ALLOWLIST_SCHEMA_VERSION}, got ${got}.`;
  console.error(
    `\n❌ ${versionMsg}\n` +
      `   File: .github/supabase-lint-allowlist.json\n` +
      `   Either update the file to the current schema and set "schemaVersion": ${SUPPORTED_ALLOWLIST_SCHEMA_VERSION},\n` +
      `   or update SUPPORTED_ALLOWLIST_SCHEMA_VERSION in scripts/check-supabase-lints.mjs\n` +
      `   together with the JSON Schema's schemaVersion.const. See docs/supabase-lint-allowlist.md.`,
  );
  emitAnnotation({
    file: ALLOWLIST_REL_PATH,
    line: resolveLine({ rootKey: "schemaVersion" }),
    title: "Allowlist schemaVersion mismatch",
    message: versionMsg,
  });
  const summaryPathVer = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPathVer) {
    appendFileSync(
      summaryPathVer,
      [
        "# Supabase Security Linter",
        "",
        "## ❌ Allowlist schemaVersion mismatch",
        "",
        `- Expected: \`${SUPPORTED_ALLOWLIST_SCHEMA_VERSION}\``,
        `- Got: \`${got}\``,
        "",
        "Bump the allowlist to the current schema, or update `SUPPORTED_ALLOWLIST_SCHEMA_VERSION` in the checker.",
        "",
      ].join("\n") + "\n",
    );
  }
  process.exit(1);
}

// ---------- Allowlist schema validation ----------
// Two-phase validation:
//   1. JSON Schema (Ajv) enforces the structural contract — required fields,
//      types, enums, minLength, regex patterns, uniqueItems. The schema file
//      is the canonical source of truth and lives next to the allowlist so
//      editors can pick it up via the `$schema` reference.
//   2. Cross-entry invariants that JSON Schema cannot express — category
//      uniqueness per rule, and no function appearing in two buckets for the
//      same rule (duplicate suppression hides regressions).
const VALID_LEVELS = new Set(["INFO", "WARN", "ERROR"]);
const MIN_REASON_LEN = 40;
/**
 * Structured validation errors. Each entry carries the human-readable
 * message PLUS enough context to resolve a file line for GitHub
 * annotations. Shape:
 *   { msg, entryIdx?: number, key?: string, rootKey?: string }
 */
const schemaValidationErrors = [];
const pushErr = (msg, ctx = {}) => schemaValidationErrors.push({ msg, ...ctx });
const seenCategoryPerRule = new Map(); // rule -> Set<category>
const seenFunctionPerRule = new Map(); // rule -> Map<fn, category>

// Phase 1: JSON Schema
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
const validateSchema = ajv.compile(allowlistSchema);
if (!validateSchema(allowlist)) {
  for (const err of validateSchema.errors || []) {
    const path = err.instancePath || "(root)";
    // instancePath is like "/allow/3/reason" — parse it into entryIdx+key.
    const parts = path.split("/").filter(Boolean);
    let entryIdx;
    let key;
    let rootKey;
    if (parts[0] === "allow" && parts[1] !== undefined) {
      const n = Number(parts[1]);
      if (Number.isInteger(n)) entryIdx = n;
      if (parts[2]) key = parts[2];
    } else if (parts[0]) {
      rootKey = parts[0];
    }
    // Ajv reports the missing property under `params.missingProperty`
    // with `instancePath` pointing at the parent — surface that as `key`.
    if (!key && err.params?.missingProperty) key = err.params.missingProperty;
    pushErr(`${path} ${err.message}`, { entryIdx, key, rootKey });
  }
}

// Phase 2: cross-entry invariants
if (!Array.isArray(allowlist.allow)) {
  pushErr("`allow` must be an array.", { rootKey: "allow" });
}

(allowlist.allow || []).forEach((entry, idx) => {
  const loc = `allow[${idx}]${entry?.category ? ` (category=${entry.category})` : ""}`;
  if (!entry || typeof entry !== "object") {
    pushErr(`${loc}: entry must be an object.`, { entryIdx: idx });
    return;
  }
  if (!entry.name || typeof entry.name !== "string") {
    pushErr(`${loc}: missing/empty 'name' (linter rule id).`, { entryIdx: idx, key: "name" });
  }
  const level = (entry.level || "").toUpperCase();
  if (!VALID_LEVELS.has(level)) {
    pushErr(
      `${loc}: 'level' must be one of ${[...VALID_LEVELS].join("|")} (got '${entry.level}').`,
      { entryIdx: idx, key: "level" },
    );
  }
  if (!entry.category || typeof entry.category !== "string" || !entry.category.trim()) {
    pushErr(`${loc}: 'category' is required and must be a non-empty string.`, {
      entryIdx: idx,
      key: "category",
    });
  }
  if (!entry.reason || typeof entry.reason !== "string" || !entry.reason.trim()) {
    pushErr(`${loc}: 'reason' is required and must be a non-empty string.`, {
      entryIdx: idx,
      key: "reason",
    });
  } else if (entry.reason.trim().length < MIN_REASON_LEN) {
    pushErr(
      `${loc}: 'reason' too short (${entry.reason.trim().length} chars, need >= ${MIN_REASON_LEN}). Justification must be substantive.`,
      { entryIdx: idx, key: "reason" },
    );
  }
  if (!Array.isArray(entry.functions) || entry.functions.length === 0) {
    pushErr(`${loc}: 'functions' must be a non-empty array.`, {
      entryIdx: idx,
      key: "functions",
    });
  }

  // Uniqueness: category per rule
  if (entry.name && entry.category) {
    const cats = seenCategoryPerRule.get(entry.name) || new Set();
    if (cats.has(entry.category)) {
      pushErr(
        `${loc}: duplicate category '${entry.category}' for rule '${entry.name}'. Merge into a single entry.`,
        { entryIdx: idx, key: "category" },
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
        pushErr(`${loc}: functions[] contains empty/non-string value.`, {
          entryIdx: idx,
          key: "functions",
        });
        continue;
      }
      if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(fn)) {
        pushErr(
          `${loc}: function '${fn}' must be schema-qualified (e.g. 'public.my_fn').`,
          { entryIdx: idx, key: "functions" },
        );
      }
      if (seenInEntry.has(fn)) {
        pushErr(`${loc}: function '${fn}' listed twice in same entry.`, {
          entryIdx: idx,
          key: "functions",
        });
        continue;
      }
      seenInEntry.add(fn);
      if (perRule.has(fn)) {
        pushErr(
          `${loc}: function '${fn}' already allowlisted under category '${perRule.get(fn)}' for rule '${entry.name}'. A function must belong to exactly one bucket.`,
          { entryIdx: idx, key: "functions" },
        );
      } else {
        perRule.set(fn, entry.category || "(uncategorised)");
      }
    }
    seenFunctionPerRule.set(entry.name, perRule);

    // Ordering: `functions` must stay alphabetically sorted so diffs stay
    // reviewable and additions land in a predictable place. The docs already
    // require this; the checker enforces it here to prevent drift.
    const sorted = [...entry.functions].sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < entry.functions.length; i++) {
      if (entry.functions[i] !== sorted[i]) {
        pushErr(
          `${loc}: 'functions' must be alphabetically sorted. Expected '${sorted[i]}' at index ${i}, got '${entry.functions[i]}'.`,
          { entryIdx: idx, key: "functions" },
        );
        break;
      }
    }
  }
});

if (schemaValidationErrors.length) {
  console.error(
    `\n❌ Allowlist schema validation failed (${schemaValidationErrors.length} error${schemaValidationErrors.length === 1 ? "" : "s"}):`,
  );
  for (const err of schemaValidationErrors) {
    console.error(`  - ${err.msg}`);
    emitAnnotation({
      file: ALLOWLIST_REL_PATH,
      line: resolveLine(err),
      title: "Allowlist validation error",
      message: err.msg,
    });
  }
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
        ...schemaValidationErrors.map(
          (e) => `- \`L${resolveLine(e)}\` ${e.msg}`,
        ),
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