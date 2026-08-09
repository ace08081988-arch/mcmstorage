/**
 * Penyaring notifikasi (toast) terpusat — "audit kebisingan".
 *
 * Aplikasi ini punya >1000 titik pemanggilan `toast.*`. Banyak di antaranya
 * bersifat teknis/latar (sinkronisasi, diagnostik, status internal) dan
 * muncul tanpa pengguna menekan apa pun, sehingga terasa mengganggu.
 *
 * Modul ini menambal metode `toast.*` sekali saat boot dan menerapkan tiga
 * aturan sederhana:
 *
 *  1. Daftar-hitam pola: pesan teknis/latar tertentu tidak pernah tampil.
 *  2. Aturan "harus ada niat pengguna": notifikasi non-error hanya tampil
 *     bila pengguna baru saja berinteraksi (klik/ketik/submit) dalam
 *     `GESTURE_WINDOW_MS`. Toast yang muncul sendiri dari timer, realtime,
 *     atau efek mount akan disenyapkan.
 *  3. Anti-duplikat + durasi ringkas: pesan identik tidak diulang dalam
 *     `DEDUPE_MS`, dan notifikasi informatif memakai durasi pendek.
 *
 * `toast.error` dan toast yang memiliki tombol aksi (`action`) TIDAK PERNAH
 * disenyapkan — itu kategori "benar-benar penting".
 */
import { toast } from "sonner";

/** Jendela waktu setelah gestur pengguna di mana notifikasi dianggap relevan. */
const GESTURE_WINDOW_MS = 20_000;
/** Jeda minimum sebelum pesan identik boleh tampil lagi. */
const DEDUPE_MS = 6_000;
/** Durasi ringkas untuk notifikasi informatif. */
const INFO_DURATION_MS = 2_600;

/**
 * Pesan yang tidak pernah berguna bagi pengguna akhir (teknis/latar).
 * Cocokkan huruf kecil, sebagian string sudah cukup.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /scroll terasa berat/i,
  /\bfps\b/i,
  /frame tersendat/i,
  /web vitals|core web vitals|lcp|inp\b|cls\b/i,
  /disinkronkan dari perangkat lain/i,
  /preferensi .*disinkronkan/i,
  /segera hadir/i,
  /tidak ada perubahan/i,
  /tidak ada (data|entri|kontak|baris|notifikasi|kecocokan|relasi|kotak)/i,
  /sedang memeriksa/i,
  /perubahan dibatalkan/i,
  /^log auth/i,
  /^tindakan dibatalkan$/i,
];

let lastGestureAt = 0;
const recent = new Map<string, number>();
let installed = false;

function isBlocked(text: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(text));
}

function toText(message: unknown): string {
  return typeof message === "string" ? message : "";
}

function hasUserIntent(): boolean {
  return Date.now() - lastGestureAt <= GESTURE_WINDOW_MS;
}

function isDuplicate(key: string): boolean {
  const now = Date.now();
  const prev = recent.get(key);
  // Bersihkan sesekali supaya map tidak tumbuh.
  if (recent.size > 60) {
    for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
  }
  recent.set(key, now);
  return prev !== undefined && now - prev < DEDUPE_MS;
}

type ToastData = Record<string, unknown> | undefined;

/**
 * Putuskan apakah satu notifikasi layak tampil.
 * Diekspor supaya bisa diuji tanpa DOM.
 */
export function shouldShowToast(opts: {
  level: "info" | "message" | "success" | "warning" | "error";
  text: string;
  hasAction: boolean;
  userIntent: boolean;
}): boolean {
  const { level, text, hasAction, userIntent } = opts;
  if (level === "error") return true;
  if (hasAction) return true; // butuh keputusan pengguna → penting
  if (isBlocked(text)) return false;
  if (level === "warning") return true; // peringatan kegagalan tetap tampil
  return userIntent;
}

export function installToastNoiseFilter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const mark = () => {
    lastGestureAt = Date.now();
  };
  for (const ev of ["pointerdown", "keydown", "submit", "change"] as const) {
    window.addEventListener(ev, mark, { capture: true, passive: true });
  }

  const levels = ["info", "message", "success", "warning"] as const;
  for (const level of levels) {
    const original = (toast as unknown as Record<string, unknown>)[level] as
      | ((m: unknown, d?: ToastData) => string | number)
      | undefined;
    if (typeof original !== "function") continue;
    const bound = original.bind(toast);
    const patched = (message: unknown, data?: ToastData) => {
      const text = toText(message);
      const hasAction = Boolean(data && (data["action"] || data["cancel"]));
      if (
        !shouldShowToast({
          level,
          text,
          hasAction,
          userIntent: hasUserIntent(),
        })
      ) {
        return "" as unknown as string;
      }
      const descr = typeof data?.["description"] === "string" ? (data["description"] as string) : "";
      if (!hasAction && isDuplicate(`${level}:${text}:${descr}`)) {
        return "" as unknown as string;
      }
      const next: ToastData =
        level === "info" || level === "message"
          ? { duration: INFO_DURATION_MS, ...(data ?? {}) }
          : data;
      return bound(message, next);
    };
    try {
      (toast as unknown as Record<string, unknown>)[level] = patched;
    } catch {
      /* objek beku → biarkan perilaku bawaan */
    }
  }
}