import { describe, it, expect } from "vitest";
import {
  buildDiagnosticsSummary,
  SUMMARY_MAX_WIDTH,
  type SummaryCheck,
  type SummaryPackage,
} from "./diagnostics-summary";

const PACKAGES: SummaryPackage[] = [
  { name: "@tanstack/react-router", version: "1.170.15" },
  { name: "@tanstack/react-start", version: "1.168.25" },
  { name: "@tanstack/router-core", version: "1.171.13" },
];

const OK_CHECKS: SummaryCheck[] = [
  { label: "react-start ↔ react-router", ok: true, detail: "react-start mengharapkan react-router 1.170.15 dan versi terpasang sama." },
  { label: "Minor version selaras", ok: true, detail: "react-router 1.170.15 · react-start 1.168.25" },
];

const MIXED_CHECKS: SummaryCheck[] = [
  ...OK_CHECKS,
  { label: "router-core ↔ react-router", ok: false, detail: "Butuh router-core 1.168.17, terpasang 1.171.13. Bisa memicu error preload." },
];

const FIXED_DATE = new Date("2026-06-22T15:30:00Z");

describe("buildDiagnosticsSummary", () => {
  it("contains the title, timestamp, and OK status", () => {
    const text = buildDiagnosticsSummary({
      appName: "MCM Storage",
      timestamp: FIXED_DATE,
      packages: PACKAGES,
      checks: OK_CHECKS,
    });
    expect(text).toContain("DIAGNOSTIK MCM STORAGE");
    expect(text).toContain("2026-06-22 15:30 UTC");
    expect(text).toContain("Status   : KOMPATIBEL");
    expect(text).toContain("Ringkas  : 2/2 cek lolos");
  });

  it("lists every package on its own line", () => {
    const text = buildDiagnosticsSummary({
      timestamp: FIXED_DATE, packages: PACKAGES, checks: OK_CHECKS,
    });
    for (const p of PACKAGES) {
      expect(text).toContain(`- ${p.name}@${p.version}`);
    }
  });

  it("marks failing checks with [FAIL] and tallies them", () => {
    const text = buildDiagnosticsSummary({
      timestamp: FIXED_DATE, packages: PACKAGES, checks: MIXED_CHECKS,
    });
    expect(text).toContain("Status   : ADA KETIDAKCOCOKAN");
    expect(text).toContain("Ringkas  : 2/3 cek lolos");
    expect(text).toMatch(/3\. \[FAIL\] router-core/);
  });

  it("uses LF newlines only — no CR, no tabs, no trailing spaces", () => {
    const text = buildDiagnosticsSummary({
      timestamp: FIXED_DATE, packages: PACKAGES, checks: MIXED_CHECKS,
    });
    expect(text).not.toContain("\r");
    expect(text).not.toContain("\t");
    for (const line of text.split("\n")) {
      expect(line).toBe(line.replace(/[ ]+$/, ""));
    }
  });

  it("uses only safe printable ASCII (so it renders the same in any font)", () => {
    const text = buildDiagnosticsSummary({
      timestamp: FIXED_DATE, packages: PACKAGES, checks: MIXED_CHECKS,
    });
    // Allow tab-free ASCII 0x20..0x7E plus LF. Block emoji, box-drawing,
    // smart quotes, en/em dashes — anything that varies by clipboard app.
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const ok = code === 0x0a || (code >= 0x20 && code <= 0x7e);
      if (!ok) {
        throw new Error(`Non-ASCII char U+${code.toString(16).padStart(4, "0")} at index ${i}: ${JSON.stringify(text.slice(Math.max(0, i - 10), i + 10))}`);
      }
    }
  });

  it(`keeps every line within ${SUMMARY_MAX_WIDTH} chars`, () => {
    const longDetail: SummaryCheck = {
      label: "Cek panjang",
      ok: false,
      detail:
        "Pesan deskripsi panjang yang dibuat sengaja agar memuat banyak kata dan harus dibungkus pada lebar maksimum agar tidak melebar di clipboard yang sempit pada perangkat mobile.",
    };
    const text = buildDiagnosticsSummary({
      timestamp: FIXED_DATE,
      packages: PACKAGES,
      checks: [...OK_CHECKS, longDetail],
    });
    for (const line of text.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(SUMMARY_MAX_WIDTH);
    }
  });

  it("is deterministic for the same input (snapshot-friendly)", () => {
    const a = buildDiagnosticsSummary({
      timestamp: FIXED_DATE, packages: PACKAGES, checks: OK_CHECKS,
    });
    const b = buildDiagnosticsSummary({
      timestamp: FIXED_DATE, packages: PACKAGES, checks: OK_CHECKS,
    });
    expect(a).toBe(b);
  });
});