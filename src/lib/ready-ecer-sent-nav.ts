/**
 * Jembatan antara alur kirim (WA/Chat/skip) di halaman /ecer dan tab
 * "Riwayat terkirim" di `ReadyEcerSection` (dirender di /index).
 *
 * Alur:
 *   1. Setelah `markSent` sukses, caller memanggil `requestOpenSentHistory()`.
 *   2. Kami menyimpan flag di sessionStorage supaya bila user navigasi ke
 *      "/" (dari tombol action toast), ReadyEcerSection langsung membuka
 *      tab Riwayat + scroll ke section.
 *   3. Kami juga dispatch event agar bila ReadyEcerSection sudah ter-mount
 *      (mis. user sudah di "/"), ia bisa langsung reaksi tanpa nunggu
 *      remount.
 */
export const SENT_TAB_FLAG = "ready-ecer:open-sent";
export const SHOW_SENT_EVENT = "ready-ecer:show-sent";

export function requestOpenSentHistory() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SENT_TAB_FLAG, "1");
  } catch { /* private mode: dispatch masih efektif untuk komponen aktif */ }
  try {
    window.dispatchEvent(new CustomEvent(SHOW_SENT_EVENT));
  } catch { /* ignore */ }
}

export function consumeSentTabFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.sessionStorage.getItem(SENT_TAB_FLAG);
    if (v) window.sessionStorage.removeItem(SENT_TAB_FLAG);
    return !!v;
  } catch {
    return false;
  }
}