/**
 * Satu sumber kebenaran untuk syarat submit penyiapan.
 *
 * Alur yang disepakati: foto WAJIB melewati editor, dan lokasi WAJIB ada
 * sebelum submit. Sebelumnya tiga layar (portal pegawai, /request, /ecer)
 * punya aturan berbeda-beda sehingga alur terasa tidak konsisten.
 */
import { countUneditedPhotos } from "./prep-file-staging";

export type SubmitGateInput = {
  photos: { edited?: boolean }[];
  locUrl?: string | null;
  gps?: { lat: number; lng: number } | null;
  /** Set true bila user sudah menyetujui memakai foto tanpa edit. */
  allowUnedited?: boolean;
};

export type SubmitGateResult =
  | { ok: true }
  | { ok: false; code: "no-photo" | "unedited" | "no-location" | "bad-url"; message: string };

export function validateSubmitGate(input: SubmitGateInput): SubmitGateResult {
  const photos = input.photos ?? [];
  if (photos.length === 0) {
    return {
      ok: false,
      code: "no-photo",
      message: "Wajib lampirkan foto bukti timbangan/barang",
    };
  }
  const unedited = countUneditedPhotos(photos);
  if (unedited > 0 && !input.allowUnedited) {
    return {
      ok: false,
      code: "unedited",
      message:
        unedited === 1
          ? "Foto harus diedit dulu — ketuk foto untuk membuka editor"
          : `${unedited} foto belum diedit — ketuk foto untuk membuka editor`,
    };
  }
  const url = (input.locUrl ?? "").trim();
  if (url) {
    if (url.length > 2048) {
      return { ok: false, code: "bad-url", message: "URL lokasi terlalu panjang" };
    }
    if (!/^https:\/\//i.test(url)) {
      return { ok: false, code: "bad-url", message: "URL lokasi harus diawali https://" };
    }
  }
  const hasGps =
    !!input.gps &&
    Number.isFinite(input.gps.lat) &&
    Number.isFinite(input.gps.lng);
  if (!url && !hasGps) {
    return {
      ok: false,
      code: "no-location",
      message: "Wajib isi lokasi — ambil GPS atau tempel link Maps",
    };
  }
  return { ok: true };
}