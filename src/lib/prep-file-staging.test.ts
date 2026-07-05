import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { stageFile, isHeic } from "./prep-file-staging";

vi.mock("heic2any", () => ({
  default: async ({ blob }: { blob: Blob }) =>
    new Blob([await blob.text(), "-converted"], { type: "image/jpeg" }),
}));

type G = {
  URL?: { createObjectURL?: (b: Blob) => string };
  FileReader?: unknown;
};
const g = globalThis as unknown as G;

function saveGlobals() {
  return { URL: g.URL, FileReader: g.FileReader };
}
function restoreGlobals(prev: { URL: G["URL"]; FileReader: G["FileReader"] }) {
  g.URL = prev.URL;
  g.FileReader = prev.FileReader;
}

describe("stageFile — pemilihan foto kamera & galeri di halaman pegawai", () => {
  let prev: ReturnType<typeof saveGlobals>;
  beforeEach(() => { prev = saveGlobals(); });
  afterEach(() => { restoreGlobals(prev); });

  it("pakai URL.createObjectURL kalau tersedia (path utama Android/Chrome)", async () => {
    const create = vi.fn((_b: Blob) => "blob:mock/abc-123");
    g.URL = { createObjectURL: create };
    const blob = new Blob(["a"], { type: "image/jpeg" });
    const res = await stageFile(blob as File);
    expect(create).toHaveBeenCalledTimes(1);
    expect(res.dataUrl).toBe("blob:mock/abc-123");
    expect(res.blob).toBe(blob);
  });

  it("thumbnail selalu punya dataUrl non-kosong (untuk <img> grid)", async () => {
    g.URL = { createObjectURL: () => "blob:mock/xyz" };
    const res = await stageFile(new Blob(["b"]) as File);
    expect(typeof res.dataUrl).toBe("string");
    expect(res.dataUrl.length).toBeGreaterThan(0);
  });

  it("fallback ke FileReader kalau createObjectURL melempar (regresi WebView)", async () => {
    g.URL = { createObjectURL: () => { throw new Error("boom"); } };
    class FR {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      error: Error | null = null;
      readAsDataURL(_b: Blob) {
        setTimeout(() => { this.result = "data:image/jpeg;base64,AAA"; this.onload?.(); }, 0);
      }
    }
    g.FileReader = FR as unknown as typeof FileReader;
    const res = await stageFile(new Blob(["c"]) as File);
    expect(res.dataUrl).toBe("data:image/jpeg;base64,AAA");
  });

  it("fallback ke FileReader kalau createObjectURL kembalikan string kosong", async () => {
    g.URL = { createObjectURL: () => "" };
    class FR {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      error: Error | null = null;
      readAsDataURL(_b: Blob) {
        setTimeout(() => { this.result = "data:image/png;base64,BBB"; this.onload?.(); }, 0);
      }
    }
    g.FileReader = FR as unknown as typeof FileReader;
    const res = await stageFile(new Blob(["d"]) as File);
    expect(res.dataUrl).toBe("data:image/png;base64,BBB");
  });

  it("TOLAK promise saat FileReader.onerror (dulu menggantung → foto hilang)", async () => {
    g.URL = undefined;
    class FR {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      error: Error | null = new Error("decode gagal");
      readAsDataURL(_b: Blob) {
        setTimeout(() => { this.onerror?.(); }, 0);
      }
    }
    g.FileReader = FR as unknown as typeof FileReader;
    await expect(stageFile(new Blob(["e"]) as File)).rejects.toThrow(/decode gagal|Tidak bisa/);
  });

  it("melempar error jelas kalau tidak ada URL & FileReader sama sekali", async () => {
    g.URL = undefined;
    g.FileReader = undefined;
    await expect(stageFile(new Blob(["f"]) as File)).rejects.toThrow(/tidak mendukung/i);
  });

  it("blob asli diteruskan apa adanya supaya upload pakai file yang sama", async () => {
    g.URL = { createObjectURL: () => "blob:mock/keep" };
    const blob = new Blob(["payload"], { type: "image/webp" });
    const res = await stageFile(blob as File);
    expect(res.blob).toBe(blob);
    expect(res.blob.type).toBe("image/webp");
  });

  it("isHeic() mengenali MIME dan ekstensi HEIC/HEIF", () => {
    expect(isHeic(new File(["x"], "IMG_0001.HEIC", { type: "" }))).toBe(true);
    expect(isHeic(new File(["x"], "IMG_0001.heif", { type: "" }))).toBe(true);
    expect(isHeic(new Blob(["x"], { type: "image/heic" }))).toBe(true);
    expect(isHeic(new Blob(["x"], { type: "image/heif-sequence" }))).toBe(true);
    expect(isHeic(new File(["x"], "IMG_0001.jpg", { type: "image/jpeg" }))).toBe(false);
    expect(isHeic(new Blob(["x"], { type: "image/png" }))).toBe(false);
  });

  it("mengkonversi foto HEIC iPhone → JPEG sebelum stage (agar tidak hilang di editor)", async () => {
    g.URL = { createObjectURL: (b: Blob) => `blob:mock/${b.type}` };
    const heic = new File(["heic-bytes"], "IMG_0001.HEIC", { type: "image/heic" });
    const res = await stageFile(heic);
    expect(res.blob.type).toBe("image/jpeg");
    expect((res.blob as File).name).toBe("IMG_0001.jpg");
    expect(res.dataUrl).toBe("blob:mock/image/jpeg");
  });

  it("mengkonversi HEIC berdasar ekstensi walau MIME kosong (share dari WhatsApp/iOS)", async () => {
    g.URL = { createObjectURL: (b: Blob) => `blob:mock/${b.type}` };
    const heic = new File(["heic-bytes"], "photo.heif", { type: "" });
    const res = await stageFile(heic);
    expect(res.blob.type).toBe("image/jpeg");
    expect((res.blob as File).name).toBe("photo.jpg");
  });

  it("meneruskan foto JPEG apa adanya tanpa memanggil konverter", async () => {
    g.URL = { createObjectURL: () => "blob:mock/jpg" };
    const jpg = new File(["j"], "foo.jpg", { type: "image/jpeg" });
    const res = await stageFile(jpg);
    expect(res.blob).toBe(jpg); // referensi sama = tidak dikonversi
  });
});