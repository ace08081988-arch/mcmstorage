// Helper bersama untuk menghitung "kotak siap" pada judul Ecer.
// Sumber data:
//   1) ecer_preparations (kotak yang dibuat di halaman Penyiapan Ecer)
//   2) self_prep_items (Siapkan Sendiri) yang judulnya cocok PRESISI dengan
//      judul ecer: harus memuat nama produk gudang DAN takaran/satuan yang
//      sama dengan target_grams + unit_label judul ecer.
//
// Contoh untuk judul "KRISTAL 1 G" (target_grams=1, unit_label="gram"):
//   "KRISTAL 1 gram"      ✅ cocok
//   "Kristal 1g"          ✅ cocok
//   "KRISTAL 5 G"         ❌ takaran beda
//   "Maps 1 gram"         ❌ produk beda
//   "KRISTAL ST"          ❌ tanpa takaran 1 g

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// Keluarga satuan: "g" | "gram" | "gr" -> "g", "kg" -> "kg", lainnya apa adanya.
function unitFamily(u: string): string {
  const x = norm(u);
  if (x === "g" || x === "gr" || x === "gram" || x === "grams") return "g";
  if (x === "kg" || x === "kilogram" || x === "kilograms") return "kg";
  return x;
}

// Ekstrak pasangan {value, family} dari teks bebas, mis. "kristal 1 gram" -> [{1,"g"}].
function extractQuantities(text: string): Array<{ value: number; family: string }> {
  const out: Array<{ value: number; family: string }> = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(kg|kilograms?|grams?|gr|g)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(value)) out.push({ value, family: unitFamily(m[2]) });
  }
  return out;
}

// Cek apakah `productName` muncul sebagai kata utuh di `text` (case-insensitive).
function containsWord(text: string, word: string): boolean {
  const t = norm(text);
  const w = norm(word);
  if (!w || w === "—") return false;
  // word boundary versi sederhana: harus dikelilingi non-alfanumerik atau ujung string.
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(t);
}

export function countMatchingSelfPreps(
  titleName: string,
  productName: string | null | undefined,
  selfTitles: Array<string | null | undefined>,
  targetGrams?: number | null,
  unitLabel?: string | null,
): number {
  const pName = norm(productName);
  const targetFamily = unitLabel ? unitFamily(unitLabel) : "g";
  const hasTarget = typeof targetGrams === "number" && Number.isFinite(targetGrams) && targetGrams > 0;

  let n = 0;
  for (const raw of selfTitles) {
    const st = norm(raw);
    if (!st) continue;

    // 1) Produk harus disebut (kata utuh) di judul Siapkan Sendiri.
    if (!containsWord(st, pName)) continue;

    // 2) Takaran harus cocok bila judul ecer punya target_grams.
    if (hasTarget) {
      const qtys = extractQuantities(st);
      const ok = qtys.some(
        (q) => q.family === targetFamily && Math.abs(q.value - (targetGrams as number)) < 1e-6,
      );
      if (!ok) continue;
    } else {
      // Tanpa target: fallback ke kecocokan nama judul utuh.
      if (!st.includes(norm(titleName))) continue;
    }

    n += 1;
  }
  return n;
}

export const _normalizeForMatch = norm;