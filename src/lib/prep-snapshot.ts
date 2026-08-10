/**
 * Perbandingan semantik snapshot tugas/item portal pegawai.
 *
 * silentRefresh berjalan tiap 15 detik. Tanpa perbandingan ini, setiap
 * respons (walau isinya identik) menghasilkan array/objek baru → setState →
 * SELURUH daftar kartu rerender. Bandingkan dulu; kalau sama, no-op.
 */
export function sameSnapshotValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!sameSnapshotValue(a[i], b[i])) return false;
    }
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  const kb = Object.keys(rb);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(rb, k)) return false;
    if (!sameSnapshotValue(ra[k], rb[k])) return false;
  }
  return true;
}
