/**
 * Validasi input editor minSupported (semver + build) di halaman
 * Pengaturan APK. Dipakai klien-side untuk menolak input tidak valid
 * sebelum mengirim ke server (server juga memvalidasi lagi).
 */

export type FieldError = { ok: true } | { ok: false; error: string };

/**
 * Validasi min_version_name. Format yang diterima:
 *   MAJOR.MINOR[.PATCH[.EXTRA]]
 * Semua segmen wajib angka desimal tanpa prefix, tanpa suffix
 * prerelease/build. Kosong berarti "tidak diperiksa" (valid).
 */
export function validateMinVersionName(raw: string): FieldError {
  const v = raw.trim();
  if (!v) return { ok: true };
  if (/^v/i.test(raw)) {
    return { ok: false, error: "Jangan pakai prefix 'v' (mis. tulis 1.2.0)" };
  }
  if (/[-+]/.test(v)) {
    return {
      ok: false,
      error: "Tidak boleh ada suffix prerelease/build (mis. -beta, +build)",
    };
  }
  if (!/^\d+(\.\d+){1,3}$/.test(v)) {
    return {
      ok: false,
      error: "Format harus MAJOR.MINOR[.PATCH] angka saja (mis. 1.2.3)",
    };
  }
  const parts = v.split(".").map((s) => Number.parseInt(s, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 99999)) {
    return { ok: false, error: "Setiap segmen harus 0–99999" };
  }
  return { ok: true };
}

/**
 * Validasi min_version_code. Kosong berarti "tidak diperiksa" (valid).
 * Harus bilangan bulat ≥ 0 dan ≤ 2_100_000_000 (batas Android versionCode).
 */
export function validateMinVersionCode(raw: string): FieldError {
  const v = raw.trim();
  if (!v) return { ok: true };
  if (!/^\d+$/.test(v)) {
    return { ok: false, error: "Harus bilangan bulat non-negatif (mis. 45)" };
  }
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: "Harus bilangan bulat ≥ 0" };
  }
  if (n > 2_100_000_000) {
    return {
      ok: false,
      error: "Melebihi batas versionCode Android (≤ 2.100.000.000)",
    };
  }
  return { ok: true };
}

/** Validasi reason: opsional, maksimum 200 karakter setelah trim. */
export function validateMinReason(raw: string): FieldError {
  if (raw.length > 200) {
    return { ok: false, error: "Alasan maksimum 200 karakter" };
  }
  return { ok: true };
}

export type MinSupportedFormErrors = {
  name: string | null;
  code: string | null;
  reason: string | null;
  form: string | null;
};

/**
 * Validasi seluruh form. Mengembalikan pesan per-field dan pesan level
 * form (mis. "isi minimal salah satu"). Semua null = valid & siap simpan.
 */
export function validateMinSupportedForm(input: {
  name: string;
  code: string;
  reason: string;
}): MinSupportedFormErrors {
  const name = validateMinVersionName(input.name);
  const code = validateMinVersionCode(input.code);
  const reason = validateMinReason(input.reason);
  const nameEmpty = !input.name.trim();
  const codeEmpty = !input.code.trim();
  // Boleh kedua-duanya kosong (artinya "hapus minimum"). Tapi jika reason
  // diisi tanpa min sama sekali, itu tidak masuk akal.
  const reasonWithoutMin = !!input.reason.trim() && nameEmpty && codeEmpty;
  return {
    name: name.ok ? null : name.error,
    code: code.ok ? null : code.error,
    reason: reason.ok ? null : reason.error,
    form: reasonWithoutMin
      ? "Alasan hanya berlaku bila minimum versi atau build diisi"
      : null,
  };
}

export function hasAnyError(e: MinSupportedFormErrors): boolean {
  return !!(e.name || e.code || e.reason || e.form);
}