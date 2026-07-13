// Deep link handler untuk APK Android (Capacitor).
//
// Mendukung dua bentuk URL yang dikirim OS ke aplikasi:
//   1) Custom scheme  : biz.mcmstorage.app://t/<share_token>?p=<pin>
//   2) Android App Link: https://mcmstorage.biz/t/<share_token>?p=<pin>
//      (atau menggunakan fragment #p=<pin>)
//
// Tujuannya: begitu OS memicu URL, aplikasi langsung menuju
// /t/<share_token>#p=<pin> — route worker portal sudah menangani
// pengisian PIN otomatis dari fragment tersebut.

type DeepLinkRouter = {
  navigate: (opts: { to: string; hash?: string }) => unknown;
};

function extractPin(u: URL): string | null {
  // Prioritas 1: query ?p=1234 (mudah diteruskan lewat scanner/OS).
  const q = u.searchParams.get("p");
  if (q && /^\d{4,8}$/.test(q)) return q;
  // Prioritas 2: fragment #p=1234 — format share URL /t/... existing.
  const hash = u.hash.replace(/^#/, "");
  const m = hash.match(/(?:^|&)p=(\d{4,8})/);
  return m ? m[1] : null;
}

function extractToken(u: URL): string | null {
  // biz.mcmstorage.app://t/<token>  → host="t", path="/<token>"
  // https://mcmstorage.biz/t/<token> → path="/t/<token>"
  const parts = u.pathname.split("/").filter(Boolean);
  if (u.protocol === "biz.mcmstorage.app:" || u.host === "t") {
    // host bisa "t" (custom scheme) ATAU path segment pertama = "t"
    if (u.host === "t") return parts[0] ?? null;
    if (parts[0] === "t") return parts[1] ?? null;
    return parts[0] ?? null;
  }
  const idx = parts.indexOf("t");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

export function parseDeepLink(rawUrl: string): { token: string; pin: string | null } | null {
  try {
    const u = new URL(rawUrl);
    const token = extractToken(u);
    if (!token) return null;
    return { token, pin: extractPin(u) };
  } catch {
    return null;
  }
}

export async function startDeepLinkListener(router: DeepLinkRouter) {
  if (typeof window === "undefined") return;
  let App: typeof import("@capacitor/app").App | null = null;
  try {
    const mod = await import("@capacitor/app");
    App = mod.App;
  } catch {
    return; // web/PWA — deep link native tidak berlaku
  }
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return;

  const handle = (rawUrl: string) => {
    const parsed = parseDeepLink(rawUrl);
    if (!parsed) return;
    const path = `/t/${encodeURIComponent(parsed.token)}`;
    const hash = parsed.pin ? `#p=${parsed.pin}` : "";
    try {
      router.navigate({ to: path, hash: hash.replace(/^#/, "") || undefined });
    } catch {
      window.location.assign(`${path}${hash}`);
    }
  };

  // URL saat app di-cold start dari intent
  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) handle(launch.url);
  } catch { /* ignore */ }

  // URL saat app sudah berjalan lalu menerima intent baru
  App.addListener("appUrlOpen", (evt) => {
    if (evt?.url) handle(evt.url);
  });
}