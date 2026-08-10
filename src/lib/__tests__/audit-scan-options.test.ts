import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SCAN_OPTIONS,
  capUrls,
  clampOption,
  fetchPagesPooled,
  formatScanOptions,
  parseScanOptions,
} from "../audit-scan-options";

describe("parseScanOptions", () => {
  it("memakai default saat tanpa flag/env", () => {
    expect(parseScanOptions([], {})).toEqual(DEFAULT_SCAN_OPTIONS);
  });

  it("membaca env dan flag CLI (flag menang)", () => {
    const o = parseScanOptions(["--max-urls", "12", "--concurrency=4"], {
      AUDIT_MAX_URLS: "99",
      AUDIT_TIMEOUT_MS: "5000",
      AUDIT_RETRIES: "3",
    });
    expect(o.maxUrls).toBe(12);
    expect(o.concurrency).toBe(4);
    expect(o.timeoutMs).toBe(5000);
    expect(o.retries).toBe(3);
  });

  it("menjepit nilai di luar rentang aman", () => {
    expect(clampOption("concurrency", 999, 6)).toBe(32);
    expect(clampOption("timeoutMs", 5, 15000)).toBe(1000);
    expect(clampOption("maxUrls", "bukan-angka", 40)).toBe(40);
  });

  it("meringkas opsi untuk log", () => {
    expect(formatScanOptions(DEFAULT_SCAN_OPTIONS)).toContain("maks 40 URL");
  });
});

describe("capUrls", () => {
  it("memotong daftar sesuai batas", () => {
    const { urls, dropped } = capUrls(["a", "b", "c"], 2);
    expect(urls).toEqual(["a", "b"]);
    expect(dropped).toEqual(["c"]);
  });
  it("tidak memotong bila di bawah batas", () => {
    expect(capUrls(["a"], 5).dropped).toEqual([]);
  });
});

describe("fetchPagesPooled", () => {
  it("mengambil semua URL dan menjaga urutan", async () => {
    const impl = vi.fn(async (url: string) =>
      new Response(`<title>${url}</title>`, { status: 200 }),
    ) as unknown as typeof fetch;
    const pages = await fetchPagesPooled(["/a", "/b", "/c"], {
      timeoutMs: 1000,
      concurrency: 2,
      retries: 0,
    }, impl);
    expect(pages.map((p) => p.url)).toEqual(["/a", "/b", "/c"]);
    expect(pages[0].html).toContain("/a");
  });

  it("membatasi paralelisme", async () => {
    let active = 0;
    let peak = 0;
    const impl = (async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    await fetchPagesPooled(["1", "2", "3", "4", "5"], {
      timeoutMs: 1000,
      concurrency: 2,
      retries: 0,
    }, impl);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("mencoba ulang lalu menandai gagal sebagai 599", async () => {
    const impl = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const pages = await fetchPagesPooled(["/x"], { timeoutMs: 50, concurrency: 1, retries: 2 }, impl);
    expect(pages[0].status).toBe(599);
    expect((impl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(3);
  });
});
