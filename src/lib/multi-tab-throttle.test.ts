import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCoalescingScheduler, detectTuning } from "./multi-tab-throttle";

describe("detectTuning", () => {
  it("returns slow-device tuning for CPU ≤ 4 cores", () => {
    expect(detectTuning({ hardwareConcurrency: 4 })).toEqual({
      throttle: 160, leading: 24, maxWait: 480,
    });
  });
  it("returns slow-device tuning for deviceMemory ≤ 2 GB", () => {
    expect(detectTuning({ hardwareConcurrency: 8, deviceMemory: 2 })).toEqual({
      throttle: 160, leading: 24, maxWait: 480,
    });
  });
  it("returns slow-device tuning for saveData / 2g–3g networks", () => {
    expect(detectTuning({ hardwareConcurrency: 8, deviceMemory: 8, connection: { saveData: true } }).throttle).toBe(160);
    expect(detectTuning({ hardwareConcurrency: 8, deviceMemory: 8, connection: { effectiveType: "3g" } }).throttle).toBe(160);
  });
  it("returns normal tuning for capable devices", () => {
    expect(detectTuning({ hardwareConcurrency: 8, deviceMemory: 8, connection: { effectiveType: "4g" } })).toEqual({
      throttle: 60, leading: 0, maxWait: 200,
    });
  });
  it("falls back to safe defaults when detection throws", () => {
    // Akses property yang melempar untuk memaksa catch.
    const bad = new Proxy({}, { get() { throw new Error("blocked"); } }) as Parameters<typeof detectTuning>[0];
    expect(detectTuning(bad)).toEqual({ throttle: 80, leading: 0, maxWait: 240 });
  });
});

describe("createCoalescingScheduler — multi-tab burst", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const normalTuning = { throttle: 60, leading: 0, maxWait: 200 };
  const slowTuning = { throttle: 160, leading: 24, maxWait: 480 };

  it("coalesces N simultaneous storage events into ONE apply (normal device)", () => {
    const apply = vi.fn();
    const s = createCoalescingScheduler(apply, normalTuning);
    // Simulasi 10 tab menulis SYNC_KEY hampir bersamaan.
    for (let i = 0; i < 10; i++) s.schedule();
    expect(apply).not.toHaveBeenCalled();
    expect(s._isPending()).toBe(true);
    vi.advanceTimersByTime(normalTuning.throttle);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(s._isPending()).toBe(false);
  });

  it("coalesces burst on slow devices with longer window", () => {
    const apply = vi.fn();
    const s = createCoalescingScheduler(apply, slowTuning);
    // Burst pertama setelah idle → leading-edge (delay `leading`).
    for (let i = 0; i < 20; i++) s.schedule();
    vi.advanceTimersByTime(slowTuning.leading - 1);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(apply).toHaveBeenCalledTimes(1);
    // Burst kedua dalam window aktif → throttle penuh.
    for (let i = 0; i < 20; i++) s.schedule();
    vi.advanceTimersByTime(slowTuning.throttle - 1);
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("does NOT reset the timer when additional events arrive mid-burst", () => {
    const apply = vi.fn();
    const s = createCoalescingScheduler(apply, normalTuning);
    s.schedule();
    vi.advanceTimersByTime(40); // setengah jalan
    s.schedule(); // tab lain ikut menulis
    s.schedule();
    vi.advanceTimersByTime(20); // total 60ms sejak schedule pertama
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("uses leading-edge after long idle (responsive on slow devices)", () => {
    const apply = vi.fn();
    const s = createCoalescingScheduler(apply, slowTuning);
    s.schedule();
    vi.advanceTimersByTime(slowTuning.throttle);
    expect(apply).toHaveBeenCalledTimes(1);
    // Lewati maxWait → idle. Event berikutnya harus pakai delay `leading` (24ms).
    vi.advanceTimersByTime(slowTuning.maxWait + 50);
    s.schedule();
    vi.advanceTimersByTime(slowTuning.leading);
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("applies guard signature: skips when shouldApply() returns false", () => {
    const apply = vi.fn();
    let allow = true;
    const s = createCoalescingScheduler(apply, normalTuning, { shouldApply: () => allow });
    s.schedule();
    allow = false; // tab lain menulis payload identik → guard signature menolak
    vi.advanceTimersByTime(normalTuning.throttle);
    expect(apply).not.toHaveBeenCalled();
  });

  it("supports multiple sequential bursts without double-apply", () => {
    const apply = vi.fn();
    const s = createCoalescingScheduler(apply, normalTuning);
    // Burst 1
    for (let i = 0; i < 5; i++) s.schedule();
    vi.advanceTimersByTime(normalTuning.throttle);
    expect(apply).toHaveBeenCalledTimes(1);
    // Burst 2 (masih dalam maxWait window)
    for (let i = 0; i < 5; i++) s.schedule();
    vi.advanceTimersByTime(normalTuning.throttle);
    expect(apply).toHaveBeenCalledTimes(2);
    // Burst 3 (setelah idle melewati maxWait → leading-edge)
    vi.advanceTimersByTime(normalTuning.maxWait + 1);
    s.schedule();
    vi.advanceTimersByTime(normalTuning.leading);
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it("cancel() stops pending apply (unmount safety)", () => {
    const apply = vi.fn();
    const s = createCoalescingScheduler(apply, normalTuning);
    s.schedule();
    s.cancel();
    vi.advanceTimersByTime(normalTuning.throttle * 3);
    expect(apply).not.toHaveBeenCalled();
  });

  it("stress: 100 tabs × 5 writes each → at most 1 apply per coalescing window", () => {
    const apply = vi.fn();
    const s = createCoalescingScheduler(apply, normalTuning);
    for (let tab = 0; tab < 100; tab++) {
      for (let w = 0; w < 5; w++) s.schedule();
    }
    vi.advanceTimersByTime(normalTuning.throttle);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});