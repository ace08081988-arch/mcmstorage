/**
 * Deteksi kemiripan kontak untuk mapping pelanggan/supplier.
 *
 * Tujuan: mencegah satu orang yang sama terdaftar dua kali dengan ejaan
 * berbeda ("Pak Budi" vs "budi ") atau nomor telepon sama tapi nama beda.
 * Murni util frontend — tidak menyentuh data.
 */

export type PartyKind = "customer" | "supplier" | "debt";

export type PartyCandidate = {
  id: string;
  name: string;
  contact?: string | null;
  kind: PartyKind;
};

export type DupMatch = {
  candidate: PartyCandidate;
  /** 0..1, makin besar makin mirip. */
  score: number;
  reason: "phone" | "name";
};

/** Normalisasi nama: lowercase, buang gelar/panggilan umum & tanda baca. */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\b(pak|bu|bpk|ibu|mas|mbak|kak|h|hj|toko|tk|cv|pt|ud)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ambil digit telepon (>=8 digit) dari sebuah teks bebas. */
export function extractPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D+/g, "");
  if (digits.length < 8) return null;
  return digits.slice(-9);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Skor kemiripan nama 0..1 (gabungan token overlap + jarak edit). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const overlap = shared / Math.max(ta.size, tb.size);
  const dist = levenshtein(na, nb);
  const edit = 1 - dist / Math.max(na.length, nb.length);
  const contains = na.includes(nb) || nb.includes(na) ? 0.85 : 0;
  return Math.max(overlap, edit, contains);
}

export const DUP_THRESHOLD = 0.72;

/** Cari kandidat duplikat untuk sebuah nama kontak baru. */
export function findDuplicates(
  title: string,
  candidates: PartyCandidate[],
  threshold = DUP_THRESHOLD,
): DupMatch[] {
  const phone = extractPhone(title);
  const out: DupMatch[] = [];
  for (const c of candidates) {
    const cPhone = extractPhone(c.contact) ?? extractPhone(c.name);
    if (phone && cPhone && phone === cPhone) {
      out.push({ candidate: c, score: 1, reason: "phone" });
      continue;
    }
    const score = nameSimilarity(title, c.name);
    if (score >= threshold) out.push({ candidate: c, score, reason: "name" });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function kindLabel(kind: PartyKind): string {
  if (kind === "customer") return "Pelanggan";
  if (kind === "supplier") return "Supplier";
  return "Buku hutang";
}
