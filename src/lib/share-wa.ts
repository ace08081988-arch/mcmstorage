/**
 * Share helper that prefers the Web Share API so attachments (foto) ikut terkirim
 * ke aplikasi seperti WhatsApp. Falls back to `wa.me?text=...` when files cannot
 * be shared (mostly desktop browsers).
 */
export type ShareInput = {
  text: string;
  title?: string;
  url?: string;
  files?: File[];
  /** Optional phone in international format (without +), used only in fallback. */
  phone?: string;
  /** Total foto yang diharapkan dilampirkan (>= files.length). Selisihnya muncul
   *  di pratinjau sebagai "X foto gagal diunduh" beserta tombol retry. */
  expectedCount?: number;
  /** Dipanggil saat user menekan "Coba ambil ulang" di pratinjau. Caller wajib
   *  mengembalikan File[] tambahan yang berhasil diambil pada percobaan ini —
   *  helper akan menambahkannya ke array `files`. */
  retryMissing?: () => Promise<File[]>;
  /** Info klik ganda dari idempotency layer; saat hadir, pratinjau menampilkan
   *  peringatan "Klik ganda terdeteksi" dan tombol "Kirim ulang (paksa)". */
  duplicate?: { at: number; status: "in-flight" | "done" | "failed" } | null;
};

import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { pickWhatsAppTarget, type WaTarget } from "./wa-target";
import { confirmWaShare } from "./wa-preview";

export function buildWhatsAppUrl(text: string, phone?: string) {
  const base = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

/**
 * Build an Android intent:// URL that targets the WhatsApp Business package
 * (`com.whatsapp.w4b`). If WA Business isn't installed, Android automatically
 * falls back to the `S.browser_fallback_url` (wa.me) which then opens regular
 * WhatsApp or the browser.
 */
export function buildWhatsAppBusinessIntentUrl(text: string, phone?: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const fallback = buildWhatsAppUrl(text, phone);
  const encodedText = encodeURIComponent(text);
  const phonePart = digits ? `phone=${digits}&` : "";
  return (
    `intent://send?${phonePart}text=${encodedText}` +
    `#Intent;scheme=whatsapp;package=com.whatsapp.w4b;` +
    `S.browser_fallback_url=${encodeURIComponent(fallback)};end`
  );
}

function isAndroidWeb(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

/**
 * Open WhatsApp dengan preferensi WA Business (auto-deteksi):
 * - Android web: pakai intent:// dengan package `com.whatsapp.w4b`; jika WA
 *   Business tidak terpasang, Android otomatis fallback ke wa.me.
 * - Selain itu: buka wa.me biasa (browser/iOS akan pakai app yang terpasang).
 */
export function openWhatsAppPreferBusiness(
  text: string,
  phone?: string,
  target: WaTarget | "auto" = "auto",
): Window | null {
  let url: string;
  let isIntent = false;
  if (target === "business") {
    // Pakai intent:// di Android; di luar Android tidak ada cara memaksa,
    // jadi fallback ke wa.me (browser/iOS akan pakai WA terpasang).
    if (isAndroidWeb()) {
      url = buildWhatsAppBusinessIntentUrl(text, phone);
      isIntent = true;
    } else {
      url = buildWhatsAppUrl(text, phone);
    }
  } else if (target === "regular") {
    url = buildWhatsAppUrl(text, phone);
  } else {
    if (isAndroidWeb()) {
      url = buildWhatsAppBusinessIntentUrl(text, phone);
      isIntent = true;
    } else {
      url = buildWhatsAppUrl(text, phone);
    }
  }
  // Chrome Android hanya memproses `intent://` kalau navigasi terjadi di tab
  // saat ini (atau lewat <a> click). `window.open(intent://..., "_blank")`
  // sering hanya membuka tab kosong dan WA tidak pernah ter-trigger.
  if (isIntent) {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      // Tidak set target=_blank — biarkan Chrome menangani intent di tab ini.
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      window.location.href = url;
    }
    // Kembalikan window saat ini sebagai indikator "berhasil dibuka".
    return window;
  }
  return window.open(url, "_blank", "noopener,noreferrer");
}

export type ShareResult =
  | { status: "shared"; withFiles: boolean }
  | { status: "cancelled" }
  | { status: "failed"; error: string; withFiles: boolean }
  | { status: "fallback"; withFiles: boolean; reason: "no-web-share" | "share-failed" };

export async function shareToWhatsApp(input: ShareInput): Promise<ShareResult> {
  let { text } = input;
  const { title, url, files, phone, expectedCount, retryMissing, duplicate } = input;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;

  // Pratinjau pesan + daftar foto sebelum benar-benar membuka WA. Pratinjau
  // dapat menambah file via retryMissing (memutasi array `files`), jadi cek
  // `hasFiles` SETELAH konfirmasi.
  const approved = await confirmWaShare({ text, url, files, expectedCount, retryMissing, duplicate });
  if (!approved.ok) return { status: "cancelled" };
  if (typeof approved.text === "string") text = approved.text;
  const hasFiles = !!(files && files.length > 0);

  // Native Android/iOS: pakai Capacitor Share + Filesystem agar foto benar-benar
  // terlampir di WhatsApp (Web Share API kerap menjatuhkan files di WebView).
  if (Capacitor.isNativePlatform()) {
    try {
      const fileUris: string[] = [];
      if (hasFiles) {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        for (let i = 0; i < files!.length; i++) {
          const f = files![i];
          const buf = await f.arrayBuffer();
          const b64 = arrayBufferToBase64(buf);
          const safeName = f.name.replace(/[^\w.\-]+/g, "_") || `share-${Date.now()}-${i}.bin`;
          const written = await Filesystem.writeFile({
            path: `share/${Date.now()}-${i}-${safeName}`,
            data: b64,
            directory: Directory.Cache,
            recursive: true,
          });
          fileUris.push(written.uri);
        }
      }
      const { Share } = await import("@capacitor/share");
      const fullText = url ? `${text}\n${url}` : text;
      await Share.share({
        title,
        text: fullText,
        files: fileUris.length ? fileUris : undefined,
        dialogTitle: "Kirim ke WhatsApp",
      });
      return { status: "shared", withFiles: fileUris.length > 0 };
    } catch (err) {
      const name = (err as { message?: string })?.message ?? "";
      if (/cancel/i.test(name)) return { status: "cancelled" };
      // Lanjut ke Web Share / fallback bila plugin gagal.
    }
  }

  // Tanya target WA (Business / biasa) sebelum membuka aplikasi.
  const previewText = url ? `${text}\n${url}` : text;

  // PRIORITAS: kalau ada foto dan browser bisa share files, pakai Web Share
  // API langsung. Intent `whatsapp://send?text=` tidak bisa membawa lampiran,
  // jadi memilih WA Business vs biasa lewat picker akan membuat foto hilang.
  // Share sheet sistem (Android) sudah menampilkan WA Business & WA biasa
  // sebagai pilihan target, plus app lain — itu yang user inginkan.
  let shareFailed = false;
  let shareError = "";
  let filesPayload: File[] | undefined;
  if (hasFiles && nav && typeof nav.share === "function") {
    const probe: ShareData = { files, text, title };
    if (typeof nav.canShare === "function" && nav.canShare(probe)) {
      filesPayload = files;
    } else if (typeof nav.canShare === "function" && nav.canShare({ files })) {
      filesPayload = files;
    }
    if (filesPayload) {
      try {
        await nav.share({ files: filesPayload, text, title });
        return { status: "shared", withFiles: true };
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === "AbortError" || name === "NotAllowedError") {
          return { status: "cancelled" };
        }
        shareFailed = true;
        shareError = (err as Error)?.message || String(err);
      }
    }
  }

  // Teks-saja (atau browser tidak bisa kirim files): tanya target WA dulu.
  const target = await pickWhatsAppTarget({ text: previewText, phone });
  if (target === null) return { status: "cancelled" };

  // Coba Web Share API teks dulu (tanpa files) sebelum jatuh ke intent URL.
  if (!hasFiles && nav && typeof nav.share === "function") {
    try {
      await nav.share({ text, title, url });
      return { status: "shared", withFiles: false };
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === "AbortError" || name === "NotAllowedError") {
        return { status: "cancelled" };
      }
      shareFailed = true;
      shareError = (err as Error)?.message || String(err);
    }
  }

  const fullText = url ? `${text}\n${url}` : text;
  if (hasFiles) {
    for (const f of files!) downloadFile(f, f.name);
    try { await navigator.clipboard?.writeText(fullText); } catch { /* ignore */ }
  }
  const win = openWhatsAppPreferBusiness(fullText, phone, target);
  if (!win) {
    return {
      status: "failed",
      error: "Popup diblokir browser. Izinkan popup untuk situs ini lalu coba lagi.",
      withFiles: hasFiles,
    };
  }
  return {
    status: "fallback",
    withFiles: hasFiles,
    reason: shareFailed ? "share-failed" : "no-web-share",
    ...(shareFailed ? { _error: shareError } as never : {}),
  };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/**
 * Tampilkan toast yang sesuai untuk hasil share — sukses, dibatalkan,
 * fallback (foto perlu dilampirkan manual), atau gagal.
 */
export function notifyShareResult(result: ShareResult) {
  switch (result.status) {
    case "shared":
      if (result.withFiles) {
        toast.success("Dibagikan — pilih WhatsApp di share sheet agar foto + teks terkirim bersamaan.");
      } else {
        toast.success("Dibagikan ke WhatsApp.");
      }
      return;
    case "cancelled":
      toast.message("Dibatalkan — tidak jadi mengirim.");
      return;
    case "fallback":
      if (result.withFiles) {
        toast.message(
          result.reason === "share-failed"
            ? "Share sheet gagal. Foto sudah diunduh & teks disalin — di WhatsApp, tempel teks lalu lampirkan foto."
            : "Perangkat ini tak mendukung lampiran otomatis. Foto sudah diunduh & teks disalin — di WhatsApp, tempel teks lalu lampirkan foto.",
          { duration: 8000 },
        );
      } else {
        toast.success(
          result.reason === "share-failed"
            ? "Share sheet gagal — WhatsApp dibuka di tab baru sebagai gantinya."
            : "Browser ini belum mendukung tombol Bagikan langsung. WhatsApp dibuka di tab baru — tempel pesan lalu kirim.",
          { duration: 7000 },
        );
      }
      return;
    case "failed":
      toast.error(`Gagal membagikan: ${result.error}`, {
        description: "Pakai tombol Salin lalu tempel manual di WhatsApp.",
        duration: 9000,
      });
      return;
  }
}

/**
 * Salin teks ke clipboard dengan fallback execCommand untuk konteks yang
 * memblokir Clipboard API (mis. iframe pratinjau tanpa izin clipboard-write,
 * Safari lama, atau halaman non-HTTPS).
 */
export async function copyText(text: string): Promise<{ ok: true } | { ok: false; reason: "denied" | "unsupported" | "error"; error?: string }> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name !== "NotAllowedError" && name !== "SecurityError") {
      // Bukan masalah izin — coba fallback dulu sebelum menyerah.
    } else {
      // Coba fallback execCommand sebelum melaporkan ditolak.
      if (legacyCopy(text)) return { ok: true };
      return { ok: false, reason: "denied", error: (err as Error).message };
    }
  }
  if (legacyCopy(text)) return { ok: true };
  return { ok: false, reason: "unsupported" };
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function downloadFile(blob: Blob, filename: string) {
  try {
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch {
    /* ignore */
  }
}

export async function urlToFile(url: string, filename: string, mime = "image/jpeg"): Promise<File | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], filename, { type: blob.type || mime });
  } catch {
    return null;
  }
}

export function dataUrlToFile(dataUrl: string, filename: string): File | null {
  try {
    const [head, body] = dataUrl.split(",");
    const mime = /data:([^;]+)/.exec(head ?? "")?.[1] ?? "image/jpeg";
    const bin = atob(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], filename, { type: mime });
  } catch {
    return null;
  }
}