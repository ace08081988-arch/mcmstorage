import type { Page, Route } from "@playwright/test";

/**
 * Helper deterministik untuk men-stub `getApkVariantDetail` di harness
 * `/lovable/visual/apk-availability-shortcuts`.
 *
 * Alih-alih memakai variabel `let flag = false` yang di-flip di tengah
 * test (rawan race: request bisa berangkat sebelum/ setelah flag
 * berubah — non-deterministik di CI yang lambat), tiap varian punya
 * antrian respons yang eksplisit:
 *
 *   const stub = await installApkStub(page);
 *   stub.enqueue("chat", []);          // untuk fetch awal
 *   stub.enqueue("storage", []);
 *   await page.goto(URL);
 *   // ... assert idle
 *   stub.enqueue("storage", [release]);// untuk refetch setelah tap
 *   await refresh.click();
 *   // ... assert aktif
 *
 * Handler HANYA membalas ketika ada item di antrian: kalau tidak ada,
 * request menunggu sampai `enqueue` dipanggil. Ini menghilangkan race
 * antara "flip flag" vs "kirim request" — test tidak pernah bergantung
 * pada urutan wall-clock antara `flag = true` dan handler membaca flag.
 *
 * `waitIdle` mengembalikan promise yang resolve saat SEMUA antrian
 * habis DAN tidak ada waiter yang tertahan — berguna untuk memastikan
 * fase awal (initial fetch) sudah dikonsumsi sebelum melanjutkan.
 */

export type ApkRelease = {
  name: string;
  url: string;
  sizeMB: number | null;
  updatedAt: string | null;
  versionName: string | null;
  versionCode: number | null;
  belowMinimum: boolean;
};

export type ApkVariant = "chat" | "storage";

/** Satu event yang tercatat di log helper (relatif thd install time). */
export type ApkStubEvent = {
  /** Milidetik sejak `installApkStub` dipanggil. */
  t: number;
  variant: ApkVariant;
  type: "request" | "served" | "hold" | "enqueue";
  requested: number;
  served: number;
  queued: number;
  holding: number;
  /** Info opsional (mis. URL request atau ukuran payload). */
  note?: string;
};

export function makeRelease(variant: ApkVariant): ApkRelease {
  const label = variant === "chat" ? "MCM-Chat" : "MCM-Storage";
  return {
    name: `${label}-1.0.0.apk`,
    url: `https://example.test/${label}-1.0.0.apk`,
    sizeMB: 12,
    updatedAt: "2026-07-03T00:00:00.000Z",
    versionName: "1.0.0",
    versionCode: 1,
    belowMinimum: false,
  };
}

export function makeDetail(
  variant: ApkVariant,
  releases: ApkRelease[],
): Record<string, unknown> {
  return {
    variant,
    title: variant === "chat" ? "MCM Chat" : "MCM Storage",
    subtitle: "Harness stub.",
    latest: releases[0] ?? null,
    releases,
    changelog: null,
    minSupported: null,
  };
}

type PendingWaiter = (releases: ApkRelease[]) => void;

export type ApkStub = {
  enqueue: (variant: ApkVariant, releases: ApkRelease[]) => void;
  /** Jumlah request yang selesai di-fulfill per varian. */
  servedCount: (variant: ApkVariant) => number;
  /** Jumlah request yang sudah TIBA di handler (belum tentu di-fulfill). */
  requestedCount: (variant: ApkVariant) => number;
  /** Jumlah antrian tersisa & waiter yang belum dilayani. */
  pending: () => { chat: number; storage: number; waiters: number };
  /**
   * Enqueue respons untuk fetch AWAL kedua varian (dipanggil SEBELUM
   * `page.goto`). Default: kedua varian kosong. Menetapkan flag
   * `primed=true` yang divalidasi oleh {@link assertPrimed}.
   */
  primeInitial: (
    chatReleases?: ApkRelease[],
    storageReleases?: ApkRelease[],
  ) => void;
  /**
   * Penegasan bahwa halaman siap dinavigasi. Wajib dipanggil TEPAT
   * sebelum `page.goto(URL)` di setiap spec — melempar error kalau
   * `primeInitial` belum dipanggil atau salah satu antrian awal
   * (chat / storage) belum terisi. Mencegah race di mana test lupa
   * setup dan initial fetch tergantung menunggu waiter selamanya.
   */
  assertPrimed: () => void;
  /**
   * Ambil salinan log event mentah — pemakai boleh memfilter,
   * memformat, atau menaruh di attach Playwright.
   */
  getEventLog: () => ApkStubEvent[];
  /**
   * Format ringkas `tail` event terakhir sebagai string multi-baris
   * — dipakai internal oleh `assertQuiescent` untuk melampirkan
   * konteks di pesan error. Tersedia publik supaya spec boleh
   * juga `console.log(stub.formatEventLog())` saat men-debug.
   */
  formatEventLog: (tail?: number) => string;
  /**
   * Menunggu handler menerima request ke-`n` untuk `variant` (event
   * "request tiba" — sebelum fulfill). Deterministik: berbasis event
   * counter internal, bukan `page.waitForTimeout` / `expect.poll`.
   * Cocok untuk assertion state "checking/busy" — pastikan request
   * benar-benar sampai di handler sebelum mengukur UI, tanpa
   * bergantung wall-clock CI.
   *
   * @param variant "chat" atau "storage"
   * @param n       nomor request ke-N (1-based). Default 1.
   * @param timeoutMs default 10_000 ms (bukan sleep; hanya batas atas
   *                  agar test tidak hang selamanya kalau logika salah).
   */
  waitForRequest: (
    variant: ApkVariant,
    n?: number,
    timeoutMs?: number,
  ) => Promise<void>;
  /**
   * Menunggu handler SELESAI fulfill request ke-`n` untuk `variant`
   * (event "served" — setelah `route.fulfill`). Deterministik,
   * berbasis event counter — dipakai untuk assertion "tepat N refetch
   * per tap" tanpa `expect.poll` yang bergantung timing.
   */
  waitForServed: (
    variant: ApkVariant,
    n: number,
    timeoutMs?: number,
  ) => Promise<void>;
  /**
   * Menunggu handler menahan waiter untuk `variant` (request tiba
   * TAPI antrian kosong → handler menunggu enqueue). Dipakai untuk
   * pola "hold → release": test yakin request sudah sampai di
   * handler dan sedang digantung SEBELUM mengukur state UI
   * (mis. "Memeriksa…") lalu `enqueue` untuk melepaskan.
   */
  waitForHold: (variant: ApkVariant, timeoutMs?: number) => Promise<void>;
  /**
   * Penegasan "quiescent": setelah state aktif tercapai, verifikasi
   * bahwa TIDAK ada request tambahan untuk `variant` selama jendela
   * `windowMs` (default 1000 ms). Alur:
   *
   *   1. Cek handler kosong — antrian & waiter untuk varian ini = 0
   *      dan `requestedCount === servedCount` (tidak ada request yang
   *      sedang diproses / tergantung).
   *   2. Snapshot `requestedCount` & `servedCount`.
   *   3. Coba `waitForRequest(varian, requested+1, windowMs)` — kalau
   *      resolve berarti ADA request tambahan → lempar error.
   *   4. Setelah timeout jendela lewat (tidak ada request masuk),
   *      verifikasi counter TETAP sama dengan snapshot.
   *
   * Timeout `windowMs` di sini adalah bounded upper-bound untuk
   * MEMBUKTIKAN absence (bukan sleep untuk sinkronisasi alur test).
   */
  assertQuiescent: (
    variant: ApkVariant,
    opts?: {
      windowMs?: number;
      /**
       * Setelah jendela `windowMs` lewat tanpa request tambahan,
       * verifikasi `requestedCount` & `servedCount` TETAP sama
       * selama `stableTicks` event-loop ticks berturut-turut
       * (default `5`). Setiap tick = `setTimeout(0)` + microtask
       * flush — memberi kesempatan task tertunda / callback
       * React Query untuk sempat memicu request baru sebelum
       * kita menyatakan handler benar-benar stabil.
       */
      stableTicks?: number;
    },
  ) => Promise<void>;
  /**
   * Mode standalone "counter stabil": memverifikasi `requestedCount`
   * & `servedCount` untuk `variant` TETAP sama selama `ticks`
   * event-loop ticks berturut-turut. Berbeda dari `waitForIdle`
   * (yang menunggu idle DATANG) — helper ini menguji idle BERTAHAN.
   *
   * Berguna sebagai pengaman tambahan di CI yang lambat: kalau ada
   * task tertunda (mis. `queueMicrotask`, `Promise.resolve().then`,
   * atau timer 0 ms) yang memicu refetch, ia akan sempat firing
   * dalam `ticks` iterasi ini dan test gagal cepat.
   */
  assertCounterStable: (
    variant: ApkVariant,
    opts?: { ticks?: number },
  ) => Promise<void>;
  /**
   * Menunggu handler benar-benar IDLE (deterministik, tanpa
   * `waitForTimeout`). Kondisi idle:
   *
   *   - Tidak ada request in-flight: `requestedCount === servedCount`
   *     (setiap request yang tiba di handler sudah di-fulfill).
   *   - Tidak ada waiter tertahan (`holding === 0`).
   *   - Opsional: antrian respons juga kosong bila `drainQueue: true`
   *     (default `false` — respons ter-enqueue yang belum "dipakai"
   *     tetap dianggap idle karena UI tidak sedang menunggu apa-apa).
   *
   * Jika sudah idle saat dipanggil, resolve segera. Kalau belum,
   * subscribe ke event `served` (dan `hold` untuk mendeteksi request
   * baru yang masuk) dan re-check tiap fire. Timeout hanya batas atas
   * pengaman (bukan sinkronisasi UI).
   */
  waitForIdle: (
    variant?: ApkVariant,
    opts?: { drainQueue?: boolean; timeoutMs?: number },
  ) => Promise<void>;
};

function detectVariant(raw: string): ApkVariant {
  return raw.includes("storage") ? "storage" : "chat";
}

export async function installApkStub(page: Page): Promise<ApkStub> {
  const queued: Record<ApkVariant, ApkRelease[][]> = { chat: [], storage: [] };
  const waiters: Record<ApkVariant, PendingWaiter[]> = { chat: [], storage: [] };
  const served: Record<ApkVariant, number> = { chat: 0, storage: 0 };
  const requested: Record<ApkVariant, number> = { chat: 0, storage: 0 };
  /** Berapa waiter yang saat ini tertahan (menunggu enqueue). */
  const holding: Record<ApkVariant, number> = { chat: 0, storage: 0 };
  const t0 = Date.now();
  const events: ApkStubEvent[] = [];
  /** Batas maksimum event yang disimpan (mencegah log tak terbatas). */
  const EVENT_LOG_CAP = 500;

  function pushEvent(
    variant: ApkVariant,
    type: ApkStubEvent["type"],
    note?: string,
  ) {
    events.push({
      t: Date.now() - t0,
      variant,
      type,
      requested: requested[variant],
      served: served[variant],
      queued: queued[variant].length,
      holding: holding[variant],
      note,
    });
    if (events.length > EVENT_LOG_CAP) events.shift();
  }

  function formatEventLog(tail = 15): string {
    if (events.length === 0) return "  (log kosong — belum ada event)";
    const slice = events.slice(-Math.max(1, tail));
    return slice
      .map((e) => {
        const pad = (n: number, w = 2) => String(n).padStart(w, " ");
        const noteStr = e.note ? ` · ${e.note}` : "";
        return (
          `  [+${pad(e.t, 5)}ms] ${e.variant.padEnd(7)} ${e.type.padEnd(7)}` +
          ` req=${pad(e.requested)} served=${pad(e.served)}` +
          ` queue=${pad(e.queued)} hold=${pad(e.holding)}${noteStr}`
        );
      })
      .join("\n");
  }

  /** Listener terdaftar per event: dipanggil setelah counter bertambah. */
  type Listener = () => void;
  const requestListeners: Record<ApkVariant, Listener[]> = { chat: [], storage: [] };
  const servedListeners: Record<ApkVariant, Listener[]> = { chat: [], storage: [] };
  const holdListeners: Record<ApkVariant, Listener[]> = { chat: [], storage: [] };

  function fire(list: Listener[]) {
    // Copy dulu — listener boleh melepas dirinya sendiri dari array.
    for (const fn of list.slice()) fn();
  }

  function waitFor(
    check: () => boolean,
    subscribe: (fn: Listener) => () => void,
    label: string,
    timeoutMs: number,
  ): Promise<void> {
    if (check()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        unsubscribe();
        reject(new Error(`[apk-stub] Timeout ${timeoutMs}ms menunggu ${label}`));
      }, timeoutMs);
      const unsubscribe = subscribe(() => {
        if (done || !check()) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      });
    });
  }

  function subscribeTo(list: Listener[]) {
    return (fn: Listener) => {
      list.push(fn);
      return () => {
        const idx = list.indexOf(fn);
        if (idx >= 0) list.splice(idx, 1);
      };
    };
  }
  function enqueueOne(variant: ApkVariant, releases: ApkRelease[]) {
    const waiter = waiters[variant].shift();
    if (waiter) {
      holding[variant] = Math.max(0, holding[variant] - 1);
      waiter(releases);
      pushEvent(variant, "enqueue", `release waiter (n=${releases.length})`);
    } else {
      queued[variant].push(releases);
      pushEvent(variant, "enqueue", `queue (n=${releases.length})`);
    }
  }

  let primed = false;

  function nextResponse(variant: ApkVariant): Promise<ApkRelease[]> {
    const ready = queued[variant].shift();
    if (ready) return Promise.resolve(ready);
    // Tidak ada antrian → handler akan MENAHAN waiter sampai enqueue.
    holding[variant] += 1;
    pushEvent(variant, "hold");
    fire(holdListeners[variant]);
    return new Promise<ApkRelease[]>((resolve) => {
      waiters[variant].push(resolve);
    });
  }

  await page.route("**/_serverFn/**", async (route: Route) => {
    const req = route.request();
    const url = req.url();
    let raw = decodeURIComponent(url.split("?")[1] ?? "");
    if (!raw && req.method() === "POST") {
      raw = req.postData() ?? "";
    }
    const variant = detectVariant(raw);
    requested[variant] += 1;
    pushEvent(variant, "request", url.split("?")[0].split("/").pop() ?? "");
    fire(requestListeners[variant]);
    const releases = await nextResponse(variant);
    served[variant] += 1;
    pushEvent(variant, "served", `releases=${releases.length}`);
    fire(servedListeners[variant]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeDetail(variant, releases)),
    });
  });

  return {
    enqueue(variant, releases) {
      enqueueOne(variant, releases);
    },
    servedCount(variant) {
      return served[variant];
    },
    requestedCount(variant) {
      return requested[variant];
    },
    pending() {
      return {
        chat: queued.chat.length,
        storage: queued.storage.length,
        waiters: waiters.chat.length + waiters.storage.length,
      };
    },
    getEventLog() {
      return events.slice();
    },
    formatEventLog(tail = 15) {
      return formatEventLog(tail);
    },
    primeInitial(chatReleases = [], storageReleases = []) {
      // Enqueue respons untuk fetch awal (mount) kedua varian.
      enqueueOne("chat", chatReleases);
      enqueueOne("storage", storageReleases);
      primed = true;
    },
    assertPrimed() {
      if (!primed) {
        throw new Error(
          "[apk-stub] Panggil stub.primeInitial(...) sebelum page.goto — " +
            "harness memanggil getApkVariantDetail untuk chat & storage " +
            "saat mount, dan handler menunggu antrian sebelum fulfill.",
        );
      }
      if (queued.chat.length < 1 || queued.storage.length < 1) {
        throw new Error(
          "[apk-stub] Antrian fetch awal tidak lengkap sebelum goto " +
            `(chat=${queued.chat.length}, storage=${queued.storage.length}). ` +
            "Pastikan tidak ada enqueue lain yang mengonsumsi antrian " +
            "sebelum navigasi.",
        );
      }
    },
    waitForRequest(variant, n = 1, timeoutMs = 10_000) {
      return waitFor(
        () => requested[variant] >= n,
        subscribeTo(requestListeners[variant]),
        `request ${variant} #${n} (sekarang=${requested[variant]})`,
        timeoutMs,
      );
    },
    waitForServed(variant, n, timeoutMs = 10_000) {
      return waitFor(
        () => served[variant] >= n,
        subscribeTo(servedListeners[variant]),
        `served ${variant} #${n} (sekarang=${served[variant]})`,
        timeoutMs,
      );
    },
    waitForHold(variant, timeoutMs = 10_000) {
      return waitFor(
        () => holding[variant] >= 1,
        subscribeTo(holdListeners[variant]),
        `waiter tertahan ${variant} (holding=${holding[variant]})`,
        timeoutMs,
      );
    },
    async assertQuiescent(variant, opts) {
      const windowMs = opts?.windowMs ?? 1000;
      const stableTicks = opts?.stableTicks ?? 5;
      // (1) Handler benar-benar kosong untuk varian ini.
      if (queued[variant].length > 0) {
        throw new Error(
          `[apk-stub] assertQuiescent(${variant}): antrian belum kosong ` +
            `(${queued[variant].length} respons tersisa). Konsumsi dulu ` +
            `atau enqueue lebih akurat sebelum memanggil helper ini.`,
        );
      }
      if (waiters[variant].length > 0 || holding[variant] > 0) {
        throw new Error(
          `[apk-stub] assertQuiescent(${variant}): masih ada waiter ` +
            `tertahan (${waiters[variant].length}) — request menunggu ` +
            `enqueue. Lepas atau selesaikan dulu.`,
        );
      }
      if (requested[variant] !== served[variant]) {
        throw new Error(
          `[apk-stub] assertQuiescent(${variant}): requested` +
            `=${requested[variant]} ≠ served=${served[variant]} ` +
            `(ada request yang belum di-fulfill).`,
        );
      }
      // (2) Snapshot counter.
      const snapReq = requested[variant];
      const snapServ = served[variant];
      // (3) Coba tunggu request tambahan; kalau resolve → gagal.
      const outcome = await waitFor(
        () => requested[variant] > snapReq,
        subscribeTo(requestListeners[variant]),
        `[quiescent] request ${variant} tambahan (snapshot=${snapReq})`,
        windowMs,
      ).then(
        () => "extra-request",
        () => "quiet",
      );
      if (outcome === "extra-request") {
        throw new Error(
          `[apk-stub] assertQuiescent(${variant}) GAGAL: ada request ` +
            `tambahan dalam jendela ${windowMs}ms ` +
            `(requested naik dari ${snapReq} → ${requested[variant]}).`,
        );
      }
      // (4) Counter tetap stabil.
      if (requested[variant] !== snapReq || served[variant] !== snapServ) {
        throw new Error(
          `[apk-stub] assertQuiescent(${variant}) GAGAL: counter ` +
            `berubah setelah jendela (requested ${snapReq}→` +
            `${requested[variant]}, served ${snapServ}→` +
            `${served[variant]}).`,
        );
      }
      // (5) Ekstra: counter WAJIB tetap stabil selama `stableTicks`
      // event-loop ticks berturut-turut. Melindungi dari task tertunda
      // (microtask / setTimeout(0)) yang bisa memicu refetch tepat
      // setelah jendela `windowMs` habis di CI yang lambat.
      for (let i = 0; i < stableTicks; i += 1) {
        // setTimeout(0) → beri task queue kesempatan; lalu
        // Promise.resolve() → flush microtask yang mungkin
        // ter-schedule dari task itu.
        await new Promise<void>((r) => setTimeout(r, 0));
        await Promise.resolve();
        if (
          requested[variant] !== snapReq ||
          served[variant] !== snapServ
        ) {
          throw new Error(
            `[apk-stub] assertQuiescent(${variant}) GAGAL pada tick ` +
              `#${i + 1}/${stableTicks}: counter bergerak (requested ` +
              `${snapReq}→${requested[variant]}, served ${snapServ}→` +
              `${served[variant]}). Ada task tertunda yang memicu ` +
              `refetch setelah handler tampak idle.`,
          );
        }
      }
    },
    async assertCounterStable(variant, opts) {
      const ticks = opts?.ticks ?? 5;
      const snapReq = requested[variant];
      const snapServ = served[variant];
      for (let i = 0; i < ticks; i += 1) {
        await new Promise<void>((r) => setTimeout(r, 0));
        await Promise.resolve();
        if (
          requested[variant] !== snapReq ||
          served[variant] !== snapServ
        ) {
          throw new Error(
            `[apk-stub] assertCounterStable(${variant}) GAGAL pada ` +
              `tick #${i + 1}/${ticks}: requested ${snapReq}→` +
              `${requested[variant]}, served ${snapServ}→` +
              `${served[variant]}.`,
          );
        }
      }
    },
    waitForIdle(variant, opts) {
      const drainQueue = opts?.drainQueue ?? false;
      const timeoutMs = opts?.timeoutMs ?? 10_000;
      const variants: ApkVariant[] = variant
        ? [variant]
        : (["chat", "storage"] as const).slice();

      const isIdle = () =>
        variants.every(
          (v) =>
            requested[v] === served[v] &&
            holding[v] === 0 &&
            (!drainQueue || queued[v].length === 0),
        );

      if (isIdle()) return Promise.resolve();

      // Subscribe ke SEMUA event yang bisa mengubah kondisi idle:
      //   - served: request in-flight selesai (bisa menutup gap
      //     requested vs served).
      //   - hold: request BARU masuk & tertahan (naikkan requested,
      //     idle bisa jadi false — re-check).
      //   - request listener juga: request baru tiba (naikkan
      //     requested sebelum fulfill).
      return new Promise<void>((resolve, reject) => {
        let done = false;
        const unsubs: Array<() => void> = [];
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          for (const u of unsubs) u();
          reject(
            new Error(
              `[apk-stub] Timeout ${timeoutMs}ms menunggu handler idle ` +
                `(${variants
                  .map(
                    (v) =>
                      `${v}: req=${requested[v]}/served=${served[v]}, ` +
                      `hold=${holding[v]}, queue=${queued[v].length}`,
                  )
                  .join(" | ")}).`,
            ),
          );
        }, timeoutMs);

        const check = () => {
          if (done || !isIdle()) return;
          done = true;
          clearTimeout(timer);
          for (const u of unsubs) u();
          resolve();
        };

        for (const v of variants) {
          unsubs.push(subscribeTo(servedListeners[v])(check));
          unsubs.push(subscribeTo(requestListeners[v])(check));
          unsubs.push(subscribeTo(holdListeners[v])(check));
        }
      });
    },
  };
}