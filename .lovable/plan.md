# Scope Paket Request per link tugas

## Masalah (root cause)

Saat ini `prep_task_items` (ecer) sudah discope per-tugas — aman.
Tapi bagian **Paket Request** di halaman pegawai (`RequestSection` di `t.$token.tsx`) memuat data lewat RPC `request_list_titles_via_task`, yang hanya memfilter global:

- `request_titles.user_id = pemilik tugas`
- `AND belum ada penyiapan pemilik pada siklus aktif (reprep_requested_at)`

Tidak ada relasi antara `prep_tasks` dan `request_titles`. Akibatnya: paket "Pencampuran" yang tadi Anda kirim ke pegawai A di link+PIN #1, otomatis ikut nongol lagi di link+PIN #2 untuk pegawai lain, meskipun link #1 belum diselesaikan. Ini melanggar aturan "1 link+PIN = 1 perintah penyiapan".

## Sasaran

- Setiap link+PIN membawa **hanya** paket yang dipilih pemilik saat membuat link itu.
- Link lain (dengan PIN berbeda) yang dibuat setelahnya untuk paket yang sama TIDAK boleh melihat paket tersebut lagi, kecuali pemilik memang menyertakannya lagi.
- Ecer (`prep_task_items`) tidak berubah — sudah per-tugas.

## Perubahan (technical detail)

### 1. Schema baru (migration)

Tabel penghubung `prep_task_request_titles`:

```text
prep_task_request_titles
- task_id  uuid  FK prep_tasks(id) ON DELETE CASCADE
- title_id uuid  FK request_titles(id) ON DELETE CASCADE
- PRIMARY KEY (task_id, title_id)
- index (title_id, task_id)
```

RLS + GRANTs standar (authenticated, service_role). Owner-only via join ke `prep_tasks.owner_user_id = auth.uid()`.

### 2. RPC `prep_create_task`

Tambah parameter `_title_ids uuid[] DEFAULT '{}'::uuid[]`. Setelah insert task, insert baris `prep_task_request_titles(task_id, title_id)` untuk setiap `title_id` — divalidasi milik `v_uid` supaya tidak bisa "meminjam" paket akun lain.

### 3. RPC `request_list_titles_via_task`

Ganti filter `t.user_id = v_task.owner_user_id` menjadi:

```text
JOIN prep_task_request_titles ptrt ON ptrt.title_id = t.id
WHERE ptrt.task_id = v_task.id
```

Filter "sudah ada penyiapan" tetap dipertahankan (jadi kalau ternyata pemilik sudah menyiapkan sendiri, tetap disembunyikan).

### 4. UI `/tugas-baru`

Tambahkan bagian "Sertakan Paket Request" (opsional, collapsible) yang menampilkan daftar paket aktif milik pemilik + checkbox. Yang dicentang dikirim sebagai `_title_ids`. Default: tidak ada paket tercentang (lebih aman — pemilik pilih eksplisit).

Kalau tugas dibuka via deep-link dari halaman Paket Request (`/tugas-baru?title_id=<uuid>`), paket tersebut otomatis tercentang.

### 5. Backfill tugas lama

Migration mengisi `prep_task_request_titles` untuk tugas yang **masih `active` dan belum expired**:

- Untuk setiap `request_titles` milik pemilik yang belum punya penyiapan pada siklus aktif, tautkan ke tugas aktif terbaru pemilik itu (satu tugas saja — biar tidak ganda).

Alasannya: kalau tidak di-backfill, link lama yang sudah dibagikan tiba-tiba kehilangan bagian Paket, membingungkan pegawai. Backfill ini konservatif — hanya link terbaru yang mewarisi paket lama.

## Lingkup yang TIDAK berubah

- Alur submit paket dari pegawai (`prep_submit`/`request_preparations`) — tidak disentuh.
- Ecer / `prep_task_items` — tidak disentuh.
- Halaman `/kios`, hutang-piutang, dsb — tidak disentuh.

## Verifikasi setelah build

- `tsgo` typecheck.
- Uji manual di device:
  1. Buat tugas A dengan paket X tercentang → link+PIN A tampil paket X.
  2. Buat tugas B tanpa paket → link+PIN B tampil kosong (hanya ecer, kalau ada).
  3. Buat tugas C dengan paket X tercentang lagi → link+PIN C tampil paket X, sementara link A tetap tampil X juga sampai salah satunya menyelesaikan.
  4. Setelah salah satu link kirim paket X → filter "sudah ada penyiapan" menyembunyikannya di kedua link.

Setujui untuk saya lanjutkan implementasi 5 langkah di atas?
