/**
 * Uji lintas platform tombol "Kirim ke WhatsApp":
 * caption + link 📍 lokasi HARUS selalu sampai ke user meski WA membuang
 * EXTRA_TEXT. Skenario yang dijaga:
 *   1. Android APK native (Capacitor Share + Filesystem)
 *   2. iOS APK native (Capacitor Share)
 *   3. Android Chrome web (navigator.share dengan files)
 *   4. iOS Safari web (navigator.share tanpa canShare files)
 *   5. Desktop / WhatsApp Web (fallback wa.me)
 *
 * Kontrak invarian:
 *   - Caption yang mengandung "📍 Lokasi ambil:" + URL Maps HARUS ikut
 *     dikirim sebagai `text` ke share layer.
 *   - Bila share menyertakan foto, caption juga HARUS disalin ke clipboard
 *     (jaring pengaman kalau WA drop EXTRA_TEXT).
 *   - Fallback wa.me HARUS meng-encode caption utuh (round-trip persis).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks harus dideklarasikan SEBELUM import share-wa ----

const shareMock = vi.fn(async () => undefined);
const writeFileMock = vi.fn(async (opts: { path: string }) => ({
  uri: `file:///cache/${opts.path}`,
}));
const clipboardWriteMock = vi.fn(async () => undefined);

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => nativeFlag },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: shareMock } }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { writeFile: writeFileMock },
  Directory: { Cache: "CACHE" },
}));
vi.mock("@capacitor/clipboard", () => ({
  Clipboard: { write: clipboardWriteMock },
}));
vi.mock("./wa-preview", () => ({
  confirmWaShare: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./wa-target", () => ({
  pickWhatsAppTarget: vi.fn(async () => "regular"),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));

// ---- Toggle platform runtime ----
let nativeFlag = false;

import { shareToWhatsApp, buildWhatsAppUrl } from "./share-wa";

const CAPTION = [
  "*Kacang tanah 500g*",
  "",
  "Isi paket (1 kotak):",
  "• #1 — 500 g",
  "",
  "Total: *Rp10.000*",
  "Pembayaran: Hutang",
  "Sisa hutang: Rp10.000",
  "",
  "📍 Lokasi ambil:",
  "https://maps.app.goo.gl/xyz",
].join("\n");

function makeFile(name = "foto.jpg") {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/jpeg" });
}

function installWebNavigator(opts: {
  ua: string;
  canShareFiles: boolean;
  shareOk?: boolean;
  clipboardOk?: boolean;
}) {
  const clipboardWriteText = vi.fn(async () => {
    if (opts.clipboardOk === false) throw new Error("denied");
  });
  const share = vi.fn(async () => {
    if (opts.shareOk === false) {
      const err = new Error("share failed");
      (err as unknown as { name: string }).name = "DataError";
      throw err;
    }
  });
  const canShare = vi.fn((data?: ShareData) => {
    if (!data || !("files" in data)) return true;
    return opts.canShareFiles;
  });
  vi.stubGlobal("navigator", {
    userAgent: opts.ua,
    share,
    canShare,
    clipboard: { writeText: clipboardWriteText },
  });
  vi.stubGlobal("window", {
    open: vi.fn(() => ({})),
    location: { href: "" },
  });
  vi.stubGlobal("document", {
    createElement: () => ({ click: vi.fn(), remove: vi.fn(), setAttribute: vi.fn(), style: {} }),
    body: { appendChild: vi.fn() },
  });
  return { share, canShare, clipboardWriteText };
}

beforeEach(() => {
  shareMock.mockClear();
  writeFileMock.mockClear();
  clipboardWriteMock.mockClear();
});

afterEach(() => {
  nativeFlag = false;
  vi.unstubAllGlobals();
});

describe("shareToWhatsApp — lintas platform", () => {
  it("Android APK native: caption + lokasi masuk ke Capacitor Share DAN clipboard", async () => {
    nativeFlag = true;
    installWebNavigator({ ua: "Android", canShareFiles: true });
    const res = await shareToWhatsApp({ text: CAPTION, files: [makeFile()] });
    expect(res.status).toBe("shared");
    expect(shareMock).toHaveBeenCalledTimes(1);
    const payload = (shareMock.mock.calls as unknown as unknown[][])[0][0] as unknown as { text: string; files?: string[] };
    expect(payload.text).toContain("📍 Lokasi ambil:");
    expect(payload.text).toContain("https://maps.app.goo.gl/xyz");
    expect(payload.text).toContain("Sisa hutang: Rp10.000");
    expect(payload.files?.length).toBe(1);
    // Jaring pengaman clipboard WAJIB dipanggil karena WA Android drop EXTRA_TEXT.
    expect(clipboardWriteMock).toHaveBeenCalledWith({ string: expect.stringContaining("📍 Lokasi ambil:") });
  });

  it("iOS APK native: caption + lokasi masuk ke Capacitor Share + clipboard", async () => {
    nativeFlag = true;
    installWebNavigator({ ua: "iPhone", canShareFiles: true });
    const res = await shareToWhatsApp({ text: CAPTION, files: [makeFile("foto.jpg")] });
    expect(res.status).toBe("shared");
    const payload = (shareMock.mock.calls as unknown as unknown[][])[0][0] as unknown as { text: string };
    expect(payload.text).toContain("📍 Lokasi ambil:");
    expect(payload.text).toContain("https://maps.app.goo.gl/xyz");
    expect(clipboardWriteMock).toHaveBeenCalled();
  });

  it("Android Chrome web: Web Share files + caption dibackup ke clipboard", async () => {
    nativeFlag = false;
    const nav = installWebNavigator({
      ua: "Mozilla/5.0 (Linux; Android 13) Chrome/120",
      canShareFiles: true,
    });
    const res = await shareToWhatsApp({ text: CAPTION, files: [makeFile()] });
    expect(res.status).toBe("shared");
    expect(nav.share).toHaveBeenCalledTimes(1);
    const arg = (nav.share.mock.calls as unknown as unknown[][])[0][0] as unknown as { text: string; files?: File[] };
    expect(arg.text).toContain("📍 Lokasi ambil:");
    expect(arg.text).toContain("https://maps.app.goo.gl/xyz");
    expect(arg.files?.length).toBe(1);
    expect(nav.clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining("📍 Lokasi ambil:"),
    );
  });

  it("iOS Safari web: Web Share teks-saja tetap membawa caption + lokasi", async () => {
    nativeFlag = false;
    // iOS Safari lama menolak canShare({files}); jalur teks-only harus tetap
    // menyertakan caption utuh sebagai `text` (bukan hanya URL).
    const nav = installWebNavigator({
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Safari",
      canShareFiles: false,
    });
    const res = await shareToWhatsApp({ text: CAPTION });
    expect(res.status).toBe("shared");
    expect(nav.share).toHaveBeenCalled();
    const arg = (nav.share.mock.calls as unknown as unknown[][])[0][0] as unknown as { text: string };
    expect(arg.text).toContain("📍 Lokasi ambil:");
    expect(arg.text).toContain("https://maps.app.goo.gl/xyz");
  });

  it("Desktop WhatsApp Web: fallback wa.me meng-encode caption + lokasi lengkap", async () => {
    // Kontrak URL fallback — dites tanpa menjalankan share() penuh:
    // decode round-trip harus mengembalikan caption apa adanya, sehingga
    // saat WA Web membuka wa.me?text=... user langsung melihat 📍 + link.
    const url = buildWhatsAppUrl(CAPTION);
    const m = url.match(/\?text=(.+)$/);
    expect(m).toBeTruthy();
    const decoded = decodeURIComponent(m![1]);
    expect(decoded).toBe(CAPTION);
    expect(decoded).toContain("📍 Lokasi ambil:");
    expect(decoded).toContain("https://maps.app.goo.gl/xyz");
    expect(decoded).toContain("Sisa hutang: Rp10.000");
  });
});