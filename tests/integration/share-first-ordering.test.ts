import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("share-first: paket request (ReadyPackagesPanel)", () => {
  const src = read("src/components/ReadyPackagesPanel.tsx");

  it("membatalkan commit ketika share cancelled/failed", () => {
    expect(src).toContain('res.status === "cancelled" || res.status === "failed"');
    const guard = src.indexOf('res.status === "cancelled" || res.status === "failed"');
    const commit = src.indexOf('.from("ready_packages").update({');
    expect(guard).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(guard);
  });

  it("share dijalankan sebelum mutasi status paket", () => {
    const share = src.indexOf("await shareToWhatsApp(");
    const commit = src.indexOf('.from("ready_packages").update({');
    expect(share).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(share);
  });

  it("busy lock membungkus share + commit", () => {
    const start = src.indexOf("setSharing(true)");
    const end = src.indexOf("setSharing(false)");
    const share = src.indexOf("await shareToWhatsApp(");
    const commit = src.indexOf('.from("ready_packages").update({');
    expect(start).toBeLessThan(share);
    expect(end).toBeGreaterThan(commit);
  });
});

describe("share-first: ecer (ReadyEcerSection)", () => {
  const src = read("src/components/ReadyEcerSection.tsx");

  it("hanya menandai terkirim setelah status shared/fallback", () => {
    const occurrences = [...src.matchAll(/markSent\(/g)].map((m) => m.index ?? 0);
    expect(occurrences.length).toBeGreaterThan(0);
    for (const idx of occurrences) {
      const before = src.slice(Math.max(0, idx - 400), idx);
      // setiap markSent pada jalur share harus didahului cek sukses
      if (before.includes("await callShare()")) {
        expect(before).toMatch(/r0\.status === "shared" \|\| r0\.status === "fallback"/);
      }
    }
  });

  it("cancelled melempar __cancelled__ tanpa menandai terkirim", () => {
    expect(src).toContain('r0.status === "cancelled"');
    expect(src).toContain('throw new Error("__cancelled__")');
  });

  it("commit dibungkus withIdempotency sehingga retry tidak menggandakan", () => {
    expect(src).toContain("withIdempotency(idemKey");
    expect(src).toContain("onSkip:");
  });

  it("label kanal share menyebut WhatsApp secara jujur", () => {
    expect(src).toMatch(/channel: "wa"/);
  });
});
