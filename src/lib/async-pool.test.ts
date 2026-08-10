import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./async-pool";

describe("mapWithConcurrency", () => {
  it("gallery 20 item: konkurensi maksimal 2 dan urutan output stabil", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency(items, 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, (20 - n) % 5));
      active -= 1;
      return `p${n}`;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(out).toEqual(items.map((n) => `p${n}`));
  });

  it("mengembalikan array kosong tanpa memanggil fn", async () => {
    let calls = 0;
    const out = await mapWithConcurrency([], 2, async () => { calls += 1; return 1; });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("melempar error pertama", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
