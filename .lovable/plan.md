## Konsep baru: "1 kartu = 1 aksi utama"

Prinsip: setiap kartu punya **satu status ringkas** + **satu tombol utama** yang mendorong ke langkah berikutnya. Detail dan aksi sekunder disembunyikan di menu ⋯ atau expand.

---

### A. Beranda — kartu PSR (`ReadyRequestSection` / `_authenticated.index.tsx`)

**Sekarang** (tumpukan badge):
```
🏷 PSR (SPR)
PSR · 0.2 gram
● Tidak cocok
● Belum dikirim
● Cocok: produk + 0.2g
0 kotak siap
┌──────────────────┐
│  Belum ada       │
│  kiriman pegawai │
│  Menunggu foto…  │
│  [ Segarkan ]    │
└──────────────────┘
```

**Rombak jadi** (satu status + satu progress):
```
🏷 PSR (SPR)              ⋯
0,2 gram · 0/1 kotak
━━━━━━━━━━━━━━━━━━━━  0%
⏳ Menunggu foto pegawai
[ Buat / lihat tugas → ]
```

Perubahan konkret:
1. **Gabung 3 badge sinkronisasi** (`Tidak cocok` / `Cocok produk` / `Tersinkron`) → hilangkan dari kartu. Info sinkron hanya muncul saat ada kiriman & bermasalah, sebagai chip kecil di baris kotak (bukan header kartu). Detail lengkap tetap dapat dibuka via ⋯ → "Info sinkronisasi".
2. **Hapus badge "Belum dikirim"** — sudah redundan dengan angka "0/1 kotak" + progress bar.
3. **Panel besar "Belum ada kiriman pegawai"** → jadi 1 baris status + 1 tombol utama kontekstual:
   - 0 kotak & belum ada tugas → `[Buat tugas pegawai]`
   - 0 kotak & tugas sudah ada → `[Buka tugas pegawai]` + link kecil "Segarkan"
   - ≥ 1 kotak → `[Kirim ke pembeli]` (existing; tetap lewat verifikasi bayar `send=1`)
4. **Menu ⋯** menampung: Segarkan, QR, Detail sinkron, Kelola paket. Menghilangkan grid tombol yang berserakan.

Guardrail yang dipertahankan (tidak diubah):
- Tombol kosong tetap navigasi ke `/tugas` atau `/tugas-baru` (tes `ecer-send-empty-shots-navigation.test.ts`).
- Tombol "Kirim ke pembeli" tetap → `navigate('/ecer', { send: '1' })` (tes `ecer-send-flag-wiring.test.ts`).

---

### B. Halaman `/ecer` — Penyiapan Ecer (`_authenticated.ecer.tsx`)

**Sekarang**: Kartu Terkirim + section terpisah "Kiriman pegawai" dengan 3 tombol sejajar (Segarkan / QR / Kirim WA) + grid foto dengan 2 tombol per foto (WA / Chat).

**Rombak jadi**: Timeline vertikal per-kotak, satu tombol utama per baris.

```
━━ Kotak saya (mandiri) ─────────────
📷  0,9 g · Lunas Rp 900.000
    Terkirim 21/07 · 19.33 · 📍
    [ Detail ▾ ]

━━ Kiriman pegawai · 2 kotak ────────
              ⓘ Cocok via ID + 0,9g
📷  0,9 g · 18 Jul 18.35 · 📍
    [ Kirim ke pembeli ▸ ]        ⋯
📷  0,9 g · 18 Jul 17.45 · unit≠
    [ Kirim ke pembeli ▸ ]        ⋯

[ Segarkan ]   [ QR pegawai ]  ← footer kecil
```

Perubahan konkret:
1. **Satu tombol utama per kotak pegawai** = "Kirim ke pembeli" (memicu `SendEcerPrepsDialog` yang sama, verifikasi bayar tetap jalan). Tombol WA + Chat lama digabung — pilihan channel muncul di dalam dialog konfirmasi (sudah ada di `AutoSendConfirmDialog`).
2. **Hapus tombol besar "Kirim WA" header section**. Aksi massal dipindah ke sticky action bar bila > 1 kotak dipilih (`selectionMode`).
3. **Chip sinkronisasi**: pindah dari teks paragraf "Cocok via warehouse_item_id + 0.9gram (fallback ukuran/unit)" jadi chip ⓘ di header section, tooltip berisi penjelasan lengkap.
4. **Segarkan + QR** → footer section (bukan aksi utama, jarang dipakai).
5. **Menu ⋯ per-kotak**: Buka lokasi, Salin caption, Kirim ulang, Hapus.

Guardrail dipertahankan:
- Alur `autoSend` (search `send=1`) → `AutoSendConfirmDialog` → `SendEcerPrepsDialog` tidak berubah (tes `ecer-send-flag-wiring.test.ts` tetap hijau).
- Caption WA + `📍 Lokasi ambil` tetap.
- Kontrak return-from-WA (`visibilitychange` + fallback 4s) tetap.

---

### Urutan implementasi (2 turn)

**Turn 1 — Beranda kartu PSR** (`ReadyRequestSection.tsx`, ~200 LoC diff):
- Rakit ulang JSX kartu dengan progress bar + 1 status + 1 CTA.
- Sembunyikan badge sinkronisasi & "Belum dikirim" dari header.
- Menu ⋯ (pakai `DropdownMenu` shadcn yang sudah ada).
- Jalankan tes existing (`ecer-send-empty-shots-navigation`, `ecer-send-flag-wiring`).

**Turn 2 — Halaman `/ecer`** (`ReadyEcerSection.tsx`, ~400 LoC diff):
- Ganti grid foto 2-tombol → baris timeline 1-tombol.
- Pindah Segarkan/QR ke footer section.
- Konversi banner sinkronisasi jadi chip + tooltip.
- Menu ⋯ per-kotak.
- Verifikasi `ecer-send-flag-wiring` + snapshot visual `tests/visual/prep-loc-buttons.public.spec.ts`.

Setiap turn: build + vitest run untuk file tes terkait sebelum saya bilang selesai. Tidak ada perubahan RPC / DB / auth / migrasi.

### Yang **tidak** diubah
- Logika `sendWA`, `handleSend`, `SendEcerPrepsDialog`, `AutoSendConfirmDialog`.
- Kontrak `visibilitychange`, `sentCalled`, guard localStorage per-user.
- Tombol "Kirim ke pembeli" tetap lewat verifikasi bayar (`send=1`).
- Fungsi & indeks database.

Setujui rencana ini, atau minta saya balik dulu (mis. cukup Beranda saja, atau tahan menu ⋯)?