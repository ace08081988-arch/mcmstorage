/**
 * Diff antar dua struktur JSON pada level baris (setelah di-stringify).
 * Implementasi ringan berbasis LCS (Longest Common Subsequence) — cukup
 * untuk preview snapshot puluhan-ratusan baris; jangan dipakai untuk file
 * multi-MB.
 */

export type DiffLine = {
  kind: "same" | "add" | "del";
  /** Nomor baris di sisi kiri (before) jika ada. */
  left: number | null;
  /** Nomor baris di sisi kanan (after) jika ada. */
  right: number | null;
  text: string;
};

export type DiffStats = { added: number; removed: number; unchanged: number };

function stringifyStable(value: unknown): string {
  // JSON.stringify dgn indent 2; kunci diurut alfabetis biar diff stabil
  // walau properti ditulis dalam urutan berbeda antar versi.
  return JSON.stringify(value, sortReplacer(), 2);
}

function sortReplacer() {
  return (_key: string, val: unknown) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const rec = val as Record<string, unknown>;
      return Object.fromEntries(Object.keys(rec).sort().map((k) => [k, rec[k]]));
    }
    return val;
  };
}

/** Diff dua nilai JSON. Kembalikan daftar baris terurut & statistik. */
export function diffJsonLines(
  before: unknown,
  after: unknown,
): { lines: DiffLine[]; stats: DiffStats } {
  const a = stringifyStable(before).split("\n");
  const b = stringifyStable(after).split("\n");
  return diffLines(a, b);
}

function diffLines(a: string[], b: string[]): { lines: DiffLine[]; stats: DiffStats } {
  const n = a.length;
  const m = b.length;
  // Bangun tabel LCS.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", left: i + 1, right: j + 1, text: a[i] });
      stats.unchanged++;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", left: i + 1, right: null, text: a[i] });
      stats.removed++;
      i++;
    } else {
      out.push({ kind: "add", left: null, right: j + 1, text: b[j] });
      stats.added++;
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: "del", left: i + 1, right: null, text: a[i] });
    stats.removed++;
    i++;
  }
  while (j < m) {
    out.push({ kind: "add", left: null, right: j + 1, text: b[j] });
    stats.added++;
    j++;
  }
  return { lines: out, stats };
}