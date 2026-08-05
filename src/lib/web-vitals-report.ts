/**
 * Pemantauan Core Web Vitals lapangan (RUM) untuk halaman katalog publik.
 *
 * Diukur di perangkat pengunjung nyata memakai `web-vitals` (LCP, CLS, INP,
 * TTFB, FCP), lalu dikirim fire-and-forget ke `/api/public/web-vitals`.
 * Pengiriman memakai `sendBeacon` supaya tetap terkirim saat tab ditutup —
 * nilai CLS/INP final baru diketahui persis pada saat itu.
 *
 * Tidak ada PII yang dikirim: hanya jenis halaman, slug toko, jenis
 * perangkat, tipe navigasi, dan label build (untuk tren sebelum-sesudah).
 */

export type VitalsPage = "katalog_list" | "katalog_detail";

const ENDPOINT = "/api/public/web-vitals";

type Payload = {
  page: VitalsPage;
  slug: string | null;
  metric: string;
  value: number;
  rating: string;
  navType: string | null;
  device: "mobile" | "desktop" | "unknown";
  releaseTag: string | null;
};

function device(): Payload["device"] {
  if (typeof window === "undefined") return "unknown";
  return window.matchMedia?.("(max-width: 767px)").matches ? "mobile" : "desktop";
}

function releaseTag(): string | null {
  try {
    return typeof __BUILD_ID__ === "string" ? __BUILD_ID__.slice(0, 64) : null;
  } catch {
    return null;
  }
}

function send(payload: Payload) {
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* jatuh ke fetch di bawah */
  }
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Pasang pengukur untuk satu tampilan halaman. Aman dipanggil dari
 * `useEffect`; mengembalikan fungsi pembersih (no-op — `web-vitals` sendiri
 * hanya melapor sekali per metrik per pemuatan halaman).
 */
export function reportCatalogVitals(page: VitalsPage, slug: string | null) {
  if (typeof window === "undefined") return () => undefined;
  let cancelled = false;

  void import("web-vitals")
    .then(({ onCLS, onINP, onLCP, onTTFB, onFCP }) => {
      if (cancelled) return;
      const tag = releaseTag();
      const dev = device();
      const handle = (m: {
        name: string;
        value: number;
        rating: string;
        navigationType?: string;
      }) => {
        if (cancelled) return;
        // CLS tak berdimensi (dikirim apa adanya); metrik lain milidetik.
        const value = m.name === "CLS" ? Math.round(m.value * 1000) / 1000 : Math.round(m.value);
        send({
          page,
          slug: slug ? slug.slice(0, 48) : null,
          metric: m.name,
          value,
          rating: m.rating,
          navType: m.navigationType ?? null,
          device: dev,
          releaseTag: tag,
        });
      };
      onLCP(handle);
      onCLS(handle);
      onINP(handle);
      onTTFB(handle);
      onFCP(handle);
    })
    .catch(() => undefined);

  return () => {
    cancelled = true;
  };
}