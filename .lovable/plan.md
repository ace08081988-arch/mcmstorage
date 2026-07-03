# Perbaikan panggilan + kontrol audio

Dua pekerjaan digabung:

**A. Panggilan tidak bisa tersambung** — akar penyebab & perbaikannya.
**B. Fitur baru** — panel kontrol audio di layar panggilan.

---

## A. Kenapa panggilan sering gagal & yang akan diperbaiki

### 1. Belum ada TURN server (penyebab utama di jaringan seluler)
`src/lib/webrtc.ts` hanya memakai STUN publik Google. Di jaringan seluler Indonesia dan Wi-Fi kantor/rumah dengan NAT simetris, dua peer tidak bisa saling menjangkau tanpa TURN relay — inilah yang paling sering bikin panggilan macet di "Memanggil…".

Perbaikan:
- Server function baru `getIceServers()` yang membaca kredensial TURN dari secret (`TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`) dan mengembalikan daftar `RTCIceServer` (STUN + TURN).
- `createPeerSession` memanggil ini sekali di awal, bukan konstanta modul.
- Kalau secret belum diisi, tetap jalan dengan STUN saja + tampilkan banner sekali "Panggilan mungkin gagal di jaringan tertentu — atur TURN".
- Saya minta 3 secret via alat secrets setelah rencana ini disetujui. Anda tinggal tempel dari penyedia TURN pilihan (mis. Twilio Network Traversal, Metered.ca, Cloudflare Calls, atau coturn sendiri).

### 2. Race signaling: offer terkirim sebelum callee gabung channel
`startOffer()` langsung `channel.send(offer)` begitu caller `SUBSCRIBED`. Broadcast Supabase Realtime tidak antre — kalau callee belum subscribe, offer hilang, dan panggilan macet.

Perbaikan:
- Callee kirim signal `hello` saat subscribe berhasil (dari `CallHost.acceptIncoming`).
- Caller menahan `startOffer` sampai menerima `hello`, dengan fallback timer 4 detik untuk tetap mengirim offer.
- Caller me-resend offer maks 3× tiap 2 detik selama `pc.signalingState === "have-local-offer"`.

### 3. Track audio remote tidak selalu terputar
Sudah ada handler retry `.play()` on tap, tapi kalau `<audio>` remote di-mount dua kali (elemen dobel pada mode video), `ref` menimpa yang lain. Perbaikan: pakai satu `<audio ref>` remote + kelas `sr-only` yang selalu ada.

### 4. Tombol WhatsApp membuka chat, bukan panggilan
Deep link `wa.me/<nomor>` selalu membuka jendela chat. Skema panggilan WA (`whatsapp://call?phone=…`) tidak resmi dan sering ditolak. Perbaikan:
- Tombol di header chat/kontak menjadi dropdown "Buka WhatsApp": item **Chat** (default `wa.me`), item **Panggilan WA** yang mencoba `whatsapp://call?phone=…` lalu fallback ke `wa.me` jika gagal (toast: "Buka WhatsApp lalu tekan tombol panggilan").
- Tambahkan tooltip menjelaskan keterbatasan platform WA — bukan bug kita.

---

## B. Kontrol audio baru di layar panggilan

Panel bawah `CallScreen` diperluas jadi 2 baris:

**Baris utama (sudah ada):** Mic · Kamera (mode video) · Akhiri.

**Baris kontrol audio (baru):**
1. **Pilih output audio** — tombol icon berubah: `🔊 Speaker` / `👂 Earpiece` / `🎧 Headset` / `🎧 Bluetooth`. Ketuk membuka sheet daftar perangkat output aktif dari `navigator.mediaDevices.enumerateDevices()`; pilihan diterapkan via `remoteAudio.setSinkId(deviceId)`. Di iOS Safari tombol tetap tampil tapi disabled dengan tooltip "Ubah dari kontrol sistem".
2. **Toggle Speaker cepat** — tombol pintas antara "Earpiece/headphone" ↔ "Speaker keras" (setara tombol speakerphone WhatsApp). Dipetakan ke sink default vs `speaker` device kalau tersedia.
3. **Slider volume in-call** — mengubah `remoteAudio.volume` 0–1. State disimpan di `localStorage` supaya persist antar panggilan.
4. **Indikator perangkat aktif** — di status bar atas panggilan: chip kecil "🎧 Bluetooth Soundcore Q30" (label perangkat dari `enumerateDevices`); update otomatis lewat event `devicechange`.

Semua kontrol berjalan idempoten — kalau browser/WebView tidak mendukung `setSinkId`, tombol menjadi label-only + hint.

### Penanganan Capacitor Android
`setSinkId` bekerja di Chromium tapi tidak selalu mengubah routing OS (Bluetooth/earpiece diatur `AudioManager` Android). Untuk build APK Storage/Chat:
- Tambah util `src/lib/native-audio-route.ts` yang mendeteksi Capacitor lalu meminta plugin `@capacitor-community/audio-toggle` (kalau terpasang) untuk `setMode('IN_CALL')` dan `setSpeakerOn(true|false)`.
- Kalau plugin belum ada, feature detect diam-diam disable dan tombol jadi Web-only.
- Instalasi plugin ditawarkan sebagai langkah opsional setelah rencana disetujui (butuh rebuild APK).

---

## Berkas yang berubah

- `src/lib/webrtc.ts` — TURN via `getIceServers`, race fix (`hello` + resend offer).
- `src/lib/calls.functions.ts` (baru) — server function `getIceServers`.
- `src/lib/audio-output.ts` (baru) — enumerate output, apply sink, event `devicechange`, persist volume.
- `src/lib/native-audio-route.ts` (baru) — jembatan Capacitor.
- `src/components/chat/CallScreen.tsx` — panel kontrol audio baru + chip indikator + integrasi.
- `src/components/chat/CallHost.tsx` — kirim `hello` saat callee accept.
- `src/components/chat/WhatsAppMenu.tsx` (baru) — dropdown Chat/Panggilan.
- Tempat pemakaian tombol WA di header chat/kontak diganti ke komponen baru.
- Test: `tests/e2e/call-audio-controls.spec.ts` (harness publik `/lovable/visual/call-audio-controls`), `tests/integration/webrtc-ice-config.test.ts`.

## Detail teknis singkat

```text
Sinyal (setelah fix)
--------------------
callee accept → subscribe(call:<id>) → send "hello"
caller wait "hello" atau 4s → startOffer
caller resend offer tiap 2s (maks 3×) selama signalingState=have-local-offer

ICE
---
STUN Google (2 endpoint) + TURN (username/credential dari secret)
Fallback tanpa TURN → banner sekali per session
```

## Yang perlu Anda siapkan setelah rencana disetujui

1. Kredensial TURN (URL, username, credential). Rekomendasi: Twilio Network Traversal (Anda sudah punya connector Twilio) atau Metered.ca free tier.
2. Konfirmasi kalau boleh menambah plugin Capacitor `@capacitor-community/audio-toggle` — perlu rebuild APK Storage & Chat.
