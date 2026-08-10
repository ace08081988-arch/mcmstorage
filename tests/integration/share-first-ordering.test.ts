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

describe("ReadyEcerSection: tidak ada jalur kirim pintas", () => {
  const src = read("src/components/ReadyEcerSection.tsx");

  it("tidak pernah memanggil markSent", () => {
    expect(src).not.toMatch(/\bmarkSent\(/);
  });

  it("tidak memanggil share WA/Chat langsung dari kartu dashboard", () => {
    expect(src).not.toContain("shareToWhatsApp(");
    expect(src).not.toContain("shareToChat(");
  });

  it("aksi kirim mengarahkan ke alur kanonik /ecer dengan send=1", () => {
    expect(src).toContain('send: "1"');
  });
});
