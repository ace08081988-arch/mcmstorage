// Helper bersama untuk menghitung "kotak siap" pada judul Ecer.
// Sumber data:
//   1) ecer_preparations (kotak yang dibuat di halaman Penyiapan Ecer)
//   2) self_prep_items (Siapkan Sendiri) yang judulnya cocok dengan
//      nama judul ecer atau nama produk gudangnya.

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function countMatchingSelfPreps(
  titleName: string,
  productName: string | null | undefined,
  selfTitles: Array<string | null | undefined>,
): number {
  const tName = norm(titleName);
  const pName = norm(productName);
  let n = 0;
  for (const raw of selfTitles) {
    const st = norm(raw);
    if (!st) continue;
    const hit =
      (tName.length > 0 && (st.includes(tName) || tName.includes(st))) ||
      (pName.length > 0 && pName !== "—" && st.includes(pName));
    if (hit) n += 1;
  }
  return n;
}

export const _normalizeForMatch = norm;