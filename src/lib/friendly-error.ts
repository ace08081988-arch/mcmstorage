// Maps backend errors to safe, user-facing Indonesian messages.
// Avoid leaking raw PostgreSQL / Supabase error text (constraint names,
// table/column identifiers) into toasts. Full details are still visible
// in browser devtools / server logs for debugging.
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
    case "23503": return "Data terkait tidak ditemukan.";
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