# Helpers E2E — APK Availability Stub

Dokumen ini merangkum penggunaan helper `assertNoAdditionalRequests`, `assertQuiescent`, dan `assertCounterStable` dari `tests/e2e/_apk-availability-stub.ts`. Helper-helper ini dipakai untuk menangkap kebocoran request (leak) secara konsisten di test-test yang memicu APK refresh atau copy chat.

> **Konsep utama**: semua helper bekerja **event-based** — tanpa polling `expect.poll` atau `waitForTimeout` sebagai sinkronisasi. `windowMs` hanyalah bounded upper-bound untuk membuktikan *absence* (tidak ada request tambahan), bukan untuk menunggu state UI.

---

## Pasang stub terlebih dulu

```ts
import { installApkStub } from "./_apk-availability-stub";

const stub = await installApkStub(page);
stub.primeInitial([], []);  // chat & storage, masing-masing tanpa release
stub.assertPrimed();
await page.goto("/lovable/visual/apk-availability-shortcuts");
```

Setiap test yang berinteraksi dengan APK tile wajib memasang stub ini dan mengisi respons awal (`primeInitial`) sebelum `page.goto`, agar initial fetch tidak race dengan variabel flag yang di-flip manual.

---

## `assertNoAdditionalRequests` — dua mode pemakaian

### 1. Standalone — guard di akhir aksi

Snapshot counter diambil saat helper dipanggil, lalu diverifikasi bahwa tidak ada request masuk ke stub dalam trailing window.

```ts
await refreshButton.click();
await stub.waitForServed("storage", 2);
await stub.assertNoAdditionalRequests({ variant: "storage", windowMs: 500 });
```

Bila `variant` diabaikan, helper memeriksa **chat + storage** sekaligus — cocok sebagai guard akhir test.

```ts
import { APK_STUB_TERMINAL_WINDOW_MS } from "./_helpers/apk-stub-timing";

await stub.assertNoAdditionalRequests({ windowMs: APK_STUB_TERMINAL_WINDOW_MS });
```

### 2. Pembungkus aksi — cek kebocoran selama aksi

Wrap aksi UI dengan helper; counter di-snapshot **sebelum** aksi dijalankan, lalu diverifikasi selama aksi + trailing window.

```ts
import { APK_STUB_PER_ACTION_WINDOW_MS } from "./_helpers/apk-stub-timing";

await stub.assertNoAdditionalRequests(
  async () => { await refreshButton.click(); },
  { variant: "chat", windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
);
```

Pola ini sangat berguna untuk membuktikan bahwa aksi pada varian A tidak men-trigger request untuk varian B:

```ts
// Aksi storage tap tidak boleh mengirim request chat.
await stub.assertNoAdditionalRequests(
  async () => { await storageTile.getByRole("button", { name: "Periksa" }).click(); },
  { variant: "chat", windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
);
```

---

## Opsi

| Opsi | Tipe | Default | Keterangan |
|------|------|---------|------------|
| `variant` | `"chat" \| "storage"` | keduanya | Batasi asersi ke satu varian. |
| `windowMs` | `number` | `500` | Trailing window (ms) setelah aksi/sejak snapshot. |
| `expected` | `{ chat?: number; storage?: number }` | `{ chat: 0, storage: 0 }` | Jumlah request per varian yang memang diharapkan masuk. |
| `ignore` | `(info: ApkStubIgnoreInfo) => boolean` | — | Predikat kustom untuk mengabaikan request tertentu. |

### `expected` — whitelist kuantitatif

Cocok kalau test memang tahu berapa request boleh masuk:

```ts
// Tap ini boleh memicu tepat 1 refetch storage; chat harus tetap 0.
await stub.assertNoAdditionalRequests(
  async () => { await refreshButton.click(); },
  { expected: { storage: 1 }, windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
);
```

Perilaku:
- Request ke-N sampai `expected[variant]` diabaikan.
- Request lebih dari kuota = **leak** → test gagal.
- Request kurang dari kuota = juga gagal (regresi diam-diam).

### `ignore` — whitelist kualitatif

Dievaluasi setelah `expected`. Return `true` berarti request ini diizinkan.

```ts
await stub.assertNoAdditionalRequests({
  ignore: (info) => info.variant === "chat" && info.nthSinceSnapshot <= 2,
  windowMs: 750,
});
```

Field `info`:
- `variant`: varian request yang baru masuk.
- `nthSinceSnapshot`: nomor request untuk varian tersebut sejak snapshot (1-based).
- `totalRequested`: total `requestedCount` untuk varian setelah request ini masuk.

---

## Output saat gagal

Helper selalu menampilkan:
1. Fase kegagalan (`selama aksi` atau `trailing Nms`).
2. Daftar request bocor dengan varian, nomor, dan waktu relatif (ms).
3. Daftar request yang diizinkan beserta alasannya (`expected` atau `ignore`).
4. Counter sebelum vs sesudah untuk tiap varian.
5. 20 event log terakhir dari stub.

Contoh pesan error:

```
[apk-stub] assertNoAdditionalRequests GAGAL (trailing 500ms): 1 request bocor [chat#1@+120ms]; 1 diizinkan [storage#1(expected)]. chat: req 0→1 (expected=0), served=0 | storage: req 1→1 (expected=1), served=1
  Event log terakhir:
  [+  12ms] chat    request  req=0 served=0 queue=0 hold=0 · getApkVariantDetail
  ...
```

---

## Menggunakan `assertQuiescent` dan `assertCounterStable` bersama `assertNoAdditionalRequests`

Semua tiga helper dibuat **di atas satu sumber kebenaran yang sama** di `tests/e2e/_apk-availability-stub.ts`:

- `assertNoAdditionalRequests` langsung memanggil `runNoAdditionalGuard`.
- `assertQuiescent` memanggil `runNoAdditionalGuard` untuk fase jendela `windowMs`, lalu memanggil `verifyCounterStable` untuk beberapa event-loop ticks.
- `assertCounterStable` langsung memanggil `verifyCounterStable`.

Jadi **tidak perlu menulis ulang logika trailing-window / counter-stable di spec**. Cukup pilih helper yang semantiknya paling pas, dan biarkan implementasi bersama yang menangani listener, timeout, serta format error.

### Kapan pakai yang mana?

| Helper | Gunakan saat | Jangan pakai untuk |
|--------|--------------|--------------------|
| `assertNoAdditionalRequests(action, opts)` | Membungkus aksi UI — cek tidak ada request bocor **selama** aksi + trailing window. | Menggantikan `waitForServed` / `waitForIdle`. |
| `assertNoAdditionalRequests(opts)` | Guard standalone di akhir fase / akhir spec — snapshot sekarang, cek trailing window. | Menunggu request selesai (tunggu dulu dengan `waitForServed`). |
| `assertQuiescent(variant)` | Setelah state aktif / idle tercapai — cek handler kosong + tidak ada request tambahan + counter stabil. | Menggantikan guard per-aksi (lebih lambat, tidak perlu di setiap tap). |
| `assertCounterStable(variant)` | Verifikasi cepat bahwa counter tidak bergerak setelah semua assertion — tangkap task tertunda. | Menggantikan `assertNoAdditionalRequests` jika butuh jendela wall-clock. |

### Pola kombinasi yang direkomendasikan

#### A. Per aksi + quiescent + terminal guard

Pola paling umum: setiap tap dibungkus leak-guard, lalu setelah semua state aktif diverifikasi, pastikan tidak ada request tambahan sama sekali.

```ts
import {
  APK_STUB_PER_ACTION_WINDOW_MS,
  APK_STUB_TERMINAL_WINDOW_MS,
} from "./_helpers/apk-stub-timing";

// (1) Bungkus tiap aksi — pastikan tap hanya memicu refetch varian yang diharapkan.
await stub.assertNoAdditionalRequests(
  async () => { await chatRefresh.click(); },
  { expected: { chat: 1 }, windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
);
await stub.assertNoAdditionalRequests(
  async () => { await storageRefresh.click(); },
  { expected: { storage: 1 }, windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
);

// (2) Tunggu request benar-benar selesai sebelum assert UI.
await stub.waitForIdle();

// (3) Pastikan state aktif tidak memicu polling / refetch background.
await stub.assertQuiescent("chat", { windowMs: 1000 });
await stub.assertQuiescent("storage", { windowMs: 1000 });

// (4) Terminal guard: kedua varian sekaligus, tanpa polling.
await stub.assertNoAdditionalRequests({ windowMs: APK_STUB_TERMINAL_WINDOW_MS });
```

#### B. Cross-variant leak guard per aksi

Kalau aksi pada varian A tidak boleh menyentuh varian B:

```ts
await stub.assertNoAdditionalRequests(
  async () => { await storageRefresh.click(); },
  { variant: "chat", windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
);
await stub.waitForServed("storage", 2);
// Storage refetch sudah selesai; chat tetap 1.
expect(stub.servedCount("chat")).toBe(1);
```

#### C. Hold → release + counter stabil

Pola untuk menguji state UI sementara (checking / busy) dengan `waitForHold`, lalu melepaskan request. Setelah selesai, verifikasi tidak ada request tersembunyi.

```ts
// Tahan request: jangan enqueue, lalu tap.
await stub.assertNoAdditionalRequests(
  async () => { await mainButton.click(); },
  { variant: "storage", windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
);
await stub.waitForHold("chat");
await expect(mainButton).toHaveAttribute("aria-label", "Memeriksa…");

// Lepaskan request.
stub.enqueue("chat", [makeRelease("chat")]);
await stub.waitForServed("chat", 2);
await expect(mainButton).toHaveAttribute("aria-label", "Salin semua link APK Chat");

// Pastikan tidak ada polling setelah state aktif.
await stub.assertQuiescent("chat", { windowMs: 1000 });
await stub.assertQuiescent("storage", { windowMs: 500 });
await stub.assertNoAdditionalRequests({ windowMs: APK_STUB_TERMINAL_WINDOW_MS });
```

#### D. Extra stabilization setelah quiescent

Kalau runner CI sering memicu task tertunda (microtask / timer 0 ms) yang memicu refetch setelah semua assertion "selesai", tambahkan `assertCounterStable` setelah `assertQuiescent`:

```ts
await stub.assertQuiescent("storage", { windowMs: 1500, stableTicks: 8 });
await stub.assertQuiescent("chat", { windowMs: 500, stableTicks: 8 });
// Verifikasi tambahan: counter benar-benar tidak bergerak beberapa ticks.
await stub.assertCounterStable("storage", { ticks: 5 });
await stub.assertCounterStable("chat", { ticks: 5 });
// Terminal guard tanpa duplikasi logika trailing-window.
await stub.assertNoAdditionalRequests({ windowMs: APK_STUB_TERMINAL_WINDOW_MS });
```

---

## Anti-pola: jangan duplikasi logika

❌ **Jangan menulis `expect.poll(() => stub.requestedCount(...))` sendiri** — sudah ada helper yang event-based dan memberikan pesan error rapi.

❌ **Jangan membungkus aksi yang sama dengan `assertNoAdditionalRequests` lalu langsung `assertQuiescent` tanpa alasan** — keduanya memeriksa request tambahan. Gunakan `assertNoAdditionalRequests` untuk per-aksi, `assertQuiescent` untuk post-active.

❌ **Jangan mengganti `waitForServed` / `waitForIdle` dengan `assertNoAdditionalRequests({ expected: ... })`** — `expected` memang menunggu request, tapi semantiknya "boleh masuk N"; kalau butuh "request ke-N sudah selesai di-fulfill", gunakan `waitForServed`.

---

## Pola pemakaian di test yang sudah ada

### Guard akhir test (semua varian)

```ts
await stub.assertQuiescent("chat");
await stub.assertQuiescent("storage");
await stub.assertNoAdditionalRequests({ windowMs: APK_STUB_TERMINAL_WINDOW_MS });
```

### Membuktikan aksi varian A tidak mengganggu varian B

```ts
await stub.assertNoAdditionalRequests(
  async () => { await chatRefresh.click(); },
  { variant: "storage", windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
);
```

### Membuktikan refetch tunggal per tap

```ts
await stub.assertNoAdditionalRequests(
  async () => { await tileRefresh.click(); },
  { expected: { storage: 1 }, windowMs: APK_STUB_PER_ACTION_WINDOW_MS },
);
```

---

## Tips

- Gunakan konstanta dari `tests/e2e/_helpers/apk-stub-timing.ts` untuk semua nilai `windowMs` — jangan tulis angka literal. Ini membuat threshold CI seragam dan mudah di-tune.
- Jangan gunakan `assertNoAdditionalRequests` sebagai pengganti `waitForServed` — tetap tunggu request selesai di-fulfill sebelum memanggil guard akhir.
- Pilih `windowMs` sesuai kebutuhan: `APK_STUB_PER_ACTION_WINDOW_MS` (500 ms) cukup untuk sebagian besar case, `APK_STUB_TERMINAL_WINDOW_MS` (750 ms) untuk guard akhir, dan override langsung (mis. 1000–1500 ms) untuk `assertQuiescent` kalau memang perlu lebih ketat.
- Kalau test memang mengharapkan request tertentu, gunakan `expected` agar leak tetap terdeteksi dengan jelas.
- Hindari `ignore` yang terlalu longgar; predikat harus spesifik supaya kebocoran nyata tidak terlewat.
