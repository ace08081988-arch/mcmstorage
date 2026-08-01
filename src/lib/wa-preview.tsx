import { memo, useCallback, useEffect, useMemo, useState } from "react";
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
import { useLiveSendLogStatus } from "@/lib/send-log";
import { SyncSourceBadge } from "@/components/SyncSourceBadge";
import { InflightStepProgress } from "@/components/InflightStepProgress";
import { StatusBadge } from "@/components/StatusBadge";
import { useLiveIdemByIds, channelFromKey } from "@/lib/idempotency";
import type { SendPayloadSummary } from "@/lib/idempotency";
import { SendPayloadDiff } from "@/components/SendPayloadDiff";
import { FingerprintInfoTooltip } from "@/components/FingerprintInfoTooltip";
import { DebtQuickActions } from "@/components/DebtQuickActions";

const SKIP_PREVIEW_KEY = "wa-skip-preview";

/** Format ukuran berkas — pure, dipindah ke module scope agar stabil. */
function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Sub-komponen berat yang di-memo agar tidak ikut re-render saat mengetik. */
const MemoDebtQuickActions = memo(DebtQuickActions);
const MemoSendLogViewer = memo(SendLogViewer);
const MemoSendPayloadDiff = memo(SendPayloadDiff);
const MemoInflightStepProgress = memo(InflightStepProgress);

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
  duplicate?: { at: number; status: "in-flight" | "done" | "failed"; destination?: string; fingerprint?: string; summary?: SendPayloadSummary } | null;
  /** Fingerprint payload yang akan dikirim sekarang. Dipakai untuk membandingkan
   *  dengan `duplicate.fingerprint` agar tombol "Kirim ulang (paksa)" hanya aktif
   *  jika payload-nya benar-benar sama. */
  currentFingerprint?: string;
  /** Ringkasan payload yang akan dikirim sekarang — dipakai banner untuk
   *  menampilkan diff field-by-field saat fingerprint tidak cocok. */
  currentSummary?: SendPayloadSummary;
  previousLog?: SendLogEntry[];
  /** Daftar shot ID (sorted, koma) untuk sinkronisasi idempotency lintas channel. */
  idemIdsKey?: string;
  /** Info lawan bicara (pelanggan / supplier) untuk tombol Hutang / Bayar / Lunas. */
  peer?: { name?: string; phone?: string; accountUserId?: string } | null;
  resolve: (result: { ok: boolean; text?: string; force?: boolean }) => void;
};

let openRequest: ((req: Request) => void) | null = null;
const queue: Request[] = [];

type DupInfo = NonNullable<Request["duplicate"]>;

/** Banner klik-ganda. Di-memo: hanya re-render saat data idempotency berubah. */
const DuplicateNotice = memo(function DuplicateNotice({
  dup, crossChannel, payloadMatches, forceDisabledReason, curFp, currentSummary, liveLog, liveChannel,
}: {
  dup: DupInfo;
  crossChannel: boolean;
  payloadMatches: boolean;
  forceDisabledReason: string | null;
  curFp?: string;
  currentSummary?: SendPayloadSummary;
  liveLog: ReturnType<typeof useLiveSendLogStatus>;
  liveChannel: ReturnType<typeof channelFromKey>;
}) {
  const dupAgoSec = Math.max(0, Math.round((Date.now() - dup.at) / 1000));
  const dupAgoLabel = dupAgoSec < 60 ? `${dupAgoSec} detik lalu` : `${Math.round(dupAgoSec / 60)} menit lalu`;
  const dupAbsLabel = new Date(dup.at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dupStatusLabel = dup.status === "in-flight" ? "Masih berjalan" : dup.status === "done" ? "Sudah terkirim" : "Gagal";
  return (
    <div className="flex items-start gap-ms-2 rounded-lg border border-warning/50 bg-warning/10 p-ms-3 text-ms-xs text-warning dark:text-warning">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          {dup.status === "in-flight"
            ? (crossChannel
                ? "Kiriman Chat untuk paket ini sedang berjalan."
                : "Klik ganda terdeteksi — kiriman MCM sebelumnya masih berjalan.")
            : "Klik ganda terdeteksi — paket ini baru saja dikirim via MCM."}
        </div>
        <div className="mt-0.5 opacity-90">
          {dup.status === "in-flight"
            ? `Dimulai ${dupAgoLabel}. Tombol "Kirim via MCM" dinonaktifkan hingga ${crossChannel ? "kiriman Chat" : "kiriman sebelumnya"} selesai agar tidak terkirim dua kali.`
            : `Dikirim ${dupAgoLabel}. Tombol "Kirim via MCM" dinonaktifkan untuk mencegah pesan dobel. Gunakan "Kirim ulang (paksa)" hanya jika Anda yakin perlu mengirim ulang.`}
        </div>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-ms-2xs">
          <dt className="font-medium opacity-80">Waktu</dt>
          <dd className="min-w-0 break-words"><span className="font-mono">{dupAbsLabel}</span> <span className="opacity-70">({dupAgoLabel})</span></dd>
          {dup.destination || crossChannel ? (<>
            <dt className="font-medium opacity-80">Tujuan</dt>
            <dd className="min-w-0 break-words">{dup.destination ?? "—"}{crossChannel ? " · via Chat" : ""}</dd>
          </>) : null}
          <dt className="font-medium opacity-80">Status</dt>
          <dd className="min-w-0 break-words">{dupStatusLabel}</dd>
        </dl>
        {dup.status !== "in-flight" ? (
          <div
            className={
              "mt-2 rounded-md border px-ms-2 py-1.5 text-ms-2xs " +
              (payloadMatches
                ? "border-success/40 bg-success/10 text-success dark:text-success"
                : "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200")
            }
          >
            <span className="inline-flex items-start gap-ms-1">
              <span className="flex-1">
                {payloadMatches
                  ? "Payload identik dengan kiriman sebelumnya — aman untuk dikirim ulang bila perlu."
                  : forceDisabledReason}
              </span>
              <FingerprintInfoTooltip
                matches={payloadMatches}
                previousFp={dup.fingerprint}
                currentFp={curFp}
                previous={dup.summary}
                current={currentSummary}
              />
            </span>
          </div>
        ) : null}
        {dup.status !== "in-flight" && !payloadMatches ? (
          <MemoSendPayloadDiff previous={dup.summary} current={currentSummary} />
        ) : null}
        {dup.status === "in-flight" ? (
          <MemoInflightStepProgress
            entries={liveLog.entries}
            channel={liveChannel}
            stale={liveLog.stale}
            syncError={liveLog.error}
            lastSyncedAt={liveLog.lastSyncedAt}
          />
        ) : null}
      </div>
    </div>
  );
});

type PreviewItem = { name: string; size: number; url: string; isImage: boolean };

/** Grid lampiran foto. Di-memo agar mengetik caption tidak me-render ulang thumbnail. */
const AttachmentsSection = memo(function AttachmentsSection({
  previews, expected, missing, canRetry, retrying, onRetry, hasUrl,
}: {
  previews: PreviewItem[];
  expected: number;
  missing: number;
  canRetry: boolean;
  retrying: boolean;
  onRetry: () => void;
  hasUrl: boolean;
}) {
  const photoCount = previews.length;
  return (
    <div className="rounded-lg border bg-muted/30 p-ms-2 sm:p-ms-3">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-ms-2">
        <div className="flex min-w-0 items-center gap-ms-1.5 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ImageIcon className="h-3 w-3" /> Foto / lampiran
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-ms-2 py-0.5 text-ms-2xs font-medium tabular-nums text-muted-foreground">
          {photoCount}{expected > photoCount ? ` / ${expected}` : ""} berkas
        </span>
      </div>
      {missing > 0 ? (
        <div className="mb-2 flex flex-wrap items-start gap-ms-2 rounded-md border border-warning/40 bg-warning/10 p-ms-2 text-ms-2xs text-warning dark:text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-[10rem] flex-1">
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
              className="h-8 shrink-0 border-warning/60 bg-background px-ms-2 text-ms-2xs text-warning hover:bg-warning/10 dark:text-warning"
              onClick={onRetry}
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
        <div className="rounded-md border border-dashed bg-background/60 p-ms-4 text-center text-ms-xs text-muted-foreground">
          Tidak ada foto — hanya teks{hasUrl ? " + link" : ""} yang akan dikirim.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-ms-2">
          {previews.map((p, i) => (
            <div key={`${p.name}-${i}`} className="overflow-hidden rounded-md border bg-background">
              {p.isImage ? (
                <img src={p.url} alt={p.name} className="aspect-square w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-muted text-muted-foreground">
                  <FileText className="h-6 w-6" />
                </div>
              )}
              <div className="px-1.5 py-1">
                <div className="truncate text-ms-2xs font-medium leading-snug" title={p.name}>{p.name}</div>
                <div className="truncate text-ms-2xs tabular-nums text-muted-foreground">{fmtSize(p.size)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/** Kartu link tambahan — statis per request. */
const LinkSection = memo(function LinkSection({ url }: { url: string }) {
  const isMapsUrl = /(?:google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|geo:)/i.test(url);
  return (
    <div className="rounded-lg border bg-muted/30 p-ms-2 sm:p-ms-3">
      <div className="mb-1.5 flex items-center gap-ms-1.5 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {isMapsUrl ? <MapPin className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
        {isMapsUrl ? "Link Maps" : "Link tambahan"}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block break-all rounded-md bg-background p-ms-2 font-mono text-ms-2xs text-primary underline-offset-2 hover:underline"
      >
        {url}
      </a>
    </div>
  );
});

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
  duplicate?: { at: number; status: "in-flight" | "done" | "failed"; destination?: string; fingerprint?: string; summary?: SendPayloadSummary } | null;
  currentFingerprint?: string;
  currentSummary?: SendPayloadSummary;
  previousLog?: SendLogEntry[];
  idemIdsKey?: string;
  peer?: { name?: string; phone?: string; accountUserId?: string } | null;
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
  const live = useLiveIdemByIds(current?.idemIdsKey);
  const liveChannel = live ? channelFromKey(live.key) : "unknown";
  // Pantau log langkah kiriman in-flight (channel manapun) — saat kiriman Chat
  // untuk paket yang sama masih berjalan, dialog WA ikut menampilkan progresnya.
  const liveInflightKey = live && live.status === "in-flight" ? live.key : null;
  const liveLog = useLiveSendLogStatus(liveInflightKey);
  const crossChannel = !!live && liveChannel === "chat";
  const snapshotDup = current?.duplicate ?? null;
  const dup = live
    ? { at: live.at, status: live.status, destination: snapshotDup?.destination, fingerprint: live.fingerprint, summary: live.summary }
    : snapshotDup;
  const dupActive = !!dup && dup.status !== "failed";
  // Tombol "Kirim ulang (paksa)" hanya boleh aktif jika fingerprint payload
  // saat ini sama dengan fingerprint payload kiriman sebelumnya. Bila salah
  // satu fingerprint tidak tersedia (record lama tanpa fingerprint), default
  // ke "tidak cocok" demi kehati-hatian — operator harus menutup dialog
  // alih-alih mengirim konten yang mungkin berbeda secara tak sengaja.
  const dupFp = dup?.fingerprint;
  const curFp = current?.currentFingerprint;
  const payloadMatches = !!dupFp && !!curFp && dupFp === curFp;
  const forceDisabledReason = !payloadMatches
    ? (!dupFp
        ? "Tidak ada sidik jari payload tersimpan dari kiriman sebelumnya — tutup dialog dan tunggu jeda idempotency selesai sebelum mengirim ulang."
        : "Payload (caption / foto / link) berbeda dari kiriman sebelumnya. Tombol paksa dinonaktifkan agar konten berbeda tidak terkirim ke tujuan yang sama dengan key idempotency yang sama.")
    : null;
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
      <DialogContent className="flex max-h-[92svh] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-h-[88svh] sm:w-full sm:max-w-md">
        <DialogHeader className="shrink-0 border-b bg-muted/30 px-ms-4 pb-3 pt-4 sm:px-ms-5 sm:pb-4 sm:pt-5">
          <div className="flex items-center gap-ms-2 sm:gap-ms-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success dark:text-success sm:h-10 sm:w-10">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <DialogTitle className="flex min-w-0 flex-wrap items-center gap-ms-2 text-ms-sm sm:text-ms-base">
                <span className="min-w-0 truncate">Pratinjau pesan MCM</span>
                <SyncSourceBadge source={liveLog.lastSource} active={liveLog.active} />
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-ms-2xs leading-snug sm:text-ms-xs">
                Tinjau teks dan foto yang akan dikirim sebelum membuka MCM.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-ms-3 overflow-y-auto overscroll-contain px-ms-3 py-ms-3 sm:px-ms-5 sm:py-ms-4">
          {current?.peer && (current.peer.phone || current.peer.accountUserId) ? (
            <DebtQuickActions
              peerPhone={current.peer.phone ?? null}
              peerName={current.peer.name ?? null}
              peerAccountUserId={current.peer.accountUserId ?? null}
            />
          ) : null}
          {dupActive ? (
            <div className="flex items-start gap-ms-2 rounded-lg border border-warning/50 bg-warning/10 p-ms-3 text-ms-xs text-warning dark:text-warning">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {dup!.status === "in-flight"
                    ? (crossChannel
                        ? "Kiriman Chat untuk paket ini sedang berjalan."
                        : "Klik ganda terdeteksi — kiriman MCM sebelumnya masih berjalan.")
                    : "Klik ganda terdeteksi — paket ini baru saja dikirim via MCM."}
                </div>
                <div className="mt-0.5 opacity-90">
                  {dup!.status === "in-flight"
                    ? `Dimulai ${dupAgoLabel}. Tombol "Kirim via MCM" dinonaktifkan hingga ${crossChannel ? "kiriman Chat" : "kiriman sebelumnya"} selesai agar tidak terkirim dua kali.`
                    : `Dikirim ${dupAgoLabel}. Tombol "Kirim via MCM" dinonaktifkan untuk mencegah pesan dobel. Gunakan "Kirim ulang (paksa)" hanya jika Anda yakin perlu mengirim ulang.`}
                </div>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-ms-2xs">
                  <dt className="font-medium opacity-80">Waktu</dt>
                  <dd className="min-w-0 break-words"><span className="font-mono">{dupAbsLabel}</span> <span className="opacity-70">({dupAgoLabel})</span></dd>
                  {dup!.destination || crossChannel ? (<>
                    <dt className="font-medium opacity-80">Tujuan</dt>
                    <dd className="min-w-0 break-words">{dup!.destination ?? "—"}{crossChannel ? " · via Chat" : ""}</dd>
                  </>) : null}
                  <dt className="font-medium opacity-80">Status</dt>
                  <dd className="min-w-0 break-words">{dupStatusLabel}</dd>
                </dl>
                {dup!.status !== "in-flight" ? (
                  <div
                    className={
                      "mt-2 rounded-md border px-ms-2 py-1.5 text-ms-2xs " +
                      (payloadMatches
                        ? "border-success/40 bg-success/10 text-success dark:text-success"
                        : "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200")
                    }
                  >
                    <span className="inline-flex items-start gap-ms-1">
                      <span className="flex-1">
                        {payloadMatches
                          ? "Payload identik dengan kiriman sebelumnya — aman untuk dikirim ulang bila perlu."
                          : forceDisabledReason}
                      </span>
                      <FingerprintInfoTooltip
                        matches={payloadMatches}
                        previousFp={dupFp}
                        currentFp={curFp}
                        previous={dup!.summary}
                        current={current?.currentSummary}
                      />
                    </span>
                  </div>
                ) : null}
                {dup!.status !== "in-flight" && !payloadMatches ? (
                  <SendPayloadDiff previous={dup!.summary} current={current?.currentSummary} />
                ) : null}
                {dup!.status === "in-flight" ? (
                  <InflightStepProgress
                    entries={liveLog.entries}
                    channel={liveChannel}
                    stale={liveLog.stale}
                    syncError={liveLog.error}
                    lastSyncedAt={liveLog.lastSyncedAt}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
          {current?.previousLog && current.previousLog.length > 0 ? (
            <SendLogViewer entries={current.previousLog} defaultOpen={dupActive && dup!.status !== "in-flight"} />
          ) : null}
          <div className="rounded-lg border bg-muted/30 p-ms-2 sm:p-ms-3">
            <div className="mb-1.5 flex min-w-0 items-center justify-between gap-ms-2">
              <div className="flex min-w-0 items-center gap-ms-1.5 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                <FileText className="h-3 w-3" /> Teks pesan {edited ? <StatusBadge size="xs" variant="menunggu">diubah</StatusBadge> : null}
              </div>
              <div className="flex shrink-0 items-center gap-ms-1">
                {edited ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-ms-2 text-ms-2xs" onClick={() => setDraft(original)}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Reset
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="sm" className="h-7 px-ms-2 text-ms-2xs" onClick={() => setEditing((v) => !v)}>
                  <Pencil className="mr-1 h-3 w-3" /> {editing ? "Selesai" : "Edit"}
                </Button>
              </div>
            </div>
            {editing ? (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={8}
                className="min-h-[8rem] max-h-[45svh] resize-y bg-background font-sans text-ms-xs leading-relaxed"
                placeholder="Tulis pesan untuk MCM…"
                autoFocus
              />
            ) : (
              <pre
                className="max-h-[38svh] cursor-text overflow-auto overscroll-contain whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-background p-ms-2 font-sans text-ms-xs leading-relaxed text-foreground"
                onClick={() => setEditing(true)}
                title="Klik untuk mengedit"
              >
{draft || <span className="italic text-muted-foreground">(kosong — klik untuk mengetik)</span>}
              </pre>
            )}
          </div>

          {url ? (
            <div className="rounded-lg border bg-muted/30 p-ms-2 sm:p-ms-3">
              <div className="mb-1.5 flex items-center gap-ms-1.5 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                {isMapsUrl ? <MapPin className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                {isMapsUrl ? "Link Maps" : "Link tambahan"}
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block break-all rounded-md bg-background p-ms-2 font-mono text-ms-2xs text-primary underline-offset-2 hover:underline"
              >
                {url}
              </a>
            </div>
          ) : null}

          <div className="rounded-lg border bg-muted/30 p-ms-2 sm:p-ms-3">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-ms-2">
              <div className="flex min-w-0 items-center gap-ms-1.5 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ImageIcon className="h-3 w-3" /> Foto / lampiran
              </div>
              <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-ms-2 py-0.5 text-ms-2xs font-medium tabular-nums text-muted-foreground">
                {photoCount}{expected > photoCount ? ` / ${expected}` : ""} berkas
              </span>
            </div>
            {missing > 0 ? (
              <div className="mb-2 flex flex-wrap items-start gap-ms-2 rounded-md border border-warning/40 bg-warning/10 p-ms-2 text-ms-2xs text-warning dark:text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-[10rem] flex-1">
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
                    className="h-8 shrink-0 border-warning/60 bg-background px-ms-2 text-ms-2xs text-warning hover:bg-warning/10 dark:text-warning"
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
              <div className="rounded-md border border-dashed bg-background/60 p-ms-4 text-center text-ms-xs text-muted-foreground">
                Tidak ada foto — hanya teks{url ? " + link" : ""} yang akan dikirim.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-ms-2">
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
                    <div className="truncate text-ms-2xs font-medium leading-snug" title={p.name}>{p.name}</div>
                    <div className="truncate text-ms-2xs tabular-nums text-muted-foreground">{fmtSize(p.size)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-start gap-ms-2 rounded-lg border p-ms-2 text-ms-2xs leading-snug text-muted-foreground sm:p-ms-3 sm:text-ms-xs">
            <Checkbox checked={skip} onCheckedChange={(c) => setSkip(c === true)} className="mt-0.5" />
            <span>Jangan tampilkan pratinjau ini lagi (bisa diaktifkan kembali dari Pengaturan)</span>
          </label>
        </div>

        <div
          className="grid shrink-0 grid-cols-1 gap-ms-2 border-t bg-muted/20 px-ms-3 py-ms-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-ms-5"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <span className="truncate text-ms-2xs text-muted-foreground">
            {photoCount > 0 ? `${photoCount} foto + teks` : "Teks saja"}
          </span>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-ms-2 sm:flex">
            <Button type="button" variant="outline" size="sm" onClick={() => finish(false)}>
              Batal
            </Button>
            {dupActive ? (
              <Button
                type="button"
                size="sm"
                onClick={() => finish(true, true)}
                disabled={dup!.status === "in-flight" || !payloadMatches}
                title={
                  dup!.status === "in-flight"
                    ? (crossChannel ? "Kiriman Chat untuk paket ini masih berjalan" : "Kiriman sebelumnya masih berjalan")
                    : !payloadMatches
                      ? (forceDisabledReason ?? "Payload berbeda dari kiriman sebelumnya")
                      : "Kirim ulang meski klik ganda terdeteksi"
                }
                className="min-w-0 bg-warning text-warning-foreground hover:bg-warning disabled:opacity-50"
              >
                <ShieldAlert className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Kirim ulang (paksa)</span>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => finish(true)}
                disabled={live?.status === "in-flight"}
                title={live?.status === "in-flight" ? (crossChannel ? "Kiriman Chat untuk paket ini masih berjalan — tunggu selesai" : "Kiriman sebelumnya masih berjalan") : undefined}
                className="min-w-0 bg-success text-white hover:bg-success"
              >
                <Send className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{live?.status === "in-flight" ? "Menunggu kiriman lain…" : "Kirim via MCM"}</span>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}