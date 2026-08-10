// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  beginNativePicker,
  endNativePicker,
  isLockSuppressed,
  getNativePickerDepth,
  withNativePicker,
  armFilePickerLock,
  openFilePickerWithLock,
} from "./app-lock";

beforeEach(() => {
  localStorage.clear();
  endNativePicker();
});

describe("reference-counted native picker suppression", () => {
  it("nested picker A+B: release A tidak membuka lock B", () => {
    const relA = beginNativePicker();
    const relB = beginNativePicker();
    expect(getNativePickerDepth()).toBe(2);
    relA();
    expect(isLockSuppressed()).toBe(true);
    relB();
    expect(isLockSuppressed()).toBe(false);
  });

  it("release idempoten: dipanggil berkali-kali tetap 1 kali efek", () => {
    const relA = beginNativePicker();
    const relB = beginNativePicker();
    relA();
    relA();
    relA();
    expect(getNativePickerDepth()).toBe(1);
    expect(isLockSuppressed()).toBe(true);
    relB();
    expect(getNativePickerDepth()).toBe(0);
  });

  it("background nyata setelah semua release tetap mengunci", () => {
    const rel = beginNativePicker();
    rel();
    expect(isLockSuppressed()).toBe(false);
  });

  it("endNativePicker (kompat lama) melepas semua token", () => {
    beginNativePicker();
    beginNativePicker();
    endNativePicker();
    expect(isLockSuppressed()).toBe(false);
  });

  it("withNativePicker melepas pada resolve dan pada throw", async () => {
    await withNativePicker(async () => {
      expect(isLockSuppressed()).toBe(true);
    });
    expect(getNativePickerDepth()).toBe(0);

    await expect(
      withNativePicker(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(getNativePickerDepth()).toBe(0);
  });

  it("suppression kedaluwarsa otomatis", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    beginNativePicker(1_000);
    expect(isLockSuppressed()).toBe(true);
    vi.spyOn(Date, "now").mockReturnValue(now + 5_000);
    expect(isLockSuppressed()).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("armFilePickerLock / openFilePickerWithLock", () => {
  function makeInput() {
    const inp = document.createElement("input");
    inp.type = "file";
    document.body.appendChild(inp);
    return inp;
  }

  it("suppression aktif sebelum click dan lepas pada change", () => {
    const inp = makeInput();
    const clicks: number[] = [];
    inp.click = () => clicks.push(getNativePickerDepth());
    openFilePickerWithLock(inp);
    expect(clicks).toEqual([1]); // suppression dimulai SEBELUM click
    inp.dispatchEvent(new Event("change"));
    expect(isLockSuppressed()).toBe(false);
  });

  it("lepas pada cancel", () => {
    const inp = makeInput();
    inp.click = () => {};
    openFilePickerWithLock(inp);
    inp.dispatchEvent(new Event("cancel"));
    expect(getNativePickerDepth()).toBe(0);
  });

  it("lepas tepat sekali walau change + cancel dua-duanya terjadi", () => {
    const inp = makeInput();
    inp.click = () => {};
    const other = beginNativePicker();
    openFilePickerWithLock(inp);
    expect(getNativePickerDepth()).toBe(2);
    inp.dispatchEvent(new Event("change"));
    inp.dispatchEvent(new Event("cancel"));
    expect(getNativePickerDepth()).toBe(1); // token picker lain tetap hidup
    other();
    expect(getNativePickerDepth()).toBe(0);
  });

  it("release saat click melempar error", () => {
    const inp = makeInput();
    inp.click = () => {
      throw new Error("click blocked");
    };
    openFilePickerWithLock(inp);
    expect(getNativePickerDepth()).toBe(0);
  });

  it("input null langsung release", () => {
    openFilePickerWithLock(null);
    expect(getNativePickerDepth()).toBe(0);
  });

  it("release lewat window focus setelah kembali dari picker", async () => {
    const inp = makeInput();
    const release = armFilePickerLock(inp, { returnGraceMs: 1 });
    expect(getNativePickerDepth()).toBe(1);
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 20));
    expect(getNativePickerDepth()).toBe(0);
    release();
    expect(getNativePickerDepth()).toBe(0);
  });
});
