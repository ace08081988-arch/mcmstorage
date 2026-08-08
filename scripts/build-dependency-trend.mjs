#!/usr/bin/env node
/**
 * Bangun data dashboard tren dependency: perubahan versi paket per minggu
 * (dikelompokkan @tanstack/* vs router-plugin vs lainnya) plus status audit
 * (audit:router-versions dan audit:deps) saat build.
 *
 * Output: public/data/dependency-trend.json
 * Aman di clone dangkal / tanpa git: menulis dataset kosong, bukan gagal.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "data", "dependency-trend.json");
const WEEKS = Number(process.env["DEP_TREND_WEEKS"] ?? 16);

const sh = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function groupOf(name) {
  if (name === "@tanstack/router-plugin") return "router-plugin";
  if (name.startsWith("@tanstack/")) return "tanstack";
  return "lainnya";
}

/** Kunci minggu ISO (YYYY-Www) + tanggal Senin. */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7; // Senin = 0
  const monday = new Date(t);
  monday.setUTCDate(t.getUTCDate() - day);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const firstThu = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((thursday - firstThu) / (7 * 86400000));
  return {
    key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    start: monday.toISOString().slice(0, 10),
  };
}

function depsAt(ref) {
  const res = sh("git", ["show", `${ref}:package.json`]);
  if (res.status !== 0) return null;
  try {
    const pkg = JSON.parse(res.stdout);
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return null;
  }
}

function collectWeeks() {
  const log = sh("git", ["log", "--format=%H %cI", "--reverse", "--", "package.json"]);
  if (log.status !== 0 || !log.stdout.trim()) return { weeks: [], gitAvailable: false };
  const commits = log.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const [hash, iso] = line.trim().split(/\s+/);
      return { hash, date: new Date(iso) };
    })
    .filter((c) => c.hash && !Number.isNaN(c.date.getTime()));

  const buckets = new Map();
  let prev = null;
  for (const c of commits) {
    const cur = depsAt(c.hash);
    if (!cur) continue;
    if (prev) {
      const names = new Set([...Object.keys(prev), ...Object.keys(cur)]);
      const changes = [];
      for (const name of names) {
        const from = prev[name];
        const to = cur[name];
        if (from === to) continue;
        changes.push({ name, from: from ?? null, to: to ?? null, group: groupOf(name) });
      }
      if (changes.length) {
        const { key, start } = isoWeek(c.date);
        const b = buckets.get(key) ?? { week: key, start, tanstack: 0, "router-plugin": 0, lainnya: 0, changes: [] };
        for (const ch of changes) {
          b[ch.group] += 1;
          if (b.changes.length < 60) b.changes.push({ ...ch, date: c.date.toISOString() });
        }
        buckets.set(key, b);
      }
    }
    prev = cur;
  }
  const weeks = [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start)).slice(-WEEKS);
  return { weeks, gitAvailable: true };
}

function auditRouter() {
  const res = sh("node", ["scripts/audit-router-versions.mjs", "--json"]);
  try {
    const start = res.stdout.indexOf("{");
    const parsed = JSON.parse(res.stdout.slice(start));
    return { ok: !!parsed.ok, versions: parsed.versions ?? {}, errors: parsed.errors ?? [], warnings: parsed.warnings ?? [] };
  } catch {
    return { ok: false, versions: {}, errors: ["Audit versi router tidak menghasilkan JSON."], warnings: [] };
  }
}

function auditDeps() {
  const res = sh("bun", ["scripts/audit-ci.mjs", "--soft"]);
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  const skipped = /Lewati audit dependensi/.test(out);
  return {
    ok: res.status === 0 && !/❌/.test(out),
    skipped,
    output: out.slice(0, 2000),
  };
}

const { weeks, gitAvailable } = collectWeeks();
const router = auditRouter();
const deps = auditDeps();

const payload = {
  generatedAt: new Date().toISOString(),
  gitAvailable,
  weeks,
  groups: [
    { id: "tanstack", label: "@tanstack/* (router suite)" },
    { id: "router-plugin", label: "@tanstack/router-plugin" },
    { id: "lainnya", label: "Paket lain" },
  ],
  audits: {
    routerVersions: router,
    dependencies: deps,
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
console.log(
  `✅ Tren dependency ditulis (${weeks.length} minggu) — audit router: ${router.ok ? "lulus" : "gagal"}, audit paket: ${deps.skipped ? "dilewati" : deps.ok ? "lulus" : "gagal"}.`,
);
