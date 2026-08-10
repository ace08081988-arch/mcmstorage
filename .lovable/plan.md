# Audit Ulang Mendalam — ACE STORAGE (rencana, tanpa perubahan kode)

Audit dibaca langsung dari source HEAD dan definisi fungsi database saat ini, bukan dari klaim sprint lama. Bagian yang belum saya buktikan saya tandai belum terverifikasi dan saya jadikan langkah pertama sebelum perbaikan.

## 1. State machine kanonik (target)

```text
TUGAS dibuat (prep_tasks: active)
   -> link + PIN dibuka pegawai (t/$token)
   -> foto + editor + lokasi -> SUBMIT (prep_submissions, client_key idempoten)
   -> SIAP: request_preparations / ecer_preparations (verification_status: pending|verified|rejected)
   -> ADMIN isi harga + metode bayar (kas | DP/partial | hutang)  <- saat pembeli minta kirim
   -> KIRIM (WhatsApp atau Ace Chat) berisi foto + maps + status bayar
   -> hanya jika kirim terkonfirmasi: TERKIRIM (sold_at terisi, sales + debts tercatat)
   -> RIWAYAT PESANAN (read-only; pembatalan hanya lewat unsend yang tercatat audit)
```

Satu status kanonik = kombinasi `verification_status` + `sold_at` + baris `sales`/`debts`. Hari ini status tersebar di banyak kolom di tabel berbeda (`request_preparations`, `ecer_preparations`, `ready_packages.status`, `self_prep_items.status`, `prep_submissions.sent_at`), sehingga UI harus menebak.

## 2. Temuan terverifikasi

### P0

1. **Stok dipotong saat SUBMIT pegawai, bukan saat kirim.** Trigger `apply_ecer_preparation`, `apply_request_preparation_item`, dan `apply_ready_package` mengurangi `warehouse_items.stock_base` pada INSERT. Saat `sold_at` diisi, trigger mengembalikan stok lalu RPC kirim menyisipkan `sales` yang memotong lagi. Net memang 1x, tetapi rantainya rapuh: tiap jalur hapus/unsend/gagal-di-tengah punya aturan pengembalian berbeda (`ready`/`failed` dikembalikan, `sent`/`archived` tidak, `cancelled` tidak). Ini kandidat terkuat penyebab "stok terasa ngawur".
2. **Tidak ada kunci idempotensi pada RPC kirim.** `send_request_prep_to_customer` dan `send_ecer_preps_to_customer` hanya dilindungi filter `sold_at IS NULL`. Di WebView Android yang lambat, tap ganda atau retry sesudah timeout bisa menghasilkan dua baris `sales`/`debts` bila commit pertama sebenarnya berhasil.
3. **Konfirmasi "terkirim" dari WhatsApp tidak dapat dipercaya.** `src/routes/_authenticated.request.tsx` (~3038-3055) menandai sukses berdasar hasil share sheet; Web Share API tidak melaporkan apakah pesan benar-benar terkirim, jadi status Terkirim bisa muncul untuk pesan yang tak pernah dikirim. Ace Chat aman karena ada bukti pesan.
4. **Banyak jalur penulisan status paralel.** `unsend_request_prep`, `fix_request_prep_payment`, update langsung `prep_tasks.status` dari klien (`request.tsx` ~4028), `prep_submissions_mark_sent`/`unmark_sent`, plus kolom status di `self_prep_items` dan `ready_packages`. Tiap jalur bisa menggeser status tanpa melewati state machine, sehingga lompat status dan desinkronisasi bayar/kirim mungkin terjadi.

### P1

5. **ECER dan Request memakai dua tabel dan dua RPC kirim yang logikanya nyaris identik tapi tidak sama** (alokasi harga proporsional, penanganan DP, penulisan `debts`). Perbedaan kecil menghasilkan saldo berbeda untuk kasus yang sama.
6. **Fan-out query dan realtime berlebihan.** 36 pemanggilan `.channel(...)`, 37 `setInterval`, dan Gudang melakukan sekitar 30 pemanggilan Supabase per `reloadAllNow`. Di APK ini terasa berat dan memicu render storm setelah app resume.
7. **Tidak ada virtualisasi daftar.** Tidak ditemukan `useVirtualizer`/`react-window`; daftar besar (Gudang, Request, ECER, Chat) dirender penuh.
8. **Rute raksasa** — `t.$token.tsx` 5383, `ecer.tsx` 5084, `gudang.tsx` 4796, `request.tsx` 4450, `chat.$conversationId.tsx` 3417 baris. Satu perubahan state me-render ulang pohon besar; ini penyebab struktural lag di perangkat kelas menengah.

### P2

9. Grid `grid-cols-3`/`grid-cols-4` tanpa breakpoint pada beberapa toolbar (`ecer.tsx` 1238, `t.$token.tsx` 3896, beberapa blok `gudang.tsx`) berisiko terpotong di 320px dan pada font scaling 200%.
10. `PhotoEditorV2.tsx` 1718 baris dalam satu komponen; decode/edit foto berjalan di thread utama saat perangkat menahan kamera/galeri.

## 3. Perlu diverifikasi dulu (diukur sebelum diperbaiki)

- Perilaku AppLock saat kembali dari kamera/galeri di Capacitor (apakah state editor hilang).
- Inset keyboard/visualViewport di 320/360/411/480 px dan font scaling 200%, memakai skrip audit overflow yang sudah ada di repo.
- Apakah judul ECER benar-benar terkunci per tugas lewat `prep_task_request_titles` di semua jalur.
- Jumlah channel realtime yang aktif bersamaan dalam satu sesi APK.

## 4. Rencana implementasi (batch kecil, berurutan)

**Batch 0 — Instrumentasi dan bukti.** Audit responsif 320/360/411/480 + font 200%, penghitung channel realtime dan jumlah query per halaman, profil render Gudang/Request/ECER. Output: angka sebelum-sesudah. Tanpa perubahan perilaku.

**Batch 1 — Satu sumber status.** `src/lib/prep-status.ts` menjadi satu-satunya penentu status untuk Request, ECER, dashboard, dan riwayat. Semua badge dan tombol membacanya. Tanpa perubahan database.

**Batch 2 — Konfirmasi kirim yang jujur (P0-3).** Untuk kanal WhatsApp, setelah share sheet tampilkan konfirmasi eksplisit "Sudah terkirim / Belum". Hanya "Sudah" yang memanggil RPC pencatatan. Ace Chat tetap otomatis.

**Batch 3 — Idempotensi kirim (P0-2).** Migrasi menambah `client_key` unik pada jalur kirim mengikuti pola `worker_submit_idempotency`, dengan urutan lock -> reserve -> mutate. Klien mengirim key dari `src/lib/submit-idempotency.ts`.

**Batch 4 — Ledger stok sebagai kebenaran (P0-1).** Rekonsiliasi dulu: bandingkan `stock_ledger` dengan `warehouse_items.stock_base` untuk semua produk dan laporkan selisih. Baru setelah laporan bersih, putuskan memindahkan pemotongan ke titik kirim atau mempertahankannya di submit dengan reservasi eksplisit. Trigger tidak diubah sebelum itu.

**Batch 5 — Penyatuan ECER dan Request (P1-5).** Satu fungsi internal penghitung alokasi harga dan pembayaran dipakai kedua RPC kirim. Kasus yang sekarang benar tidak berubah; hanya DP dan pembulatan yang diseragamkan.

**Batch 6 — Performa.** Satu multiplexer realtime per halaman, penggabungan fan-out query Gudang, virtualisasi 4 daftar terbesar, pemecahan rute raksasa menjadi komponen memo.

**Batch 7 — Responsivitas dan PhotoEditor.** Perbaikan grid tanpa breakpoint, safe-area, bottom nav/FAB, dan dialog pada 320px serta font 200%; decode/resize foto dipindah ke worker.

## 5. Tes baru

- Kirim gagal atau dibatalkan tidak menghasilkan `sales`, `debts`, maupun `sold_at`.
- Dua panggilan kirim dengan key sama menghasilkan satu `sales`.
- Rekonsiliasi ledger versus `stock_base` menunjukkan nol selisih.
- Paritas ECER dan Request untuk kas, DP, dan hutang dengan angka identik.
- Viewport 320/360/411/480 dan font 200% tanpa scroll horizontal pada request, ecer, gudang, tugas, t/$token, dan chat.

## 6. Kriteria diterima

Status di UI selalu sama dengan status database; stok berkurang tepat satu kali dan cocok dengan ledger; tidak ada baris Terkirim tanpa bukti kirim; saldo hutang dan piutang identik antara ringkasan dan detail; tidak ada scroll horizontal pada 320px dan font 200%; jumlah query halaman Gudang serta channel realtime turun secara terukur.

## 7. Risiko regresi

Mengubah titik pemotongan stok paling berisiko, karena itu ditempatkan setelah rekonsiliasi dan bersifat forward-only. Konfirmasi kirim manual menambah satu ketukan bagi pemilik, disengaja demi status yang benar. Virtualisasi daftar dapat mengubah perilaku scroll-restore, jadi diuji per halaman.

Tidak ada build APK, tidak ada permintaan keystore, dan tidak ada perubahan data produksi pada tahap ini. Brand ACE STORAGE dan appId `biz.mcmstorage.app` dipertahankan.