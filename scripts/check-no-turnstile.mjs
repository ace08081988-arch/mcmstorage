#!/usr/bin/env node
// Fail the build if any Turnstile reference sneaks back into the repo.
// Historical migrations and the removal doc are allowlisted.
import { execSync } from "node:child_process";

const ALLOWLIST = [
  /^docs\/turnstile-removal\.md$/,
  /^supabase\/migrations\/\d+_.*\.sql$/,
  /^scripts\/check-no-turnstile\.mjs$/,
  /^\.github\/workflows\/check-no-turnstile\.yml$/,
];

const PATTERNS = [
  "TURNSTILE_SECRET_KEY",
  "VITE_TURNSTILE_SITE_KEY",
  "turnstile_config",
  "get_turnstile_site_key",
  "challenges.cloudflare.com/turnstile",
  "cf-turnstile",
];

const args = [
  "rg",
  "-n",
  "--hidden",
  "-g", "!node_modules",
  "-g", "!.git",
  "-g", "!bun.lockb",
  "-g", "!package-lock.json",
  ...PATTERNS.flatMap((p) => ["-e", p]),
  ".",
];

let raw = "";
try {
  raw = execSync(args.map((a) => (/[^\w./=!-]/.test(a) ? JSON.stringify(a) : a)).join(" "), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  // rg exits 1 when there are no matches — that's success for us.
  if (err.status === 1) {
    console.log("✓ No Turnstile references found.");
    process.exit(0);
  }
  console.error(err.stderr?.toString() || err.message);
  process.exit(2);
}

const offenders = raw
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const m = line.match(/^\.?\/?([^:]+):(\d+):(.*)$/);
    if (!m) return null;
    return { file: m[1], line: m[2], text: m[3] };
  })
  .filter(Boolean)
  .filter((hit) => !ALLOWLIST.some((rx) => rx.test(hit.file)));

if (offenders.length === 0) {
  console.log("✓ No Turnstile references outside allowlist.");
  process.exit(0);
}

console.error("✗ Turnstile references detected — they were removed and must not return:\n");
for (const hit of offenders) {
  console.error(`  ${hit.file}:${hit.line}  ${hit.text.trim()}`);
}
console.error(
  "\nAllowed paths: docs/turnstile-removal.md, supabase/migrations/*.sql, this script, and its workflow.",
);
process.exit(1);