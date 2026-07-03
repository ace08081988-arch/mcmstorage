import type { Page, Request } from "@playwright/test";

/**
 * Guard "tidak ada request tambahan" untuk spec yang MEMAKAI backend
 * asli (mis. `chat-pin-mcm-copy-export`) — tidak seperti APK stub yang
 * meng-fulfill respons deterministik, guard ini hanya PASSTHROUGH:
 *
 *   - Menghitung setiap request ke `**\/_serverFn/**` yang melewati
 *     Playwright network layer.
 *   - Tidak pernah `route.fulfill` / `route.abort` — request tetap
 *     diteruskan ke server asli via `route.continue()`.
 *
 * Cocok untuk mendeteksi kebocoran refetch pada aksi lokal (copy,
 * export, toggle UI) yang HARUS tidak memicu round-trip ke server.
 * Semantik `assertNoAdditionalRequests` sengaja disamakan dengan
 * `ApkStub.assertNoAdditionalRequests` supaya spec bisa dipindahkan
 * antar helper tanpa mengubah bentuk pemanggilan:
 *
 *   const guard = await installServerFnPassthroughGuard(page);
 *   await guard.assertNoAdditionalRequests(
 *     async () => { await copyBtn.click(); },
 *     { windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
 *   );
 *
 * Berbeda dari APK stub:
 *   - Tidak ada konsep `variant` (chat/storage) — hitungan flat.
 *   - Tidak ada antrian respons; test tetap butuh data server asli.
 *   - `expected` adalah angka tunggal (bukan per-variant).
 */

export type PassthroughIgnoreInfo = {
  url: string;
  method: string;
  /** Nomor request ke-N (1-based) sejak snapshot terakhir. */
  nthSinceSnapshot: number;
  /** Total request server-fn sejak guard dipasang. */
  totalRequested: number;
};

export type PassthroughAssertOpts = {
  /** Trailing window setelah aksi. Default 500ms. */
  windowMs?: number;
  /** Whitelist kuantitatif: berapa request diperbolehkan. Default 0. */
  expected?: number;
  /** Predikat kustom untuk mengecualikan request tertentu. */
  ignore?: (info: PassthroughIgnoreInfo) => boolean;
};

export type ServerFnPassthroughGuard = {
  /** Jumlah request server-fn yang tercatat sejak guard dipasang. */
  totalCount: () => number;
  /** Salinan URL request terakhir (untuk debug). */
  getRecentRequests: (tail?: number) => Array<{ url: string; method: string; at: number }>;
  /**
   * Verifikasi tidak ada request `**\/_serverFn/**` tambahan selama
   * aksi + trailing window. Dua bentuk pemakaian:
   *
   *   // (a) Pembungkus aksi
   *   await guard.assertNoAdditionalRequests(
   *     async () => { await copyBtn.click(); },
   *     { windowMs: 500 },
   *   );
   *
   *   // (b) Standalone terminal guard di akhir spec
   *   await guard.assertNoAdditionalRequests({ windowMs: 750 });
   */
  assertNoAdditionalRequests: (
    ...args:
      | [action: () => Promise<void>, opts?: PassthroughAssertOpts]
      | [opts?: PassthroughAssertOpts]
  ) => Promise<void>;
  /** Lepaskan route handler (dipanggil di akhir test jika diperlukan). */
  dispose: () => Promise<void>;
};

export async function installServerFnPassthroughGuard(
  page: Page,
): Promise<ServerFnPassthroughGuard> {
  const t0 = Date.now();
  const entries: Array<{ url: string; method: string; at: number }> = [];
  const LOG_CAP = 100;
  type Listener = (url: string, method: string) => void;
  const listeners: Listener[] = [];

  const handler = async (route: import("@playwright/test").Route) => {
    const req: Request = route.request();
    const url = req.url();
    const method = req.method();
    entries.push({ url, method, at: Date.now() - t0 });
    if (entries.length > LOG_CAP) entries.shift();
    for (const fn of listeners.slice()) fn(url, method);
    await route.continue();
  };

  await page.route("**/_serverFn/**", handler);

  const formatTail = (tail = 10): string => {
    if (entries.length === 0) return "  (belum ada request server-fn)";
    return entries
      .slice(-Math.max(1, tail))
      .map(
        (e) =>
          `  [+${String(e.at).padStart(5, " ")}ms] ${e.method.padEnd(5)} ${e.url}`,
      )
      .join("\n");
  };

  async function runGuard(
    opts: PassthroughAssertOpts | undefined,
    action: (() => Promise<void>) | undefined,
  ): Promise<void> {
    const windowMs = opts?.windowMs ?? 500;
    const expected = opts?.expected ?? 0;
    const ignoreFn = opts?.ignore;

    const snap = entries.length;
    let sinceSnapshot = 0;
    type Entry = {
      url: string;
      method: string;
      nth: number;
      at: number;
      reason: "allowed:expected" | "allowed:ignore" | "leak";
    };
    const classified: Entry[] = [];

    const listener: Listener = (url, method) => {
      sinceSnapshot += 1;
      const nth = sinceSnapshot;
      const info: PassthroughIgnoreInfo = {
        url,
        method,
        nthSinceSnapshot: nth,
        totalRequested: entries.length,
      };
      let reason: Entry["reason"];
      if (nth <= expected) reason = "allowed:expected";
      else if (ignoreFn && ignoreFn(info)) reason = "allowed:ignore";
      else reason = "leak";
      classified.push({
        url,
        method,
        nth,
        at: Date.now() - t0,
        reason,
      });
    };
    listeners.push(listener);
    const cleanup = () => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };

    const failIfLeaked = (phase: string) => {
      const leaks = classified.filter((e) => e.reason === "leak");
      if (leaks.length === 0) return;
      const summary = leaks
        .map((l) => `#${l.nth} ${l.method} ${l.url}@+${l.at}ms`)
        .join(", ");
      throw new Error(
        `[serverfn-passthrough] assertNoAdditionalRequests GAGAL ` +
          `(${phase}): ${leaks.length} request bocor [${summary}] ` +
          `(expected=${expected}, total ${snap}→${entries.length}).` +
          `\n  Log request terakhir:\n${formatTail(15)}`,
      );
    };

    try {
      if (action) {
        await action();
        failIfLeaked("selama aksi");
      }
      // Trailing window — hanya bounded upper bound; keluar lebih awal
      // begitu leak terdeteksi.
      await new Promise<void>((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          resolve();
        }, windowMs);
        const trailingListener: Listener = () => {
          if (done) return;
          if (!classified.some((e) => e.reason === "leak")) return;
          done = true;
          clearTimeout(timer);
          const idx = listeners.indexOf(trailingListener);
          if (idx >= 0) listeners.splice(idx, 1);
          resolve();
        };
        listeners.push(trailingListener);
      });
      failIfLeaked(`trailing ${windowMs}ms`);
      if (expected > 0 && sinceSnapshot < expected) {
        throw new Error(
          `[serverfn-passthrough] assertNoAdditionalRequests GAGAL: ` +
            `expected=${expected} tetapi hanya ${sinceSnapshot} request ` +
            `masuk selama aksi + trailing ${windowMs}ms.` +
            `\n  Log request terakhir:\n${formatTail(15)}`,
        );
      }
    } finally {
      cleanup();
    }
  }

  return {
    totalCount: () => entries.length,
    getRecentRequests: (tail = 10) =>
      entries.slice(-Math.max(1, tail)).map((e) => ({ ...e })),
    async assertNoAdditionalRequests(...args) {
      let action: (() => Promise<void>) | undefined;
      let opts: PassthroughAssertOpts | undefined;
      if (typeof args[0] === "function") {
        action = args[0] as () => Promise<void>;
        opts = args[1] as typeof opts;
      } else {
        opts = args[0] as typeof opts;
      }
      await runGuard(opts, action);
    },
    async dispose() {
      await page.unroute("**/_serverFn/**", handler);
    },
  };
}