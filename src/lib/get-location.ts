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
  try {
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: useHighAccuracy, timeout: 20000, maximumAge: 30000 });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
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
    return await getWebPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
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
