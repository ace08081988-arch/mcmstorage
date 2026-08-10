#!/usr/bin/env node
/**
 * Validasi build: kompatibilitas versi @tanstack/react-router,
 * @tanstack/react-start, dan @tanstack/router-plugin.
 *
 * Update dependency yang tidak sinkron menyebabkan konflik senyap:
 * dua salinan router-core, route tree gagal digenerate, atau error
 * runtime "Invalid server function ID". Audit ini menggagalkan build
 * lebih dulu dengan pesan perbaikan yang eksplisit.
 *
 * Aturan yang diperiksa:
 *  1. Versi terpasang cocok dengan versi yang dipin di package.json.
 *  2. @tanstack/react-start memin @tanstack/react-router — versi itu harus
 *     sama persis dengan react-router yang terpasang.
 *  3. peerDependency @tanstack/react-router pada router-plugin harus
 *     terpenuhi oleh react-router yang terpasang.
 *  4. @tanstack/router-core harus tunggal (tidak ada salinan nested).
 *
 * Flag: --json untuk output mesin.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const pkgPath = (name) => join(ROOT, "node_modules", name, "package.json");

function installed(name) {
  const p = pkgPath(name);
  return existsSync(p) ? readJson(p) : null;
}

const root = readJson(join(ROOT, "package.json"));
const declared = { ...root.dependencies, ...root.devDependencies };
const errors = [];
const warnings = [];

const PINNED = ["@tanstack/react-router", "@tanstack/react-start", "@tanstack/router-plugin"];
const meta = {};

for (const name of PINNED) {
  const pkg = installed(name);
  if (!pkg) {
    errors.push(`${name} tidak terpasang. Jalankan \`bun install\`.`);
    continue;
  }
  meta[name] = pkg.version;
  const range = declared[name];
  if (!range) {
    warnings.push(`${name} terpasang (${pkg.version}) tapi tidak terdaftar di package.json.`);
  } else if (!semver.satisfies(pkg.version, range, { includePrerelease: true })) {
    errors.push(
      `${name}@${pkg.version} tidak memenuhi range package.json "${range}". Regenerasi bun.lock (\`bun install\`).`,
    );
  }
}

const router = installed("@tanstack/react-router");
const start = installed("@tanstack/react-start");
const plugin = installed("@tanstack/router-plugin");

// 2. react-start memin react-router secara eksak.
if (router && start) {
  const want = start.dependencies?.["@tanstack/react-router"];
  if (want && !semver.satisfies(router.version, want, { includePrerelease: true })) {
    errors.push(
      `@tanstack/react-start@${start.version} membutuhkan @tanstack/react-router "${want}", ` +
        `tapi yang terpasang ${router.version}. Samakan pin @tanstack/react-router di package.json ke ${want}.`,
    );
  }
}

// 3. peerDependency router-plugin -> react-router.
if (router && plugin) {
  const peer = plugin.peerDependencies?.["@tanstack/react-router"];
  if (peer && !semver.satisfies(router.version, peer, { includePrerelease: true })) {
    errors.push(
      `@tanstack/router-plugin@${plugin.version} butuh @tanstack/react-router "${peer}", ` +
        `tapi yang terpasang ${router.version}. Naikkan/turunkan router-plugin agar cocok.`,
    );
  }
}

// 4. router-core harus tunggal.
function findNestedCore(dir, depth = 0, found = []) {
  if (depth > 4 || !existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    if (entry.name === "node_modules") {
      const core = join(child, "@tanstack", "router-core", "package.json");
      if (existsSync(core)) found.push({ path: core, version: readJson(core).version });
      findNestedCore(child, depth + 1, found);
    } else if (entry.name.startsWith("@") || depth === 0) {
      findNestedCore(child, depth + 1, found);
    }
  }
  return found;
}

const cores = [];
const topCore = installed("@tanstack/router-core");
if (topCore) cores.push({ path: pkgPath("@tanstack/router-core"), version: topCore.version });
cores.push(...findNestedCore(join(ROOT, "node_modules", "@tanstack")));
const coreVersions = [...new Set(cores.map((c) => c.version))];
if (coreVersions.length > 1) {
  errors.push(
    `Terdeteksi ${coreVersions.length} versi @tanstack/router-core (${coreVersions.join(", ")}). ` +
      `Dua salinan router-core memecah konteks router. Samakan versi router/start/plugin lalu \`bun install\`.`,
  );
}

const report = {
  ok: errors.length === 0,
  versions: { ...meta, "@tanstack/router-core": coreVersions.join(", ") || "-" },
  errors,
  warnings,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

for (const w of warnings) console.warn(`⚠️  ${w}`);

if (!report.ok) {
  console.error("❌ Kompatibilitas versi router bermasalah:\n");
  for (const e of errors) console.error(`  • ${e}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    try {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        ["## ❌ Audit versi router gagal", "", ...errors.map((e) => `- ${e}`), ""].join("\n") + "\n",
      );
    } catch {
      /* summary opsional */
    }
  }
  process.exit(1);
}

console.log(
  `✅ Versi router kompatibel — react-router ${meta["@tanstack/react-router"]}, ` +
    `react-start ${meta["@tanstack/react-start"]}, router-plugin ${meta["@tanstack/router-plugin"]}, ` +
    `router-core ${coreVersions.join(", ")}.`,
);
