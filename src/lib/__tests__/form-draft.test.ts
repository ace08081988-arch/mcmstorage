// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFormDraft, clearFormDraft } from "@/lib/form-draft";

const BASE = "mcm:draft:test-form";

function put(key: string, val: unknown) {
  window.localStorage.setItem(key, JSON.stringify(val));
}

describe("form-draft", () => {
  beforeEach(() => window.localStorage.clear());

  it("mengembalikan null bila tidak ada draft", () => {
    expect(readFormDraft(BASE, "u1")).toBeNull();
  });

  it("membaca draft valid milik user yang sama", () => {
    put(`${BASE}:u:u1`, { v: 1, at: Date.now(), data: { name: "KRISTAL" } });
    expect(readFormDraft<{ name: string }>(BASE, "u1")).toEqual({ name: "KRISTAL" });
  });

  it("terisolasi antar user", () => {
    put(`${BASE}:u:u1`, { v: 1, at: Date.now(), data: { name: "A" } });
    expect(readFormDraft(BASE, "u2")).toBeNull();
  });

  it("mengabaikan draft basi (> 24 jam)", () => {
    put(`${BASE}:u:u1`, { v: 1, at: Date.now() - 25 * 3600 * 1000, data: { name: "A" } });
    expect(readFormDraft(BASE, "u1")).toBeNull();
  });

  it("mengabaikan versi lama / payload rusak", () => {
    put(`${BASE}:u:u1`, { v: 0, at: Date.now(), data: { name: "A" } });
    expect(readFormDraft(BASE, "u1")).toBeNull();
    window.localStorage.setItem(`${BASE}:u:u1`, "{rusak");
    expect(readFormDraft(BASE, "u1")).toBeNull();
  });

  it("clear menghapus draft", () => {
    put(`${BASE}:u:u1`, { v: 1, at: Date.now(), data: { name: "A" } });
    clearFormDraft(BASE, "u1");
    expect(readFormDraft(BASE, "u1")).toBeNull();
  });

  it("tidak melempar saat localStorage error", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => readFormDraft(BASE, "u1")).not.toThrow();
    spy.mockRestore();
  });
});
