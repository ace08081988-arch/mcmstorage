import { describe, it, expect } from "vitest";
import {
  buildCompareRow,
  buildCompareRows,
  formatCompareMarkdown,
} from "./bench-compare";
import type { BaselineFile } from "./bench-baseline";

const BASELINE: BaselineFile = {
  regressionPctDefault: 50,
  floorMs: { batched: 2, sequential: 5 },
  scenarios: {
    "batched-20-rounds": {
      bestMs: 0.1,
      p50Ms: 0.2,
      p95Ms: 0.6,
      cv: 0.3,
      mode: "batched",
    },
  },
};

describe("bench-compare", () => {
  it("noBaseline=true bila scenario tidak ada di baseline", () => {
    const row = buildCompareRow(
      { scenario: "new-one", mode: "batched", bestMs: 1, p50Ms: 1, p95Ms: 2, cv: 0.1 },
      BASELINE,
    );
    expect(row.noBaseline).toBe(true);
    expect(row.best.baseline).toBeNull();
    expect(row.p95.pctDelta).toBeNull();
  });

  it("menghitung absDelta dan pctDelta terhadap baseline", () => {
    const row = buildCompareRow(
      {
        scenario: "batched-20-rounds",
        mode: "batched",
        bestMs: 0.12,
        p50Ms: 0.22,
        p95Ms: 0.9,
        cv: 0.6,
      },
      BASELINE,
    );
    expect(row.noBaseline).toBe(false);
    expect(row.best.baseline).toBe(0.1);
    expect(row.best.pctDelta).toBeCloseTo(20, 5);
    expect(row.p95.pctDelta).toBeCloseTo(50, 5);
    expect(row.cv.pctDelta).toBeCloseTo(100, 5);
  });

  it("baseline null → semua field null tanpa Infinity", () => {
    const row = buildCompareRow(
      { scenario: "x", mode: "batched", bestMs: 1 },
      null,
    );
    expect(row.best.baseline).toBeNull();
    expect(row.best.pctDelta).toBeNull();
    expect(row.noBaseline).toBe(true);
  });

  it("formatCompareMarkdown menghasilkan header dan baris scenario", () => {
    const rows = buildCompareRows(
      [
        {
          scenario: "batched-20-rounds",
          mode: "batched",
          bestMs: 0.09, // turun 10% → 🟢
          p50Ms: 0.2,   // stabil → ≈
          p95Ms: 0.9,   // naik 50% → 🔺
          cv: 0.3,      // stabil
        },
      ],
      BASELINE,
    );
    const md = formatCompareMarkdown(rows);
    expect(md).toContain("Baseline vs build terbaru");
    expect(md).toContain("batched-20-rounds");
    expect(md).toContain("🟢");
    expect(md).toContain("🔺");
    expect(md).toContain("≈");
  });

  it("empty rows → placeholder", () => {
    expect(formatCompareMarkdown([])).toContain("Tidak ada scenario tercatat");
  });
});