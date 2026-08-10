import { describe, expect, it } from "vitest";
// @ts-expect-error — skrip JS tanpa deklarasi tipe.
import { isWatchedPath } from "../../../scripts/pre-commit-head-audit.mjs";

describe("pre-commit head audit — filter file staged", () => {
  it("memicu audit untuk rute, util SEO, dan aset brand", () => {
    for (const p of [
      "src/routes/index.tsx",
      "src/routes/katalog.$slug.index.tsx",
      "src/lib/seo-meta.ts",
      "src/lib/asset-version.ts",
      "src/lib/structured-data.ts",
      "public/manifest.webmanifest",
      "public/_headers",
      "public/og-ace-storage.png",
      "public/robots.txt",
    ]) {
      expect(isWatchedPath(p), p).toBe(true);
    }
  });

  it("melewati perubahan yang tidak menyentuh tag head", () => {
    for (const p of [
      "README.md",
      "docs/rilis.md",
      "src/components/ui/button.tsx",
      "android/app/build.gradle",
      "src/lib/party-duplicate.ts",
    ]) {
      expect(isWatchedPath(p), p).toBe(false);
    }
  });
});