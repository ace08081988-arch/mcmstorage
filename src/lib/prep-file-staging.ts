// Helper untuk menyiapkan file foto yang baru dipilih user (kamera / galeri)
// menjadi obyek berisi URL preview + blob asli untuk diupload.
//
// Prioritas 1: `URL.createObjectURL` — sinkron, cepat, tidak memblokir memori,
// dan didukung stabil oleh Android WebView untuk `<img>` maupun PhotoEditor.
// Prioritas 2: fallback `FileReader.readAsDataURL` bila `createObjectURL` tak
// tersedia (mis. jsdom lama / test env) — dengan `onerror` yang MENOLAK
// promise, sehingga tidak ada lagi kasus "foto hilang senyap" karena promise
// menggantung selamanya.
export type StagedPhoto = {
  dataUrl: string;
  blob: Blob;
  format: string;          // format final yang akan di-upload (JPEG, PNG, WEBP, dsb)
  size: number;            // ukuran blob final dalam bytes
  originalFormat?: string; // format asli sebelum konversi/kompresi (bila berbeda)
  converted?: boolean;     // true bila format asli berubah (mis. HEIC → JPEG)
};

import { compressImage } from "./prep-image-compress";

// Sebagian browser (Android WebView lama, Chromium desktop, Firefox) tidak
// bisa men-decode HEIC/HEIF. `<img>` gagal senyap → foto seolah "hilang" saat
// masuk PhotoEditor. Konversi ke JPEG di sisi klien memakai heic2any (dimuat
// dinamis agar tidak menambah bundle awal).
export function isHeic(file: File | Blob): boolean {
  const t = (file.type || "").toLowerCase();
  if (t === "image/heic" || t === "image/heif" || t === "image/heic-sequence" || t === "image/heif-sequence") return true;
  const name = (file as File).name?.toLowerCase?.() ?? "";
  return /\.(heic|heif)$/.test(name);
}

type Heic2AnyFn = (opts: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>;

export async function convertHeicToJpeg(file: File | Blob): Promise<File> {
  const mod = (await import("heic2any")) as unknown as { default: Heic2AnyFn };
  const heic2any = mod.default;
  const out = await heic2any({ blob: file as Blob, toType: "image/jpeg", quality: 0.85 });
  const jpegBlob = Array.isArray(out) ? out[0] : out;
  const baseName = ((file as File).name ?? "photo").replace(/\.(heic|heif)$/i, "") || "photo";
  return new File([jpegBlob], `${baseName}.jpg`, { type: "image/jpeg" });
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0 || !Number.isFinite(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.max(0, Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k))));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatLabel(file: Blob): string {
  const t = (file.type || "").toLowerCase();
  if (t === "image/heic" || t === "image/heif" || t === "image/heic-sequence" || t === "image/heif-sequence") return "HEIC";
  if (t === "image/jpeg") return "JPEG";
  if (t === "image/png") return "PNG";
  if (t === "image/webp") return "WEBP";
  if (t === "image/gif") return "GIF";
  if (t === "image/svg+xml") return "SVG";
  const name = (file as File).name?.toLowerCase?.() ?? "";
  const ext = name.split(".").pop() || "";
  if (/^(heic|heif)$/.test(ext)) return "HEIC";
  if (ext) return ext.toUpperCase();
  return t.replace("image/", "").toUpperCase() || "FOTO";
}

export function buildStagedPhoto(dataUrl: string, blob: Blob): StagedPhoto {
  return { dataUrl, blob, format: formatLabel(blob), size: blob.size };
}

export async function stageFile(file: File | Blob): Promise<StagedPhoto> {
  const originalFormat = formatLabel(file);
  // 1) Jika HEIC/HEIF, konversi ke JPEG dulu supaya bisa dirender di <img>
  //    dan PhotoEditor di semua browser (khususnya foto dari iPhone).
  let f: File | Blob = file;
  if (isHeic(file)) {
    try {
      f = await convertHeicToJpeg(file);
    } catch (err) {
      throw new Error(
        "Foto HEIC dari iPhone tidak bisa dikonversi otomatis. " +
          "Aktifkan pengaturan iPhone → Kamera → Format → ‘Paling Kompatibel’, lalu foto ulang. " +
          `(${(err as Error).message || "gagal konversi"})`,
      );
    }
  }
  // 2) Kompresi/resize otomatis untuk foto besar (mis. 12MP dari kamera
  //    Android). Ini menjaga performa PhotoEditor di WebView (canvas
  //    besar → OOM/lag) dan memangkas ukuran upload. Gagal → blob asli.
  try {
    const compressed = await compressImage(f);
    if (compressed && compressed !== f) {
      // Pertahankan nama file agar upload tetap punya ekstensi masuk akal.
      const name = ((f as File).name ?? "photo").replace(/\.(png|webp|heic|heif)$/i, ".jpg");
      f = new File([compressed], name.endsWith(".jpg") ? name : `${name}.jpg`, {
        type: compressed.type || "image/jpeg",
      });
    }
  } catch {
    // biarkan f apa adanya
  }
  const g = globalThis as unknown as {
    URL?: { createObjectURL?: (b: Blob) => string };
    FileReader?: typeof FileReader;
  };
  if (typeof g.URL?.createObjectURL === "function") {
    try {
      const dataUrl = g.URL.createObjectURL(f);
      if (typeof dataUrl === "string" && dataUrl.length > 0) {
        return { dataUrl, blob: f };
      }
    } catch {
      // lanjut ke fallback FileReader
    }
  }
  if (typeof g.FileReader !== "function") {
    throw new Error("Browser tidak mendukung pembacaan file foto");
  }
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new g.FileReader!();
    r.onload = () => res(String(r.result ?? ""));
    r.onerror = () => rej((r.error as Error | null) ?? new Error("Tidak bisa membaca foto"));
    r.readAsDataURL(f);
  });
  if (!dataUrl) throw new Error("Foto kosong / rusak");
  return { dataUrl, blob: f };
}