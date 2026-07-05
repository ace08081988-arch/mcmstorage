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
  /**
   * Daftar barang yang harus difoto pegawai. Jika diberikan, pesan WA
   * menampilkan satu baris "Foto: <nama> — <qty> <unit>" per barang
   * sehingga status foto tiap item eksplisit dan bisa dicek satu per satu
   * sebelum tugas dikirim. `itemsCount` diabaikan bila `items` diisi.
   */
  items?: Array<{ name: string; qty?: number | null; unit?: string | null }>;
};

function formatItemLine(it: { name: string; qty?: number | null; unit?: string | null }): string {
  const name = it.name.trim();
  const qty = it.qty != null && Number.isFinite(Number(it.qty)) ? String(it.qty) : "";
  const unit = (it.unit ?? "").trim();
  const suffix = qty ? ` — ${qty}${unit ? ` ${unit}` : ""}` : "";
  return `   ☐ Foto: ${name}${suffix}`;
}

export function buildTugasBaruWaMessage(input: TugasWaInput): string {
  const { title, pin, url, itemsCount, items } = input;
  const validItems = (items ?? []).filter((r) => r.name.trim().length > 0);
  const useList = validItems.length > 0;
  const count = useList ? validItems.length : itemsCount;
  const header =
    count && count > 0
      ? `*Foto* setiap barang (${count} barang) yang sudah disiapkan${useList ? ":" : ""}`
      : `*Foto* setiap barang yang sudah disiapkan`;
  const step3Lines = useList ? [`3) ${header}`, ...validItems.map(formatItemLine)] : [`3) ${header}`];
  return [
    `Tolong siapkan barang berikut. Ikuti langkah ini di HP:`,
    `1) Buka link di bawah`,
    `2) Masukkan PIN`,
    ...step3Lines,
    `4) *Kirim lokasi (link Google Maps)* dari tempat penyiapan`,
    `5) Tekan Kirim`,
    ``,
    `Judul: *${title}*`,
    `PIN: *${pin}*`,
    `Link: ${url}`,
  ].join("\n");
}

export type TugasWaValidation = {
  ok: boolean;
  issues: string[];
};

/**
 * Validasi pesan WA yang sudah dibangun agar tidak ada instruksi wajib yang
 * hilang sebelum tugas dikirim ke pegawai:
 *  - harus memuat instruksi foto (step 3)
 *  - harus memuat instruksi kirim link Google Maps (step 4)
 *  - harus memuat judul, PIN, dan URL tugas
 *  - bila daftar `items` diberikan, setiap nama barang harus muncul pada
 *    baris "Foto: <nama>" sehingga status foto per barang eksplisit.
 */
export function validateTugasBaruWaMessage(
  msg: string,
  expect: { title: string; pin: string; url: string; items?: Array<{ name: string }> },
): TugasWaValidation {
  const issues: string[] = [];
  if (!/\*Foto\* setiap barang/i.test(msg)) issues.push("Instruksi foto tiap barang hilang");
  if (!/link Google Maps/i.test(msg)) issues.push("Instruksi kirim link Google Maps hilang");
  if (!msg.includes(expect.title)) issues.push("Judul tugas tidak muncul di pesan");
  if (!msg.includes(expect.pin)) issues.push("PIN tidak muncul di pesan");
  if (!msg.includes(expect.url)) issues.push("Link tugas tidak muncul di pesan");
  const items = (expect.items ?? []).map((i) => i.name.trim()).filter((n) => n.length > 0);
  for (const name of items) {
    // Cari baris "Foto: <name>" (case-insensitive, escape regex).
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`Foto:\\s*${escaped}(?:\\s|$|—|-)`, "i");
    if (!re.test(msg)) issues.push(`Barang "${name}" belum tercantum sebagai baris foto`);
  }
  return { ok: issues.length === 0, issues };
}