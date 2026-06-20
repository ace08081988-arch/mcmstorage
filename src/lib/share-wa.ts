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

export type ShareResult =
  | { status: "shared"; withFiles: boolean }
  | { status: "cancelled" }
  | { status: "failed"; error: string; withFiles: boolean }
  | { status: "fallback"; withFiles: boolean; reason: "no-web-share" | "share-failed" };

export async function shareToWhatsApp(input: ShareInput): Promise<ShareResult> {
  const { text, title, url, files, phone } = input;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;

  const hasFiles = !!(files && files.length > 0);

  let shareFailed = false;
  let shareError = "";
  if (nav && typeof nav.share === "function") {
    try {
      const filesPayload = hasFiles && typeof nav.canShare === "function" && nav.canShare({ files })
        ? files
        : undefined;
      const payload: ShareData = filesPayload
        ? { files: filesPayload, text, title }
        : { text, title, url };
      await nav.share(payload);
      return { status: "shared", withFiles: !!filesPayload };
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