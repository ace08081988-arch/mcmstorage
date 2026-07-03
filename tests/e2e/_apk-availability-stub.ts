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
    } else {
      queued[variant].push(releases);
    }
  }

  let primed = false;

  function nextResponse(variant: ApkVariant): Promise<ApkRelease[]> {
    const ready = queued[variant].shift();
    if (ready) return Promise.resolve(ready);
    // Tidak ada antrian → handler akan MENAHAN waiter sampai enqueue.
    holding[variant] += 1;
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
    fire(requestListeners[variant]);
    const releases = await nextResponse(variant);
    served[variant] += 1;
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
  };
}