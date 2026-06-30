import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, Image as ImageIcon, Link2, FileText, Send, Pencil, RotateCcw, MapPin, AlertTriangle, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { SendLogViewer } from "@/components/SendLogViewer";
import type { SendLogEntry } from "@/lib/send-log";

const SKIP_PREVIEW_KEY = "wa-skip-preview";

export function getWaSkipPreview(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(SKIP_PREVIEW_KEY) === "1"; } catch { return false; }
}

export function setWaSkipPreview(v: boolean) {
  try {
    if (v) window.localStorage.setItem(SKIP_PREVIEW_KEY, "1");
    else window.localStorage.removeItem(SKIP_PREVIEW_KEY);
  } catch { /* ignore */ }
}

type Request = {
  text: string;
  url?: string;
  files?: File[];
  /** Total foto yang diharapkan ada (>= files.length). Selisihnya dianggap "gagal diunduh". */
  expectedCount?: number;
  /** Coba ambil ulang foto yang gagal. Implementasi caller wajib mengembalikan File[] baru
   *  (yang sukses pada percobaan ini). Helper akan menambahkannya ke files. */
  retryMissing?: () => Promise<File[]>;
  /** Info klik ganda (idempotency hit) saat dialog dibuka. */
  duplicate?: { at: number; status: "in-flight" | "done" | "failed"; destination?: string } | null;
  previousLog?: SendLogEntry[];
  resolve: (result: { ok: boolean; text?: string; force?: boolean }) => void;
};

let openRequest: ((req: Request) => void) | null = null;
const queue: Request[] = [];

/**
 * Tampilkan pratinjau pesan WA + daftar foto sebelum benar-benar membuka WA.
 * Mengembalikan true jika user menekan "Kirim", false jika dibatalkan.
 * Akan dilewati jika user pernah mencentang "Jangan tampilkan lagi".
 */
export function confirmWaShare(input: {
  text: string;
  url?: string;
  files?: File[];
  expectedCount?: number;
  retryMissing?: () => Promise<File[]>;
  duplicate?: { at: number; status: "in-flight" | "done" | "failed"; destination?: string } | null;
  previousLog?: SendLogEntry[];
}): Promise<{ ok: boolean; text?: string; force?: boolean }> {
  // Tampilkan pratinjau saat klik ganda terdeteksi, meski user pernah meminta "jangan
  // tampilkan lagi" — operator perlu lihat peringatan duplikat & tombol force.
  const dupActive = !!input.duplicate && input.duplicate.status !== "failed";
  if (getWaSkipPreview() && !dupActive) return Promise.resolve({ ok: true, text: input.text });
  return new Promise((resolve) => {
    const req: Request = { ...input, resolve };
    if (openRequest) openRequest(req);
    else queue.push(req);
  });
}

export function WaPreviewHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [retrying, setRetrying] = useState(false);
  /** Counter untuk memaksa re-render setelah retryMissing memutasi current.files. */
  const [fileRev, setFileRev] = useState(0);

  useEffect(() => {
    openRequest = (req) => {
      setSkip(false);
      setEditing(false);
      setDraft(req.text);
      setRetrying(false);
      setFileRev(0);
      setCurrent(req);
      setOpen(true);
    };
    while (queue.length) {
      const req = queue.shift()!;
      setSkip(false);
      setEditing(false);
      setDraft(req.text);
      setRetrying(false);
      setFileRev(0);
      setCurrent(req);
      setOpen(true);
    }
    return () => { openRequest = null; };
  }, []);

  const previews = useMemo(() => {
    if (!current?.files?.length) return [] as { name: string; size: number; url: string; isImage: boolean }[];
    return current.files.map((f) => ({
      name: f.name,
      size: f.size,
      url: URL.createObjectURL(f),
      isImage: /^image\//.test(f.type),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, fileRev]);

  useEffect(() => {
    return () => {
      previews.forEach((p) => { try { URL.revokeObjectURL(p.url); } catch { /* ignore */ } });
    };
  }, [previews]);

  const finish = (ok: boolean, force = false) => {
    setOpen(false);
    if (ok && skip) setWaSkipPreview(true);
    current?.resolve({ ok, text: ok ? draft : undefined, force: ok ? force : undefined });
    setTimeout(() => setCurrent(null), 150);
  };

  const url = current?.url;
  const isMapsUrl = !!url && /(?:google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|geo:)/i.test(url);
  const photoCount = previews.length;
  const expected = current?.expectedCount ?? photoCount;
  const missing = Math.max(0, expected - photoCount);
  const canRetry = !!current?.retryMissing && missing > 0;
  const dup = current?.duplicate ?? null;
  const dupActive = !!dup && dup.status !== "failed";
  const dupAgoSec = dup ? Math.max(0, Math.round((Date.now() - dup.at) / 1000)) : 0;
  const dupAgoLabel = dupAgoSec < 60 ? `${dupAgoSec} detik lalu` : `${Math.round(dupAgoSec / 60)} menit lalu`;
  const dupAbsLabel = dup ? new Date(dup.at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  const dupStatusLabel = dup ? (dup.status === "in-flight" ? "Masih berjalan" : dup.status === "done" ? "Sudah terkirim" : "Gagal") : "";
  const original = current?.text ?? "";
  const edited = draft !== original;

  const handleRetry = async () => {
    if (!current?.retryMissing || retrying) return;
    setRetrying(true);
    try {
      const newFiles = await current.retryMissing();
      if (newFiles && newFiles.length > 0) {
        // Mutasi array yang dipegang caller agar foto baru ikut terkirim.
        const arr = (current.files ??= []);
        arr.push(...newFiles);
        setFileRev((n) => n + 1);
        toast.success(`${newFiles.length} foto berhasil diambil ulang.`);
      } else {
        toast.warning("Masih gagal mengunduh foto. Coba lagi sebentar atau periksa koneksi.");
      }
    } catch (err) {
      toast.error(`Gagal mengambil ulang foto: ${(err as Error).message || "tidak diketahui"}`);
    } finally {
      setRetrying(false);
    }
  };

  const fmtSize = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish(false)}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b bg-muted/30 px-5 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <DialogTitle className="text-base">Pratinjau pesan WhatsApp</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                Tinjau teks dan foto yang akan dikirim sebelum membuka WhatsApp.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
          {dupActive ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-[12px] text-amber-900 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {dup!.status === "in-flight"
                    ? "Klik ganda terdeteksi — kiriman WA sebelumnya masih berjalan."
                    : "Klik ganda terdeteksi — paket ini baru saja dikirim ke WA."}
                </div>
                <div className="mt-0.5 opacity-90">
                  {dup!.status === "in-flight"
                    ? `Dimulai ${dupAgoLabel}. Tunggu hingga selesai agar tidak terkirim dua kali.`
                    : `Dikirim ${dupAgoLabel}. Tombol "Kirim WA" dinonaktifkan untuk mencegah pesan dobel. Gunakan "Kirim ulang (paksa)" hanya jika Anda yakin perlu mengirim ulang.`}
                </div>
                <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-[11.5px]">
                  <dt className="font-medium opacity-80">Waktu</dt>
                  <dd className="break-words"><span className="font-mono">{dupAbsLabel}</span> <span className="opacity-70">({dupAgoLabel})</span></dd>
                  {dup!.destination ? (<>
                    <dt className="font-medium opacity-80">Tujuan</dt>
                    <dd className="break-words">{dup!.destination}</dd>
                  </>) : null}
                  <dt className="font-medium opacity-80">Status</dt>
                  <dd className="break-words">{dupStatusLabel}</dd>
                </dl>
              </div>
            </div>
          ) : null}
          {current?.previousLog && current.previousLog.length > 0 ? (
            <SendLogViewer entries={current.previousLog} defaultOpen={dupActive && dup!.status !== "in-flight"} />
          ) : null}
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                <FileText className="h-3 w-3" /> Teks pesan {edited ? <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">diubah</span> : null}
              </div>
              <div className="flex items-center gap-1">
                {edited ? (
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10.5px]" onClick={() => setDraft(original)}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Reset
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10.5px]" onClick={() => setEditing((v) => !v)}>
                  <Pencil className="mr-1 h-3 w-3" /> {editing ? "Selesai" : "Edit"}
                </Button>
              </div>
            </div>
            {editing ? (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={8}
                className="min-h-[8rem] resize-y bg-background font-sans text-xs leading-relaxed"
                placeholder="Tulis pesan untuk WhatsApp…"
                autoFocus
              />
            ) : (
              <pre
                className="max-h-48 cursor-text overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 font-sans text-xs leading-relaxed text-foreground"
                onClick={() => setEditing(true)}
                title="Klik untuk mengedit"
              >
{draft || <span className="italic text-muted-foreground">(kosong — klik untuk mengetik)</span>}
              </pre>
            )}
          </div>

          {url ? (
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {isMapsUrl ? <MapPin className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                {isMapsUrl ? "Link Maps" : "Link tambahan"}
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block break-all rounded-md bg-background p-2 font-mono text-[11px] text-primary underline-offset-2 hover:underline"
              >
                {url}
              </a>
            </div>
          ) : null}

          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ImageIcon className="h-3 w-3" /> Foto / lampiran
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {photoCount}{expected > photoCount ? ` / ${expected}` : ""} berkas
              </span>
            </div>
            {missing > 0 ? (
              <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{missing} foto gagal diunduh.</div>
                  <div className="opacity-80">
                    {canRetry
                      ? "Coba ambil ulang sebelum mengirim agar tidak ada foto yang hilang."
                      : "Foto ini tidak akan ikut terkirim — lanjutkan kirim hanya jika tidak diperlukan."}
                  </div>
                </div>
                {canRetry ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 border-amber-500/60 bg-background px-2 text-[11px] text-amber-800 hover:bg-amber-500/10 dark:text-amber-200"
                    onClick={handleRetry}
                    disabled={retrying}
                  >
                    {retrying ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3 w-3" />
                    )}
                    {retrying ? "Mengambil…" : "Coba ambil ulang"}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {photoCount === 0 ? (
              <div className="rounded-md border border-dashed bg-background/60 p-4 text-center text-xs text-muted-foreground">
                Tidak ada foto — hanya teks{url ? " + link" : ""} yang akan dikirim.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {previews.map((p, i) => (
                  <div key={i} className="overflow-hidden rounded-md border bg-background">
                    {p.isImage ? (
                      <img
                        src={p.url}
                        alt={p.name}
                        className="aspect-square w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center bg-muted text-muted-foreground">
                        <FileText className="h-6 w-6" />
                      </div>
                    )}
                    <div className="px-1.5 py-1">
                      <div className="truncate text-[10px] font-medium" title={p.name}>{p.name}</div>
                      <div className="text-[9.5px] text-muted-foreground">{fmtSize(p.size)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-start gap-2 rounded-lg border p-3 text-xs text-muted-foreground">
            <Checkbox checked={skip} onCheckedChange={(c) => setSkip(c === true)} className="mt-0.5" />
            <span>Jangan tampilkan pratinjau ini lagi (bisa diaktifkan kembali dari Pengaturan)</span>
          </label>
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-5 py-3">
          <span className="text-[11px] text-muted-foreground">
            {photoCount > 0 ? `${photoCount} foto + teks` : "Teks saja"}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => finish(false)}>
              Batal
            </Button>
            {dupActive ? (
              <Button
                type="button"
                size="sm"
                onClick={() => finish(true, true)}
                disabled={dup!.status === "in-flight"}
                title={dup!.status === "in-flight" ? "Kiriman sebelumnya masih berjalan" : "Kirim ulang meski klik ganda terdeteksi"}
                className="bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
              >
                <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                Kirim ulang (paksa)
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => finish(true)}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Kirim WA
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}