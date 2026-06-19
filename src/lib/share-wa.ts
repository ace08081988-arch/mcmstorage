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

  if (nav && typeof nav.share === "function") {
    try {
      const payload: ShareData = { text, title, url };
      if (files && files.length > 0 && typeof nav.canShare === "function" && nav.canShare({ files })) {
        payload.files = files;
      }
      await nav.share(payload);
      return "shared";
    } catch (err) {
      // User cancelled or share failed — fall through to wa.me
      if ((err as DOMException)?.name === "AbortError") return "shared";
    }
  }
  const fullText = url ? `${text}\n${url}` : text;
  window.open(buildWhatsAppUrl(fullText, phone), "_blank", "noopener,noreferrer");
  return "fallback";
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