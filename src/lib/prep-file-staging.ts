// Helper untuk menyiapkan file foto yang baru dipilih user (kamera / galeri)
// menjadi obyek berisi URL preview + blob asli untuk diupload.
//
// Prioritas 1: `URL.createObjectURL` — sinkron, cepat, tidak memblokir memori,
// dan didukung stabil oleh Android WebView untuk `<img>` maupun PhotoEditor.
// Prioritas 2: fallback `FileReader.readAsDataURL` bila `createObjectURL` tak
// tersedia (mis. jsdom lama / test env) — dengan `onerror` yang MENOLAK
// promise, sehingga tidak ada lagi kasus "foto hilang senyap" karena promise
// menggantung selamanya.
export type StagedPhoto = { dataUrl: string; blob: Blob };

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

export async function convertHeicToJpeg(file: File | Blob): Promise<File> {
  const mod = await import("heic2any");
  const heic2any = (mod as { default: typeof import("heic2any") }).default;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
  const jpegBlob = Array.isArray(out) ? out[0] : out;
  const baseName = ((file as File).name ?? "photo").replace(/\.(heic|heif)$/i, "") || "photo";
  return new File([jpegBlob], `${baseName}.jpg`, { type: "image/jpeg" });
}

export async function stageFile(file: File | Blob): Promise<StagedPhoto> {
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