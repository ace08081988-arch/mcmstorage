import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { compressImage, fitWithin } from "./prep-image-compress";

type G = {
  createImageBitmap?: unknown;
  OffscreenCanvas?: unknown;
};
const g = globalThis as unknown as G;

function saveGlobals() {
  return { createImageBitmap: g.createImageBitmap, OffscreenCanvas: g.OffscreenCanvas };
}
function restoreGlobals(prev: ReturnType<typeof saveGlobals>) {
  g.createImageBitmap = prev.createImageBitmap;
  g.OffscreenCanvas = prev.OffscreenCanvas;
}

// Fake OffscreenCanvas yang menghasilkan blob ukuran deterministik.
function makeFakeCanvas(outSize: number, outType = "image/jpeg") {
  return class FakeCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) { this.width = w; this.height = h; }
    getContext(_id: "2d") {
      return { drawImage: () => {} };
    }
    async convertToBlob(opts?: { type?: string }) {
      return new Blob([new Uint8Array(outSize)], { type: opts?.type ?? outType });
    }
  };
}

describe("fitWithin — resize proporsional", () => {
  it("memperkecil ke sisi terpanjang = maxDim, menjaga rasio", () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ w: 2048, h: 1536 });
    expect(fitWithin(3000, 4000, 2048)).toEqual({ w: 1536, h: 2048 });
  });
  it("tidak memperbesar foto yang sudah kecil", () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ w: 800, h: 600 });
  });
});

describe("compressImage — auto kompresi sebelum PhotoEditor", () => {
  let prev: ReturnType<typeof saveGlobals>;
  beforeEach(() => { prev = saveGlobals(); });
  afterEach(() => { restoreGlobals(prev); });

  it("skip foto kecil (di bawah minBytes) — hemat CPU di HP low-end", async () => {
    const small = new Blob([new Uint8Array(50 * 1024)], { type: "image/jpeg" });
    // Tidak set createImageBitmap sekalipun; harusnya langsung return blob asli.
    const out = await compressImage(small);
    expect(out).toBe(small);
  });

  it("skip GIF (animasi) supaya tidak berubah jadi frame statis", async () => {
    const gif = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/gif" });
    const out = await compressImage(gif);
    expect(out).toBe(gif);
  });

  it("skip di lingkungan tanpa createImageBitmap (WebView jadul/jsdom)", async () => {
    g.createImageBitmap = undefined;
    const big = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/jpeg" });
    const out = await compressImage(big);
    expect(out).toBe(big);
  });

  it("re-encode foto besar → blob JPEG lebih kecil (jalur bahagia Android)", async () => {
    // Foto "asli" 3 MB, decode → 4000x3000, canvas output 300 KB.
    const big = new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "image/jpeg" });
    let closed = false;
    g.createImageBitmap = vi.fn(async (_b: Blob) => ({
      width: 4000,
      height: 3000,
      close: () => { closed = true; },
    }));
    g.OffscreenCanvas = makeFakeCanvas(300 * 1024);
    const out = await compressImage(big, { maxDim: 2048, quality: 0.8 });
    expect(out).not.toBe(big);
    expect(out.size).toBeLessThan(big.size);
    expect(out.type).toBe("image/jpeg");
    expect(closed).toBe(true);
  });

  it("kalau hasil re-encode lebih besar dari asli → pakai blob asli", async () => {
    const big = new Blob([new Uint8Array(500 * 1024)], { type: "image/jpeg" });
    g.createImageBitmap = vi.fn(async () => ({ width: 1000, height: 1000, close: () => {} }));
    // Canvas keluarkan blob yang lebih besar dari asli.
    g.OffscreenCanvas = makeFakeCanvas(2 * 1024 * 1024);
    const out = await compressImage(big);
    expect(out).toBe(big);
  });

  it("createImageBitmap gagal → fallback ke blob asli (tidak melempar)", async () => {
    const big = new Blob([new Uint8Array(1024 * 1024)], { type: "image/jpeg" });
    g.createImageBitmap = vi.fn(async () => { throw new Error("decode error"); });
    g.OffscreenCanvas = makeFakeCanvas(100 * 1024);
    const out = await compressImage(big);
    expect(out).toBe(big);
  });

  it("convertToBlob gagal → fallback ke blob asli", async () => {
    const big = new Blob([new Uint8Array(1024 * 1024)], { type: "image/jpeg" });
    g.createImageBitmap = vi.fn(async () => ({ width: 1000, height: 1000, close: () => {} }));
    class BadCanvas {
      width = 0; height = 0;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext() { return { drawImage: () => {} }; }
      async convertToBlob() { throw new Error("encode gagal"); }
    }
    g.OffscreenCanvas = BadCanvas;
    const out = await compressImage(big);
    expect(out).toBe(big);
  });
});