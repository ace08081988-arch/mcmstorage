# Helpers E2E — APK Availability Stub

Dokumen ini merangkum penggunaan helper `assertNoAdditionalRequests` dari `tests/e2e/_apk-availability-stub.ts`. Helper ini dipakai untuk menangkap kebocoran request (leak) secara konsisten di test-test yang memicu APK refresh atau copy chat.

> **Konsep utama**: helper bekerja **event-based** — tanpa polling `expect.poll` atau `waitForTimeout` sebagai sinkronisasi. `windowMs` hanyalah bounded upper-bound untuk membuktikan *absence* (tidak ada request tambahan), bukan untuk menunggu state UI.

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
await stub.assertNoAdditionalRequests({ windowMs: 1000 });
```

### 2. Pembungkus aksi — cek kebocoran selama aksi

Wrap aksi UI dengan helper; counter di-snapshot **sebelum** aksi dijalankan, lalu diverifikasi selama aksi + trailing window.

```ts
await stub.assertNoAdditionalRequests(
  async () => { await refreshButton.click(); },
  { variant: "chat", windowMs: 500 },
);
```

Pola ini sangat berguna untuk membuktikan bahwa aksi pada varian A tidak men-trigger request untuk varian B:

```ts
// Aksi storage tap tidak boleh mengirim request chat.
await stub.assertNoAdditionalRequests(
  async () => { await storageTile.getByRole("button", { name: "Periksa" }).click(); },
  { variant: "chat", windowMs: 500 },
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
  { expected: { storage: 1 }, windowMs: 500 },
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

## Pola pemakaian di test yang sudah ada

### Guard akhir test (semua varian)

```ts
await stub.assertQuiescent("chat");
await stub.assertQuiescent("storage");
await stub.assertNoAdditionalRequests({ windowMs: 1000 });
```

### Membuktikan aksi varian A tidak mengganggu varian B

```ts
await stub.assertNoAdditionalRequests(
  async () => { await chatRefresh.click(); },
  { variant: "storage", windowMs: 500 },
);
```

### Membuktikan refetch tunggal per tap

```ts
await stub.assertNoAdditionalRequests(
  async () => { await tileRefresh.click(); },
  { expected: { storage: 1 }, windowMs: 500 },
);
```

---

## Tips

- Jangan gunakan `assertNoAdditionalRequests` sebagai pengganti `waitForServed` — tetap tunggu request selesai di-fulfill sebelum memanggil guard akhir.
- Pilih `windowMs` sesuai kebutuhan: 500 ms cukup untuk sebagian besar case, 1000–1500 ms untuk guard akhir yang ingin lebih ketat.
- Kalau test memang mengharapkan request tertentu, gunakan `expected` agar leak tetap terdeteksi dengan jelas.
- Hindari `ignore` yang terlalu longgar; predikat harus spesifik supaya kebocoran nyata tidak terlewat.
