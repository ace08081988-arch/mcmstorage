// @vitest-environment happy-dom
/**
 * Unit test untuk helper `call-video-style`.
 *
 * Fokus verifikasi:
 *  1. `objectFit` & `objectPosition` yang dihasilkan konsisten untuk
 *     kombinasi fit/preset/custom apa pun — jadi remote dan preview
 *     lokal (yang keduanya konsumsi helper ini) PASTI sinkron.
 *  2. Mode `contain` mengunci posisi ke "50% 50%" — mencegah bug lama
 *     di mana `objectPosition` masih ke-set walaupun `object-fit: contain`
 *     mengabaikannya (menimbulkan drift saat toggle Crop/Fit bolak-balik).
 *  3. Posisi custom (hasil drag) mengalahkan preset saat non-null.
 */
import { describe, expect, it } from "vitest";
import {
  computeVideoStyle,
  presetPosToCss,
  combineVideoPos,
  videoFitClassFor,
} from "@/lib/call-video-style";

describe("presetPosToCss", () => {
  it.each([
    ["center", "50% 50%"],
    ["top", "50% 0%"],
    ["bottom", "50% 100%"],
    ["left", "0% 50%"],
    ["right", "100% 50%"],
  ] as const)("%s → %s", (preset, css) => {
    expect(presetPosToCss(preset)).toBe(css);
  });
});

describe("combineVideoPos", () => {
  it("pakai preset saat custom null", () => {
    expect(combineVideoPos("top", null)).toBe("50% 0%");
  });
  it("custom mengalahkan preset", () => {
    expect(combineVideoPos("center", { x: 12.3456, y: 67.89 })).toBe("12.3% 67.9%");
  });
});

describe("computeVideoStyle", () => {
  it("cover + preset top → objectPosition 50% 0%", () => {
    expect(computeVideoStyle("cover", "top", null)).toEqual({
      objectFit: "cover",
      objectPosition: "50% 0%",
    });
  });
  it("cover + custom drag menang atas preset", () => {
    expect(computeVideoStyle("cover", "center", { x: 20, y: 80 })).toEqual({
      objectFit: "cover",
      objectPosition: "20.0% 80.0%",
    });
  });
  it("contain WAJIB kunci objectPosition ke 50% 50% (abaikan preset & custom)", () => {
    // Kalau helper bocor, toggle Crop→Fit→Crop akan meninggalkan posisi
    // lama di elemen — bug persis yang bikin remote & lokal desync.
    expect(computeVideoStyle("contain", "right", { x: 10, y: 10 })).toEqual({
      objectFit: "contain",
      objectPosition: "50% 50%",
    });
  });
});

describe("videoFitClassFor", () => {
  it("cover → object-cover, contain → object-contain", () => {
    expect(videoFitClassFor("cover")).toBe("object-cover");
    expect(videoFitClassFor("contain")).toBe("object-contain");
  });
});