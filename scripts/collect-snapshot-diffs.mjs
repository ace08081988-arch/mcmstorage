#!/usr/bin/env node
/**
 * Read a vitest JSON report and, for every failing snapshot assertion, write
 * `expected.txt`, `received.txt`, and a unified `diff.patch` into an output
 * directory. CI uploads that directory as an artifact so the diff between the
 * committed snapshot and the actually-rendered artefact is one click away.
 *
 * Usage:
 *   node scripts/collect-snapshot-diffs.mjs <vitest-report.json> <out-dir>
 *
 * Robust to both inline (`toMatchInlineSnapshot`) and file
 * (`toMatchSnapshot` / `toMatchFileSnapshot`) snapshots. Non-snapshot
 * failures are ignored — this script is only for snapshot diffs.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const [, , reportPath, outDir] = process.argv;
if (!reportPath || !outDir) {
  console.error(
    "usage: collect-snapshot-diffs.mjs <vitest-report.json> <out-dir>",
  );
  process.exit(2);
}

if (!existsSync(reportPath)) {
  console.log(`[snapshot-diffs] no report at ${reportPath}, nothing to do`);
  process.exit(0);
}

const root = resolve(outDir);
mkdirSync(root, { recursive: true });

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const cases = [];

// Vitest JSON reporter shape: { testResults: [{ name, assertionResults: [...] }] }
for (const file of report.testResults ?? []) {
  for (const a of file.assertionResults ?? []) {
    if (a.status !== "failed") continue;
    const msg = (a.failureMessages ?? []).join("\n");
    if (!/snapshot/i.test(msg)) continue;
    cases.push({ file: file.name, name: a.fullName || a.title, message: msg });
  }
}

if (cases.length === 0) {
  console.log("[snapshot-diffs] no failing snapshot assertions found");
  process.exit(0);
}

function slug(s) {
  return s
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

// Match the "expected" and "received" blocks vitest prints in the failure
// message. Vitest prints them in a few shapes; we try each in order.
function extractPair(msg) {
  // Shape A: "- Expected  - X\n+ Received  + Y\n\n  <diff lines>"
  //   → hardest to split back into full blobs; fall through.
  // Shape B: "Snapshot ... mismatched\n\nExpected: <val>\nReceived: <val>"
  const m1 = msg.match(
    /Expected:\s*([\s\S]*?)\nReceived:\s*([\s\S]*?)(?:\n\s*at\s|\n{2,}|$)/,
  );
  if (m1) return { expected: m1[1].trim(), received: m1[2].trim() };

  // Shape C: "- Snapshot\n+ Received\n\n<unified-ish diff>"
  const diffOnly = msg.match(/(?:^|\n)([-+][\s\S]*?)(?:\n\s*at\s|$)/);
  if (diffOnly) return { expected: null, received: null, diff: diffOnly[1] };

  return { expected: null, received: null };
}

const index = [];
for (let i = 0; i < cases.length; i++) {
  const c = cases[i];
  const rel = relative(process.cwd(), c.file) || `case-${i}`;
  const dir = join(root, `${String(i + 1).padStart(3, "0")}_${slug(rel)}__${slug(c.name)}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "failure.txt"), c.message, "utf8");

  const { expected, received, diff } = extractPair(c.message);
  if (expected != null) writeFileSync(join(dir, "expected.txt"), expected, "utf8");
  if (received != null) writeFileSync(join(dir, "received.txt"), received, "utf8");
  if (diff) writeFileSync(join(dir, "diff.patch"), diff, "utf8");

  index.push({
    file: rel,
    name: c.name,
    dir: relative(root, dir),
    hasExpected: expected != null,
    hasReceived: received != null,
    hasDiff: Boolean(diff),
  });
}

writeFileSync(join(root, "index.json"), JSON.stringify(index, null, 2));

// Human-readable summary for the CI step summary.
const md = [
  `# Snapshot diff bundle`,
  ``,
  `**${cases.length}** snapshot mismatch(es) captured.`,
  ``,
  `| # | File | Test | Files |`,
  `| - | ---- | ---- | ----- |`,
  ...index.map(
    (e, i) =>
      `| ${i + 1} | \`${e.file}\` | ${e.name} | ` +
      [
        e.hasExpected ? "expected.txt" : null,
        e.hasReceived ? "received.txt" : null,
        e.hasDiff ? "diff.patch" : null,
        "failure.txt",
      ]
        .filter(Boolean)
        .join(", ") +
      ` |`,
  ),
  ``,
  `Unduh artifact **snapshot-diffs-*** dari halaman run untuk melihat isinya.`,
].join("\n");
writeFileSync(join(root, "SUMMARY.md"), md);

console.log(`[snapshot-diffs] wrote ${cases.length} case(s) to ${root}`);
// Also mirror the committed __snapshots__ directories so reviewers can
// diff against them locally without checking out the branch.
// (Skipped when running outside a repo — best effort.)
try {
  const { execSync } = await import("node:child_process");
  const found = execSync("git ls-files 'src/**/__snapshots__/*'", {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  if (found.length) {
    const mirror = join(root, "__committed_snapshots__");
    for (const f of found) {
      const dest = join(mirror, f);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(f));
    }
    console.log(`[snapshot-diffs] mirrored ${found.length} committed snapshot file(s)`);
  }
} catch {
  // ignore
}