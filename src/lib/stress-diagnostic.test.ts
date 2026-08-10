import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  writeStressDiagnosticArtifact,
  type StressSnapshot,
} from "@/lib/stress-diagnostic";

const DIR = join(process.cwd(), "test-artifacts");

function baseSnap(overrides: Partial<StressSnapshot> = {}): StressSnapshot {
  return {
    derivedCalls: 1,
    warningsCalls: 1,
    finalDerived: { cost: 100, qty: 2 },
    finalWarnings: { warnings: [] },
    item: { id: "a", stock_base: 10 },
    form: { packageQty: "2", priceMode: "package" },
    ...overrides,
  };
}

describe("writeStressDiagnosticArtifact", () => {
  const written: string[] = [];
  beforeEach(() => {
    written.length = 0;
  });
  afterEach(() => {
    for (const f of written) {
      try {
        rmSync(f);
      } catch {
        // ignore
      }
    }
  });

  it("emits `equal` diffs when snapshots match, and writes the file", () => {
    const snap = baseSnap();
    const file = writeStressDiagnosticArtifact({
      label: "unit-equal",
      seed: 1,
      burst: 10,
      baseline: { name: "sequential", snapshot: snap },
      others: [
        { name: "batched", snapshot: { ...snap } },
        { name: "microtask", snapshot: { ...snap } },
      ],
    });
    expect(file).toBeTruthy();
    if (file) written.push(file);
    expect(existsSync(file!)).toBe(true);
    const payload = JSON.parse(readFileSync(file!, "utf8"));
    expect(payload.anyDiff).toBe(false);
    expect(payload.diffs.batched).toBe("equal");
    expect(payload.diffs.microtask).toBe("equal");
    expect(payload.seed).toBe(1);
    expect(payload.burst).toBe(10);
  });

  it("emits per-key diffs for finalDerived/finalWarnings/item/form when snapshots differ", () => {
    const seq = baseSnap();
    const bat = baseSnap({
      finalDerived: { cost: 200, qty: 2 },
      item: { id: "a", stock_base: 99 },
    });
    const file = writeStressDiagnosticArtifact({
      label: "unit-diff",
      seed: 42,
      burst: 5,
      baseline: { name: "sequential", snapshot: seq },
      others: [{ name: "batched", snapshot: bat }],
      extra: { error: "boom" },
    });
    expect(file).toBeTruthy();
    if (file) written.push(file);
    const payload = JSON.parse(readFileSync(file!, "utf8"));
    expect(payload.anyDiff).toBe(true);
    const d = payload.diffs.batched;
    expect(d).not.toBe("equal");
    expect(d.finalDerived.cost).toEqual({ baseline: 100, candidate: 200 });
    // qty tidak berubah → tidak muncul di sub-diff
    expect(d.finalDerived.qty).toBeUndefined();
    expect(d.finalWarnings).toBe("equal");
    expect(d.item.stock_base).toEqual({ baseline: 10, candidate: 99 });
    expect(d.form).toBe("equal");
    expect(payload.error).toBe("boom");
  });
});