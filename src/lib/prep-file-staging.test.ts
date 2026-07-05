import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { stageFile } from "./prep-file-staging";

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
});