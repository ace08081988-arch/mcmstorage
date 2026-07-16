## Tujuan

Semua input angka di aplikasi menampilkan dan menerima format id-ID:
- Titik `.` sebagai pemisah ribuan
- Koma `,` sebagai pemisah desimal
- Format aktif **live saat mengetik** (bukan hanya saat blur)
- Berlaku konsisten di **semua** field angka (harga, kuantitas, stok, durasi, umur, versi APK) — kecuali PIN/OTP/AppLock/device-verify/visual-test yang eksplisit dilarang.

Display di luar input (kartu, total, list) juga dirapikan pakai helper yang sama supaya tampilan seragam.

## Pendekatan teknis

### 1. Satu komponen shared baru: `NumericInputID`

Menggantikan `NumericDraftInput` sebagai SSOT. Perilaku:

- `type="text"` + `inputMode="decimal"` (Android tetap dapat keypad numerik + tombol koma).
- State internal string ter-format (`"1.500,50"`). Setiap keystroke:
  1. Ambil `selectionStart` sebelum re-format.
  2. Buang semua karakter selain digit dan satu koma pertama.
  3. Format ulang bagian integer dengan `Intl.NumberFormat('id-ID')` (titik ribuan).
  4. Hitung ulang posisi kursor: hitung jumlah digit sebelum kursor pada string lama, cari indeks setelah digit ke-N pada string baru, setSelectionRange di `requestAnimationFrame` supaya tidak lompat ke akhir.
- Parsing → number: hapus semua `.`, ganti `,` jadi `.`, `parseFloat`. `onCommit(numberOrNull)` dipanggil hanya saat nilai valid dalam `[min,max]`.
- Prop `decimal: boolean` — kalau `false`, koma diblokir total (untuk stok pcs/umur/versi).
- Prop `maxDecimals` (default 2 untuk decimal, 0 untuk integer) — koma kedua diabaikan, digit desimal di-trim.
- Sinkron dari `value` prop (parent) hanya saat input tidak fokus, mencegah refetch menimpa ketikan.
- Empty state: `raw = ""` tampil kosong; saat blur, kalau kosong → commit `emptyCommitsTo` (biasanya `min` atau `0`, konfigurable) dan display ulang ter-format.
- Leading zero: `"007"` → `"7"`; `",5"` diformat jadi `"0,5"`.

### 2. Helper display seragam

`src/lib/formatNumberID.ts` — dua fungsi:
- `formatIntegerID(n)` → `"1.500"`
- `formatDecimalID(n, maxDecimals=2)` → `"1.500,50"` (trailing-zero trim opsional lewat argumen ketiga).

Semua tempat yang saat ini pakai `toLocaleString('id-ID')` atau string interpolation manual dialihkan ke helper ini agar konsisten.

### 3. Migrasi menyeluruh (single sweep)

Ganti setiap input angka di file-file berikut jadi `<NumericInputID>`. Wrapper `SmartWeightInput` di-refactor: pcs fallback pakai `NumericInputID`, tapi tombol berat (½, 1 kg, dll.) tetap. Parser existing di `parseFractionalGrams` tetap dipertahankan untuk input berat spesial (fraksi seperti `1/2`), tapi angka polos lewat `NumericInputID`.

File yang disentuh (business + settings + tugas, sesuai scope yang sudah Anda setujui sebelumnya):

- `src/routes/_authenticated.index.tsx` (Beranda / Ecer — sudah pakai NumericDraftInput → ganti import + prop)
- `src/routes/_authenticated.gudang.tsx` (Beli, Stok, hutang/piutang, pembayaran)
- `src/routes/pos-kasir.index.tsx`
- `src/routes/_authenticated.request.tsx`
- `src/routes/_authenticated.hutang-piutang.tsx`
- `src/routes/_authenticated.pengaturan-apk.tsx`, `pengaturan-kunci.tsx`, `link-pegawai.tsx`, `tugas-baru.tsx`
- `src/components/SmartWeightInput.tsx`, `ChatHeaderDebtControls.tsx`, `SellSelfPrepDialog.tsx`, `ReadyPackagesPanel.tsx`, `SharePinDialog.tsx`, `label-preview*`, diagnostik.

**Tidak disentuh (whitelist eksplisit)**: PIN, OTP, AppLock, device-verify, `lovable.visual.*` — sesuai scope sebelumnya.

### 4. Business logic invariants (dijaga)

- `packageSize: "1"` default saat `packageType === "botol"` di Gudang → tetap.
- Perbandingan angka di logic (bukan display) selalu pakai hasil parse (`Number`), tidak pernah string ter-format.
- RLS/DB write tetap kirim `number` murni.

### 5. Verifikasi

- `bunx tsgo --noEmit` bersih.
- Playwright smoke di localhost:8080 untuk 3 skenario kritikal:
  1. Beranda Ecer: input harga "12500", cek display "12.500", backspace 1 kali → "1.250" (bukan lompat cursor).
  2. Gudang Beli: input berat "0,5", pcs isi 12 → total tersimpan `number` benar.
  3. POS Kasir: total transaksi tampil "Rp 1.234.567,50" konsisten.
- Screenshot 411px untuk Beranda, Gudang, POS.

## Risiko yang saya sadari

- **Cursor jump saat live-format** adalah bug klasik. Mitigasi: hitung ulang posisi kursor berbasis "jumlah digit sebelum caret" dan set di `requestAnimationFrame` — bukan sekadar `setSelectionRange` sinkron.
- **IME/composition Android**: `onCompositionStart/End` di-handle supaya reformat ditunda selama composing.
- **Diff besar**: karena Anda pilih "semua sekaligus", saya akan tetap commit satu perubahan dan minta Anda cek di device sebelum publish. Kalau ada regresi per menu, kita revisi bertarget.

## Yang tidak berubah

- Backend, RLS, schema DB.
- Business logic apapun.
- Sensitive inputs (PIN/OTP/AppLock/device-verify/visual-test).
- Tema Noir & Gold, layout, komponen shell.
