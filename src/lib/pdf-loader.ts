/**
 * Loader jsPDF yang bisa di-prefetch dan hanya mengunduh chunk sekali.
 *
 * Halaman Pratinjau Label butuh jsPDF (~390 KB) sebelum bisa menggambar
 * apa pun. Dengan memisahkan loader ke modul kecil ini, menu/link terkait
 * bisa memanggil `prefetchJsPDF()` saat pengguna baru "berniat" membuka
 * halaman (hover / focus / sentuh) sehingga saat halaman mount chunk-nya
 * sudah ada di cache — pratinjau muncul jauh lebih cepat.
 */
type JsPDFCtor = typeof import("jspdf")["jsPDF"];

let cached: JsPDFCtor | null = null;
let inflight: Promise<JsPDFCtor> | null = null;

export function isJsPDFReady(): boolean {
  return cached !== null;
}

export function loadJsPDF(): Promise<JsPDFCtor> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = import("jspdf")
      .then((m) => {
        cached = m.jsPDF;
        return cached;
      })
      .catch((e) => {
        inflight = null;
        throw e;
      });
  }
  return inflight;
}

/** Fire-and-forget — aman dipanggil berkali-kali, tidak melempar error. */
export function prefetchJsPDF(): void {
  void loadJsPDF().catch(() => {});
}
