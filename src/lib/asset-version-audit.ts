/**
 * Audit konsistensi cache-buster `?v=<versi>` untuk aset brand (og:image,
 * favicon, ikon PWA, mstile, manifest).
 *
 * Kenapa perlu: `BRAND_ASSET_VERSION` di `src/lib/asset-version.ts` adalah
 * satu-satunya sumber kebenaran versi build aset. Kalau ada file statis
 * (manifest/browserconfig) atau kode yang masih menuliskan `?v=` versi lama,
 * pratinjau WhatsApp/X bisa menunjuk URL yang berbeda-beda dan cache lama
 * tetap bertahan. Modul ini murni (tanpa I/O) supaya bisa diuji unit.
 */

export type AssetVersionIssue = {
  kind: "invalid-version" | "version-mismatch" | "stale-asset";
  file: string;
  message: string;
  found?: string;
};

export type AuditFile = { path: string; content: string };
export type AuditAsset = { path: string; mtimeMs: number };

const VERSION_RE = /\?v=(\d{6,})/g;

/** Ambil nilai `BRAND_ASSET_VERSION` dari source `asset-version.ts`. */
export function parseBrandAssetVersion(source: string): string | null {
  const m = /BRAND_ASSET_VERSION\s*=\s*"(\d+)"/.exec(source);
  return m ? m[1] : null;
}

/** Versi harus tanggal rilis YYYYMMDD yang valid dan tidak di masa depan. */
export function validateVersionFormat(version: string, now = new Date()): string | null {
  if (!/^\d{8}$/.test(version)) return `Versi "${version}" harus format YYYYMMDD (8 digit).`;
  const y = Number(version.slice(0, 4));
  const mo = Number(version.slice(4, 6));
  const d = Number(version.slice(6, 8));
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return `Versi "${version}" bukan tanggal kalender yang valid.`;
  }
  if (dt.getTime() > now.getTime() + 24 * 3600_000) {
    return `Versi "${version}" berada di masa depan.`;
  }
  return null;
}

/** Semua literal `?v=...` di file harus sama persis dengan versi build. */
export function collectVersionMismatches(
  files: AuditFile[],
  version: string,
): AssetVersionIssue[] {
  const issues: AssetVersionIssue[] = [];
  for (const file of files) {
    const seen = new Set<string>();
    for (const m of file.content.matchAll(VERSION_RE)) {
      const found = m[1];
      if (found === version || seen.has(found)) continue;
      seen.add(found);
      issues.push({
        kind: "version-mismatch",
        file: file.path,
        found,
        message: `Memakai ?v=${found} padahal BRAND_ASSET_VERSION=${version}.`,
      });
    }
  }
  return issues;
}

/** Aset brand yang diubah setelah tanggal versi berarti versi belum dinaikkan. */
export function collectStaleAssets(
  assets: AuditAsset[],
  version: string,
): AssetVersionIssue[] {
  if (!/^\d{8}$/.test(version)) return [];
  const cutoff = Date.UTC(
    Number(version.slice(0, 4)),
    Number(version.slice(4, 6)) - 1,
    Number(version.slice(6, 8)) + 1,
  ); // akhir hari rilis (UTC)
  return assets
    .filter((a) => a.mtimeMs > cutoff)
    .map((a) => ({
      kind: "stale-asset" as const,
      file: a.path,
      message: `Aset diubah setelah tanggal versi ${version}; naikkan BRAND_ASSET_VERSION.`,
    }));
}

export function auditAssetVersion(input: {
  version: string | null;
  files: AuditFile[];
  assets?: AuditAsset[];
  now?: Date;
}): { ok: boolean; version: string | null; issues: AssetVersionIssue[] } {
  const { version, files, assets = [], now = new Date() } = input;
  if (!version) {
    return {
      ok: false,
      version,
      issues: [
        {
          kind: "invalid-version",
          file: "src/lib/asset-version.ts",
          message: "BRAND_ASSET_VERSION tidak ditemukan.",
        },
      ],
    };
  }
  const issues: AssetVersionIssue[] = [];
  const formatError = validateVersionFormat(version, now);
  if (formatError) {
    issues.push({ kind: "invalid-version", file: "src/lib/asset-version.ts", message: formatError });
  }
  issues.push(...collectVersionMismatches(files, version));
  issues.push(...collectStaleAssets(assets, version));
  return { ok: issues.length === 0, version, issues };
}

/** Ganti semua `?v=<lama>` menjadi versi build saat ini. */
export function rewriteVersions(content: string, version: string): string {
  return content.replace(/\?v=\d{6,}/g, `?v=${version}`);
}

export function formatAuditReport(result: {
  ok: boolean;
  version: string | null;
  issues: AssetVersionIssue[];
}): string {
  if (result.ok) return `✓ Cache-buster og:image konsisten (?v=${result.version}).`;
  const lines = [`✗ Cache-buster tidak sinkron dengan versi build (${result.version ?? "?"}):`];
  for (const i of result.issues) lines.push(`  • ${i.file}: ${i.message}`);
  lines.push("");
  lines.push("Perbaiki: bun run audit:asset-version:fix (lalu commit ulang).");
  return lines.join("\n");
}
