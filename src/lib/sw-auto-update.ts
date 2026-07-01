/**
 * Registrasi service worker MCM + mekanisme auto-update.
 *
 * - `updateViaCache: "none"` → browser TIDAK mem-cache berkas SW; setiap
 *   pengecekan pasti membaca versi terbaru dari server.
 * - Panggil `reg.update()` saat mount, saat halaman kembali visible,
 *   saat `pageshow` (kembali dari bfcache), dan setiap 30 menit.
 * - Saat SW baru terpasang (state = "installed") sementara SW lama masih
 *   mengendalikan halaman, kirim `SKIP_WAITING` supaya versi baru langsung
 *   aktif; setelah `controllerchange`, muat ulang halaman satu kali agar
 *   manifest & ikon terbaru diambil.
 * - Bila SW pertama kali terpasang (belum ada `controller`), tidak reload —
 *   halaman saat ini sudah menggunakan aset segar.
 */

const SW_URL = "/sw-push.js";
const SW_SCOPE = "/";
const UPDATE_INTERVAL_MS = 30 * 60 * 1000; // 30 menit
const RELOAD_GUARD_KEY = "__mcm_sw_reload_at";

function shouldReload(): boolean {
  try {
    const prev = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
    if (prev && Date.now() - prev < 10_000) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

function watchWaiting(reg: ServiceWorkerRegistration) {
  const nw = reg.installing || reg.waiting;
  if (!nw) return;
  const onState = () => {
    if (nw.state === "installed" && navigator.serviceWorker.controller) {
      // Ada versi baru yang siap menggantikan versi lama → langsung aktifkan.
      try { nw.postMessage({ type: "SKIP_WAITING" }); } catch { /* ignore */ }
    }
  };
  nw.addEventListener("statechange", onState);
  // Handle case where it's already installed by the time we attach.
  onState();
}

let installed = false;

export function installSwAutoUpdate(): (() => void) | void {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Jangan registrasi di dalam iframe preview Lovable.
  if (window.top !== window.self) return;
  installed = true;

  let reg: ServiceWorkerRegistration | null = null;
  let intervalId: number | null = null;
  let hadController = !!navigator.serviceWorker.controller;

  const doUpdate = () => {
    if (!reg) return;
    reg.update().catch(() => { /* silent */ });
  };

  const onVisibility = () => { if (document.visibilityState === "visible") doUpdate(); };
  const onPageShow = () => doUpdate();
  const onFocus = () => doUpdate();
  const onControllerChange = () => {
    // Hanya reload bila SEBELUMNYA sudah ada controller (artinya benar-benar
    // upgrade dari versi lama, bukan first-install).
    if (!hadController) { hadController = true; return; }
    if (!shouldReload()) return;
    try { window.location.reload(); } catch { /* ignore */ }
  };

  navigator.serviceWorker.register(SW_URL, {
    scope: SW_SCOPE,
    updateViaCache: "none",
  }).then((r) => {
    reg = r;
    // Kejadian saat SW baru mulai diinstal.
    r.addEventListener("updatefound", () => watchWaiting(r));
    // Bila sudah ada waiting worker saat halaman baru dibuka.
    watchWaiting(r);
    // Cek update sekali di awal + jadwalkan berkala.
    doUpdate();
    intervalId = window.setInterval(doUpdate, UPDATE_INTERVAL_MS);
  }).catch(() => { /* silent */ });

  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("focus", onFocus);

  return () => {
    if (intervalId !== null) window.clearInterval(intervalId);
    navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("focus", onFocus);
  };
}