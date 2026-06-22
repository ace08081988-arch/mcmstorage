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
};

import { toast } from "sonner";

export function buildWhatsAppUrl(text: string, phone?: string) {
  const base = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
};

function inferImageMime(...values: Array<string | undefined | null>) {
  const explicit = values.find((v) => v && /^image\//i.test(v));
  if (explicit) return explicit.toLowerCase();

  for (const value of values) {
    const ext = value?.split(/[?#]/)[0]?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (ext && IMAGE_MIME_BY_EXT[ext]) return IMAGE_MIME_BY_EXT[ext];
  }
  return "image/jpeg";
}

function extensionForMime(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("heif")) return "heif";
  if (mime.includes("avif")) return "avif";
  return "jpg";
}

function withImageExtension(filename: string, mime: string) {
  const safeName = filename.trim() || "foto";
  return /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(safeName)
    ? safeName
    : `${safeName.replace(/\.[^.]+$/, "")}.${extensionForMime(mime)}`;
}

function normalizeShareFile(file: File) {
  const mime = inferImageMime(file.type, file.name);
  const name = withImageExtension(file.name, mime);
  if (file.type === mime && file.name === name) return file;
  return new File([file], name, { type: mime, lastModified: file.lastModified });
}

export type ShareResult =
  | { status: "shared"; withFiles: boolean }
  | { status: "cancelled"; fallbackText?: string; phone?: string }
  | { status: "failed"; error: string; withFiles: boolean }
  | { status: "fallback"; withFiles: boolean; reason: "no-web-share" | "share-failed" };

export async function shareToWhatsApp(input: ShareInput): Promise<ShareResult> {
  const { text, title, url, files, phone } = input;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const fullText = url ? `${text}\n${url}` : text;

  const shareFiles = (files ?? []).map(normalizeShareFile);
  const hasFiles = shareFiles.length > 0;

  let shareFailed = false;
  let shareError = "";

  if (hasFiles) {
    if (nav && typeof nav.share === "function") {
      const canShareFiles = typeof nav.canShare !== "function" || nav.canShare({ files: shareFiles });
      if (canShareFiles) {
        try {
          // WhatsApp sering mengubah URL menjadi preview link dan mengabaikan media.
          // Kirim file sebagai media utama; teks lengkap disiapkan di clipboard untuk caption/pesan lanjutan.
          void nav.clipboard?.writeText(fullText).catch(() => undefined);
          await nav.share({ files: shareFiles, title });
          return { status: "shared", withFiles: true };
        } catch (err) {
          const name = (err as DOMException)?.name;
          if (name === "AbortError" || name === "NotAllowedError") {
            return { status: "cancelled", fallbackText: fullText, phone };
          }
          shareFailed = true;
          shareError = (err as Error)?.message || String(err);
        }
      }
    }

    for (const f of shareFiles) downloadFile(f, f.name);
    try { await nav?.clipboard?.writeText(fullText); } catch { /* ignore */ }
    return {
      status: "fallback",
      withFiles: true,
      reason: shareFailed ? "share-failed" : "no-web-share",
      ...(shareFailed ? { _error: shareError } as never : {}),
    };
  }

  if (nav && typeof nav.share === "function") {
      try {
        await nav.share({ text, title, url });
        return { status: "shared", withFiles: false };
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === "AbortError" || name === "NotAllowedError") {
          return { status: "cancelled", fallbackText: fullText, phone };
        }
        shareFailed = true;
        shareError = (err as Error)?.message || String(err);
    }
  }

  const win = window.open(buildWhatsAppUrl(fullText, phone), "_blank", "noopener,noreferrer");
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
      toast.message("Dibatalkan — tidak jadi mengirim.", {
        action: result.fallbackText
          ? {
              label: "Buka WhatsApp langsung",
              onClick: () => {
                const href = buildWhatsAppUrl(result.fallbackText!, result.phone);
                window.open(href, "_blank", "noopener,noreferrer");
              },
            }
          : undefined,
        cancel: result.fallbackText
          ? {
              label: "Salin teks WhatsApp",
              onClick: async () => {
                try {
                  await navigator.clipboard?.writeText(result.fallbackText!);
                  toast.success("Teks disalin. Tempel di WhatsApp untuk kirim manual.");
                } catch {
                  toast.error("Gagal menyalin — salin manual dari pesan.");
                }
              },
            }
          : undefined,
        duration: 8000,
      });
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
        toast.success("WhatsApp dibuka.");
      }
      return;
    case "failed":
      toast.error(`Gagal mengirim: ${result.error}`);
      return;
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