import { describe, it, expect } from "vitest";
import { classifyDnsResult, LOVABLE_IP } from "@/lib/domain-dns.functions";

describe("classifyDnsResult", () => {
  it("A: ok when only Lovable IP", () => {
    expect(classifyDnsResult("A", [LOVABLE_IP])).toEqual({ status: "ok" });
  });
  it("A: warn when Lovable IP + extra", () => {
    const r = classifyDnsResult("A", [LOVABLE_IP, "1.2.3.4"]);
    expect(r.status).toBe("warn");
    expect(r.note).toMatch(/record ganda/);
  });
  it("A: fail when Lovable IP missing", () => {
    const r = classifyDnsResult("A", ["1.2.3.4"]);
    expect(r.status).toBe("fail");
    expect(r.note).toContain(LOVABLE_IP);
  });
  it("A: fail when empty", () => {
    expect(classifyDnsResult("A", []).status).toBe("fail");
  });
  it("TXT: ok when lovable_verify present (any case)", () => {
    expect(classifyDnsResult("TXT", ["lovable_verify=abc"]).status).toBe("ok");
    expect(classifyDnsResult("TXT", ["LOVABLE_VERIFY=xyz"]).status).toBe("ok");
  });
  it("TXT: fail when no lovable_verify", () => {
    const r = classifyDnsResult("TXT", ["v=spf1 -all"]);
    expect(r.status).toBe("fail");
    expect(r.note).toMatch(/lovable_verify/);
  });
});