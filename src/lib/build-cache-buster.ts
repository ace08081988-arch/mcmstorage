/**
 * Cache-buster berbasis BUILD_ID.
 *
 * - `__BUILD_ID__` di-inline oleh Vite tiap build (lihat vite.config.ts).
 * - Saat aplikasi bootstrap, kita bandingkan BUILD_ID sekarang dengan yang
 *   tersimpan di `localStorage`. Bila berbeda → bundle JS berganti; artinya
 *   cache aset SW (manifest/ikon versi lama) berpotensi mencampur label &
 *   satuan dengan bundle baru. Kirim `PURGE_ALL_CACHES` ke service worker
 *   untuk mengosongkan seluruh cache miliknya.
 * - Kita juga polling `/api/version` (server) dan bila BUILD_ID di server
 *   sudah lebih baru dari yang sedang berjalan di tab ini, lakukan hard
 *   reload SATU KALI (rate-limited 60 detik) supaya user tidak terus-menerus
 *   memakai JS lama. Reload dilewati bila document sedang di-fokus + user
 *   sedang mengetik (input focus) agar tidak menginterupsi pekerjaan.
 *
 * Modul ini dipanggil sekali dari `RootComponent` (src/routes/__root.tsx).
 */

const BUILD_ID: string = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

const LS_KEY = "mcm:last-build-id";
const RELOAD_GUARD_KEY = "mcm:auto-reload-at";
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 menit
const RELOAD_COOLDOWN_MS = 60 * 1000;

// Status "reload versi baru sedang ditahan". Diekspos ke UI sehingga
// pegawai/owner tahu kenapa halaman tidak refresh saat versi baru sudah live.
export type DeferredReloadReason = "worker-portal" | "app-busy" | "editing-text";
export type DeferredReloadState = {
  pending: boolean;
  reason: DeferredReloadReason | null;
  serverBuildId: string | null;
  since: number | null;
};
let deferredState: DeferredReloadState = {
  pending: false,
  reason: null,
  serverBuildId: null,
  since: null,
};
const deferredListeners = new Set<(s: DeferredReloadState) => void>();
function setDeferredState(next: DeferredReloadState) {
  const changed =
    next.pending !== deferredState.pending ||
    next.reason !== deferredState.reason ||
    next.serverBuildId !== deferredState.serverBuildId;
  deferredState = next;
  if (!changed) return;
  for (const fn of deferredListeners) {
    try { fn(deferredState); } catch { /* noop */ }
  }
}
export function getDeferredReloadState(): DeferredReloadState {
  return deferredState;
}
export function subscribeDeferredReload(cb: (s: DeferredReloadState) => void): () => void {
  deferredListeners.add(cb);
  // Kirim state saat ini agar subscriber langsung sinkron.
  try { cb(deferredState); } catch { /* noop */ }
  return () => { deferredListeners.delete(cb); };
}

function isEditingText(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

// Portal pegawai (`/t/<token>`) tidak boleh di-hard-reload otomatis: proses
// ambil foto → editor → upload sangat rentan terhadap remount (draft foto,
// section terbuka, dan sesi PIN semua hilang). Reload akan ikut terjadi
// secara alami saat pegawai keluar dari portal.
function isWorkerPortalActive(): boolean {
  try {
    return typeof location !== "undefined" && /^\/t\//.test(location.pathname);
  } catch {
    return false;
  }
}

// Flag global yang bisa di-set halaman lain saat sedang melakukan pekerjaan
// yang tidak boleh diinterupsi reload (mis. staging/upload foto). Diperiksa
// setiap kali polling BUILD_ID hendak reload.
function isAppBusy(): boolean {
  try {
    const w = window as unknown as { __mcmBusy?: number };
    return typeof w.__mcmBusy === "number" && w.__mcmBusy > 0;
  } catch {
    return false;
  }
}

function hardReloadOnce() {
  try {
    const prev = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
    if (prev && Date.now() - prev < RELOAD_COOLDOWN_MS) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch { /* ignore */ }
  const url = new URL(window.location.href);
  url.searchParams.set("__r", String(Date.now()));
  window.location.replace(url.toString());
}

async function purgeSwCaches(buildId: string): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const target = reg?.active || navigator.serviceWorker.controller;
    if (!target) return;
    target.postMessage({ type: "PURGE_ALL_CACHES", buildId });
  } catch { /* ignore */ }

  // Belt-and-braces: browser-side juga hapus cache yang bisa kita akses.
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.allSettled(names.map((n) => caches.delete(n)));
    }
  } catch { /* ignore */ }
}

async function checkServerBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: string };
    return typeof data.buildId === "string" && data.buildId ? data.buildId : null;
  } catch {
    return null;
  }
}

let installed = false;
let externalRecheck: (() => void) | null = null;

/**
 * Paksa cek versi sekali. Aman dipanggil kapan pun; internal function ini
 * yang menjalankan seluruh guard (busy, portal, editing). Dipakai oleh
 * portal pegawai saat operasi foto selesai — begitu busy=0, coba reload
 * lagi kalau server sudah bumped build id.
 */
export function recheckBuildVersion(): void {
  externalRecheck?.();
}

export function installBuildCacheBuster(): void {
  if (installed) return;
  installed = true;
  if (typeof window === "undefined") return;

  // 1) Bandingkan BUILD_ID sekarang dengan yang tersimpan.
  try {
    const prev = localStorage.getItem(LS_KEY);
    if (prev && prev !== BUILD_ID) {
      // Bundle JS berganti sejak kunjungan terakhir → bersihkan cache SW.
      void purgeSwCaches(BUILD_ID);
    }
    localStorage.setItem(LS_KEY, BUILD_ID);
  } catch { /* ignore */ }

  // 2) Polling server: kalau BUILD_ID server berbeda dari yang sedang
  //    berjalan, artinya deploy baru sudah live tapi tab ini masih
  //    memakai JS lama. Lakukan hard reload sekali.
  const runCheck = async () => {
    const serverId = await checkServerBuildId();
    if (!serverId) return;
    if (serverId === BUILD_ID) {
      // Server balik sama — pastikan indikator "ditahan" dibersihkan.
      if (deferredState.pending) {
        setDeferredState({ pending: false, reason: null, serverBuildId: null, since: null });
      }
      return;
    }
    // Tentukan alasan penundaan (jika ada). Urutan diperiksa dari yang
    // paling spesifik: operasi aktif (upload/edit foto) > portal pegawai >
    // user sedang mengetik.
    let reason: DeferredReloadReason | null = null;
    if (isAppBusy()) reason = "app-busy";
    else if (isWorkerPortalActive()) reason = "worker-portal";
    else if (document.visibilityState === "visible" && isEditingText()) reason = "editing-text";

    if (reason) {
      // Publikasikan status "reload ditahan" agar UI bisa menampilkan
      // badge; simpan sejak kapan supaya UI bisa memberi hint "sejak N mnt lalu".
      setDeferredState({
        pending: true,
        reason,
        serverBuildId: serverId,
        since: deferredState.since && deferredState.pending ? deferredState.since : Date.now(),
      });
      return;
    }
    // Bersihkan cache SW lalu reload.
    await purgeSwCaches(serverId);
    hardReloadOnce();
  };

  // Cek segera + interval + saat tab kembali visible.
  void runCheck();
  externalRecheck = () => { void runCheck(); };
  const iv = window.setInterval(() => { void runCheck(); }, POLL_INTERVAL_MS);
  const onVis = () => {
    if (document.visibilityState === "visible") void runCheck();
  };
  document.addEventListener("visibilitychange", onVis);

  // Jika suatu saat kita ingin melepas, sediakan cleanup — TAPI di root
  // component ini hidup selama aplikasi, jadi tidak dipanggil.
  (installBuildCacheBuster as unknown as { _cleanup?: () => void })._cleanup = () => {
    window.clearInterval(iv);
    document.removeEventListener("visibilitychange", onVis);
  };
}