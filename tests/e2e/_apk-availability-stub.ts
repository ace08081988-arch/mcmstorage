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
};

function detectVariant(raw: string): ApkVariant {
  return raw.includes("storage") ? "storage" : "chat";
}

export async function installApkStub(page: Page): Promise<ApkStub> {
  const queued: Record<ApkVariant, ApkRelease[][]> = { chat: [], storage: [] };
  const waiters: Record<ApkVariant, PendingWaiter[]> = { chat: [], storage: [] };
  const served: Record<ApkVariant, number> = { chat: 0, storage: 0 };
  let primed = false;

  function nextResponse(variant: ApkVariant): Promise<ApkRelease[]> {
    const ready = queued[variant].shift();
    if (ready) return Promise.resolve(ready);
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
    const releases = await nextResponse(variant);
    served[variant] += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeDetail(variant, releases)),
    });
  });

  return {
    enqueue(variant, releases) {
      const waiter = waiters[variant].shift();
      if (waiter) waiter(releases);
      else queued[variant].push(releases);
    },
    servedCount(variant) {
      return served[variant];
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
      const enqueueOne = (variant: ApkVariant, releases: ApkRelease[]) => {
        const waiter = waiters[variant].shift();
        if (waiter) waiter(releases);
        else queued[variant].push(releases);
      };
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
  };
}