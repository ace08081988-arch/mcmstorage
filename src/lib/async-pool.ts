/**
 * Peta async dengan batas konkurensi.
 *
 * Dipakai portal pegawai saat memproses banyak foto galeri sekaligus:
 * decode/compress 20 foto secara paralel penuh (Promise.all) memicu OOM /
 * jank berat di Android WebView. Dengan pool kecil (default 2), memori
 * puncak tetap rendah dan urutan hasil tetap sesuai urutan input.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const total = items.length;
  const results = new Array<R>(total);
  if (total === 0) return results;
  const max = Math.max(1, Math.min(Math.floor(limit) || 1, total));
  let next = 0;
  let failure: unknown = null;
  let failed = false;

  async function worker() {
    for (;;) {
      if (failed) return;
      const i = next++;
      if (i >= total) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        if (!failed) {
          failed = true;
          failure = e;
        }
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: max }, () => worker()));
  if (failed) throw failure;
  return results;
}
