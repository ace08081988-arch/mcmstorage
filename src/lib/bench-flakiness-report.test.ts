import { describe, it, expect } from "vitest";
import type { FlakinessCheck } from "./bench-baseline";
import {
  classifyFlakiness,
  formatFlakinessMarkdown,
} from "./bench-flakiness-report";

function base(overrides: Partial<FlakinessCheck> = {}): FlakinessCheck {
  return {
    scenario: "s",
    mode: "batched",
    p95Ms: 1,
    baselineP95Ms: 1,
    allowedP95Ms: 2,
    p95DeltaPct: 0,
    p95AbsDeltaMs: 0,
    p95Pct: 100,
    floorMs: 1,
    cv: 0.1,
    maxCv: 1,
    p95GuardTripped: false,
    cvGuardTripped: false,
    floorGuardBlocked: false,
    flaky: false,
    reasons: [],
    ...overrides,
  };
}

describe("classifyFlakiness", () => {
  it("returns clean when nothing tripped and baseline present", () => {
    expect(classifyFlakiness(base())).toBe("clean");
  });
  it("returns no_baseline when p95 baseline missing", () => {
    expect(classifyFlakiness(base({ baselineP95Ms: null }))).toBe("no_baseline");
  });
  it("returns p95_blocked_by_floor when floor guard saved it", () => {
    expect(classifyFlakiness(base({ floorGuardBlocked: true }))).toBe(
      "p95_blocked_by_floor",
    );
  });
  it("returns cv_over_max when only CV guard tripped", () => {
    expect(classifyFlakiness(base({ cvGuardTripped: true }))).toBe("cv_over_max");
  });
  it("returns p95_over_baseline when only p95 guard tripped", () => {
    expect(classifyFlakiness(base({ p95GuardTripped: true }))).toBe(
      "p95_over_baseline",
    );
  });
  it("returns p95_and_cv when both tripped", () => {
    expect(
      classifyFlakiness(base({ p95GuardTripped: true, cvGuardTripped: true })),
    ).toBe("p95_and_cv");
  });
});

describe("formatFlakinessMarkdown", () => {
  it("renders headers, per-row breakdown, and root cause buckets", () => {
    const md = formatFlakinessMarkdown([
      base({ scenario: "clean-one" }),
      base({ scenario: "p95-noise", floorGuardBlocked: true, p95DeltaPct: 30 }),
      base({
        scenario: "cv-high",
        cv: 2.5,
        cvGuardTripped: true,
        flaky: true,
      }),
      base({
        scenario: "hard-regress",
        p95GuardTripped: true,
        cvGuardTripped: true,
        flaky: true,
        p95DeltaPct: 200,
      }),
    ]);
    expect(md).toContain("Flakiness breakdown per scenario");
    expect(md).toContain("clean-one");
    expect(md).toContain("floor guard");
    expect(md).toContain("p95 + CV");
    expect(md).toContain("Ringkas per akar penyebab");
    // Rows for each bucket present.
    expect(md).toMatch(/`cv-high`/);
    expect(md).toMatch(/`hard-regress`/);
    expect(md).toMatch(/`p95-noise`/);
  });

  it("handles empty input", () => {
    const md = formatFlakinessMarkdown([]);
    expect(md).toContain("Tidak ada scenario");
  });
});