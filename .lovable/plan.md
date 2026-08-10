# Audit lanjutan alur foto & portal pegawai — rencana Batch 3

## Yang sudah terverifikasi selesai (tidak dikerjakan ulang)
- Editor wajib: `src/lib/prep-submit-gate.ts` + penanda `edited` di `src/lib/prep-file-staging.ts` sudah dipakai portal pegawai (`src/routes/t.$token.tsx`) dan `/request`.
- Error boundary + retry chunk untuk editor: `src/components/photo-editor/LazyPhotoEditorV2.tsx`.
- Relock palsu saat kamera/galeri/share: suppression ber-reference-count di `src/lib/app-lock.ts`.
- Draft tidak hilang saat WebView recreate: foto di IndexedDB (`prep-draft-store.ts`) + catatan/lokasi/GPS/jumlah di `prep-draft-fields.ts`.
- Inset keyboard pada footer sticky portal, input jumlah berlabel dan ramah 360px.
- Kirim wajib dikonfirmasi sebelum Terkirim/Riwayat (`post-share-confirm.ts`, alur WA vs Ace Chat).
- Integritas stok/idempotensi (lock → reserve → mutate), `stock_ledger`, revoke sesi, hardening upload, `search_path` fungsi yang dilaporkan sebelumnya.

## Temuan yang masih terbuka

### Critical
**C1. `/ecer` belum memakai gate bersama.**
`src/routes/_authenticated.ecer.tsx` masih punya validasi sendiri (`save()` ~baris 3245). Foto memang hanya bisa masuk lewat editor di layar ini, tapi aturan lokasi/URL diduplikasi sehingga mudah menyimpang lagi dari `/request` dan portal.
Perbaikan: ganti blok validasi foto+lokasi dengan `validateSubmitGate`, pertahankan validasi berat/stok yang khusus ECER dan pertahankan pesan multi-issue yang sudah ada.

### High
**H1. Editor belum bisa menggabungkan foto kedua.**
`src/components/photo-editor/engine/scene.ts` hanya mengenal objek `draw`, `shape`, `text`, `sticker` — tidak ada layer gambar. Ini satu-satunya kemampuan editor yang diminta pemilik namun belum ada.
Perbaikan: tambah `kind: "image"` pada scene (src, x/y/w/h/rotasi/opacity), render di kanvas, ikutkan di undo/redo, layer panel, dan pipeline export; tombol "Tambah foto" di toolbar memakai `openFilePickerWithLock` supaya tidak memicu relock.

**H2. Editor legacy masih ada dua salinan.**
`src/components/PhotoEditor.tsx` (2013 baris) hanya dipakai `src/routes/lovable.visual.photo-editor.tsx`. Risiko: perbaikan masa depan salah sasaran.
Perbaikan: arahkan route visual ke V2, hapus komponen legacy.

### Medium
**M1. Verifikasi lebar 360–411px & font 200%** untuk portal pegawai, dialog Request, dan dialog ECER lewat Playwright (screenshot 360/390/411), perbaiki hanya kontrol yang benar-benar terpotong.
**M2. Lint database:** masih ada peringatan `SECURITY DEFINER` yang bisa dieksekusi anon dan extension di schema public. Perlu keputusan pemilik dulu — beberapa fungsi memang harus dipanggil portal pegawai tanpa login (alur token+PIN), jadi tidak boleh dicabut membabi buta. Rencana: inventarisasi fungsi mana yang benar-benar butuh anon, cabut sisanya di migrasi terpisah.

## Detail teknis
- Gate bersama: `validateSubmitGate({ photos, locUrl, gps, allowUnedited })` mengembalikan `{ ok }` atau kode `no-photo | unedited | no-location | bad-url`.
- Layer gambar: sumber dibaca sebagai data URL agar autosave scene JSON tetap utuh setelah WebView recreate; batasi sisi terpanjang (mis. 1600px) sebelum masuk scene supaya memori Android aman.
- Tidak ada perubahan alur bisnis: urutan tetap foto→editor→lokasi→submit→pembayaran→kirim terkonfirmasi.

## Acceptance test
- Unit: gate ECER menolak tanpa lokasi dan tanpa foto; scene serialize/deserialize objek image; undo/redo mengembalikan layer image.
- Unit: toolbar "Tambah foto" memakai pembungkus app-lock (source assertion seperti tes native-guard yang sudah ada).
- Manual/Playwright: 360px — tombol Kamera/Galeri/Simpan tidak terpotong, keyboard terbuka tidak menutup tombol Simpan.
- Regresi: submit tanpa melewati editor tetap ditolak di ketiga layar.

## Perintah verifikasi
```text
bunx tsgo --noEmit
bunx vitest run src/lib/prep-submit-gate.test.ts src/components/photo-editor
bunx vitest run
bun run build
```
Setelah tes, kembalikan artefak generated (`public/data/dependency-trend.json`, benchmark trend) ke kondisi bersih.

## Urutan eksekusi
1. Batch 3a: C1 (gate ECER) + tesnya.
2. Batch 3b: H1 (layer gambar / gabung foto) + tes scene.
3. Batch 3c: H2 (hapus editor legacy) dan M1 (verifikasi 360px).
4. M2 dibahas terpisah karena menyentuh database.
