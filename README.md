# MCM Storage

Aplikasi gudang / retail internal untuk BAROKAH RIZKI / Toko Kifa. MCM Storage menggantikan koordinasi manual WhatsApp dengan satu alat yang membuat Ace tetap menguasai angka stok, hutang, dan produktivitas pegawai.

---

## E2E / APK

Bagian ini menjelaskan cara membaca blok project `apk-*` di `playwright.config.ts` dan memilih mode guard yang tepat untuk setiap skenario APK.

### Dua mode guard APK

Setiap spec E2E yang menguji tile APK memasang stub `getApkVariantDetail`. Ada dua tingkat perlindungan:

| Mode | Pasang | Cakupan | Kapan dipakai |
|---|---|---|---|
| **terminalGuard-only** | `installApkStub(page)` | Hanya `getApkVariantDetail` (chat + storage) | Flow APK murni: hanya mount, refresh, quiescent, atau refetch varian |
| **full guards** | `installApkStub(page)` + `installServerFnPassthroughGuard(page)` | Semua server function (`**/_serverFn/**`) | Flow APK yang juga memicu server function lain, misalnya copy/export link chat |

`terminalGuard()` tidak pernah digantikan oleh passthrough guard. Keduanya saling melengkapi: terminal guard menangkap leak jangka panjang pada `getApkVariantDetail`, sementara passthrough guard menangkap kebocoran round-trip server function lain selama aksi user.

### Beda per skenario APK

| Skenario | Mode | Alasan |
|---|---|---|
| Mount halaman tile APK tanpa aksi user | `terminal` | Hanya fetch awal dua varian; tidak ada server function lain |
| Tap refresh satu varian | `terminal` | Aksi memicu `getApkVariantDetail` lewat `trackedClick` — masih cakupan APK |
| Tap refresh semua varian + cross-variant guard | `terminal` | Semua request masuk ke `getApkVariantDetail`; `terminalGuard()` cukup untuk membuktikan zero-leak |
| Copy / salin link APK Chat yang memanggil server function selain `getApkVariantDetail` | `full` | Perlu `installServerFnPassthroughGuard` agar round-trip copy/export tidak bocor |
| Form validasi `minSupported` | *form-only* | Bukan flow APK, tidak memakai `installApkStub`, tidak memakai `terminalGuard` |

### Tabel pemetaan skenario APK aktual

| Spec | Skenario | Guard requirement | Perubahan checklist Guards |
|---|---|---|---|
| `apk-min-validate-form.spec.ts` | Form validasi `minSupported` | *form-only* | Tulis `// Guards : (spec form murni — bukan flow getApkVariantDetail, tidak memakai apk-stub / terminalGuard)`. Hapus semua marker stub. |
| `apk-mount-quiescent.spec.ts` | Mount murni tile APK | `terminalGuard-only` | `primeInitial + assertPrimed` → `waitForServed` → `assertQuiescent` → `terminalGuard()`; tidak ada `trackedClick` karena mount-only; tambahkan `(mode: terminal)`. |
| `apk-availability-refresh.spec.ts` | Idle → tap refresh Chat → aktif | `terminalGuard-only` | Base checklist stub + `trackedClick(expected.chat=1)` + `assertQuiescent` + `terminalGuard()`; `(mode: terminal)`. |
| `apk-availability-refresh-storage.spec.ts` | Idle → tap refresh Storage → aktif | `terminalGuard-only` | Sama seperti di atas, tetapi `trackedClick(expected.storage=1)` untuk bukti independensi varian; `(mode: terminal)`. |
| `apk-refresh-single-refetch.spec.ts` | Satu tap = satu refetch | `terminalGuard-only` | Base checklist + `trackedClick(expected.storage=1)` + `assertQuiescent` + `terminalGuard()`; fokus regression hitungan request; `(mode: terminal)`. |
| `apk-example-terminal-only.spec.ts` | Contoh pembanding terminal-only | `terminalGuard-only` | Base checklist + `trackedClick(expected.chat=1)` + `assertQuiescent` + `terminalGuard()`; `(mode: terminal)`. |
| `apk-*-copy-export-*.spec.ts` (bila ada) | Copy / export link APK Chat | `terminalGuard + installServerFnPassthroughGuard` | Base checklist stub + `passthrough.assertNoAdditionalRequests` + `passthrough.dispose()` di akhir; ganti tag menjadi `(mode: full)`. |

**Cara membaca tabel:** baris `Spec` yang sudah ada di repo saat ini menunjukkan mode aktual; baris terakhir menunjukkan apa yang harus berubah ketika spec nantinya menyentuh server function di luar `getApkVariantDetail`. Perubahan checklist selalu dimulai dari base checklist stub (lima marker), lalu ditambah atau dihapus sesuai mode.

### Arti setiap item checklist Guards

Setiap project block `apk-*` di `playwright.config.ts` wajib memuat kolom `Guards` dengan checklist yang sesuai mode. Validator (`bun run e2e:apk:validate`) memastikan checklist tidak boleh kontradiksi dengan isi spec.

| Item | Mode | Arti |
|---|---|---|
| `primeInitial + assertPrimed` | terminal / full | Respons untuk fetch awal di-enqueue SEBELUM `page.goto()`, dan setup sudah benar-benar lengkap sebelum navigasi. Tanpa ini test bisa hang karena waiter tidak pernah di-fulfill. |
| `waitForServed` | terminal / full | Sinkronisasi deterministik: tunggu handler memberi respons untuk fetch awal sebelum assertion UI. Menghindari race antara render React dan data stub. |
| `trackedClick(expected.<variant>=N)` | terminal / full | Setiap tap yang memicu refetch dibungkus guard per-aksi. `expected` sekaligus jadi regression check: kalau tap tiba-tiba tidak memicu request, test gagal. |
| `assertQuiescent` | terminal / full | Setelah state aktif tercapai, verifikasi handler benar-benar idle selama window waktu tertentu. Menangkap polling / interval / refetch-on-focus. |
| `terminalGuard()` | terminal / full | Guard akhir di penghujung spec dengan window default `APK_STUB_TERMINAL_WINDOW_MS`. Membuktikan kedua varian bebas leak jangka panjang. |
| `passthrough.assertNoAdditionalRequests` | full | Tambahan dari `installServerFnPassthroughGuard`. Memastikan tidak ada server function tak terduga yang terpanggil di luar whitelist selama aksi copy/export. |
| `tidak memakai apk-stub / terminalGuard` | form-only | Penanda eksplisit bahwa spec ini bukan flow `getApkVariantDetail` dan tidak memasang stub APK. |
| `(mode: terminal)` | terminal | Penanda bahwa spec hanya memakai `installApkStub` tanpa `installServerFnPassthroughGuard`. |
| `(mode: full)` | full | Penanda bahwa spec memasang `installServerFnPassthroughGuard` selain `installApkStub`. |

### Perintah yang sering dipakai

```bash
# Jalankan semua spec APK sekaligus
bun run test:e2e:apk

# Regenerasi scaffold (dry-run)
bun run e2e:apk:regen

# Regenerasi dan langsung tulis (apply)
bun run e2e:apk:regen:apply

# Validasi header & checklist Guards
bun run e2e:apk:validate

# Scaffold satu spec baru
node scripts/scaffold-apk-e2e-spec.mjs --name <flow-name> --mode terminal
node scripts/scaffold-apk-e2e-spec.mjs --name <flow-name> --mode full
```

Rincian teknis helper stub dan pola anti-pattern ada di `tests/e2e/_helpers/README.md` dan di header `tests/e2e/_helpers/apk-spec.template.ts`.
