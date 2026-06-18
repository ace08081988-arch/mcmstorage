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
  }

  const msg = (e.message ?? "").toLowerCase();
  if (msg.includes("invalid login") || msg.includes("invalid credentials"))
    return "Email atau kata sandi salah.";
  if (msg.includes("email not confirmed"))
    return "Email belum dikonfirmasi.";
  if (msg.includes("user already registered") || msg.includes("already registered"))
    return "Akun sudah terdaftar.";
  if (msg.includes("password") && msg.includes("short"))
    return "Kata sandi terlalu pendek.";
  if (msg.includes("rate limit"))
    return "Terlalu banyak percobaan. Coba lagi sebentar.";
  if (msg.includes("network") || msg.includes("fetch"))
    return "Gangguan koneksi. Periksa internet Anda.";

  return fallback;
}