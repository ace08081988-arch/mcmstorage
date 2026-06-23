import { useEffect, useState } from "react";
import { Loader2, Send, X, Image as ImageIcon, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { shareToWhatsApp, notifyShareResult, type ShareInput, type ShareResult } from "@/lib/share-wa";

export type PreviewShareInput = ShareInput & {
  /** URL gambar untuk pratinjau saja (mis. signed URL). Tidak ikut dikirim. */
  previewImageUrls?: string[];
  /** Dipanggil setelah pengguna mengonfirmasi pratinjau (mis. fetch foto sebagai File). */
  resolveFiles?: () => Promise<File[] | undefined>;
  /** Judul modal opsional. */
  previewTitle?: string;
};

type Req = {
  input: PreviewShareInput;
  resolve: (r: ShareResult) => void;
};

let openRequest: ((req: Req) => void) | null = null;
const queue: Req[] = [];

/**
 * Pratinjau dulu (foto + teks), baru buka Web Share / WhatsApp.
 * Toast notifikasi otomatis ditampilkan setelah selesai.
 * Resolve dengan ShareResult (status "cancelled" bila batal di pratinjau).
 */
export function previewAndShareWA(input: PreviewShareInput): Promise<ShareResult> {
  return new Promise<ShareResult>((resolve) => {
    const req: Req = { input, resolve };
    if (openRequest) openRequest(req);
    else queue.push(req);
  });
}

export function WhatsAppPreviewHost() {
  const [current, setCurrent] = useState<Req | null>(null);
  const [sending, setSending] = useState(false);
  const [filePreviewUrls, setFilePreviewUrls] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<ShareResult | null>(null);
  // Cache resolved files so retry reuses the exact same payload (text, url, photo)
  // that the user saw in the preview — no re-fetching, no re-rendering.
  const [resolvedFiles, setResolvedFiles] = useState<File[] | undefined>(undefined);

  useEffect(() => {
    openRequest = (req) => setCurrent(req);
    while (queue.length) {
      const req = queue.shift()!;
      setCurrent(req);
    }
    return () => { openRequest = null; };
  }, []);

  // Reset inline status & cached payload whenever a new request opens
  useEffect(() => { setLastResult(null); setResolvedFiles(undefined); }, [current]);

  // Generate object URLs untuk files yang sudah disediakan upfront
  useEffect(() => {
    const files = current?.input.files;
    if (!files || files.length === 0) { setFilePreviewUrls([]); return; }
    const urls = files.map((f) => URL.createObjectURL(f));
    setFilePreviewUrls(urls);
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [current]);

  if (!current) return null;

  const { input } = current;
  const previewUrls = input.previewImageUrls && input.previewImageUrls.length > 0
    ? input.previewImageUrls
    : filePreviewUrls;
  const hasPhoto = previewUrls.length > 0 || !!input.resolveFiles;
  const fullText = input.url ? `${input.text}\n${input.url}` : input.text;

  const close = (result: ShareResult) => {
    const req = current;
    setCurrent(null);
    setSending(false);
    notifyShareResult(result);
    req.resolve(result);
  };

  const cancel = () => {
    if (sending) return;
    const req = current;
    setCurrent(null);
    const cancelled: ShareResult = {
      status: "cancelled",
      fallbackText: fullText,
      phone: input.phone,
    };
    req.resolve(cancelled);
  };

  const confirm = async () => {
    setSending(true);
    setLastResult(null);
    try {
      let files = resolvedFiles ?? input.files;
      if (!files && input.resolveFiles) {
        files = await input.resolveFiles();
      }
      // Cache for subsequent retries — same exact bytes the user previewed.
      if (files && !resolvedFiles) setResolvedFiles(files);
      const res = await shareToWhatsApp({ ...input, files });
      // Always surface inline status. Auto-close only on confirmed success.
      notifyShareResult(res);
      if (res.status === "shared") {
        const req = current;
        setCurrent(null);
        setSending(false);
        req?.resolve(res);
        return;
      }
      setLastResult(res);
      setSending(false);
    } catch (e) {
      const failed: ShareResult = {
        status: "failed",
        error: (e as Error)?.message ?? "Gagal",
        withFiles: !!input.files,
      };
      notifyShareResult(failed);
      setLastResult(failed);
      setSending(false);
    }
  };

  const statusMessage = (r: ShareResult): { tone: "success" | "warn" | "error"; text: string } => {
    switch (r.status) {
      case "shared":
        return { tone: "success", text: "Terkirim ke WhatsApp." };
      case "cancelled":
        return {
          tone: "warn",
          text: r.withFiles
            ? "Dibatalkan — foto belum terkirim. Coba lagi dan pilih WhatsApp dari share sheet."
            : "Dibatalkan — pesan belum dikirim.",
        };
      case "fallback":
        return {
          tone: "warn",
          text: r.withFiles
            ? "WhatsApp tidak menerima foto otomatis. Teks sudah disalin — tempel di WhatsApp lalu lampirkan foto manual."
            : "WhatsApp dibuka di tab baru.",
        };
      case "failed":
        return { tone: "error", text: `Gagal: ${r.error}` };
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={cancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">{input.previewTitle ?? "Pratinjau Kiriman WA"}</h3>
            <p className="text-[11px] text-muted-foreground">Pastikan foto & teks benar sebelum membuka WhatsApp.</p>
          </div>
          <button
            type="button"
            onClick={cancel}
            disabled={sending}
            aria-label="Tutup pratinjau"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 overflow-hidden rounded-xl border bg-background">
          {hasPhoto ? (
            previewUrls.length > 0 ? (
              <div className={previewUrls.length === 1 ? "" : "grid grid-cols-2 gap-1 p-1"}>
                {previewUrls.map((u, i) => (
                  <img
                    key={`${u}-${i}`}
                    src={u}
                    alt=""
                    className={previewUrls.length === 1
                      ? "max-h-72 w-full bg-black/5 object-contain"
                      : "aspect-square w-full rounded object-cover"}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-[11px] text-muted-foreground">
                <ImageIcon className="mr-2 h-4 w-4" /> Foto akan disiapkan saat dikirim.
              </div>
            )
          ) : (
            <div className="flex h-24 items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <ImageIcon className="h-4 w-4" /> Tidak ada foto — hanya teks yang akan dikirim.
            </div>
          )}
        </div>

        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Teks pesan</span>
            {input.phone && <span>ke +{input.phone.replace(/\D/g, "")}</span>}
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-[12px] leading-relaxed">{fullText}</pre>
        </div>

        {lastResult && (() => {
          const s = statusMessage(lastResult);
          const toneCls =
            s.tone === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : s.tone === "warn"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
              : "border-destructive/30 bg-destructive/10 text-destructive";
          const Icon = s.tone === "success" ? CheckCircle2 : AlertTriangle;
          return (
            <div className={`mb-3 flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11px] ${toneCls}`} role="status">
              <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="flex-1 leading-relaxed">{s.text}</span>
            </div>
          );
        })()}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={sending}
            className="inline-flex h-9 items-center rounded-md border px-3 text-xs disabled:opacity-50"
          >
            {lastResult && lastResult.status !== "shared" ? "Tutup" : "Batal"}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={sending}
            className="inline-flex h-9 items-center gap-1 rounded-md bg-[#25D366] px-3 text-xs font-semibold text-white disabled:opacity-60"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : lastResult ? (
              <RefreshCw className="h-3.5 w-3.5" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {sending
              ? "Menyiapkan…"
              : lastResult
              ? "Coba lagi"
              : hasPhoto
              ? "Pilih WhatsApp"
              : "Lanjut Kirim WA"}
          </button>
        </div>
      </div>
    </div>
  );
}