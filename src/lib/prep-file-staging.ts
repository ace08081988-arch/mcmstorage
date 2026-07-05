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

export async function stageFile(file: File | Blob): Promise<StagedPhoto> {
  const g = globalThis as unknown as {
    URL?: { createObjectURL?: (b: Blob) => string };
    FileReader?: typeof FileReader;
  };
  if (typeof g.URL?.createObjectURL === "function") {
    try {
      const dataUrl = g.URL.createObjectURL(file);
      if (typeof dataUrl === "string" && dataUrl.length > 0) {
        return { dataUrl, blob: file };
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
    r.readAsDataURL(file);
  });
  if (!dataUrl) throw new Error("Foto kosong / rusak");
  return { dataUrl, blob: file };
}