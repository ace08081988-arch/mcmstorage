import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { uploadPrepPhoto } from "./prep";

type StorageClientArg = Parameters<typeof uploadPrepPhoto>[4];

// -----------------------------------------------------------------------
// Fake storage client (interface = Pick<supabase, "storage">).
// Menyimpan panggilan .upload() untuk assertion.
// -----------------------------------------------------------------------
type UploadCall = {
  bucket: string;
  path: string;
  body: Blob | File;
  options: { contentType?: string; upsert?: boolean };
};
function makeStorage(err: unknown = null) {
  const calls: UploadCall[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          async upload(
            path: string,
            body: Blob | File,
            options: { contentType?: string; upsert?: boolean },
          ) {
            calls.push({ bucket, path, body, options });
            return { data: err ? null : { path }, error: err };
          },
        };
      },
    },
  } as unknown as StorageClientArg;
  return { client, calls };
}

// -----------------------------------------------------------------------
// Global stub untuk compressImage path (createImageBitmap +
// OffscreenCanvas). Kita perlu ini untuk memverifikasi safety-net kompresi
// aktif saat blob besar.
// -----------------------------------------------------------------------
type G = {
  createImageBitmap?: unknown;
  OffscreenCanvas?: unknown;
};
const g = globalThis as unknown as G;
function saveGlobals() {
  return { createImageBitmap: g.createImageBitmap, OffscreenCanvas: g.OffscreenCanvas };
}
function restoreGlobals(p: ReturnType<typeof saveGlobals>) {
  g.createImageBitmap = p.createImageBitmap;
  g.OffscreenCanvas = p.OffscreenCanvas;
}
function installFakeImageStack(outSize: number, outType = "image/jpeg") {
  g.createImageBitmap = async () => ({ width: 4000, height: 3000, close() {} });
  g.OffscreenCanvas = class {
    width: number;
    height: number;
    constructor(w: number, h: number) { this.width = w; this.height = h; }
    getContext() { return { drawImage: () => {} }; }
    async convertToBlob(opts?: { type?: string }) {
      return new Blob([new Uint8Array(outSize)], { type: opts?.type ?? outType });
    }
  };
}

describe("uploadPrepPhoto — nama & MIME JPEG hasil konversi", () => {
  let prev: ReturnType<typeof saveGlobals>;
  beforeEach(() => { prev = saveGlobals(); });
  afterEach(() => { restoreGlobals(prev); vi.restoreAllMocks(); });

  it("JPEG kecil: MIME image/jpeg, path .jpg, tidak re-encode", async () => {
    const { client, calls } = makeStorage();
    const blob = new Blob([new Uint8Array(10 * 1024)], { type: "image/jpeg" });
    const path = await uploadPrepPhoto("tok", "item-1", blob, {}, client);
    expect(path).toMatch(/^tok\/item-1\/\d+-[a-z0-9]+\.jpg$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].options.contentType).toBe("image/jpeg");
    // Payload dibungkus sebagai File dengan MIME jpeg & nama .jpg
    const body = calls[0].body as File;
    expect(body.type).toBe("image/jpeg");
    expect(body.name).toMatch(/^item-1-.*\.jpg$/);
    // Blob asli tidak diubah bila di bawah ambang.
    expect(body.size).toBe(blob.size);
  });

  it("HEIC MIME tetap dinormalisasi ke jpg (nama & MIME upload)", async () => {
    // stageFile SEHARUSNYA sudah mengonversi, tapi kalau ada jalur lain
    // yang lolos, uploadPrepPhoto harus menolak Content-Type HEIC.
    const { client, calls } = makeStorage();
    const blob = new Blob([new Uint8Array(10 * 1024)], { type: "image/heic" });
    const path = await uploadPrepPhoto("t", "i", blob, {}, client);
    expect(path).toMatch(/\.jpg$/);
    expect(calls[0].options.contentType).toBe("image/jpeg");
    expect((calls[0].body as File).type).toBe("image/jpeg");
  });

  it("PNG: extensi & MIME .png dipertahankan", async () => {
    const { client, calls } = makeStorage();
    const blob = new Blob([new Uint8Array(10 * 1024)], { type: "image/png" });
    const path = await uploadPrepPhoto("t", "i", blob, {}, client);
    expect(path).toMatch(/\.png$/);
    expect(calls[0].options.contentType).toBe("image/png");
    expect((calls[0].body as File).name).toMatch(/\.png$/);
  });

  it("ext override lewat argument string tetap didukung (backward compat)", async () => {
    const { client, calls } = makeStorage();
    const blob = new Blob([new Uint8Array(10 * 1024)], { type: "image/webp" });
    const path = await uploadPrepPhoto("t", "i", blob, "jpg", client);
    expect(path).toMatch(/\.jpg$/);
    expect(calls[0].options.contentType).toBe("image/jpeg");
  });

  it("fileName kustom dipakai untuk nama File (Content-Disposition)", async () => {
    const { client, calls } = makeStorage();
    const blob = new Blob([new Uint8Array(10 * 1024)], { type: "image/jpeg" });
    await uploadPrepPhoto("t", "i", blob, { fileName: "bukti-timbang.jpg" }, client);
    expect((calls[0].body as File).name).toBe("bukti-timbang.jpg");
  });

  it("blob > 1.5 MB memicu re-kompresi ke JPEG q=0.8 (safety-net)", async () => {
    installFakeImageStack(300 * 1024, "image/jpeg"); // hasil 300 KB
    const { client, calls } = makeStorage();
    const big = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/jpeg" });
    await uploadPrepPhoto("t", "i", big, {}, client);
    const body = calls[0].body as File;
    expect(body.type).toBe("image/jpeg");
    // Ukuran turun signifikan (± ukuran fake canvas output).
    expect(body.size).toBeLessThan(big.size);
    expect(body.size).toBe(300 * 1024);
  });

  it("safety-net TIDAK dipakai bila hasil kompresi lebih besar dari asli", async () => {
    installFakeImageStack(3 * 1024 * 1024, "image/jpeg"); // 3 MB > input
    const { client, calls } = makeStorage();
    const input = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/jpeg" });
    await uploadPrepPhoto("t", "i", input, {}, client);
    expect((calls[0].body as File).size).toBe(input.size);
  });

  it("skipCompress: tidak memanggil createImageBitmap (jalur test cepat)", async () => {
    const spy = vi.fn(async () => ({ width: 100, height: 100, close() {} }));
    g.createImageBitmap = spy;
    const { client } = makeStorage();
    const big = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/jpeg" });
    await uploadPrepPhoto("t", "i", big, { skipCompress: true }, client);
    expect(spy).not.toHaveBeenCalled();
  });

  it("mengembalikan null saat storage.upload error, tanpa melempar", async () => {
    const { client } = makeStorage({ message: "boom" } as unknown);
    const blob = new Blob([new Uint8Array(1024)], { type: "image/jpeg" });
    const path = await uploadPrepPhoto("t", "i", blob, { skipCompress: true }, client);
    expect(path).toBeNull();
  });

  it("path selalu di bawah prefix `<token>/<itemId>/`", async () => {
    const { client, calls } = makeStorage();
    const blob = new Blob([new Uint8Array(1024)], { type: "image/jpeg" });
    await uploadPrepPhoto("TOK-abc", "item-xyz", blob, { skipCompress: true }, client);
    expect(calls[0].path.startsWith("TOK-abc/item-xyz/")).toBe(true);
  });
});
// SPRINT 5 (High) — pagar upload untuk bucket yang bisa ditulis sesi anon.
describe("uploadPrepPhoto — pagar MIME & ukuran", () => {
  it("menolak file non-gambar (PDF) tanpa menyentuh storage", async () => {
    const { client, calls } = makeStorage();
    const blob = new Blob([new Uint8Array(1024)], { type: "application/pdf" });
    const path = await uploadPrepPhoto("t", "i", blob, { skipCompress: true }, client);
    expect(path).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("menerima image/heic karena dinormalisasi ke jpg", async () => {
    const { client, calls } = makeStorage();
    const blob = new Blob([new Uint8Array(1024)], { type: "image/heic" });
    const path = await uploadPrepPhoto("t", "i", blob, { skipCompress: true }, client);
    expect(path).toMatch(/\.jpg$/);
    expect(calls).toHaveLength(1);
  });

  it("menolak gambar > 12 MB yang tidak bisa dikompres", async () => {
    const { client, calls } = makeStorage();
    const big = new Blob([new Uint8Array(13 * 1024 * 1024)], { type: "image/jpeg" });
    const path = await uploadPrepPhoto("t", "i", big, { skipCompress: true }, client);
    expect(path).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
