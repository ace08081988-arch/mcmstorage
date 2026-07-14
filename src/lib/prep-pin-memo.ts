/**
 * Pengingat PIN lokal untuk pemilik toko.
 *
 * PIN tugas penyiapan disimpan di server hanya sebagai bcrypt hash — tidak
 * bisa diambil kembali. Modul ini menyimpan salinan PIN pada `localStorage`
 * perangkat pemilik saja, semata-mata sebagai catatan pengingat ("kalau
 * lupa, cek di kartu tugas") persis seperti menuliskan PIN di buku catatan
 * pribadi.
 *
 * Karakteristiknya:
 * - Kunci = `share_token` tugas (unik per tugas & berubah kalau token direset).
 * - Tidak pernah dikirim ke server / analytics / log — hanya dibaca ulang
 *   oleh UI di device yang sama.
 * - Tidak dipakai untuk autentikasi apa pun. Verifikasi PIN tetap dilakukan
 *   server-side lewat bcrypt hash + rate limit RPC.
 * - Aman untuk dihapus kapan saja (`forgetPin`) — pegawai tetap bisa masuk
 *   selama PIN aktif di server, hanya UI pengingat yang hilang.
 *
 * Catatan keamanan: karena tersimpan plaintext di `localStorage`, siapa pun
 * yang bisa membuka aplikasi di HP pemilik juga bisa membaca PIN. Ini
 * konsisten dengan model yang sudah ada — App Lock/PIN aplikasi melindungi
 * seluruh device pemilik, bukan tiap PIN tugas satu per satu.
 */

const KEY = "prep:pin-memo:v1";

type Store = Record<string, string>;

function read(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Store = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" && /^\d{4,8}$/.test(v)) out[k] = v;
      }
      return out;
    }
  } catch {
    /* abaikan — anggap kosong */
  }
  return {};
}

function write(store: Store): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — biarkan gagal diam-diam */
  }
}

export function rememberPin(shareToken: string, pin: string): void {
  if (!shareToken || !/^\d{4,8}$/.test(pin)) return;
  const s = read();
  s[shareToken] = pin;
  write(s);
}

export function recallPin(shareToken: string | null | undefined): string | null {
  if (!shareToken) return null;
  return read()[shareToken] ?? null;
}

export function forgetPin(shareToken: string | null | undefined): void {
  if (!shareToken) return;
  const s = read();
  if (shareToken in s) {
    delete s[shareToken];
    write(s);
  }
}