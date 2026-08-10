/**
 * Kunci HMAC untuk token kepemilikan push.
 *
 * Diturunkan dari service-role key yang memang hanya ada di server, jadi
 * tidak perlu secret baru (dan tidak boleh ada secret palsu). Bila kunci
 * server belum tersedia, pemanggil WAJIB fail-closed.
 */
export function pushOwnershipSecret(): string | null {
  const base =
    process.env["PUSH_OWNERSHIP_SECRET"] ??
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ??
    null;
  if (!base) return null;
  return `push-ownership:v1:${base}`;
}
