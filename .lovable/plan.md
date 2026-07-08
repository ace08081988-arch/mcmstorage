# Gap #5 + #10 — Verifikasi & Status SSOT

## Prinsip

- **Tidak ubah RPC/logic existing.** Kolom lifecycle & verifikasi ditambah, kode lama terus jalan (default = perilaku sekarang).
- **1 SSOT** untuk 11 status di TS + 1 komponen badge dipakai di semua surface.
- **Bahasa Indonesia** untuk label UI, kunci enum tetap English snake_case.

## 1. DB (1 migrasi, additive-only)

**`prep_submissions`** — tambah:
- `verification_status text NOT NULL DEFAULT 'pending'` — nilai: `pending | approved | rejected`
- `verified_at timestamptz`
- `verified_by uuid`
- `rejection_reason text`

**`request_preparations`** & **`ecer_preparations`** — tambah:
- `verification_status text NOT NULL DEFAULT 'approved'` — record lama tetap approved (backward compat)
- `verified_at timestamptz`, `verified_by uuid`, `rejection_reason text`
- `ready_at timestamptz` — di-set saat approve (Request) / saat masuk ecer inventory (Ecer, disiapkan gap #9)
- `archived_at timestamptz` — untuk status Archived

**RPC baru** (tanpa ubah yang lama):
- `prep_submission_verify(_submission_id uuid, _decision text, _reason text)` — hanya admin (has_role). Set `verification_status`, `verified_at`, `verified_by`. Kalau `approved`, set `verification_status='approved'` di `request_preparations`/`ecer_preparations` terkait (via `prep_task_item_id`) + `ready_at=now()`. Kalau `rejected`, simpan alasan; row prep TIDAK dibuat aktif.
- **Trigger**: saat submission baru dibuat via existing `prep_submit_result`, default `verification_status='pending'`. Auto-provisioned row di `request_preparations`/`ecer_preparations` juga default ke `'pending'`.

**GRANT & RLS**: SELECT/UPDATE untuk `authenticated` sudah ada di kedua tabel; kolom baru ikut. Policy tidak diubah.

## 2. Status SSOT (TS)

Buat `src/lib/prep-status.ts`:

```text
LifecycleStatus =
  | 'draft'
  | 'new_request'
  | 'sent_to_employee'
  | 'preparing'
  | 'waiting_verification'
  | 'ready_to_ship'
  | 'waiting_payment'
  | 'paid'
  | 'dp'
  | 'credit'
  | 'sent'
  | 'completed'
  | 'archived'
```

Fungsi utama:
- `deriveRequestStatus(prep, task?, submission?)` → LifecycleStatus
- `deriveEcerStatus(prep, task?, submission?)` → LifecycleStatus
- `STATUS_LABEL_ID: Record<LifecycleStatus, string>` — Indonesian
- `STATUS_VARIANT: Record<LifecycleStatus, StatusVariant>` — mapping ke variant `StatusBadge` existing (menunggu/siap/selesai/hutang/lunas/info/danger)

Aturan derivasi (backward compat, tanpa ubah data lama):
- Task ada + belum ada submission → `sent_to_employee`
- Submission ada + `verification_status='pending'` → `waiting_verification`
- `verification_status='rejected'` → `preparing` (kembali ke employee) + flag danger
- `verification_status='approved'` + `sold_at IS NULL` → `ready_to_ship`
- `sold_at` ada + method=`hutang` → `credit`; `partial` → `dp`; `kas` → `paid` → status `sent`/`completed`
- `archived_at` → `archived`

## 3. UI

**Ekstend `StatusBadge`** (append-only) — tambah variant `verifikasi` (amber/kuning kuat) & keep semua yang lama:
- Terima `lifecycle` prop opsional; kalau ada, resolve via `STATUS_LABEL_ID`+`STATUS_VARIANT`.
- Backward compat: pemakaian `<StatusBadge status="hutang" />` lama tetap jalan.

**Dialog Verifikasi Admin** (`src/components/prep/VerificationDialog.tsx`):
- Tampilkan foto (multi), maps link, employee, waktu submit, item + qty.
- Tombol **Setuju** & **Tolak** (dengan input alasan).
- Panggil RPC `prep_submission_verify`.
- Toast + invalidate query.

**Pasang di 2 surface**:
- `/request` — di tiap prep dengan `verification_status='pending'`, tampilkan kartu "Menunggu Verifikasi" + tombol Verifikasi. Prep `approved` masuk grid Ready-To-Ship existing tanpa perubahan visual besar (badge ganti ke `ready_to_ship`).
- `/ecer` — sama, tapi setelah approve prep masuk section aktif ecer (Gap #9 nanti yang akan handle move ke inventory).

## 4. Non-goals turn ini

- Belum increment stok retail di ecer (Gap #9).
- Belum pisah stage Ready-To-Ship dari dialog Kirim (Gap #6).
- Belum tambah Order# & waktu ke pesan WA (Gap #7).

## Verifikasi selesai

- `tsgo` lulus.
- `/request` & `/ecer` masih bisa render (query tambahan tidak menembak kolom yang tidak ada — semua nullable/default).
- Prep lama (tanpa submission) tetap tampil sebagai "aktif" karena default `verification_status='approved'` di preparations table.
- Buat 1 prep test lewat share link, cek muncul di "Menunggu Verifikasi", approve → pindah ke Ready.
