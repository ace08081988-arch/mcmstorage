import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createTrailingThrottle } from "./trailing-throttle";

describe("createTrailingThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("event pada minGap-1 tidak hilang: refresh trailing berjalan tepat sekali", () => {
    const run = vi.fn();
    const th = createTrailingThrottle(run, { now: () => Date.now() });
    th.request(1000); // jalan langsung (lastRunAt=0 di awal epoch fake timer besar)
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    th.request(1000);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("burst banyak event hanya menghasilkan satu trailing refresh", () => {
    const run = vi.fn();
    const th = createTrailingThrottle(run);
    th.request(1000);
    run.mockClear();
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(10);
      th.request(1000);
    }
    vi.advanceTimersByTime(2000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("dispose membatalkan trailing yang tertunda", () => {
    const run = vi.fn();
    const th = createTrailingThrottle(run);
    th.request(1000);
    th.request(1000);
    th.dispose();
    vi.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
