import { describe, it, expect, beforeEach } from "vitest";
import {
  timingSafeEqualStr,
  rateLimit,
  __resetRateLimit,
  readBoundedJson,
  clientKeyFromRequest,
} from "../edge-guard";
import { checkRescrapeUrl, filterRescrapeUrls } from "../ssrf-guard";
import { sniffImage, validateImageBytes } from "../image-magic-bytes";
import { signPushOwnershipToken, verifyPushOwnershipToken } from "../push-ownership";

beforeEach(() => __resetRateLimit());

describe("timingSafeEqualStr", () => {
  it("cocok hanya untuk string identik", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("", "")).toBe(true);
  });
});

describe("rateLimit", () => {
  it("menolak setelah melewati limit dan pulih setelah window", () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k", { limit: 3, windowMs: 1000, now: 0 }).allowed).toBe(true);
    }
    const blocked = rateLimit("k", { limit: 3, windowMs: 1000, now: 0 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(rateLimit("k", { limit: 3, windowMs: 1000, now: 2000 }).allowed).toBe(true);
  });

  it("memisahkan bucket per key", () => {
    expect(rateLimit("a", { limit: 1, windowMs: 1000, now: 0 }).allowed).toBe(true);
    expect(rateLimit("a", { limit: 1, windowMs: 1000, now: 0 }).allowed).toBe(false);
    expect(rateLimit("b", { limit: 1, windowMs: 1000, now: 0 }).allowed).toBe(true);
  });
});

describe("readBoundedJson", () => {
  const req = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://x.test/", { method: "POST", body, headers });

  it("menerima payload kecil", async () => {
    const res = await readBoundedJson(req(JSON.stringify({ a: 1 })), 1024);
    expect(res).toEqual({ ok: true, value: { a: 1 } });
  });

  it("menolak payload melebihi batas walau content-length bohong", async () => {
    const big = JSON.stringify({ a: "x".repeat(2000) });
    const res = await readBoundedJson(req(big, { "content-length": "10" }), 512);
    expect(res).toEqual({ ok: false, error: "too_large" });
  });

  it("menolak JSON rusak", async () => {
    expect(await readBoundedJson(req("{oops"), 1024)).toEqual({
      ok: false,
      error: "invalid_json",
    });
  });
});

describe("clientKeyFromRequest", () => {
  it("memakai header proxy pertama", () => {
    const r = new Request("https://x.test/", {
      headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9", "user-agent": "UA" },
    });
    expect(clientKeyFromRequest(r, "s")).toContain("1.2.3.4");
  });
});

describe("SSRF guard rescrape", () => {
  const site = "https://mcmstorage.app";
  it("menerima URL situs sendiri", () => {
    expect(checkRescrapeUrl("https://mcmstorage.app/katalog/toko", site).ok).toBe(true);
    expect(checkRescrapeUrl("/produk", site).ok).toBe(true);
  });
  it("menolak host luar, http, IP literal, port aneh, kredensial, dan /api", () => {
    const cases = [
      "https://evil.test/x",
      "http://mcmstorage.app/",
      "https://169.254.169.254/latest/meta-data",
      "https://mcmstorage.app:8080/",
      "https://user:pass@mcmstorage.app/",
      "https://mcmstorage.app/api/public/web-vitals",
      "https://localhost/",
    ];
    for (const c of cases) expect(checkRescrapeUrl(c, site).ok).toBe(false);
  });
  it("filter memisahkan aman vs ditolak", () => {
    const { safe, rejected } = filterRescrapeUrls(
      ["https://mcmstorage.app/", "https://evil.test/"],
      site,
    );
    expect(safe).toHaveLength(1);
    expect(rejected[0]?.reason).toBe("host_not_allowed");
  });
});

function pngBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(32);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(b.buffer);
  view.setUint32(16, w);
  view.setUint32(20, h);
  return b;
}

describe("magic byte image validation", () => {
  it("mengenali PNG dan dimensinya", () => {
    expect(sniffImage(pngBytes(100, 50))).toMatchObject({
      mime: "image/png",
      width: 100,
      height: 50,
    });
  });

  it("menolak file non-gambar yang menyamar sebagai jpg", () => {
    const script = new TextEncoder().encode("<?php system($_GET['c']); ?>");
    expect(
      validateImageBytes(script, { declaredMime: "image/jpeg" }),
    ).toEqual({ ok: false, reason: "not_an_image" });
  });

  it("menolak MIME yang tidak cocok dengan isi", () => {
    expect(validateImageBytes(pngBytes(10, 10), { declaredMime: "image/jpeg" })).toEqual({
      ok: false,
      reason: "mime_mismatch",
    });
  });

  it("menolak pixel bomb", () => {
    expect(validateImageBytes(pngBytes(60000, 60000))).toEqual({
      ok: false,
      reason: "dimensions",
    });
  });

  it("menolak file kosong dan oversize", () => {
    expect(validateImageBytes(new Uint8Array(0))).toEqual({ ok: false, reason: "empty" });
    expect(validateImageBytes(pngBytes(10, 10), { maxBytes: 8 })).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("menerima PNG wajar", () => {
    expect(validateImageBytes(pngBytes(1200, 800), { declaredMime: "image/png" })).toMatchObject({
      ok: true,
      mime: "image/png",
    });
  });
});

describe("push ownership token", () => {
  const secret = "unit-test-secret";
  const endpoint = "https://push.example/abc";

  it("verifikasi token sah", async () => {
    const t = await signPushOwnershipToken({ endpoint, userId: "u1" }, secret);
    const v = await verifyPushOwnershipToken(t, secret, { endpoint });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.claims.userId).toBe("u1");
  });

  it("menolak tanda tangan salah", async () => {
    const t = await signPushOwnershipToken({ endpoint, userId: "u1" }, secret);
    expect(await verifyPushOwnershipToken(t, "lain", { endpoint })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("menolak token kedaluwarsa", async () => {
    const t = await signPushOwnershipToken({ endpoint, userId: "u1", exp: 1 }, secret);
    expect(await verifyPushOwnershipToken(t, secret, { endpoint, now: 1000 })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("menolak token untuk endpoint lain (anti replay lintas langganan)", async () => {
    const t = await signPushOwnershipToken({ endpoint, userId: "u1" }, secret);
    expect(
      await verifyPushOwnershipToken(t, secret, { endpoint: "https://push.example/other" }),
    ).toEqual({ ok: false, reason: "endpoint_mismatch" });
  });

  it("menolak token cacat", async () => {
    expect(await verifyPushOwnershipToken("bukan-token-yang-berbentuk-benar", secret, { endpoint }))
      .toEqual({ ok: false, reason: "malformed" });
  });
});
