/**
 * Validasi nama berkas APK sebelum dirilis ke publik.
 *
 * Konvensi yang dipakai halaman /download:
 *   - Nama harus berakhiran `.apk` (case-insensitive).
 *   - Varian **chat** wajib memuat token `chat` yang berdiri sendiri
 *     (dibatasi `-`, `_`, `.`, atau awal/akhir nama), mis. `mcm-chat-v1.2.3-45.apk`.
 *   - Varian **storage** tidak boleh mengandung token `chat`.
 *   - Nama sebaiknya mengandung versi (`vX.Y[.Z]`) dan build number
 *     supaya kartu unduhan bisa menampilkan info versi.
 *   - Tidak boleh ada spasi atau karakter di luar `[A-Za-z0-9._+()-]`.
 */

export type ApkNameVariant = "storage" | "chat";

export type ApkNameSeverity = "ok" | "warn" | "error";

export type ApkNameIssue = {
  code:
    | "not_apk"
    | "has_space"
    | "bad_char"
    | "uppercase"
    | "no_version"
    | "no_build"
    | "chat_missing_token"
    | "chat_ambiguous"
    | "storage_has_chat_token";
  severity: ApkNameSeverity;
  message: string;
};

export type ApkNameValidation = {
  severity: ApkNameSeverity;
  variant: ApkNameVariant;
  issues: ApkNameIssue[];
  suggestion: string;
};

const CHAT_TOKEN = /(^|[-_.])chat([-_.]|$)/i;
const VERSION_RE = /(?:^|[^\d])v?\d+\.\d+(?:\.\d+){0,2}/i;
const BUILD_RE = /(?:build|b|\+|\()\s*\d+\)?|[._-]\d{1,4}(?!\d)/i;
const ALLOWED_CHARS = /^[A-Za-z0-9._+()\-]+$/;

export function detectApkVariant(name: string): ApkNameVariant {
  return CHAT_TOKEN.test(name) ? "chat" : "storage";
}

export function validateApkFileName(
  name: string,
  expected?: ApkNameVariant,
): ApkNameValidation {
  const issues: ApkNameIssue[] = [];
  const detected = detectApkVariant(name);
  const variant = expected ?? detected;

  if (!/\.apk$/i.test(name)) {
    issues.push({
      code: "not_apk",
      severity: "error",
      message: "Nama harus berakhiran .apk",
    });
  }
  if (/\s/.test(name)) {
    issues.push({
      code: "has_space",
      severity: "error",
      message: "Nama tidak boleh mengandung spasi.",
    });
  }
  if (!ALLOWED_CHARS.test(name)) {
    issues.push({
      code: "bad_char",
      severity: "warn",
      message:
        "Nama sebaiknya hanya berisi huruf, angka, dan simbol . _ - + ( ).",
    });
  }
  if (/[A-Z]/.test(name)) {
    issues.push({
      code: "uppercase",
      severity: "warn",
      message: "Disarankan pakai huruf kecil untuk konsistensi URL.",
    });
  }
  if (!VERSION_RE.test(name)) {
    issues.push({
      code: "no_version",
      severity: "warn",
      message: "Tidak ada pola versi (mis. v1.2.3). Info versi tidak akan muncul.",
    });
  }
  if (!BUILD_RE.test(name)) {
    issues.push({
      code: "no_build",
      severity: "warn",
      message: "Tidak ada build number (mis. -45 atau (45)).",
    });
  }

  if (variant === "chat") {
    if (!CHAT_TOKEN.test(name)) {
      issues.push({
        code: "chat_missing_token",
        severity: "error",
        message:
          "Berkas chat wajib memuat kata `chat` yang terpisah, mis. `mcm-chat-v1.0.0-1.apk`.",
      });
    }
    if (/storage/i.test(name)) {
      issues.push({
        code: "chat_ambiguous",
        severity: "error",
        message:
          "Nama memuat `chat` dan `storage` sekaligus — pilih salah satu supaya varian tidak ambigu.",
      });
    }
  } else {
    if (CHAT_TOKEN.test(name)) {
      issues.push({
        code: "storage_has_chat_token",
        severity: "error",
        message:
          "Berkas storage tidak boleh memuat token `chat` — halaman /download akan salah mengelompokkan.",
      });
    }
  }

  const severity: ApkNameSeverity = issues.some((i) => i.severity === "error")
    ? "error"
    : issues.some((i) => i.severity === "warn")
      ? "warn"
      : "ok";

  const suggestion =
    variant === "chat"
      ? "Contoh nama valid: mcm-chat-v1.0.0-1.apk"
      : "Contoh nama valid: mcm-storage-v1.0.0-1.apk";

  return { severity, variant, issues, suggestion };
}