/**
 * Verifikasi cache-buster `?v=...` (og:image, ikon, manifest) konsisten dengan
 * versi build `BRAND_ASSET_VERSION`. Dipakai di `prebuild` supaya build gagal
 * kalau ada versi yang tertinggal.
 *
 * Pakai:
 *   bun scripts/audit-asset-version.ts          # audit, exit 1 kalau mismatch
 *   bun scripts/audit-asset-version.ts --fix    # selaraskan otomatis
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  auditAssetVersion,
  formatAuditReport,
  parseBrandAssetVersion,
  rewriteVersions,
  type AuditAsset,
  type AuditFile,
} from "../src/lib/asset-version-audit";

const ROOT = resolve(process.cwd());
const VERSION_FILE = join(ROOT, "src/lib/asset-version.ts");
const fix = process.argv.includes("--fix");

const BRAND_ASSET_RE = /\.(png|svg|ico|jpg|jpeg|webp)$/i;
const SCAN_EXT = /\.(ts|tsx|webmanifest|xml|json|html)$/i;
const SKIP_DIR = new Set(["node_modules", "dist", "android", "ios", ".git", "__pycache__"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".githooks") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      walk(full, out);
    } else out.push(full);
  }
  return out;
}

const scanRoots = [join(ROOT, "src"), join(ROOT, "public")];
const files: AuditFile[] = [];
const assets: AuditAsset[] = [];

for (const root of scanRoots) {
  for (const full of walk(root)) {
    const rel = relative(ROOT, full);
    if (BRAND_ASSET_RE.test(full) && rel.startsWith("public/")) {
      assets.push({ path: rel, mtimeMs: statSync(full).mtimeMs });
      continue;
    }
    if (!SCAN_EXT.test(full)) continue;
    if (full === VERSION_FILE) continue;
    files.push({ path: rel, content: readFileSync(full, "utf8") });
  }
}
// File header CDN juga menyebut nama aset ber-versi.
for (const extra of ["public/_headers", "public/robots.txt"]) {
  const full = join(ROOT, extra);
  try {
    files.push({ path: extra, content: readFileSync(full, "utf8") });
  } catch {
    /* opsional */
  }
}

const versionSource = readFileSync(VERSION_FILE, "utf8");
let version = parseBrandAssetVersion(versionSource);

if (fix && version) {
  const stale = auditAssetVersion({ version, files, assets }).issues.some(
    (i) => i.kind === "stale-asset",
  );
  if (stale) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    writeFileSync(
      VERSION_FILE,
      versionSource.replace(/BRAND_ASSET_VERSION\s*=\s*"\d+"/, `BRAND_ASSET_VERSION = "${today}"`),
      "utf8",
    );
    version = today;
    console.log(`↑ BRAND_ASSET_VERSION dinaikkan ke ${today} (aset brand berubah).`);
  }
  for (const file of files) {
    const next = rewriteVersions(file.content, version);
    if (next !== file.content) {
      writeFileSync(join(ROOT, file.path), next, "utf8");
      file.content = next;
      console.log(`✎ ${file.path} diselaraskan ke ?v=${version}`);
    }
  }
}

const result = auditAssetVersion({ version, files, assets });
console.log(formatAuditReport(result));
if (!result.ok) process.exit(1);
