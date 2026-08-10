import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createSessionExpiryTimer } from "./session-expiry";

describe("createSessionExpiryTimer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("memanggil onExpire tepat sekali pada waktu expiry", () => {
    const onExpire = vi.fn();
    const t = createSessionExpiryTimer({ isBusy: () => false, onExpire });
    t.arm(Date.now() + 60_000);
    vi.advanceTimersByTime(59_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("menunda expiry saat sibuk lalu menjalankannya sekali setelah idle", () => {
    const onExpire = vi.fn();
    const onDefer = vi.fn();
    let busy = true;
    const t = createSessionExpiryTimer({ isBusy: () => busy, onExpire, onDefer });
    t.arm(Date.now() + 1000);
    vi.advanceTimersByTime(1000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(onDefer).toHaveBeenCalledTimes(1);
    expect(t.hasPending()).toBe(true);
    busy = false;
    t.flushPending();
    t.flushPending();
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(t.hasPending()).toBe(false);
  });

  it("arm ulang dengan expiry sama tidak menggandakan timer", () => {
    const onExpire = vi.fn();
    const t = createSessionExpiryTimer({ isBusy: () => false, onExpire });
    const at = Date.now() + 5000;
    t.arm(at);
    t.arm(at);
    t.arm(at);
    vi.advanceTimersByTime(5000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("arm(null) membatalkan timer", () => {
    const onExpire = vi.fn();
    const t = createSessionExpiryTimer({ isBusy: () => false, onExpire });
    t.arm(Date.now() + 1000);
    t.arm(null);
    vi.advanceTimersByTime(5000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
