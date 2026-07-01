import { describe, expect, it } from "vitest";
import { compareSemver, isBelowMinimum } from "./apk.functions";

describe("compareSemver", () => {
  it("membandingkan segmen numerik dengan benar", () => {
    expect(compareSemver("1.2.3", "1.10.0")).toBeLessThan(0);
    expect(compareSemver("1.10.0", "1.2.3")).toBeGreaterThan(0);
    expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });
  it("menganggap segmen hilang sebagai 0", () => {
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
    expect(compareSemver("1", "1.0.0.0")).toBe(0);
    expect(compareSemver("1.2.1", "1.2")).toBeGreaterThan(0);
  });
  it("mengabaikan prefix v dan suffix prerelease/build", () => {
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3-beta.1", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3+build.9", "1.2.3")).toBe(0);
  });
  it("menormalkan segmen non-numerik", () => {
    expect(compareSemver("1.2a.3", "1.2.3")).toBe(0);
    expect(compareSemver("1..3", "1.0.3")).toBe(0);
  });
});

describe("isBelowMinimum", () => {
  const rel = (versionName: string | null, versionCode: number | null) => ({
    versionName,
    versionCode,
  });
  const min = (
    n: string | null,
    c: number | null,
  ): Parameters<typeof isBelowMinimum>[1] => ({
    variant: "storage",
    min_version_name: n,
    min_version_code: c,
    reason: null,
    updated_at: "2026-01-01T00:00:00Z",
  });

  it("false ketika min null atau kosong total", () => {
    expect(isBelowMinimum(rel("1.0.0", 1), null)).toBe(false);
    expect(isBelowMinimum(rel("1.0.0", 1), min(null, null))).toBe(false);
  });
  it("code lolos hanya jika finite integer dan ≥ min", () => {
    expect(isBelowMinimum(rel(null, 4), min(null, 5))).toBe(true);
    expect(isBelowMinimum(rel(null, 5), min(null, 5))).toBe(false);
    expect(isBelowMinimum(rel(null, 6), min(null, 5))).toBe(false);
    expect(isBelowMinimum(rel(null, null), min(null, 5))).toBe(true);
    expect(isBelowMinimum(rel(null, Number.NaN), min(null, 5))).toBe(true);
    expect(isBelowMinimum(rel(null, 1.5), min(null, 1))).toBe(true);
  });
  it("name lolos hanya jika semver ≥ min", () => {
    expect(isBelowMinimum(rel("1.2.3", null), min("1.2.4", null))).toBe(true);
    expect(isBelowMinimum(rel("1.2.4", null), min("1.2.4", null))).toBe(false);
    expect(isBelowMinimum(rel("1.10.0", null), min("1.2.9", null))).toBe(false);
    expect(isBelowMinimum(rel(null, null), min("1.2.4", null))).toBe(true);
    expect(isBelowMinimum(rel("beta", null), min("1.0.0", null))).toBe(true);
  });
  it("AND-gabungan: keduanya wajib lolos bila keduanya diset", () => {
    // code ok, name lawas → below
    expect(isBelowMinimum(rel("1.2.3", 50), min("1.3.0", 40))).toBe(true);
    // name ok, code lawas → below
    expect(isBelowMinimum(rel("2.0.0", 30), min("1.0.0", 40))).toBe(true);
    // keduanya ok → not below
    expect(isBelowMinimum(rel("1.3.0", 40), min("1.3.0", 40))).toBe(false);
    // rilis kekurangan salah satu data padanan → below
    expect(isBelowMinimum(rel("1.3.0", null), min("1.3.0", 40))).toBe(true);
    expect(isBelowMinimum(rel(null, 40), min("1.3.0", 40))).toBe(true);
  });
});