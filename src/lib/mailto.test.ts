import { describe, it, expect } from "vitest";
import { buildMailto, parseEmailList, isValidEmail } from "./mailto";

describe("isValidEmail", () => {
  it.each([
    ["a@b.co", true],
    ["user.name+tag@example.com", true],
    ["  spaced@example.com  ", true],
    ["no-at-sign", false],
    ["missing@domain", false],
    ["@nouser.com", false],
    ["", false],
    ["two@@example.com", false],
  ])("isValidEmail(%j) === %s", (input, expected) => {
    expect(isValidEmail(input)).toBe(expected);
  });
});

describe("parseEmailList", () => {
  it("returns empty arrays for null/undefined/empty", () => {
    expect(parseEmailList(null)).toEqual({ valid: [], invalid: [] });
    expect(parseEmailList(undefined)).toEqual({ valid: [], invalid: [] });
    expect(parseEmailList("")).toEqual({ valid: [], invalid: [] });
    expect(parseEmailList("   ,  , ")).toEqual({ valid: [], invalid: [] });
  });

  it("trims whitespace and keeps original casing", () => {
    const r = parseEmailList(" Alice@Example.com , bob@example.com ");
    expect(r.valid).toEqual(["Alice@Example.com", "bob@example.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("separates invalid entries", () => {
    const r = parseEmailList("ok@x.io, bad, also@bad, fine@y.io");
    expect(r.valid).toEqual(["ok@x.io", "fine@y.io"]);
    expect(r.invalid).toEqual(["bad", "also@bad"]);
  });

  it("deduplicates case-insensitively within the list", () => {
    const r = parseEmailList("a@x.io, A@X.IO, a@x.io , b@x.io");
    expect(r.valid).toEqual(["a@x.io", "b@x.io"]);
  });

  it("honors an external `seen` set", () => {
    const seen = new Set(["a@x.io"]);
    const r = parseEmailList("A@X.IO, c@x.io", seen);
    expect(r.valid).toEqual(["c@x.io"]);
    expect(seen.has("c@x.io")).toBe(true);
  });
});

describe("buildMailto", () => {
  it("produces a bare mailto when CC/BCC are missing", () => {
    const r = buildMailto({ to: "to@x.io" });
    expect(r.href).toBe("mailto:to%40x.io");
    expect(r.cc).toEqual([]);
    expect(r.bcc).toEqual([]);
    expect(r.invalid).toEqual([]);
  });

  it("ignores null/empty CC and BCC", () => {
    const r = buildMailto({ to: "to@x.io", cc: null, bcc: "" });
    expect(r.href).toBe("mailto:to%40x.io");
  });

  it("only includes valid CC/BCC addresses", () => {
    const r = buildMailto({
      to: "to@x.io",
      cc: "ok@x.io, bad, also@bad",
      bcc: "fine@y.io, , broken@",
    });
    expect(r.cc).toEqual(["ok@x.io"]);
    expect(r.bcc).toEqual(["fine@y.io"]);
    expect(r.invalid).toEqual(["bad", "also@bad", "broken@"]);
    expect(r.href).toBe("mailto:to%40x.io?cc=ok%40x.io&bcc=fine%40y.io");
  });

  it("drops CC entries duplicated with the To address (case-insensitive)", () => {
    const r = buildMailto({ to: "To@X.io", cc: "to@x.io, other@x.io" });
    expect(r.cc).toEqual(["other@x.io"]);
  });

  it("drops BCC entries that already appear in CC", () => {
    const r = buildMailto({
      to: "to@x.io",
      cc: "shared@x.io, only-cc@x.io",
      bcc: "SHARED@X.IO, only-bcc@x.io",
    });
    expect(r.cc).toEqual(["shared@x.io", "only-cc@x.io"]);
    expect(r.bcc).toEqual(["only-bcc@x.io"]);
  });

  it("deduplicates within the CC list itself", () => {
    const r = buildMailto({ to: "to@x.io", cc: "a@x.io, A@X.IO, a@x.io, b@x.io" });
    expect(r.cc).toEqual(["a@x.io", "b@x.io"]);
  });

  it("URL-encodes recipient lists with special chars", () => {
    const r = buildMailto({ to: "to@x.io", cc: "user+tag@x.io" });
    expect(r.href).toBe("mailto:to%40x.io?cc=user%2Btag%40x.io");
  });

  it("returns no cc/bcc params when every address is invalid", () => {
    const r = buildMailto({ to: "to@x.io", cc: "bad, alsobad", bcc: "still@bad" });
    expect(r.href).toBe("mailto:to%40x.io");
    expect(r.invalid).toEqual(["bad", "alsobad", "still@bad"]);
  });
});