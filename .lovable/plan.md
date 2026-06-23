
# Rencana — Berlangganan Pro (transfer bank manual)

## Ringkasan singkat

Saat ini MCM Storage 100% gratis dan tidak ada sistem pembayaran sama sekali. Kita akan menambahkan paket **Pro** yang diaktifkan **pemilik akun** lewat **transfer bank manual** dengan **persetujuan admin**. Pegawai yang sudah dihubungkan otomatis ikut menikmati Pro karena semua data dan akses pegawai sudah berjalan di bawah akun pemilik (lewat share token + PIN, bukan akun terpisah) — jadi tidak perlu plumbing tambahan.

## Default yang saya pakai (silakan ubah nanti)

Karena Anda mempersilakan saya memutuskan:

- **Harga Pro:** Rp 99.000 / bulan, atau Rp 990.000 / tahun (hemat ~17%).
- **Uji coba gratis:** 14 hari, tanpa bayar di muka. Otomatis turun ke Free saat habis.
- **Batas paket Free:**
  - Maks. **30** barang gudang.
  - Maks. **50** penjualan per 30 hari terakhir.
  - Maks. **1** kontak pegawai (`staff_contacts`).
  - Maks. **1** perangkat tepercaya (`user_devices`).
  - Modul **Hutang–Piutang**, **kirim chat internal**, dan **notifikasi push** terkunci.
  - Modul Free (gudang, pesanan, pelanggan, supplier, tugas siapkan barang, ECER, request) tetap utuh.
- **Akun lama:** setiap user_id yang sudah ada otomatis dapat masa **30 hari Pro gratis** ("Promo peluncuran") lewat migrasi — jadi tidak ada yang rusak di hari pertama.
- **Rekening bank:** ditaruh di tabel `app_settings` agar Anda edit sendiri lewat halaman admin (default placeholder dulu).

## Arsitektur

```text
┌─────────────────────────────┐    transfer manual + upload bukti
│ /_authenticated/langganan   │ ───────────────────────────────────┐
│ (paket, kuota, upgrade)     │                                    ▼
└────────────┬────────────────┘                          subscription_payments
             │                                              (status=pending)
             │ getMyEntitlement / startProTrial                   │
             ▼                                                    │ admin approve
┌─────────────────────────────┐                                   ▼
│ subscriptions (per user)    │ ◄────────────── extend period ─── /_authenticated/admin/pembayaran
│ plan, status, period_end    │
└────────────┬────────────────┘
             │ has_active_pro()
             ▼
   trigger BEFORE INSERT  ─── caps di warehouse_items, sales, staff_contacts, user_devices
   route gate            ─── /hutang-piutang, push, kirim chat
```

## Yang akan dibangun

### 1. Database (1 migrasi)

- `public.subscriptions` — `user_id` (unik), `plan` (`free|pro`), `status` (`trialing|active|expired|grace|none`), `billing_cycle` (`monthly|yearly|trial|promo`), `period_start`, `period_end`, `trial_used_at`.
- `public.subscription_payments` — `user_id`, `amount_idr`, `billing_cycle`, `sender_name`, `sender_bank`, `transfer_date`, `proof_path`, `status` (`pending|approved|rejected`), `reviewed_by`, `reviewed_at`, `admin_note`.
- `public.app_settings` (singleton) — `bank_name`, `bank_account_number`, `bank_account_holder`, `whatsapp_admin`, `pro_price_monthly_idr`, `pro_price_yearly_idr`.
- Storage bucket `payment-proofs` (privat) + policy: pemilik upload sendiri, admin baca semua.
- Fungsi SECURITY DEFINER:
  - `has_active_pro(uid)` — `status in ('trialing','active','grace') AND period_end > now()`.
  - `get_owner_plan(uid)` — kembalikan plan + period_end (untuk UI).
  - `start_pro_trial()` — bikin baris trialing 14 hari sekali per user.
  - `expire_subscriptions()` — set `status='expired'` kalau `period_end < now()`. Dipanggil pg_cron tiap jam.
  - `admin_approve_payment(_id, _cycle)` — extend `period_end` 30 atau 365 hari, set `status='active'`.
- Trigger `BEFORE INSERT` di `warehouse_items`, `sales`, `staff_contacts`, `user_devices` — kalau bukan Pro dan sudah lewat batas, `RAISE EXCEPTION 'pro_required:<resource>'`.
- Backfill: insert baris promo 30 hari untuk semua user_id yang sudah punya data.
- RLS: user baca subs/payment miliknya; admin (`has_role('admin')`) baca dan update semua.
- GRANT untuk authenticated + service_role di semua tabel baru.

### 2. Server functions (TanStack Start)

- `src/lib/subscription.functions.ts`
  - `getMyEntitlement` (auth) — plan, status, periodEnd, daftar pemakaian vs batas (counts dari DB).
  - `startProTrial` (auth) — panggil `start_pro_trial`.
  - `submitPaymentProof` (auth) — terima `billing_cycle` + path bukti yang sudah di-upload.
  - `adminListPayments` / `adminApprovePayment` / `adminRejectPayment` — cek `has_role('admin')` dulu.
- Hook client `src/hooks/useEntitlement.ts` — bungkus query, expose `isPro`, `caps`, `usage`, `daysLeft`.

### 3. Halaman

- **/pricing** (publik) — ganti card "Pro segera hadir" jadi harga sungguhan + tombol "Mulai uji coba 14 hari" yang mendarat ke `/langganan`.
- **/_authenticated/langganan** — baru:
  - Status paket saat ini, sisa hari, kuota terpakai vs batas.
  - Kalau Free: tombol "Mulai uji coba 14 hari" + bagian "Upgrade Pro": instruksi transfer bank dari `app_settings` + form upload bukti.
  - Riwayat pembayaran.
- **/_authenticated/admin/pembayaran** — baru, gated `has_role('admin')`:
  - Antrian pending, preview bukti, tombol Setujui (pilih siklus) / Tolak (dengan catatan).
  - Form edit `app_settings` (rekening dan harga).

### 4. Gating UI

- `/hutang-piutang` route: kalau `!isPro` → render `<ProPaywall feature="Hutang–Piutang" />` (CTA ke `/langganan`). Yang membayar bisa baca dan tulis seperti biasa.
- Composer chat (`src/components/chat/...`): kalau `!isPro`, tombol kirim disabled + tooltip "Upgrade Pro untuk kirim pesan". Membaca tetap.
- Toggle push notif: dibungkus paywall.
- `/link-pegawai` "Tambah pegawai": jika sudah 1 baris dan `!isPro`, sembunyikan tombol + tampilkan paywall inline.
- Form trust device di `/device-verify`: kalau sudah 1 device dan `!isPro`, tampilkan paywall + tetap izinkan satu sesi non-persisted.
- Form tambah barang gudang dan input sale: cek count sebelum submit (UX cepat). Trigger DB tetap jadi safety net.

### 5. Renewal & expiry

- `pg_cron` tiap jam panggil `expire_subscriptions()`. Saat habis, status → `expired`, plan otomatis dianggap Free.
- Banner di seluruh halaman 7 hari sebelum habis: "Pro berakhir DD MMM. Perpanjang sekarang."
- Tidak ada auto-charge — pengguna harus transfer ulang dan admin setujui lagi.

### 6. Kebersihan

- Hapus copy "Pro segera hadir" yang sekarang.
- `/refund` dan `/terms` ditinjau singkat agar konsisten dengan model bayar manual (refund per kebijakan Anda, default 7 hari setelah transfer kalau belum dipakai — Anda bisa ubah).

## Detail teknis (untuk referensi)

- Sumber kebenaran entitlement: **DB** (`has_active_pro`). Hook client hanya untuk UX.
- Trigger DB pakai `RAISE EXCEPTION 'pro_required:warehouse_items'` dan client-side `friendlyError` memetakan ke pesan ramah Indonesia + ajak upgrade.
- Bucket `payment-proofs` privat; URL preview lewat signed URL 5 menit.
- Tidak ada integrasi Paddle/Stripe/Shopify yang diaktifkan — model bayar manual tidak butuh.
- Semua kueri yang sudah ada tetap dipakai apa adanya; gating dilakukan di layer terpisah (trigger + paywall component) supaya rollback gampang.

## Cara menguji di preview

Karena ini transfer manual, **tidak ada test card**. Alurnya:

1. **Lihat status awal.** Buka `/langganan`. Akun lama langsung Pro 30 hari ("Promo peluncuran"). Untuk simulasi Free, jalankan satu SQL di Lovable Cloud → SQL Editor: `update public.subscriptions set status='expired', period_end=now() - interval '1 day' where user_id = '<uid>';`
2. **Cek paywall.** Refresh `/hutang-piutang` — harus muncul paywall. Coba kirim chat — tombol disabled. Coba tambah barang ke-31 — tertolak dengan pesan upgrade.
3. **Mulai uji coba.** Di `/langganan` klik "Mulai uji coba 14 hari" → semua fitur Pro membuka. Buka `/hutang-piutang` lagi — bisa.
4. **Submit transfer manual.** Di `/langganan` pilih "Bulanan", isi nama pengirim + tanggal transfer, upload bukti apa saja. Status pembayaran jadi *Menunggu konfirmasi*.
5. **Approve sebagai admin.** Buka `/admin/pembayaran` (akun dengan role admin — kalau belum ada, jalankan `insert into public.user_roles (user_id, role) values ('<uid>', 'admin');`). Setujui pembayaran. `period_end` di `subscriptions` mundur 30 hari ke depan, status `active`.
6. **Cek banner perpanjang.** SQL: `update public.subscriptions set period_end = now() + interval '5 days' where user_id='<uid>';` → banner kuning muncul.
7. **Cek expiry.** SQL: `update public.subscriptions set period_end = now() - interval '1 minute' where user_id='<uid>'; select public.expire_subscriptions();` → status `expired`, paywall kembali.
8. **Cek pewarisan pegawai.** Buka link pegawai via `/t/<token>` dengan PIN — semua fitur tugas siapkan barang jalan persis seperti sebelumnya (tidak ada gating di sisi pegawai karena mereka selalu beroperasi sebagai pemilik via SECURITY DEFINER).

## Yang TIDAK termasuk

- Integrasi gateway pembayaran (Paddle / Stripe / Shopify) — sesuai pilihan Anda.
- Faktur PDF otomatis (bisa dijadikan iterasi berikut).
- Refund otomatis — admin proses manual sesuai kebijakan.
- Notifikasi WhatsApp otomatis ke admin saat ada bukti baru (bisa ditambahkan via WA share link nanti).
