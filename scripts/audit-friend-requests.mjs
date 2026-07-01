#!/usr/bin/env node
// Automated friend_requests security audit runner.
//
// Executes supabase/tests/audit_friend_requests.sql against $DATABASE_URL,
// writes the full report to audit-reports/friend_requests-<timestamp>.log,
// and exits non-zero on any AUDIT FAIL. Designed for CI + local invocation
// (bun run audit:friend-requests).

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!DB_URL && !process.env.PGHOST) {
  console.error("audit-friend-requests: DATABASE_URL / SUPABASE_DB_URL / PG* not set");
  process.exit(2);
}

const script = resolve("supabase/tests/audit_friend_requests.sql");
const outDir = resolve("audit-reports");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = resolve(outDir, `friend_requests-${stamp}.log`);

const args = ["-v", "ON_ERROR_STOP=1", "-X", "-f", script];
if (DB_URL) args.unshift(DB_URL);

const res = spawnSync("psql", args, {
  encoding: "utf8",
  env: { ...process.env, PGCLIENTENCODING: "UTF8" },
});

const combined = `# friend_requests audit — ${new Date().toISOString()}\n`
  + `# exit code: ${res.status}\n\n`
  + `--- STDOUT ---\n${res.stdout ?? ""}\n`
  + `--- STDERR ---\n${res.stderr ?? ""}\n`;
writeFileSync(outFile, combined);

process.stdout.write(res.stdout ?? "");
process.stderr.write(res.stderr ?? "");

const failMarker = /AUDIT FAIL/.test((res.stdout ?? "") + (res.stderr ?? ""));
if (res.status !== 0 || failMarker) {
  console.error(`\naudit-friend-requests: FAILED — report saved to ${outFile}`);
  process.exit(1);
}
console.log(`\naudit-friend-requests: OK — report saved to ${outFile}`);