import { describe, expect, it, vi } from "vitest";
import {
  debuggerLinks,
  extractOgImage,
  facebookScrapeEndpoint,
  formatRescrapeReport,
  rescrapeUrls,
  selectRescrapeUrls,
  urlsFromSitemapXml,
} from "../social-rescrape";

const HTML = `<html><head><meta property="og:image" content="https://mcmstorage.app/og-ace-storage.png?v=20260806"></head></html>`;

function fakeFetch(handler?: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return (
      handler?.(url, init) ??
      (url.includes("graph.facebook.com")
        ? new Response(JSON.stringify({ image: [{ url: "https://mcmstorage.app/og.png?v=1" }] }), {
            status: 200,
          })
        : new Response(HTML, { status: 200 }))
    );
  }) as unknown as typeof fetch;
}

describe("social-rescrape", () => {
  it("memakai Graph scrape=true saat token tersedia", async () => {
    const f = fakeFetch();
    const report = await rescrapeUrls(["/"], {
      facebookToken: "TOKEN",
      platforms: ["facebook"],
      fetchImpl: f,
    });
    expect(report.ok).toBe(true);
    expect(report.results[0].method).toBe("graph");
    const called = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(called[0])).toContain("scrape=true");
    expect(called[1]?.method).toBe("POST");
  });

  it("fallback warm-up crawler tanpa token dan membaca og:image", async () => {
    const report = await rescrapeUrls(["/harga"], {
      platforms: ["facebook", "twitter"],
      fetchImpl: fakeFetch(),
    });
    expect(report.results.map((r) => r.method)).toEqual(["warm", "warm"]);
    expect(report.results[0].image).toContain("v=20260806");
  });

  it("mengirim UA Twitterbot untuk X", async () => {
    const seen: string[] = [];
    await rescrapeUrls(["/"], {
      platforms: ["twitter"],
      fetchImpl: fakeFetch((_u, init) => {
        seen.push(String((init?.headers as Record<string, string>)["user-agent"]));
        return new Response(HTML, { status: 200 });
      }),
    });
    expect(seen[0]).toContain("Twitterbot");
  });

  it("melaporkan kegagalan beserta tautan debugger manual", async () => {
    const report = await rescrapeUrls(["/rusak"], {
      platforms: ["twitter"],
      fetchImpl: fakeFetch(() => new Response("", { status: 500 })),
    });
    expect(report.ok).toBe(false);
    expect(report.manual[0].facebook).toContain("developers.facebook.com/tools/debug");
    expect(formatRescrapeReport(report)).toContain("GAGAL");
  });

  it("mengubah path relatif jadi absolut & membatasi jumlah URL", () => {
    const urls = urlsFromSitemapXml(
      `<urlset><url><loc>https://mcmstorage.app/</loc></url><url><loc>https://mcmstorage.app/katalog/a/1</loc></url><url><loc>https://mcmstorage.app/harga</loc></url></urlset>`,
    );
    expect(urls).toHaveLength(3);
    expect(selectRescrapeUrls(urls, 2)).toEqual([
      "https://mcmstorage.app/",
      "https://mcmstorage.app/harga",
    ]);
  });

  it("membangun endpoint & tautan bantu", () => {
    expect(facebookScrapeEndpoint("https://a.test/x", "T")).toContain(
      "id=https%3A%2F%2Fa.test%2Fx&scrape=true",
    );
    expect(debuggerLinks("https://a.test/x").twitter).toContain("cards-dev.twitter.com");
    expect(extractOgImage(HTML)).toContain("og-ace-storage.png");
  });
});