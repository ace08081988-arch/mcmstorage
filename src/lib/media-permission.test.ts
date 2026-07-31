import { describe, it, expect } from "vitest";
import { detectBrowser, permissionGuide, permissionToastMessage } from "./media-permission";

const UA = {
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  samsung:
    "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/22.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  firefoxAndroid:
    "Mozilla/5.0 (Android 12; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0",
  safariIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  chromeIOS:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
  whatsappWebview:
    "Mozilla/5.0 (Linux; Android 13; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.1",
  fbWebview:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.0;]",
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

describe("detectBrowser", () => {
  it("mengenali browser umum untuk arahkan panduan yang tepat", () => {
    expect(detectBrowser(UA.chromeAndroid)).toBe("chrome-android");
    expect(detectBrowser(UA.samsung)).toBe("samsung-android");
    expect(detectBrowser(UA.firefoxAndroid)).toBe("firefox-android");
    expect(detectBrowser(UA.safariIOS)).toBe("safari-ios");
    expect(detectBrowser(UA.chromeIOS)).toBe("chrome-ios");
    expect(detectBrowser(UA.chromeDesktop)).toBe("chrome-desktop");
  });

  it("mengenali WhatsApp/Facebook in-app WebView (kasus paling sering untuk pegawai)", () => {
    expect(detectBrowser(UA.whatsappWebview)).toBe("in-app-webview");
    expect(detectBrowser(UA.fbWebview)).toBe("in-app-webview");
  });
});

describe("permissionGuide", () => {
  it("in-app WebView: langkah pindah ke browser eksternal, bukan menyalahkan izin", () => {
    const g = permissionGuide("camera", "in-app-webview");
    expect(g.steps.join(" ").toLowerCase()).toMatch(/chrome|browser/);
    expect(g.hint).toBeTruthy();
  });

  it("Chrome Android + kamera: sebut pengaturan situs Chrome", () => {
    const g = permissionGuide("camera", "chrome-android");
    const joined = g.steps.join(" ").toLowerCase();
    expect(joined).toMatch(/kamera/);
    expect(joined).toMatch(/izin|site settings|setelan/);
  });

  it("iOS + galeri: panduan format foto ‘Paling Kompatibel’ ada (menyambung fix HEIC)", () => {
    const g = permissionGuide("gallery", "safari-ios");
    expect(g.steps.join(" ").toLowerCase()).toMatch(/paling kompatibel/);
  });

  it("iOS + kamera: rujuk Pengaturan → Kamera per aplikasi", () => {
    const g = permissionGuide("camera", "safari-ios");
    expect(g.steps.join(" ").toLowerCase()).toMatch(/kamera/);
    expect(g.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("semua browser menghasilkan panduan dengan judul + minimal 1 langkah", () => {
    const browsers = [
      "chrome-android", "samsung-android", "firefox-android", "safari-ios",
      "chrome-ios", "chrome-desktop", "firefox-desktop", "safari-desktop",
      "in-app-webview", "other",
    ] as const;
    for (const b of browsers) {
      for (const k of ["camera", "gallery"] as const) {
        const g = permissionGuide(k, b);
        expect(g.title.length).toBeGreaterThan(0);
        expect(g.intro.length).toBeGreaterThan(0);
        expect(g.steps.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("permissionToastMessage", () => {
  it("membedakan pesan denied vs kosong (tanpa panik-teks generik)", () => {
    expect(permissionToastMessage("camera", "denied")).toMatch(/diblokir/i);
    expect(permissionToastMessage("gallery", "prompt")).toMatch(/tidak ada foto/i);
  });
});