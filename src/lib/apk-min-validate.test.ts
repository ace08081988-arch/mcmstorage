import { describe, expect, it } from "vitest";
import {
  validateMinVersionName,
  validateMinVersionCode,
  validateMinReason,
  validateMinSupportedForm,
  hasAnyError,
} from "./apk-min-validate";

describe("validateMinVersionName", () => {
  it("kosong = valid (tidak diperiksa)", () => {
    expect(validateMinVersionName("").ok).toBe(true);
    expect(validateMinVersionName("   ").ok).toBe(true);
  });
  it("terima MAJOR.MINOR sampai 4 segmen", () => {
    expect(validateMinVersionName("1.2").ok).toBe(true);
    expect(validateMinVersionName("1.2.3").ok).toBe(true);
    expect(validateMinVersionName("1.2.3.4").ok).toBe(true);
  });
  it("tolak prefix v", () => {
    const r = validateMinVersionName("v1.2.3");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/prefix/i);
  });
  it("tolak prerelease/build suffix", () => {
    expect(validateMinVersionName("1.2.3-beta").ok).toBe(false);
    expect(validateMinVersionName("1.2.3+build.9").ok).toBe(false);
  });
  it("tolak non-numerik / segmen kosong", () => {
    expect(validateMinVersionName("1.a.3").ok).toBe(false);
    expect(validateMinVersionName("1..3").ok).toBe(false);
    expect(validateMinVersionName("1").ok).toBe(false);
    expect(validateMinVersionName("abc").ok).toBe(false);
  });
  it("tolak segmen di luar 0–99999", () => {
    expect(validateMinVersionName("1.2.100000").ok).toBe(false);
  });
});

describe("validateMinVersionCode", () => {
  it("kosong = valid", () => {
    expect(validateMinVersionCode("").ok).toBe(true);
  });
  it("terima bilangan bulat non-negatif", () => {
    expect(validateMinVersionCode("0").ok).toBe(true);
    expect(validateMinVersionCode("45").ok).toBe(true);
    expect(validateMinVersionCode("2100000000").ok).toBe(true);
  });
  it("tolak float, negatif, huruf", () => {
    expect(validateMinVersionCode("1.5").ok).toBe(false);
    expect(validateMinVersionCode("-1").ok).toBe(false);
    expect(validateMinVersionCode("a1").ok).toBe(false);
  });
  it("tolak di atas batas Android", () => {
    expect(validateMinVersionCode("2100000001").ok).toBe(false);
  });
});

describe("validateMinReason", () => {
  it("kosong / pendek valid, > 200 ditolak", () => {
    expect(validateMinReason("").ok).toBe(true);
    expect(validateMinReason("a".repeat(200)).ok).toBe(true);
    expect(validateMinReason("a".repeat(201)).ok).toBe(false);
  });
});

describe("validateMinSupportedForm", () => {
  it("semua kosong = valid (hapus minimum)", () => {
    const e = validateMinSupportedForm({ name: "", code: "", reason: "" });
    expect(hasAnyError(e)).toBe(false);
  });
  it("reason tanpa min ditolak di level form", () => {
    const e = validateMinSupportedForm({
      name: "",
      code: "",
      reason: "hotfix",
    });
    expect(e.form).toBeTruthy();
    expect(hasAnyError(e)).toBe(true);
  });
  it("gabungan input valid lolos", () => {
    const e = validateMinSupportedForm({
      name: "1.2.0",
      code: "45",
      reason: "Perbaikan keamanan",
    });
    expect(hasAnyError(e)).toBe(false);
  });
  it("melapor per-field error", () => {
    const e = validateMinSupportedForm({
      name: "v1.2",
      code: "1.5",
      reason: "",
    });
    expect(e.name).toBeTruthy();
    expect(e.code).toBeTruthy();
  });
});