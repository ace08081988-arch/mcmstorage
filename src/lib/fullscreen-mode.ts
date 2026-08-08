/**
 * Mode layar penuh untuk PWA (iOS & Android).
 *
 * Tiga hal yang diurus modul ini:
 *  1. Deteksi cara aplikasi dibuka (tab browser / terpasang standalone /
 *     fullscreen) dan menuliskannya ke `document.documentElement.dataset
 *     .displayMode`. CSS memakai atribut ini untuk membuang ruang kosong
 *     status-bar saat aplikasi memang sudah layar penuh.
 *  2. Preferensi pengguna: "auto" (ikut cara aplikasi dibuka), "on"
 *     (paksa layar penuh lewat Fullscreen API — Android/desktop), atau
 *     "off". iOS tidak punya Fullscreen API di Safari mobile, jadi di sana
 *     "on" berperilaku seperti "auto" (layar penuh datang dari manifest
 *     `display` saat dipasang ke Home Screen).
 *  3. Menjaga atribut tetap sinkron ketika pengguna keluar-masuk mode
 *     layar penuh atau memutar layar.
 */

/**
 * - `auto`   : ikut cara aplikasi dibuka (bawaan)
 * - `on`     : selalu — kembali layar penuh setiap kali keluar
 * - `launch` : hanya saat membuka aplikasi (sekali per sesi/muat)
 * - `scroll` : otomatis saat mulai menggulir halaman
 * - `off`    : jangan pernah meminta layar penuh
 */
export type FullscreenPref = "auto" | "on" | "launch" | "scroll" | "off";

const PREFS: FullscreenPref[] = ["auto", "on", "launch", "scroll", "off"];

export const FULLSCREEN_LS_KEY = "app-fullscreen-mode";
export const FULLSCREEN_EVENT = "app-fullscreen-change";

export type DisplayMode = "browser" | "minimal-ui" | "standalone" | "fullscreen";

/** Baca preferensi tersimpan (default: "auto"). */
export function readFullscreenPref(): FullscreenPref {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = localStorage.getItem(FULLSCREEN_LS_KEY);
    return PREFS.includes(raw as FullscreenPref) ? (raw as FullscreenPref) : "auto";
  } catch {
    return "auto";
  }
}

export function writeFullscreenPref(pref: FullscreenPref) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FULLSCREEN_LS_KEY, pref);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(FULLSCREEN_EVENT, { detail: { pref } }));
  } catch {
    /* ignore */
  }
}

/** Cara aplikasi sedang ditampilkan saat ini. */
export function currentDisplayMode(): DisplayMode {
  if (typeof window === "undefined") return "browser";
  if (document.fullscreenElement) return "fullscreen";
  const modes: DisplayMode[] = ["fullscreen", "standalone", "minimal-ui"];
  for (const m of modes) {
    if (window.matchMedia?.(`(display-mode: ${m})`).matches) return m;
  }
  // iOS Safari (sebelum iOS 17) hanya punya navigator.standalone.
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) {
    return "standalone";
  }
  return "browser";
}

/** Apakah aplikasi berjalan tanpa chrome browser (terpasang / layar penuh)? */
export function isAppInstalledDisplay(): boolean {
  const m = currentDisplayMode();
  return m === "standalone" || m === "fullscreen" || m === "minimal-ui";
}

export function canRequestFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  return typeof document.documentElement.requestFullscreen === "function";
}

/** Tulis status tampilan ke <html> supaya CSS bisa menyesuaikan. */
export function applyDisplayMode() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const mode = currentDisplayMode();
  root.dataset.displayMode = mode;
  // `installed` = tanpa address bar → header aplikasi adalah satu-satunya
  // header, sehingga halaman tidak perlu offset chrome browser.
  root.dataset.appInstalled = isAppInstalledDisplay() ? "1" : "0";
  root.dataset.fullscreenPref = readFullscreenPref();
}

export async function enterFullscreen(): Promise<boolean> {
  if (!canRequestFullscreen()) return false;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* ignore */
  }
}

/**
 * Terapkan preferensi. Fullscreen API hanya boleh dipanggil dari gesture
 * pengguna, jadi `fromUserGesture` menandai kapan boleh meminta.
 */
export async function applyFullscreenPref(fromUserGesture = false) {
  const pref = readFullscreenPref();
  if ((pref === "on" || pref === "launch" || pref === "scroll") && fromUserGesture) {
    await enterFullscreen();
  }
  if (pref === "off") await exitFullscreen();
  applyDisplayMode();
}

/** Pasang listener sekali; mengembalikan fungsi pembersih. */
export function startDisplayModeWatch(): () => void {
  if (typeof window === "undefined") return () => {};
  applyDisplayMode();
  const sync = () => applyDisplayMode();
  const queries = ["fullscreen", "standalone", "minimal-ui"].map((m) =>
    window.matchMedia?.(`(display-mode: ${m})`),
  );
  queries.forEach((q) => q?.addEventListener?.("change", sync));
  document.addEventListener("fullscreenchange", sync);
  window.addEventListener("orientationchange", sync);
  window.addEventListener(FULLSCREEN_EVENT, sync);
  return () => {
    queries.forEach((q) => q?.removeEventListener?.("change", sync));
    document.removeEventListener("fullscreenchange", sync);
    window.removeEventListener("orientationchange", sync);
    window.removeEventListener(FULLSCREEN_EVENT, sync);
  };
}

/** Perangkat layar sentuh berukuran ponsel/tablet. */
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarse && Math.min(window.innerWidth, window.innerHeight) <= 900;
}

/**
 * Saat aplikasi dibuka sebagai PWA terpasang di Android, bilah status sistem
 * tetap tampil (display: standalone) sehingga menyisakan pita kosong di atas
 * header. Fullscreen API hanya boleh dipanggil dari gesture pengguna, jadi
 * kita minta layar penuh pada sentuhan pertama — sekali saja, dan hanya bila
 * preferensi bukan "off" serta belum berada di mode layar penuh.
 *
 * Di ponsel, ini juga berlaku saat aplikasi dibuka lewat tab browser: bilah
 * alamat & bilah sistem ikut disembunyikan supaya layar benar-benar penuh.
 * Listener dipasang ulang setelah pengguna keluar dari layar penuh, jadi
 * sentuhan berikutnya mengembalikan mode penuh tanpa perlu muat ulang.
 */
export function startAutoFullscreenOnInstalled(): () => void {
  if (typeof window === "undefined") return () => {};
  if (!canRequestFullscreen()) return () => {};

  let done = false; // dipakai mode "launch": cukup sekali per muat halaman

  const shouldRequest = () => {
    const pref = readFullscreenPref();
    if (pref === "off") return false;
    if (pref === "launch" && done) return false;
    return (
      (isAppInstalledDisplay() || isMobileViewport()) &&
      currentDisplayMode() !== "fullscreen"
    );
  };

  const request = async () => {
    if (!shouldRequest()) return;
    done = true;
    detach();
    await enterFullscreen();
    applyDisplayMode();
  };

  const onGesture = () => {
    // Mode "scroll" menunggu gulir, bukan sentuhan biasa.
    if (readFullscreenPref() === "scroll") return;
    void request();
  };

  const onScroll = () => {
    if (readFullscreenPref() !== "scroll") return;
    void request();
  };

  const detach = () => {
    window.removeEventListener("pointerdown", onGesture);
    window.removeEventListener("keydown", onGesture);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("touchmove", onScroll);
  };

  const attach = () => {
    detach();
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("touchmove", onScroll, { passive: true });
  };

  // Keluar dari layar penuh: mode "selalu" & "scroll" memasang listener lagi,
  // mode "hanya saat membuka" membiarkan pengguna tetap di tampilan normal.
  const onFullscreenChange = () => {
    if (document.fullscreenElement) return;
    if (readFullscreenPref() === "launch") return;
    attach();
  };

  attach();
  document.addEventListener("fullscreenchange", onFullscreenChange);
  const onPrefChange = () => {
    done = false;
    if (!document.fullscreenElement) attach();
  };
  window.addEventListener(FULLSCREEN_EVENT, onPrefChange);
  return () => {
    detach();
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    window.removeEventListener(FULLSCREEN_EVENT, onPrefChange);
  };
}
