import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUDIT_POLICY,
  filterAuditUrls,
  isIssueExempt,
  isUrlAudited,
  matchGlob,
  resolvePolicy,
  stripIgnoredParams,
} from "../seo-audit-policy";
import { loadAuditPolicy } from "../seo-audit-policy.load";
import { auditRenderedPages, normalizeUrl } from "../rendered-head-audit";
import { auditRouteSeo, routeGlobPath } from "../route-seo-audit";

const page = (url: string, extra = "") => ({
  url,
  status: 200,
  html: `<html><head><title>X</title>${extra}</head></html>`,
});

describe("matchGlob", () => {
  it("* hanya cocok satu segmen, ** banyak segmen", () => {
    expect(matchGlob("/katalog/*", "/katalog/toko")).toBe(true);
    expect(matchGlob("/katalog/*", "/katalog/toko/12")).toBe(false);
    expect(matchGlob("/katalog/**", "/katalog/toko/12")).toBe(true);
    expect(matchGlob("/harga", "/harga")).toBe(true);
    expect(matchGlob("utm_*", "utm_source")).toBe(true);
  });
});

describe("whitelist/blacklist URL", () => {
  it("blacklist memblokir, whitelist membatasi", () => {
    expect(isUrlAudited("/t/abc123")).toBe(false);
    expect(isUrlAudited("/harga")).toBe(true);
    const only = resolvePolicy({ include: ["/katalog/**"], exclude: [] });
    expect(isUrlAudited("/katalog/toko", only)).toBe(true);
    expect(isUrlAudited("/harga", only)).toBe(false);
  });

  it("filterAuditUrls memisahkan yang dilewati", () => {
    const res = filterAuditUrls(["https://mcmstorage.app/harga", "https://mcmstorage.app/t/xyz"]);
    expect(res.audited).toHaveLength(1);
    expect(res.skipped).toEqual(["https://mcmstorage.app/t/xyz"]);
  });
});

describe("parameter dinamis", () => {
  it("param tracking dibuang, param identitas dipertahankan", () => {
    expect(stripIgnoredParams("https://mcmstorage.app/katalog/toko?utm_source=wa&page=2")).toBe(
      "https://mcmstorage.app/katalog/toko?page=2",
    );
  });

  it("canonical dengan utm tetap dianggap self-referensial", () => {
    const issues = auditRenderedPages(
      [
        page(
          "https://mcmstorage.app/harga?utm_source=wa",
          '<link rel="canonical" href="https://mcmstorage.app/harga">',
        ),
      ],
      "https://mcmstorage.app",
    ).issues;
    expect(issues.some((i) => i.id === "canonical-self")).toBe(false);
  });

  it("normalizeUrl tanpa policy tetap membuang semua query", () => {
    expect(normalizeUrl("/harga?page=2", "https://mcmstorage.app")).toBe(
      "https://mcmstorage.app/harga",
    );
  });
});

describe("pengecualian aturan", () => {
  const policy = resolvePolicy({
    exemptions: [{ pattern: "/promo/**", rules: ["og:image"], reason: "kartu khusus" }],
  });

  it("isIssueExempt menghormati pola & daftar aturan", () => {
    expect(isIssueExempt("/promo/lebaran", "og:image", policy)).toBe(true);
    expect(isIssueExempt("/promo/lebaran", "title", policy)).toBe(false);
    expect(isIssueExempt("/harga", "og:image", policy)).toBe(false);
  });

  it("temuan yang dikecualikan tidak muncul di laporan", () => {
    const report = auditRenderedPages([page("/promo/lebaran")], "https://mcmstorage.app", policy);
    expect(report.issues.some((i) => i.id === "og:image")).toBe(false);
  });

  it("URL yang dilewati dicatat, bukan diaudit", () => {
    const report = auditRenderedPages([page("/t/abc")], "https://mcmstorage.app");
    expect(report.ok).toBe(true);
    expect(report.skipped).toEqual(["/t/abc"]);
  });
});

describe("audit rute menghormati kebijakan", () => {
  it("routeGlobPath mengubah $param jadi *", () => {
    expect(routeGlobPath("/katalog/$slug/$itemId")).toBe("/katalog/*/*");
  });

  it("rute yang di-blacklist dilewati", () => {
    const routes = [{ file: "promo.tsx", source: "export const Route = createFileRoute('/promo')({ component: X })" }];
    const policy = resolvePolicy({ exclude: ["/promo"] });
    const report = auditRouteSeo(routes, policy);
    expect(report.issues).toEqual([]);
    expect(report.skipped).toContain("promo.tsx");
    expect(auditRouteSeo(routes).issues.length).toBeGreaterThan(0);
  });
});

describe("seo-audit.policy.json", () => {
  it("terbaca dan valid", () => {
    const policy = loadAuditPolicy();
    expect(Array.isArray(policy.exclude)).toBe(true);
    expect(policy.ignoreParams).toContain("utm_*");
    for (const e of policy.exemptions) expect(e.reason?.length).toBeGreaterThan(10);
  });

  it("resolvePolicy melengkapi field yang hilang", () => {
    expect(resolvePolicy({ include: ["/a"] }).exclude).toEqual(DEFAULT_AUDIT_POLICY.exclude);
  });
});
