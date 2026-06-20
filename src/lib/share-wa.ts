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

export function buildWhatsAppUrl(text: string, phone?: string) {
  const base = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

export async function shareToWhatsApp(input: ShareInput): Promise<"shared" | "fallback"> {
  const { text, title, url, files, phone } = input;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;

  const hasFiles = !!(files && files.length > 0);

  // Prefer Web Share API when files are present — wa.me CANNOT attach photos,
  // so the only reliable way to send foto + teks bersamaan is via system share sheet
  // (user picks WhatsApp di sheet, foto otomatis terlampir sebagai gambar dengan caption).
  if (nav && typeof nav.share === "function") {
    try {
      const filesPayload = hasFiles && typeof nav.canShare === "function" && nav.canShare({ files })
        ? files
        : undefined;
      const payload: ShareData = filesPayload
        ? { files: filesPayload, text, title }
        : { text, title, url };
      await nav.share(payload);
      return "shared";
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return "shared";
      // fall through to fallback
    }
  }

  // Fallback (desktop / browser tanpa Web Share files): simpan foto + salin teks,
  // lalu buka WhatsApp agar pengguna tinggal tempel teks & lampirkan foto.
  const fullText = url ? `${text}\n${url}` : text;
  if (hasFiles) {
    for (const f of files!) downloadFile(f, f.name);
    try { await navigator.clipboard?.writeText(fullText); } catch { /* ignore */ }
  }
  window.open(buildWhatsAppUrl(fullText, phone), "_blank", "noopener,noreferrer");
  return "fallback";
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