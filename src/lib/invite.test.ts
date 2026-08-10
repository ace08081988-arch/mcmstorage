import { describe, it, expect } from "vitest";
import {
  normalizeInviteCode,
  isLikelyInviteCode,
  formatInviteCode,
  validateInviteCode,
} from "./invite";

describe("validateInviteCode", () => {
  it("menolak input kosong", () => {
    const v = validateInviteCode("");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("tidak boleh kosong");
  });

  it("menolak input yang hanya spasi/tanda hubung", () => {
    const v = validateInviteCode("  - -  ");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("tidak boleh kosong");
  });

  it("menolak PIN terlalu pendek", () => {
    const v = validateInviteCode("ABC");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("6–16 karakter");
  });

  it("menolak karakter selain huruf/angka", () => {
    const v = validateInviteCode("ABCD@123");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("6–16 karakter huruf atau angka");
  });

  it("menerima PIN 6 karakter", () => {
    const v = validateInviteCode("ABCDEF");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.code).toBe("ABCDEF");
  });

  it("normalisasi huruf kecil, strip, dan underscore", () => {
    const v = validateInviteCode("ab-cd_12");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.code).toBe("ABCD12");
  });

  it("menerima panjang maksimum 16 setelah normalisasi", () => {
    const v = validateInviteCode("A".repeat(20));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.code).toHaveLength(16);
  });

  it("bisa memformat kode yang sudah tervalidasi", () => {
    const v = validateInviteCode("abcd-1234");
    expect(v.ok).toBe(true);
    if (v.ok) expect(formatInviteCode(v.code)).toBe("ABCD-1234");
  });
});

describe("normalizeInviteCode", () => {
  it("menghapus spasi, strip, underscore dan uppercase", () => {
    expect(normalizeInviteCode(" a-b_c1 ")).toBe("ABC1");
  });
});

describe("isLikelyInviteCode", () => {
  it("true untuk 6–16 karakter alfanumerik", () => {
    expect(isLikelyInviteCode("A1B2C3")).toBe(true);
    expect(isLikelyInviteCode("A".repeat(16))).toBe(true);
  });

  it("false untuk terlalu pendek atau karakter aneh", () => {
    expect(isLikelyInviteCode("ABC")).toBe(false);
    expect(isLikelyInviteCode("ABC!@#")).toBe(false);
  });
});
