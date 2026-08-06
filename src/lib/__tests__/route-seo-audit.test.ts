import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  auditRouteSeo,
  formatRouteSeoAudit,
  isPublicRouteFile,
  routePathFromFile,
  extractHeadBlock,
  type RouteSource,
} from "../route-seo-audit";

const routesDir = resolve(__dirname, "../../routes");

function collectRoutes(): RouteSource[] {
  return readdirSync(routesDir)
    .filter((f) => statSync(resolve(routesDir, f)).isFile())
    .filter((f) => /\.tsx?$/.test(f))
    .map((file) => ({ file, source: readFileSync(resolve(routesDir, file), "utf8") }));
}

describe("audit metadata SEO rute publik", () => {
  const report = auditRouteSeo(collectRoutes());

  it("memeriksa setidaknya beberapa rute publik", () => {
    expect(report.audited.length).toBeGreaterThan(3);
  });

  it("tidak menemukan metadata yang hilang", () => {
    expect(formatRouteSeoAudit(report)).toBe(
      `SEO rute OK — ${report.audited.length} rute publik diperiksa.`,
    );
    expect(report.issues).toEqual([]);
  });
});

describe("klasifikasi rute", () => {
  it("melewati rute privat, api, dan harness internal", () => {
    expect(isPublicRouteFile("_authenticated.gudang.tsx")).toBe(false);
    expect(isPublicRouteFile("lovable.visual.tap-targets.tsx")).toBe(false);
    expect(isPublicRouteFile("sitemap[.]xml.ts")).toBe(false);
    expect(isPublicRouteFile("faq.tsx")).toBe(true);
  });

  it("memetakan nama file ke path URL", () => {
    expect(routePathFromFile("faq.tsx")).toBe("/faq");
    expect(routePathFromFile("katalog.$slug.index.tsx")).toBe("/katalog/$slug");
    expect(routePathFromFile("katalog.$slug.$itemId.tsx")).toBe("/katalog/$slug/$itemId");
  });
});

describe("deteksi masalah", () => {
  it("melaporkan rute tanpa head()", () => {
    const r = auditRouteSeo([{ file: "contoh.tsx", source: "export const Route = {}" }]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]?.id).toBe("head-missing");
  });

  it("melaporkan tag sosial yang hilang pada meta manual", () => {
    const source = `export const Route = createFileRoute("/contoh")({
      head: () => ({ meta: [{ title: "X" }], links: [{ rel: "canonical", href: "/contoh" }] }),
    })`;
    const ids = auditRouteSeo([{ file: "contoh.tsx", source }]).issues.map((i) => i.id);
    expect(ids).toContain("og:title");
    expect(ids).toContain("og:image");
    expect(ids).toContain("twitter:card");
    expect(ids).toContain("description");
  });

  it("menerima rute yang memakai socialMeta + canonical self-referensial", () => {
    const source = `head: () => ({ meta: socialMeta({ title: "X", description: "Y", url: "/contoh" }), links: [canonical("/contoh")] })`;
    expect(auditRouteSeo([{ file: "contoh.tsx", source }]).ok).toBe(true);
  });

  it("menolak canonical yang menunjuk rute lain", () => {
    const source = `head: () => ({ meta: socialMeta({ title: "X", description: "Y", url: "/" }), links: [canonical("/")] })`;
    const ids = auditRouteSeo([{ file: "contoh.tsx", source }]).issues.map((i) => i.id);
    expect(ids).toContain("canonical-self");
  });

  it("mengizinkan halaman noindex tanpa kartu sosial", () => {
    const source = `head: () => ({ meta: [{ title: "X" }, { name: "description", content: "Y" }, { name: "robots", content: "noindex" }] })`;
    expect(auditRouteSeo([{ file: "contoh.tsx", source }]).ok).toBe(true);
  });

  it("mengekstrak blok head yang seimbang", () => {
    expect(extractHeadBlock(`x, head: () => ({ meta: [] }), component: C`)).toContain("meta");
    expect(extractHeadBlock("no head here")).toBeNull();
  });
});