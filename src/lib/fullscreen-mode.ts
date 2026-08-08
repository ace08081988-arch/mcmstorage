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

export type FullscreenPref = "auto" | "on" | "off";

export const FULLSCREEN_LS_KEY = "app-fullscreen-mode";
export const FULLSCREEN_EVENT = "app-fullscreen-change";

export type DisplayMode = "browser" | "minimal-ui" | "standalone" | "fullscreen";

/** Baca preferensi tersimpan (default: "auto"). */
export function readFullscreenPref(): FullscreenPref {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = localStorage.getItem(FULLSCREEN_LS_KEY);
    return raw === "on" || raw === "off" ? raw : "auto";
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
  if (pref === "on" && fromUserGesture) await enterFullscreen();
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

/**
 * Saat aplikasi dibuka sebagai PWA terpasang di Android, bilah status sistem
 * tetap tampil (display: standalone) sehingga menyisakan pita kosong di atas
 * header. Fullscreen API hanya boleh dipanggil dari gesture pengguna, jadi
 * kita minta layar penuh pada sentuhan pertama — sekali saja, dan hanya bila
 * preferensi bukan "off" serta belum berada di mode layar penuh.
 */
export function startAutoFullscreenOnInstalled(): () => void {
  if (typeof window === "undefined") return () => {};
  if (!canRequestFullscreen()) return () => {};

  const shouldRequest = () =>
    readFullscreenPref() !== "off" &&
    isAppInstalledDisplay() &&
    currentDisplayMode() !== "fullscreen";

  const onGesture = async () => {
    if (!shouldRequest()) return;
    cleanup();
    await enterFullscreen();
    applyDisplayMode();
  };

  const cleanup = () => {
    window.removeEventListener("pointerdown", onGesture);
    window.removeEventListener("keydown", onGesture);
  };

  window.addEventListener("pointerdown", onGesture, { passive: true });
  window.addEventListener("keydown", onGesture);
  return cleanup;
}
