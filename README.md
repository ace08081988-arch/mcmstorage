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

<!-- APK_TABLE:START (generated — jangan edit manual) -->

> Dihasilkan otomatis oleh `bun run e2e:apk:table` dari header project block APK di `playwright.config.ts` + deteksi mode di setiap spec (aturan sama dengan `bun run e2e:apk:validate`). Jangan edit blok ini secara manual — jalankan generator ulang.

| Spec | Skenario | Mode | Guards checklist (aktual) |
|---|---|---|---|
| <a id="apk-scenario-availability-refresh-storage"></a>`apk-availability-refresh-storage.spec.ts` | Tombol <DownloadStorageApkShortcut> — idle "Belum tersedia" → tap ikon refresh Storage → aktif "Unduh APK Storage". Hanya flag Storage di-flip; flag Chat sengaja dibiarkan kosong. | `terminalGuard-only` | ✓ primeInitial + assertPrimed ✓ waitForServed ✓ trackedClick(expected.storage=1) ✓ assertQuiescent ✓ terminalGuard() (mode: terminal) |
| <a id="apk-scenario-availability-refresh"></a>`apk-availability-refresh.spec.ts` | Tombol pintas Pengaturan — alur idle "Belum tersedia" → tap ikon refresh varian Chat → state aktif "Unduh APK Chat". | `terminalGuard-only` | ✓ primeInitial + assertPrimed ✓ waitForServed ✓ trackedClick(expected.chat=1) ✓ assertQuiescent ✓ terminalGuard() (mode: terminal) |
| <a id="apk-scenario-example-terminal-only"></a>`apk-example-terminal-only.spec.ts` | Mount kedua varian kosong → refetch Chat via trackedClick → state aktif "Unduh APK Chat". | `terminalGuard-only` | ✓ primeInitial + assertPrimed ✓ waitForServed ✓ trackedClick(expected.chat=1) ✓ assertQuiescent ✓ terminalGuard() (mode: terminal) |
| <a id="apk-scenario-min-validate-form"></a>`apk-min-validate-form.spec.ts` | Form validasi `minSupported` di Pengaturan APK. | *form-only* | (spec form murni — bukan flow getApkVariantDetail, tidak memakai apk-stub / terminalGuard). |
| <a id="apk-scenario-mount-quiescent"></a>`apk-mount-quiescent.spec.ts` | Mount murni — buka /lovable/visual/apk-availability-shortcuts dengan kedua varian merespons kosong; tidak ada aksi user. | `terminalGuard-only` | ✓ primeInitial + assertPrimed ✓ waitForServed (tidak ada trackedClick — mount-only) ✓ assertQuiescent ✓ terminalGuard() (mode: terminal) |
| <a id="apk-scenario-refresh-single-refetch"></a>`apk-refresh-single-refetch.spec.ts` | Tap refresh Storage sekali → observasi servedCount & request count untuk kedua varian. | `terminalGuard-only` | ✓ primeInitial + assertPrimed ✓ waitForServed ✓ trackedClick(expected.storage=1) ✓ assertQuiescent ✓ terminalGuard() (mode: terminal) |

<!-- APK_TABLE:END -->

**Cara membaca tabel:** kolom `Mode` menampilkan mode aktual hasil deteksi validator (`installApkStub` / `installServerFnPassthroughGuard`) di setiap spec. Kolom `Guards checklist (aktual)` disalin apa adanya dari header project block APK di `playwright.config.ts` — sumber yang sama dengan `bun run e2e:apk:validate`. Untuk memperbarui tabel setelah menambah / mengubah spec, jalankan `bun run e2e:apk:table` (atau `bun run e2e:apk:table:check` di CI untuk mendeteksi drift).

### Arti setiap item checklist Guards

Setiap project block `apk-*` di `playwright.config.ts` wajib memuat kolom `Guards` dengan checklist yang sesuai mode. Validator (`bun run e2e:apk:validate`) memastikan checklist tidak boleh kontradiksi dengan isi spec.

| Item | Mode | Arti | Contoh singkat |
|---|---|---|---|
| `primeInitial + assertPrimed` | terminal / full | Respons untuk fetch awal di-enqueue SEBELUM `page.goto()`, dan setup sudah benar-benar lengkap sebelum navigasi. Tanpa ini test bisa hang karena waiter tidak pernah di-fulfill. | ```ts
stub.primeInitial();
stub.assertPrimed();
await page.goto(URL);
``` |
| `waitForServed` | terminal / full | Sinkronisasi deterministik: tunggu handler memberi respons untuk fetch awal sebelum assertion UI. Menghindari race antara render React dan data stub. | ```ts
await stub.waitForServed("chat", 1);
await stub.waitForServed("storage", 1);
// baru assert label idle
await expect(chatDl.getByText("Belum tersedia")).toBeVisible();
``` |
| `trackedClick(expected.<variant>=N)` | terminal / full | Setiap tap yang memicu refetch dibungkus guard per-aksi. `expected` sekaligus jadi regression check: kalau tap tiba-tiba tidak memicu request, test gagal. | ```ts
stub.enqueue("chat", [makeRelease("chat")]);
await stub.trackedClick(chatRefresh, { expected: { chat: 1 } });
``` |
| `trackedAction(...)` | terminal / full | Sama seperti `trackedClick`, tetapi untuk aksi non-klik: keyboard, drag, focus, dsb. | ```ts
await stub.trackedAction(
  async () => { await page.keyboard.press("Enter"); },
  { expected: { storage: 1 } },
);
``` |
| `assertQuiescent` | terminal / full | Setelah state aktif tercapai, verifikasi handler benar-benar idle selama window waktu tertentu. Menangkap polling / interval / refetch-on-focus. | ```ts
await stub.assertQuiescent("chat", { windowMs: 1000, stableTicks: 5 });
await stub.assertQuiescent("storage", { windowMs: 500, stableTicks: 5 });
``` |
| `terminalGuard()` | terminal / full | Guard akhir di penghujung spec dengan window default `APK_STUB_TERMINAL_WINDOW_MS`. Membuktikan kedua varian bebas leak jangka panjang. | ```ts
await stub.terminalGuard();
``` |
| `passthrough.assertNoAdditionalRequests` | full | Tambahan dari `installServerFnPassthroughGuard`. Memastikan tidak ada server function tak terduga yang terpanggil di luar whitelist selama aksi copy/export. | ```ts
const passthrough = await installServerFnPassthroughGuard(page, {
  whitelist: ["getApkVariantDetail", "getChatCopyLink"],
});
// ... skenario APK + copy/export ...
await passthrough.assertNoAdditionalRequests();
``` |
| `tidak memakai apk-stub / terminalGuard` | form-only | Penanda eksplisit bahwa spec ini bukan flow `getApkVariantDetail` dan tidak memasang stub APK. | `// Guards : spec form murni — tidak memakai apk-stub / terminalGuard` |
| `(mode: terminal)` | terminal | Penanda bahwa spec hanya memakai `installApkStub` tanpa `installServerFnPassthroughGuard`. | `// Guards : ... (mode: terminal)` |
| `(mode: full)` | full | Penanda bahwa spec memasang `installServerFnPassthroughGuard` selain `installApkStub`. | `// Guards : ... (mode: full)` |
### Catatan tentang mode dan konsekuensi jika guard tidak terpenuhi

Mode yang tertera di kolom `Guards` bukan sekadar label; dia merefleksikan setup stub yang benar-benar dipasang di spec. Jika isi spec tidak sesuai tag-nya, validator (`bun run e2e:apk:validate`) akan langsung gagal di CI.

**Mode `terminal`** berarti spec hanya memasang `installApkStub`. Semua request yang muncul di test — baik fetch awal, refetch, maupun kebocoran polling — ditangani dan dihitung oleh stub APK. Konsekuensi jika guard wajib tidak terpenuhi:

- Tanpa `primeInitial + assertPrimed` sebelum `page.goto()`: waiter fetch awal tidak punya respons, test hang atau gagal dengan timeout tanpa jejak yang jelas.
- Tanpa `waitForServed`: assertion UI bisa jalan sebelum React render state kosong, menghasilkan flake yang sulit didebug.
- Tanpa `trackedClick` / `trackedAction` untuk aksi refetch: tap yang tidak memicu request tidak terdeteksi; regresi "tombol refresh mati" lolos.
- Tanpa `assertQuiescent`: polling background, refetch-on-focus, atau interval kecil bisa lolos dan membuat test green padahal aplikasi masih ngomong ke server.
- Tanpa `terminalGuard()` di akhir: leak jangka panjang pada `getApkVariantDetail` (satu atau kedua varian) tidak tertangkap.

**Mode `full`** berarti spec memasang `installApkStub` DAN `installServerFnPassthroughGuard`. Mode ini wajib kalau aksi user juga memicu server function di luar `getApkVariantDetail`, misalnya copy/export link chat. Konsekuensi jika guard wajib tidak terpenuhi:

- Tanpa `installServerFnPassthroughGuard` atau tanpa `passthrough.assertNoAdditionalRequests`: round-trip server function non-APK (copy, export, toggle) bisa bocor tanpa terdeteksi.
- Tanpa `passthrough.dispose()` di akhir (atau setelah assert): guard tetap menangkap request di spec berikutnya dan menyebabkan kegagalan yang sebenarnya bukan regresi target.
- Mode `full` TIDAK menghapus kewajiban `terminalGuard()`. Kedua guard harus ada: terminal guard untuk leak APK, passthrough guard untuk leak server function lain.

**Mode `form-only`** berarti spec tidak memakai `installApkStub` sama sekali. Jika kolom `Guards` tidak menyebut eksplisit "tidak memakai apk-stub / terminalGuard", validator akan menolak karena bisa terjadi spec form yang secara tidak sengaja diberi tag mode stub.

Singkatnya: tag mode harus jujur terhadap kode, dan setiap checklist item memiliki satu kegagalan spesifik yang akan lolos kalau item itu dihapus. Itulah sebabnya validator memeriksa checklist secara ketat di CI.

### Perintah yang sering dipakai

```bash
# Jalankan semua spec APK sekaligus
bun run test:e2e:apk

# Mode terminal (hanya APK stub)
bun run test:e2e:apk:terminal

# Mode full (APK stub + passthrough server function)
bun run test:e2e:apk:full

# Regenerasi scaffold (dry-run)
bun run e2e:apk:regen

# Regenerasi mode terminal/full
bun run e2e:apk:regen:terminal
bun run e2e:apk:regen:full

# Regenerasi dan langsung tulis (apply)
bun run e2e:apk:regen:apply

# Validasi header & checklist Guards
bun run e2e:apk:validate

# Scaffold satu spec baru
node scripts/scaffold-apk-e2e-spec.mjs --name <flow-name> --mode terminal
node scripts/scaffold-apk-e2e-spec.mjs --name <flow-name> --mode full
```

### Perintah npm

Jika proyek ini dijalankan tanpa `bun`, pakai perintah `npm` di bawah. Semua script di atas tetap memanggil runner Playwright melalui `node`, sehingga hasilnya identik:

```bash
# Jalankan semua spec APK sekaligus
npm run test:e2e:apk

# Jalankan hanya spec APK mode terminal
npm run test:e2e:apk:terminal

# Jalankan hanya spec APK mode full
npm run test:e2e:apk:full

# Jalankan satu spec langsung via Playwright (contoh: mode terminal)
npx playwright test --project=apk-mount-quiescent-e2e

# Jalankan satu spec langsung via Playwright (contoh: mode full)
npx playwright test --project=copy-chat-apk-aria-label-e2e

# Regenerasi, validasi, dan scaffold via npm
npm run e2e:apk:regen
npm run e2e:apk:regen:terminal
npm run e2e:apk:regen:full
npm run e2e:apk:regen:apply
npm run e2e:apk:validate

# Scaffold satu spec baru
node scripts/scaffold-apk-e2e-spec.mjs --name <flow-name> --mode terminal
node scripts/scaffold-apk-e2e-spec.mjs --name <flow-name> --mode full
```

### Troubleshooting validasi (`bun run e2e:apk:validate`)

Validator gagal umumnya karena project block di `playwright.config.ts` tidak cocak dengan isi spec. Berikut penyebab paling sering dan cara memperbaikinya.

| Pesan error / gejala | Penyebab | Cara perbaiki |
|---|---|---|
| `project "...-e2e" tidak ditemukan di playwright.config.ts` | Spec ada tapi project block belum ditambahkan, atau nama project tidak cocak (harus `<flow>-e2e`). | Tambahkan project block di `playwright.config.ts`, atau jalankan `bun run e2e:apk:regen:apply` untuk sinkron ulang. |
| `kolom "// Skenario :" hilang` / `kolom "// Guards :" kosong` | Header project block tidak memuat keempat kolom wajib: `Skenario`, `Harness`, `Tujuan`, `Guards`. | Lengkapi komentar header di atas `name:` project block; contoh format ada di template. |
| `kolom "// Guards :" masih memuat placeholder TODO` | Header baru dibuat scaffold dan belum diisi. | Ganti teks `TODO — ...` / `TODO(scaffold)` dengan deskripsi riil. |
| `spec form-only ... Guards harus eksplisit menyebut "tidak memakai apk-stub / terminalGuard"` | Spec tidak memanggil `installApkStub`, tapi kolom `Guards` tidak mencantumkan penanda `form-only`. | Tambahkan kalimat seperti `// spec form murni — tidak memakai apk-stub / terminalGuard` di kolom `Guards`. |
| `spec form-only tidak boleh memuat "(mode: terminal)"` | Spec form diberi tag mode terminal/full padahal tidak memakai stub. | Hapus `(mode: terminal)` / `(mode: full)` dari kolom `Guards` form-only. |
| `Guards tidak memuat penanda "(mode: terminal)" / "(mode: full)"` | Spec memakai `installApkStub` tapi `Guards` tidak mencantumkan tag mode. | Tambahkan `(mode: terminal)` bila hanya `installApkStub`, atau `(mode: full)` bila juga ada `installServerFnPassthroughGuard`. |
| `Guards menandai "(mode: terminal)" tapi spec sebenarnya "full"` | Tag mode di `Guards` tidak sesuai dengan setup stub di spec. | Perbaiki tag mode, atau ubah spec: tambah/hapus `installServerFnPassthroughGuard` sesuai flow. |
| `Guards tidak memuat penanda primeInitial/assertPrimed/waitForServed/assertQuiescent/terminalGuard()` | Checklist dasar stub belum lengkap. | Tambahkan item yang hilang ke kolom `Guards` (hanya penanda teks, tidak harus kode runnable). |
| `mode full: Guards WAJIB memuat "✓ passthrough.assertNoAdditionalRequests"` | Spec `full` memakai `installServerFnPassthroughGuard` tapi `Guards` tidak mencantumkan assert tersebut. | Tambahkan `✓ passthrough.assertNoAdditionalRequests` di kolom `Guards`. |
| `mode terminal: Guards TIDAK boleh memuat "passthrough.assertNoAdditionalRequests"` | Spec terminal tidak memakai passthrough guard, tapi kolom `Guards` mencantumkannya. | Hapus `passthrough.assertNoAdditionalRequests` dari `Guards`. |
| `README.md drift: tabel pemetaan APK sudah tidak sinkron` (dari `e2e:apk:table:check`) | Tabel di README beda dengan hasil generator. | Jalankan `bun run e2e:apk:table` untuk regenerate tabel. |

**Cara debug cepat:**

1. Lihat mode aktual spec: `grep -E "installApkStub|installServerFnPassthroughGuard" tests/e2e/apk-<flow>.spec.ts`.
2. Lihat header project block: `grep -n -A8 "name: \"apk-<flow>-e2e\"" playwright.config.ts`.
3. Setelah mengubah spec atau header, jalankan `bun run e2e:apk:validate` lagi, lalu `bun run e2e:apk:table` bila README perlu diperbarui.

### Template copy-paste header spec

Di bawah ini header komentar yang bisa langsung di-copy-paste ke bagian atas setiap `tests/e2e/apk-<flow>.spec.ts`. Ganti `<flow-name>`, `<URL>`, dan teks TODO dengan nilai riil. Penanda `Guards` menggunakan format yang sama dengan validator / tabel README.

#### Mode `terminal` (hanya `installApkStub`)

```ts
// README scenario: README.md#apk-scenario-<flow-name>
// Skenario : <aksi user yang diuji, mis. tap refresh Chat dari idle>
// Harness  : <route/harness, mis. /lovable/visual/apk-availability-shortcuts>
// Tujuan   : <invariant yang dibuktikan, mis. tidak ada leak getApkVariantDetail>
// Guards   : ✓ primeInitial + assertPrimed
//            ✓ waitForServed
//            ✓ trackedClick(expected: { chat: 1 })
//            ✓ assertQuiescent
//            ✓ terminalGuard() (mode: terminal)
```

#### Mode `full` (`installApkStub` + `installServerFnPassthroughGuard`)

```ts
// README scenario: README.md#apk-scenario-<flow-name>
// Skenario : <aksi user yang diuji, mis. copy link APK Chat lalu refresh>
// Harness  : <route/harness, mis. /lovable/visual/apk-availability-shortcuts>
// Tujuan   : <invariant yang dibuktikan, mis. tidak ada leak server function APK & non-APK>
// Guards   : ✓ primeInitial + assertPrimed
//            ✓ waitForServed
//            ✓ trackedClick / trackedAction
//            ✓ assertQuiescent
//            ✓ terminalGuard()
//            ✓ passthrough.assertNoAdditionalRequests (mode: full)
```

#### Mode `form-only` (tidak memakai stub APK)

```ts
// README scenario: README.md#apk-scenario-<flow-name>
// Skenario : <form / validasi yang diuji, mis. form minSupported>
// Harness  : <route/harness>
// Tujuan   : <invariant UI / validasi>
// Guards   : spec form murni — tidak memakai apk-stub / terminalGuard
```

Rincian teknis helper stub dan pola anti-pattern ada di `tests/e2e/_helpers/README.md` dan di header `tests/e2e/_helpers/apk-spec.template.ts`.
