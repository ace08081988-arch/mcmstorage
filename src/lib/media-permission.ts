// Deteksi & panduan izin kamera/galeri untuk halaman pegawai. Fokusnya:
// menjelaskan langkah nyata yang harus diambil user (bukan pesan generik
// "permission denied") berbasis browser + OS yang terdeteksi.

export type PermissionState = "granted" | "denied" | "prompt" | "unsupported" | "unknown";
export type MediaKind = "camera" | "gallery";
export type BrowserKind =
  | "chrome-android"
  | "samsung-android"
  | "firefox-android"
  | "safari-ios"
  | "chrome-ios"
  | "chrome-desktop"
  | "firefox-desktop"
  | "safari-desktop"
  | "in-app-webview"
  | "other";

export function detectBrowser(uaRaw?: string): BrowserKind {
  const ua = (uaRaw ?? (typeof navigator !== "undefined" ? navigator.userAgent : "")).toLowerCase();
  if (!ua) return "other";
  // WhatsApp/Facebook/Instagram in-app browsers sering blokir izin kamera.
  if (/(fb_iab|fbav|instagram|line|wv\)|whatsapp)/.test(ua)) return "in-app-webview";
  const isAndroid = /android/.test(ua);
  const isIOS = /(iphone|ipad|ipod)/.test(ua) || (/mac os/.test(ua) && /mobile/.test(ua));
  if (isAndroid) {
    if (/samsungbrowser/.test(ua)) return "samsung-android";
    if (/firefox/.test(ua) || /fxios/.test(ua)) return "firefox-android";
    if (/chrome|crios/.test(ua)) return "chrome-android";
    return "other";
  }
  if (isIOS) {
    if (/crios/.test(ua)) return "chrome-ios";
    return "safari-ios";
  }
  if (/firefox/.test(ua)) return "firefox-desktop";
  if (/safari/.test(ua) && !/chrome|chromium|edg/.test(ua)) return "safari-desktop";
  if (/chrome|chromium|edg/.test(ua)) return "chrome-desktop";
  return "other";
}

export async function queryCameraPermission(): Promise<PermissionState> {
  if (typeof navigator === "undefined") return "unsupported";
  // Permissions API belum menstandarkan "camera" di semua browser (Safari
  // tidak mendukung). Kita mencoba, tapi treat error/unsupported = "unknown".
  const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
  if (!perms?.query) return "unknown";
  try {
    const r = await perms.query({ name: "camera" as PermissionName });
    if (r.state === "granted" || r.state === "denied" || r.state === "prompt") return r.state;
    return "unknown";
  } catch {
    return "unknown";
  }
}

export type PermissionGuide = {
  title: string;
  intro: string;
  steps: string[];
  hint?: string;
};

/** Panduan langkah spesifik per (browser, jenis izin). */
export function permissionGuide(kind: MediaKind, browser: BrowserKind): PermissionGuide {
  const isCamera = kind === "camera";
  const label = isCamera ? "Kamera" : "Galeri/Foto";

  if (browser === "in-app-webview") {
    return {
      title: `Buka lewat browser biasa untuk pakai ${label}`,
      intro:
        "Anda sedang membuka link ini dari dalam aplikasi (WhatsApp/Instagram/dsb). Browser di dalam aplikasi biasanya memblokir izin kamera & galeri.",
      steps: [
        "Ketuk tombol menu ⋮ di kanan atas layar.",
        "Pilih ‘Buka di Chrome’ atau ‘Buka di browser’.",
        "Setelah terbuka di Chrome/Safari, ulangi tombol Kamera/Galeri di sini.",
      ],
      hint: "Sekali pindah ke browser, PIN & tugas Anda tetap sama — cukup buka link yang tadi.",
    };
  }

  if (browser === "chrome-android" || browser === "chrome-desktop") {
    return {
      title: `Aktifkan izin ${label} di Chrome`,
      intro: `Chrome memblokir akses ${label.toLowerCase()} untuk situs ini. Aktifkan lewat langkah berikut, lalu ulangi.`,
      steps: isCamera
        ? [
            "Ketuk ikon gembok/⚙️ di sebelah kiri alamat (address bar).",
            "Pilih ‘Izin’ atau ‘Site settings’.",
            "Ubah ‘Kamera’ menjadi ‘Izinkan’.",
            "Kembali ke halaman ini, ketuk ulang tombol Kamera.",
          ]
        : [
            "Pastikan Chrome memiliki izin ‘Foto & media’ di Setelan Android → Aplikasi → Chrome → Izin.",
            "Kembali ke halaman ini, ketuk ulang tombol Galeri.",
            "Kalau muncul dialog Android, pilih ‘Izinkan semua’ agar bisa memilih beberapa foto.",
          ],
    };
  }

  if (browser === "samsung-android") {
    return {
      title: `Aktifkan izin ${label} di Samsung Internet`,
      intro: `Samsung Internet memblokir akses ${label.toLowerCase()} untuk situs ini.`,
      steps: [
        "Ketuk ikon ☰ di kanan bawah → ‘Setelan’.",
        "Pilih ‘Situs & unduhan’ → ‘Izin situs’ → ‘Kamera’ / ‘Penyimpanan’.",
        "Cari halaman ini di daftar, ubah menjadi ‘Izinkan’.",
        "Muat ulang halaman lalu ulangi tombol Kamera/Galeri.",
      ],
    };
  }

  if (browser === "firefox-android" || browser === "firefox-desktop") {
    return {
      title: `Aktifkan izin ${label} di Firefox`,
      intro: `Firefox memblokir akses ${label.toLowerCase()} untuk situs ini.`,
      steps: [
        "Ketuk ikon gembok di address bar.",
        "Pilih ‘Izin’ → ubah ‘Kamera’ / ‘Autoplay & media’ ke ‘Izinkan’.",
        "Muat ulang halaman lalu ulangi tombol Kamera/Galeri.",
      ],
    };
  }

  if (browser === "safari-ios" || browser === "chrome-ios") {
    return {
      title: `Aktifkan izin ${label} di iPhone`,
      intro:
        "iOS mengatur izin per aplikasi. Kalau tombol Kamera/Galeri tidak muncul, izin browser mungkin dibatasi.",
      steps: isCamera
        ? [
            "Buka Pengaturan iPhone → Safari (atau Chrome).",
            "Ketuk ‘Kamera’ → pilih ‘Izinkan’.",
            "Buka Pengaturan → Privasi & Keamanan → Kamera, pastikan Safari/Chrome aktif.",
            "Kembali ke halaman ini, muat ulang, lalu ulangi tombol Kamera.",
          ]
        : [
            "Buka Pengaturan iPhone → Safari (atau Chrome).",
            "Ketuk ‘Foto’ → pilih ‘Semua Foto’ atau ‘Beberapa Foto’.",
            "Pastikan format foto iPhone → Kamera → Format = ‘Paling Kompatibel’ agar tidak HEIC.",
            "Kembali ke halaman ini, muat ulang, lalu ulangi tombol Galeri.",
          ],
    };
  }

  if (browser === "safari-desktop") {
    return {
      title: `Aktifkan izin ${label} di Safari`,
      intro: `Safari memblokir akses ${label.toLowerCase()}.`,
      steps: [
        "Buka menu Safari → Pengaturan → Situs Web → Kamera.",
        "Cari halaman ini, ubah ke ‘Izinkan’.",
        "Muat ulang halaman lalu ulangi tombol Kamera/Galeri.",
      ],
    };
  }

  return {
    title: `Aktifkan izin ${label}`,
    intro: `Browser Anda memblokir akses ${label.toLowerCase()} ke situs ini.`,
    steps: [
      "Buka pengaturan izin situs pada browser (biasanya ikon gembok di address bar).",
      "Ubah izin Kamera / Foto menjadi ‘Izinkan’.",
      "Muat ulang halaman lalu ulangi tombol Kamera/Galeri.",
    ],
  };
}

/** Pesan singkat untuk toast + judul untuk dialog panduan. */
export function permissionToastMessage(kind: MediaKind, state: PermissionState): string {
  const label = kind === "camera" ? "Kamera" : "Galeri";
  if (state === "denied") return `Izin ${label} diblokir oleh browser. Buka panduan untuk mengaktifkannya.`;
  return `Tidak ada foto yang dipilih. Pastikan izin ${label} diaktifkan lalu coba lagi.`;
}