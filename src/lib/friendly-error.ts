// Maps backend errors to safe, user-facing Indonesian messages.
// Avoid leaking raw PostgreSQL / Supabase error text (constraint names,
// table/column identifiers) into toasts. Full details are still visible
// in browser devtools / server logs for debugging.
import { toast } from "sonner";

/**
 * Telemetri lokal untuk melacak sumber penolakan akses.
 * Menyimpan ring-buffer di `localStorage` (`mcm:access-denied-log`, maks 50 entri)
 * dan mengeluarkan event terstruktur ke `console.info` sehingga bisa dipanen
 * dari devtools / remote log. Juga menembakkan `CustomEvent('mcm:access-denied')`
 * pada `window` supaya kolektor telemetri (mis. Sentry) bisa mendengarkan.
 */
const ACCESS_DENIED_LOG_KEY = "mcm:access-denied-log";
const ACCESS_DENIED_LOG_MAX = 50;

export type AccessDeniedTelemetry = {
  ts: string;
  phase: "toast-shown" | "action-clicked";
  code?: string;
  status?: number;
  message?: string;
  path?: string;
  prefix?: string;
};

function readAccessDeniedLog(): AccessDeniedTelemetry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ACCESS_DENIED_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AccessDeniedTelemetry[]) : [];
  } catch {
    return [];
  }
}

function appendAccessDeniedLog(entry: AccessDeniedTelemetry): void {
  if (typeof window === "undefined") return;
  try {
    const next = [...readAccessDeniedLog(), entry].slice(-ACCESS_DENIED_LOG_MAX);
    window.localStorage.setItem(ACCESS_DENIED_LOG_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — abaikan */
  }
}

/** Ambil buffer telemetri (paling lama → paling baru). Aman dipanggil di tes. */
export function getAccessDeniedLog(): AccessDeniedTelemetry[] {
  return readAccessDeniedLog();
}

/** Kosongkan buffer telemetri. */
export function clearAccessDeniedLog(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(ACCESS_DENIED_LOG_KEY); } catch { /* noop */ }
}

function emitAccessDenied(entry: AccessDeniedTelemetry): void {
  try { console.info("[access-denied]", entry); } catch { /* noop */ }
  appendAccessDeniedLog(entry);
  if (typeof window !== "undefined" && typeof CustomEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent("mcm:access-denied", { detail: entry }));
    } catch { /* noop */ }
  }
}

function extractErrorFields(err: unknown): Pick<AccessDeniedTelemetry, "code" | "status" | "message"> {
  const e = (err ?? {}) as { code?: string; status?: number; message?: string };
  return {
    code: e.code,
    status: e.status,
    message: e.message ? String(e.message).slice(0, 300) : undefined,
  };
}

/**
 * True saat error berasal dari policy RLS / Postgres yang menolak akses
 * (kode 42501) atau PostgREST 301 (JWT tidak mengizinkan). Toast untuk
 * kasus ini seharusnya menampilkan tombol menuju halaman pengaturan akses
 * (`/profil`), tempat pengguna bisa upgrade akun MCM Chat → MCM Storage.
 */
export function isAccessDeniedError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; status?: number; message?: string };
  if (e.code === "42501" || e.code === "PGRST301") return true;
  if (e.status === 401 || e.status === 403) return true;
  const msg = (e.message ?? "").toLowerCase();
  return (
    msg.includes("row-level security") ||
    msg.includes("permission denied") ||
    msg.includes("tidak memiliki akses")
  );
}

export function friendlyError(
  err: unknown,
  fallback = "Terjadi kesalahan. Coba lagi.",
): string {
  if (!err) return fallback;
  const e = err as { code?: string; message?: string; status?: number };
  // Log raw error for developer-side debugging without exposing it.
  try { console.error("[app-error]", err); } catch { /* noop */ }

  switch (e.code) {
    case "23505": return "Data ini sudah ada.";
    case "23503": return "Masih ada data terkait yang menghalangi. Hapus dulu data yang mengacu ke barang ini.";
    case "23514": return "Input tidak valid.";
    case "23502": return "Ada kolom wajib yang belum diisi.";
    case "22P02": return "Format input tidak valid.";
    case "42501":
    case "PGRST301":
      return "Anda tidak memiliki akses untuk aksi ini.";
    // Supabase Auth (GoTrue) error codes
    case "weak_password":
      return "Kata sandi terlalu lemah atau pernah bocor. Pakai kombinasi huruf, angka, dan simbol yang berbeda.";
    case "email_address_invalid":
      return "Format email tidak valid.";
    case "email_address_not_authorized":
      return "Email ini tidak diizinkan untuk mendaftar.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Terlalu banyak percobaan. Tunggu sekitar 1 menit lalu coba lagi.";
    case "signup_disabled":
      return "Pendaftaran sedang dinonaktifkan.";
    case "email_exists":
    case "user_already_exists":
      return "Email sudah terdaftar. Silakan Masuk.";
    case "email_not_confirmed":
      return "Email belum dikonfirmasi. Cek inbox untuk verifikasi.";
    case "invalid_credentials":
      return "Email atau kata sandi salah.";
  }

  const msg = (e.message ?? "").toLowerCase();
  // Konfigurasi push (VAPID) — jangan bocorkan detail teknis ke user.
  if (msg.includes("vapid") || msg.includes("config_invalid") ||
      (msg.includes("subject") && msg.includes("url"))) {
    return "Konfigurasi notifikasi belum valid.";
  }
  // Pro-tier paywall (thrown by enforce_free_*_cap triggers)
  if (msg.includes("pro_required:warehouse_items"))
    return "Batas 30 barang gudang pada paket Free sudah tercapai. Upgrade ke Pro untuk menambah lebih banyak.";
  if (msg.includes("pro_required:sales"))
    return "Batas 50 penjualan per 30 hari pada paket Free sudah tercapai. Upgrade ke Pro untuk lanjut menjual.";
  if (msg.includes("pro_required:staff_contacts"))
    return "Paket Free hanya mengizinkan 1 kontak pegawai. Upgrade ke Pro untuk menambah pegawai.";
  if (msg.includes("pro_required:user_devices"))
    return "Paket Free hanya mengizinkan 1 perangkat tepercaya. Upgrade ke Pro untuk multi-perangkat.";
  if (msg.includes("pro_required"))
    return "Fitur ini hanya untuk pelanggan Pro. Buka halaman Langganan untuk upgrade.";
  if (msg.includes("invalid login") || msg.includes("invalid credentials"))
    return "Email atau kata sandi salah.";
  if (msg.includes("email not confirmed"))
    return "Email belum dikonfirmasi.";
  if (msg.includes("user already registered") || msg.includes("already registered"))
    return "Akun sudah terdaftar.";
  if (msg.includes("password") && msg.includes("short"))
    return "Kata sandi terlalu pendek.";
  if (msg.includes("rate limit") || msg.includes("for security purposes"))
    return "Terlalu banyak percobaan. Tunggu sekitar 1 menit lalu coba lagi.";
  if (msg.includes("pwned") || msg.includes("breach") || msg.includes("compromised") ||
      (msg.includes("password") && msg.includes("weak")))
    return "Kata sandi terlalu lemah atau pernah bocor. Pakai kombinasi huruf, angka, dan simbol yang berbeda.";
  if (msg.includes("invalid") && msg.includes("email"))
    return "Format email tidak valid.";
  if (msg.includes("signup") && (msg.includes("disabled") || msg.includes("not allowed")))
    return "Pendaftaran sedang dinonaktifkan.";
  if (msg.includes("network") || msg.includes("fetch"))
    return "Gangguan koneksi. Periksa internet Anda.";

  // If we have a server message, surface it (trimmed) so the user has a clue
  // instead of a generic "try again" loop.
  if (e.message && e.message.length < 200) return e.message;
  return fallback;
}

/**
 * Tampilkan toast error yang ramah pengguna. Untuk error akses-ditolak,
 * otomatis lampirkan tombol "Perbaiki Akses" yang membuka `/profil`
 * (kartu upgrade akun) di tab yang sama. Prefix opsional (mis. "Gagal: ")
 * disisipkan sebelum pesan.
 */
export function notifyError(
  err: unknown,
  opts: { prefix?: string; fallback?: string } = {},
): string | number {
  const msg = (opts.prefix ?? "") + friendlyError(err, opts.fallback);
  if (isAccessDeniedError(err)) {
    const errorFields = extractErrorFields(err);
    const path =
      typeof window !== "undefined" ? window.location.pathname + window.location.search : undefined;
    emitAccessDenied({
      ts: new Date().toISOString(),
      phase: "toast-shown",
      ...errorFields,
      path,
      prefix: opts.prefix,
    });
    return toast.error(msg, {
      description:
        "Akun Anda mungkin masih MCM Chat saja. Buka Profil untuk upgrade ke MCM Storage.",
      action: {
        label: "Perbaiki Akses",
        onClick: () => {
          emitAccessDenied({
            ts: new Date().toISOString(),
            phase: "action-clicked",
            ...errorFields,
            path,
            prefix: opts.prefix,
          });
          if (typeof window !== "undefined") {
            window.location.assign("/profil");
          }
        },
      },
      duration: 8000,
    });
  }
  return toast.error(msg);
}