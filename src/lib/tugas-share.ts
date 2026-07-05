/**
 * Pembangun pesan WhatsApp untuk perintah tugas ke pegawai.
 *
 * Diekstrak sebagai fungsi murni supaya bisa diuji tanpa React/DOM dan
 * supaya invariant "harus memuat instruksi foto tiap barang + link Google
 * Maps + URL tugas + PIN" bisa dipertahankan lewat unit test.
 */

export type TugasWaInput = {
  title: string;
  pin: string;
  url: string;
  itemsCount?: number;
};

export function buildTugasBaruWaMessage(input: TugasWaInput): string {
  const { title, pin, url, itemsCount } = input;
  const itemHint =
    itemsCount && itemsCount > 0
      ? `*Foto* setiap barang (${itemsCount} barang) yang sudah disiapkan`
      : `*Foto* setiap barang yang sudah disiapkan`;
  return [
    `Tolong siapkan barang berikut. Ikuti langkah ini di HP:`,
    `1) Buka link di bawah`,
    `2) Masukkan PIN`,
    `3) ${itemHint}`,
    `4) *Kirim lokasi (link Google Maps)* dari tempat penyiapan`,
    `5) Tekan Kirim`,
    ``,
    `Judul: *${title}*`,
    `PIN: *${pin}*`,
    `Link: ${url}`,
  ].join("\n");
}