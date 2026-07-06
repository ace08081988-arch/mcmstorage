import { describe, it, expect } from "vitest";
import { shortenUrlForToast } from "./shorten-url-for-toast";

describe("shortenUrlForToast", () => {
  it("membuang skema http://", () => {
    expect(shortenUrlForToast("http://example.com/a")).toBe("example.com/a");
  });

  it("membuang skema https://", () => {
    expect(shortenUrlForToast("https://example.com/a")).toBe("example.com/a");
  });

  it("tidak memotong bila panjang <= 56 setelah skema dibuang", () => {
    const url = "https://example.com/" + "a".repeat(36); // stripped length = 56
    const out = shortenUrlForToast(url);
    expect(out.length).toBe(56);
    expect(out).not.toContain("…");
    expect(out).toBe("example.com/" + "a".repeat(36));
  });

  it("memotong di tengah dengan ellipsis bila > 56", () => {
    const stripped = "example.com/" + "a".repeat(50) + "b".repeat(50) + "/end";
    const url = "https://" + stripped;
    const out = shortenUrlForToast(url);
    expect(out).toContain("…");
    expect(out.length).toBe(56);
    // head = ceil((56-1)/2) = 28, tail = floor((56-1)/2) = 27
    expect(out.startsWith(stripped.slice(0, 28))).toBe(true);
    expect(out.endsWith(stripped.slice(-27))).toBe(true);
    expect(out).toBe(stripped.slice(0, 28) + "…" + stripped.slice(-27));
  });

  it("panjang hasil tepat = max saat dipotong (default 56)", () => {
    const url = "https://example.com/" + "x".repeat(200);
    expect(shortenUrlForToast(url).length).toBe(56);
  });

  it("menghormati parameter max kustom (ganjil)", () => {
    const url = "https://example.com/" + "x".repeat(200);
    const out = shortenUrlForToast(url, 21);
    expect(out.length).toBe(21);
    expect(out).toContain("…");
    // head = ceil(20/2)=10, tail=floor(20/2)=10
    const stripped = "example.com/" + "x".repeat(200);
    expect(out).toBe(stripped.slice(0, 10) + "…" + stripped.slice(-10));
  });

  it("menghormati parameter max kustom (genap) — head lebih panjang 1 char", () => {
    const url = "https://example.com/" + "x".repeat(200);
    const out = shortenUrlForToast(url, 20);
    expect(out.length).toBe(20);
    const stripped = "example.com/" + "x".repeat(200);
    // head = ceil(19/2)=10, tail=floor(19/2)=9
    expect(out).toBe(stripped.slice(0, 10) + "…" + stripped.slice(-9));
  });

  it("URL tanpa skema dibiarkan apa adanya", () => {
    expect(shortenUrlForToast("example.com/a")).toBe("example.com/a");
  });

  it("hanya membuang skema http/https, bukan skema lain", () => {
    const url = "ftp://example.com/a";
    expect(shortenUrlForToast(url)).toBe("ftp://example.com/a");
  });

  it("string kosong tetap kosong", () => {
    expect(shortenUrlForToast("")).toBe("");
  });

  it("boundary: stripped panjang = max+1 tetap dipotong", () => {
    const stripped = "a".repeat(57);
    const out = shortenUrlForToast("https://" + stripped);
    expect(out.length).toBe(56);
    expect(out).toContain("…");
  });
});
