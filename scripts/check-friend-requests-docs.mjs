#!/usr/bin/env node
// CI guard: setiap perubahan pada policy / trigger / RPC yang menyentuh
// public.friend_requests WAJIB disertai pembaruan:
//   - docs/friend-requests-rls.md
//   - supabase/tests/security_rls_authz.sql
//   - supabase/tests/audit_friend_requests.sql
//
// Jalankan lokal:   node scripts/check-friend-requests-docs.mjs
// Default: bandingkan HEAD terhadap $BASE_REF atau `origin/main`.

import { execSync } from "node:child_process";

const BASE = process.env.BASE_REF || process.env.GITHUB_BASE_REF || "origin/main";
const HEAD = process.env.HEAD_REF || "HEAD";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

let changedFiles = [];
try {
  changedFiles = sh(`git diff --name-only ${BASE}...${HEAD}`).split("\n").filter(Boolean);
} catch {
  console.warn(`[check-fr-docs] tidak bisa diff ${BASE}...${HEAD}; fallback ke HEAD~1`);
  changedFiles = sh(`git diff --name-only HEAD~1...HEAD`).split("\n").filter(Boolean);
}

const migrationsChanged = changedFiles.filter(
  (f) => f.startsWith("supabase/migrations/") && f.endsWith(".sql"),
);

if (migrationsChanged.length === 0) {
  console.log("[check-fr-docs] tidak ada migrasi berubah — skip");
  process.exit(0);
}

const SURFACE_PATTERNS = [
  /friend_requests/i,
  /tg_friend_requests_guard/i,
  /send_friend_request/i,
  /respond_friend_request/i,
  /cancel_friend_request/i,
  /fr_(select|update|delete|insert)_/i,
];

function migrationTouchesSurface(path) {
  let diff;
  try {
    diff = sh(`git diff ${BASE}...${HEAD} -- ${path}`);
  } catch {
    return false;
  }
  const body = diff
    .split("\n")
    .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"))
    .join("\n");
  return SURFACE_PATTERNS.some((re) => re.test(body));
}

const touching = migrationsChanged.filter(migrationTouchesSurface);
if (touching.length === 0) {
  console.log("[check-fr-docs] migrasi berubah tetapi tidak menyentuh permukaan friend_requests — skip");
  process.exit(0);
}

const REQUIRED_COMPANIONS = [
  "docs/friend-requests-rls.md",
  "supabase/tests/security_rls_authz.sql",
  "supabase/tests/audit_friend_requests.sql",
];

const missing = REQUIRED_COMPANIONS.filter((f) => !changedFiles.includes(f));

if (missing.length === 0) {
  console.log("[check-fr-docs] OK — dokumentasi & uji ikut diperbarui:");
  for (const f of REQUIRED_COMPANIONS) console.log("  ✓", f);
  process.exit(0);
}

console.error("");
console.error("╔══════════════════════════════════════════════════════════════════╗");
console.error("║  FAIL check-friend-requests-docs                                 ║");
console.error("╚══════════════════════════════════════════════════════════════════╝");
console.error("");
console.error("Migrasi berikut menyentuh permukaan friend_requests:");
for (const f of touching) console.error("  •", f);
console.error("");
console.error("Wajib ikut memperbarui:");
for (const f of missing) console.error("  ✗", f);
console.error("");
console.error("Kenapa: kontrak RLS/trigger/RPC friend_requests dijaga oleh 3 sumber");
console.error("kebenaran yang harus sinkron dalam commit yang sama:");
console.error("  1. docs/friend-requests-rls.md — matriks izin & kontrak error");
console.error("  2. supabase/tests/security_rls_authz.sql — uji transisi & error");
console.error("  3. supabase/tests/audit_friend_requests.sql — audit CI nightly");
console.error("");
console.error("Perbaiki: perbarui file di atas lalu commit ulang. Bila migrasi hanya");
console.error("menyentuh komentar/whitespace, refleksikan itu di bagian Referensi");
console.error("docs/friend-requests-rls.md.");
console.error("");
process.exit(1);