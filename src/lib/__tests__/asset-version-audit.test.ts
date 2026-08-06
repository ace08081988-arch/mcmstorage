import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  auditAssetVersion,
  collectStaleAssets,
  collectVersionMismatches,
  parseBrandAssetVersion,
  rewriteVersions,
  validateVersionFormat,
} from "../asset-version-audit";
import { BRAND_ASSET_VERSION } from "../asset-version";

describe("asset-version-audit", () => {
  it("membaca BRAND_ASSET_VERSION dari source", () => {
    const src = readFileSync("src/lib/asset-version.ts", "utf8");
    expect(parseBrandAssetVersion(src)).toBe(BRAND_ASSET_VERSION);
  });

  it("menolak format versi yang bukan tanggal", () => {
    expect(validateVersionFormat("2026080")).toMatch(/YYYYMMDD/);
    expect(validateVersionFormat("20261340")).toMatch(/tanggal kalender/);
    expect(validateVersionFormat("20260806", new Date("2026-08-06T00:00:00Z"))).toBeNull();
  });

  it("menandai literal ?v= yang berbeda dari versi build", () => {
    const issues = collectVersionMismatches(
      [
        { path: "public/manifest.webmanifest", content: '"/icon-192.png?v=20260806"' },
        { path: "src/routes/__root.tsx", content: '"/og.png?v=20260806"' },
      ],
      "20260806",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "version-mismatch", found: "20250101" });
  });

  it("menandai aset brand yang diubah setelah tanggal versi", () => {
    const after = Date.UTC(2026, 7, 9);
    expect(collectStaleAssets([{ path: "public/og.png", mtimeMs: after }], "20260806")).toHaveLength(1);
    const before = Date.UTC(2026, 7, 5);
    expect(collectStaleAssets([{ path: "public/og.png", mtimeMs: before }], "20260806")).toHaveLength(0);
  });

  it("rewriteVersions menyelaraskan semua literal", () => {
    expect(rewriteVersions("a?v=20260806 b?v=20260806", "20260806")).toBe(
      "a?v=20260806 b?v=20260806",
    );
  });

  it("gagal saat versi tidak ditemukan", () => {
    const res = auditAssetVersion({ version: null, files: [] });
    expect(res.ok).toBe(false);
    expect(res.issues[0].kind).toBe("invalid-version");
  });

  it("repo saat ini konsisten", () => {
    const files = [
      "public/manifest.webmanifest",
      "public/manifest-chat.webmanifest",
      "public/browserconfig.xml",
    ].map((path) => ({ path, content: readFileSync(path, "utf8") }));
    const res = auditAssetVersion({ version: BRAND_ASSET_VERSION, files });
    expect(res.issues).toEqual([]);
  });
});
