import { Capacitor } from "@capacitor/core";

export type GeoResult = { lat: number; lng: number; accuracy?: number };
export type LocationDiagnostics = {
  platform: string;
  isNative: boolean;
  hasNavigatorGeolocation: boolean;
  secureContext: boolean;
  protocol?: string;
  hostname?: string;
  permission?: PermissionState | "unsupported" | "unknown";
  userAgent?: string;
};

export class GeoError extends Error {
  code: "unsupported" | "denied" | "unavailable" | "timeout" | "insecure" | "unknown";
  hint?: string;
  constructor(code: GeoError["code"], message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export function toGeoError(error: unknown): GeoError {
  if (error instanceof GeoError) return error;
  const message = error instanceof Error ? error.message : String(error || "Gagal mengambil lokasi.");
  const lower = message.toLowerCase();

  if (lower.includes("missing") && lower.includes("permission") && lower.includes("androidmanifest")) {
    return new GeoError(
      "unsupported",
      "Izin lokasi belum aktif di build Android.",
      "Perbarui aplikasi ke versi terbaru. Jika masih gagal, kirim detail error dari tombol Salin detail.",
    );
  }
  if (lower.includes("user denied") || lower.includes("permission_denied") || lower.includes("permission denied") || lower.includes("denied") || lower.includes("not allowed")) {
    return new GeoError(
      "denied",
      "Izin lokasi ditolak atau diblokir.",
      "Aktifkan izin Lokasi untuk aplikasi/browser ini di Pengaturan, lalu kembali dan tekan GPS lagi. Jika memakai preview Lovable, aktifkan izin Lokasi untuk aplikasi Lovable juga.",
    );
  }
  if (lower.includes("secure") || lower.includes("https") || lower.includes("origin")) {
    return new GeoError("insecure", "GPS hanya tersedia di koneksi aman (HTTPS).", "Buka aplikasi dari domain HTTPS resmi, bukan mode yang tidak aman.");
  }
  if (lower.includes("timeout") || lower.includes("os-plug-gloc-0010")) {
    return new GeoError("timeout", "GPS tidak merespons tepat waktu.", "Nyalakan layanan lokasi, buka area yang lebih terbuka, lalu coba lagi. Aplikasi akan mencoba mode akurasi rendah sebagai cadangan.");
  }
  if (lower.includes("location services") || lower.includes("not enabled") || lower.includes("os-plug-gloc-0007")) {
    return new GeoError("unavailable", "Layanan lokasi perangkat belum aktif.", "Nyalakan Lokasi/GPS dari quick settings ponsel, lalu coba lagi.");
  }
  if (lower.includes("unavailable") || lower.includes("position unavailable")) {
    return new GeoError("unavailable", "Sinyal lokasi belum tersedia.", "Pastikan Lokasi/GPS ponsel menyala dan coba di area terbuka.");
  }
  return new GeoError("unknown", message || "Gagal mengambil lokasi.", "Coba tempel link Google Maps sebagai pengganti, atau salin detail error untuk troubleshooting.");
}

function isSecure(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext) return true;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

async function getNative(): Promise<GeoResult> {
  const { Geolocation } = await import("@capacitor/geolocation");
  let useHighAccuracy = true;
  try {
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
      let req = await Geolocation.requestPermissions({ permissions: ["location"] });
      if (req.location !== "granted" && req.coarseLocation !== "granted") {
        req = await Geolocation.requestPermissions({ permissions: ["coarseLocation"] });
      }
      if (req.location !== "granted" && req.coarseLocation !== "granted") {
        throw new GeoError(
          "denied",
          "Izin lokasi ditolak.",
          "Buka Pengaturan aplikasi → Izin → Lokasi, lalu aktifkan untuk MCM Storage.",
        );
      }
      useHighAccuracy = req.location === "granted";
    } else {
      useHighAccuracy = perm.location === "granted";
    }
  } catch (e) {
    if (e instanceof GeoError) throw e;
    // fall through to coords attempt
  }
  // Sampling: kumpulkan beberapa fix lalu pilih akurasi terbaik agar
  // koordinat lebih stabil dan tidak "loncat" karena reading pertama
  // sering berasal dari cache jaringan/WiFi (akurasi 500-2000 m).
  try {
    return await watchBestNative(useHighAccuracy);
  } catch (e) {
    const firstError = toGeoError(e);
    if (useHighAccuracy && (firstError.code === "timeout" || firstError.code === "unavailable")) {
      try {
        const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 25000, maximumAge: 60000 });
        return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      } catch (fallbackError) {
        throw toGeoError(fallbackError);
      }
    }
    throw firstError;
  }
}

// Target akurasi & jendela waktu pengambilan sampel GPS.
// TARGET_ACC_M: berhenti lebih awal saat sudah cukup presisi.
// MIN_WAIT_MS:  minimum sampling supaya tidak pakai fix pertama yang kasar.
// MAX_WAIT_MS:  batas atas, kembalikan sampel terbaik yang ada.
const TARGET_ACC_M = 15;
const MIN_WAIT_MS = 3500;
const MAX_WAIT_MS = 15000;

async function watchBestNative(highAccuracy: boolean): Promise<GeoResult> {
  const { Geolocation } = await import("@capacitor/geolocation");
  return new Promise<GeoResult>((resolve, reject) => {
    let best: GeoResult | null = null;
    let watchId: string | null = null;
    let settled = false;
    const startedAt = Date.now();

    const finish = (kind: "ok" | "err", payload: GeoResult | unknown) => {
      if (settled) return;
      settled = true;
      if (watchId) { try { void Geolocation.clearWatch({ id: watchId }); } catch { /* noop */ } }
      clearTimeout(maxTimer);
      if (kind === "ok") resolve(payload as GeoResult);
      else reject(payload);
    };

    const maxTimer = setTimeout(() => {
      if (best) finish("ok", best);
      else finish("err", new GeoError("timeout", "GPS tidak merespons tepat waktu."));
    }, MAX_WAIT_MS);

    Geolocation.watchPosition(
      { enableHighAccuracy: highAccuracy, timeout: MAX_WAIT_MS, maximumAge: 0 },
      (pos, err) => {
        if (err) {
          if (!best) finish("err", err);
          return;
        }
        if (!pos) return;
        const sample: GeoResult = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        if (!best || (sample.accuracy ?? Infinity) < (best.accuracy ?? Infinity)) best = sample;
        const elapsed = Date.now() - startedAt;
        if (best && (best.accuracy ?? Infinity) <= TARGET_ACC_M && elapsed >= MIN_WAIT_MS) {
          finish("ok", best);
        }
      },
    ).then((id) => { watchId = id; }).catch((e) => finish("err", e));
  });
}

function watchBestWeb(options: PositionOptions): Promise<GeoResult> {
  return new Promise<GeoResult>((resolve, reject) => {
    let best: GeoResult | null = null;
    let settled = false;
    const startedAt = Date.now();
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const sample: GeoResult = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        if (!best || (sample.accuracy ?? Infinity) < (best.accuracy ?? Infinity)) best = sample;
        const elapsed = Date.now() - startedAt;
        if (best && (best.accuracy ?? Infinity) <= TARGET_ACC_M && elapsed >= MIN_WAIT_MS) {
          finish("ok", best);
        }
      },
      (err) => { if (!best) finish("err", toGeoError(err)); },
      options,
    );
    const maxTimer = setTimeout(() => {
      if (best) finish("ok", best);
      else finish("err", new GeoError("timeout", "GPS tidak merespons tepat waktu."));
    }, MAX_WAIT_MS);
    function finish(kind: "ok" | "err", payload: GeoResult | unknown) {
      if (settled) return;
      settled = true;
      try { navigator.geolocation.clearWatch(id); } catch { /* noop */ }
      clearTimeout(maxTimer);
      if (kind === "ok") resolve(payload as GeoResult);
      else reject(payload);
    }
  });
}

async function getNativeIfAllowed(): Promise<GeoResult | null> {
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== "granted" && perm.coarseLocation !== "granted") return null;
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: perm.location === "granted", timeout: 12000, maximumAge: 60000 });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
  } catch {
    return null;
  }
}

async function readWebPermission(): Promise<PermissionState | "unsupported" | "unknown"> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perms = typeof navigator !== "undefined" ? (navigator as any).permissions : undefined;
    if (!perms?.query) return "unsupported";
    const status = await perms.query({ name: "geolocation" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

function getWebPosition(options: PositionOptions): Promise<GeoResult> {
  return new Promise<GeoResult>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(toGeoError(err)),
      options,
    );
  });
}

async function getWeb(): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new GeoError("unsupported", "Peramban tidak mendukung GPS.");
  }
  if (!isSecure()) {
    throw new GeoError(
      "insecure",
      "GPS hanya tersedia di koneksi aman (HTTPS).",
      "Buka aplikasi melalui HTTPS atau localhost.",
    );
  }

  const permission = await readWebPermission();
  if (permission === "denied") {
    throw new GeoError(
      "denied",
      "Izin lokasi diblokir untuk situs ini.",
      "Buka pengaturan aplikasi/browser → Izin situs/aplikasi → Lokasi → Izinkan. Jika memakai preview Lovable, aktifkan izin Lokasi untuk aplikasi Lovable.",
    );
  }

  try {
    return await watchBestWeb({ enableHighAccuracy: true, timeout: MAX_WAIT_MS, maximumAge: 0 });
  } catch (e) {
    const firstError = toGeoError(e);
    if (firstError.code === "timeout" || firstError.code === "unavailable") {
      try {
        return await getWebPosition({ enableHighAccuracy: false, timeout: 25000, maximumAge: 60000 });
      } catch (fallbackError) {
        throw toGeoError(fallbackError);
      }
    }
    throw firstError;
  }
}

async function getWebIfAllowed(): Promise<GeoResult | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation || !isSecure()) return null;
  const permission = await readWebPermission();
  if (permission !== "granted") return null;
  try {
    return await getWebPosition({ enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  } catch {
    return null;
  }
}

export async function getCurrentLocation(): Promise<GeoResult> {
  if (Capacitor.isNativePlatform()) return getNative();
  return getWeb();
}

export async function getCurrentLocationIfAllowed(): Promise<GeoResult | null> {
  if (Capacitor.isNativePlatform()) return getNativeIfAllowed();
  return getWebIfAllowed();
}

export async function getLocationDiagnostics(): Promise<LocationDiagnostics> {
  return {
    platform: Capacitor.getPlatform(),
    isNative: Capacitor.isNativePlatform(),
    hasNavigatorGeolocation: typeof navigator !== "undefined" && !!navigator.geolocation,
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    protocol: typeof window !== "undefined" ? window.location.protocol : undefined,
    hostname: typeof window !== "undefined" ? window.location.hostname : undefined,
    permission: await readWebPermission(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  };
}
