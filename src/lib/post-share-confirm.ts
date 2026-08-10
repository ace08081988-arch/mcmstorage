/**
 * Konfirmasi pasca-share (SSOT untuk ECER dan Request).
 *
 * Membuka share sheet / WhatsApp BUKAN bukti bahwa pesan benar-benar
 * terkirim: Web Share API hanya melaporkan bahwa sheet dibuka/ditutup.
 * Karena itu, setiap kanal WhatsApp WAJIB melewati langkah konfirmasi
 * eksplisit ini sebelum RPC finansial (sold_at / sales / debts) dipanggil.
 *
 * Kanal Ace Chat tidak memakai helper ini: pengiriman pesan ke database
 * sudah merupakan bukti keras, jadi commit boleh otomatis setelah
 * `shareToChat` mengembalikan status `shared`.
 */
import { confirm } from "@/lib/confirm";

export const WA_DELIVERY_CONFIRM_TITLE =
  "Apakah pesan WhatsApp benar-benar sudah terkirim?";
export const WA_DELIVERY_CONFIRM_YES = "Ya, sudah terkirim";
export const WA_DELIVERY_CONFIRM_NO = "Belum/batal";

const DEFAULT_BODY = [
  "Buka WhatsApp dan pastikan pesan + foto benar-benar sampai ke pembeli.",
  "",
  'Pilih "Ya, sudah terkirim" hanya kalau pesan sudah terkirim — penjualan, piutang, dan status Terkirim baru dicatat setelah itu.',
  'Pilih "Belum/batal" bila pesan gagal atau belum dikirim; paket tetap di daftar Siap Dikirim dan tidak ada pencatatan keuangan.',
].join("\n");

/** Status share yang berarti share sheet/WA sempat terbuka. */
export function isShareOpened(status: string): boolean {
  return status === "shared" || status === "fallback";
}

/**
 * Tanya pemilik apakah pesan WA benar-benar terkirim.
 * `true` = boleh commit finansial. `false` = jangan commit apa pun.
 */
export async function confirmWhatsAppDelivered(summary?: string): Promise<boolean> {
  return confirm({
    title: WA_DELIVERY_CONFIRM_TITLE,
    description: summary ? `${summary}\n\n${DEFAULT_BODY}` : DEFAULT_BODY,
    confirmText: WA_DELIVERY_CONFIRM_YES,
    cancelText: WA_DELIVERY_CONFIRM_NO,
  });
}

/**
 * Kunci re-entry sederhana: mencegah double tap / event ganda memicu dua
 * commit. Dipakai lewat ref di komponen (bukan state) supaya efektif pada
 * klik beruntun dalam satu frame render.
 */
export function createReentryLock() {
  let held = false;
  return {
    acquire(): boolean {
      if (held) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
    get locked() {
      return held;
    },
  };
}

export type ReentryLock = ReturnType<typeof createReentryLock>;