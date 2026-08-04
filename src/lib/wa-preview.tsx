import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/** useLayoutEffect aman-SSR (di server jatuh ke useEffect, tanpa warning). */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
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
  /**
   * Elemen pemicu yang ditangkap di titik pemanggilan `confirmWaShare`.
   * Host dialog di-lazy-load, jadi saat pemanggilan pertama komponennya
   * belum ter-mount; kalau menunggu host, `document.activeElement` sudah
   * berpindah dan fokus tidak bisa dipulihkan ke tombol aslinya.
   */
  trigger?: HTMLElement | null;
  triggerSelector?: string | null;
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
        className="wa-message-token block rounded-md bg-background p-ms-2 font-mono text-ms-2xs text-primary underline-offset-2 hover:underline"
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
    // Tangkap pemicu SEKARANG (masih di dalam handler klik), bukan nanti saat
    // host lazy-nya selesai dimuat.
    const active = typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null;
    const trigger =
      active && active !== document.body && typeof active.focus === "function" ? active : null;
    const req: Request = {
      ...input,
      resolve,
      trigger,
      triggerSelector: trigger ? stableSelectorFor(trigger) : null,
    };
    if (openRequest) openRequest(req);
    else queue.push(req);
  });
}

/**
 * Selector stabil untuk menemukan ulang elemen pemicu setelah re-render.
 * Urutan preferensi: data-testid → id → aria-label (+tag).
 */
function stableSelectorFor(el: HTMLElement): string | null {
  const esc = (v: string) =>
    typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${esc(testId)}"]`;
  if (el.id) return `#${esc(el.id)}`;
  const label = el.getAttribute("aria-label");
  if (label) return `${el.tagName.toLowerCase()}[aria-label="${esc(label)}"]`;
  return null;
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
  /**
   * Elemen yang memegang fokus tepat sebelum dialog dibuka (mis. tombol
   * "Kirim WA"). Dialog ini dibuka secara imperatif — tanpa <DialogTrigger>
   * — sehingga pemulihan fokus bawaan Radix tidak selalu menemukan pemicu
   * yang benar. Kita simpan sendiri lalu kembalikan saat dialog tertutup /
   * dibatalkan, supaya urutan Tab berlanjut dari titik semula.
   */
  const triggerRef = useRef<HTMLElement | null>(null);
  /**
   * Elemen di dalam dialog yang memegang fokus sebelum popover/select Radix
   * terbuka di portal. Dipakai untuk memulihkan fokus ke pemicu setelah layer
   * portal ditutup (Radix kadang meleset ke <body> di Android WebView).
   */
  const layerTriggerRef = useRef<HTMLElement | null>(null);
  /**
   * Cadangan pencarian pemicu: bila node aslinya sudah dilepas dari DOM
   * (list/kartu ikut re-render setelah kirim), kita cari ulang elemen
   * setara lewat selector stabil ini.
   */
  const triggerSelectorRef = useRef<string | null>(null);
  /** Timer/rAF pemulihan fokus agar bisa dibatalkan saat dialog dibuka lagi. */
  const restoreTimersRef = useRef<number[]>([]);
  /**
   * Penanda siklus pemulihan yang sedang berjalan. Beberapa jalur bisa memicu
   * pemulihan hampir bersamaan (onCloseAutoFocus + jaring pengaman di
   * `finish`); tanpa penjaga ini, panggilan kedua kehilangan ref pemicu dan
   * malah melompat ke fallback (elemen fokusable pertama halaman).
   */
  const restoringRef = useRef(false);

  const clearRestoreTimers = useCallback(() => {
    for (const id of restoreTimersRef.current) {
      clearTimeout(id);
      cancelAnimationFrame(id);
    }
    restoreTimersRef.current = [];
  }, []);

  /**
   * Pemulihan fokus yang tahan perubahan konten.
   *
   * Semua jalur penutupan (tombol Batal, tombol X, Kirim, ESC, klik backdrop)
   * bermuara ke sini. Tiga lapis fallback:
   *  1. Node pemicu asli, kalau masih ada di DOM.
   *  2. Node baru hasil re-render, dicari ulang lewat selector stabil
   *     (data-testid / id / aria-label).
   *  3. Elemen fokusable pertama di dalam <main> — supaya Tab tidak pernah
   *     mulai lagi dari awal halaman.
   * Percobaan diulang beberapa frame karena konten di belakang dialog bisa
   * masih remount saat dialog menutup (animasi + refetch daftar).
   */
  const restoreTriggerFocus = useCallback(() => {
    if (restoringRef.current) return;
    restoringRef.current = true;
    const el = triggerRef.current;
    const selector = triggerSelectorRef.current;
    clearRestoreTimers();
    // Ref pemicu sengaja TIDAK dikosongkan di sini: Radix bisa memicu blur
    // susulan setelah animasi tutup, dan siklus pemulihan berikutnya harus
    // tetap tahu tombol aslinya (kalau dikosongkan, ia jatuh ke fallback dan
    // fokus melompat ke elemen pertama halaman). Ref dibersihkan saat dialog
    // dibuka lagi (`capture`).

    const pick = (): HTMLElement | null => {
      if (el && document.contains(el) && el.offsetParent !== null) return el;
      if (selector) {
        const found = document.querySelector<HTMLElement>(selector);
        if (found && found.offsetParent !== null) return found;
      }
      // Fallback halaman hanya dipakai bila pemicu memang tidak pernah
      // diketahui — bukan sekadar sedang tidak bisa difokus.
      if (el || selector) return null;
      const main = document.querySelector("main") ?? document.body;
      return main.querySelector<HTMLElement>(
        'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
    };

    // Radix baru melepas overlay & aria-hidden setelah animasi tutup; fokus
    // sebelum itu bisa langsung dibuang lagi — karena itu diulang.
    let attempt = 0;
    const tryFocus = () => {
      attempt += 1;
      const active = document.activeElement as HTMLElement | null;
      const wanted = pick();
      const settled =
        active && active !== document.body && document.contains(active) &&
        (!wanted || active === wanted);
      if (settled && attempt > 1) {
        clearRestoreTimers();
        restoringRef.current = false;
        return;
      }
      if (wanted) {
        try { wanted.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
      if (attempt < 4) {
        restoreTimersRef.current.push(
          window.setTimeout(tryFocus, attempt === 1 ? 60 : attempt === 2 ? 180 : 320),
        );
      } else {
        restoringRef.current = false;
      }
    };
    restoreTimersRef.current.push(requestAnimationFrame(tryFocus));
  }, [clearRestoreTimers]);

  useEffect(() => clearRestoreTimers, [clearRestoreTimers]);

  useEffect(() => {
    /**
     * Pemicu diambil dari request (ditangkap saat `confirmWaShare` dipanggil).
     * Fallback ke `document.activeElement` untuk pemanggil lama.
     */
    const capture = (req: Request) => {
      // Dialog dibuka lagi: batalkan siklus pemulihan lama.
      clearRestoreTimers();
      restoringRef.current = false;
      const fromReq = req.trigger ?? null;
      if (fromReq) {
        triggerRef.current = fromReq;
        triggerSelectorRef.current = req.triggerSelector ?? stableSelectorFor(fromReq);
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const ok = active && active !== document.body && typeof active.focus === "function";
      triggerRef.current = ok ? active : null;
      triggerSelectorRef.current = ok ? stableSelectorFor(active!) : null;
    };
    openRequest = (req) => {
      capture(req);
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
      capture(req);
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

  const finish = useCallback((ok: boolean, force = false) => {
    setOpen(false);
    if (ok && skip) setWaSkipPreview(true);
    current?.resolve({ ok, text: ok ? draft : undefined, force: ok ? force : undefined });
    setTimeout(() => setCurrent(null), 150);
    // Jaring pengaman: kalau `onCloseAutoFocus` Radix tidak terpanggil
    // (unmount mendadak karena konten di belakang berubah), pulihkan fokus
    // sendiri. `restoreTriggerFocus` menihilkan ref-nya, jadi aman ganda.
    setTimeout(() => {
      if (triggerRef.current || triggerSelectorRef.current) restoreTriggerFocus();
    }, 120);
  }, [current, draft, skip, restoreTriggerFocus]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /**
   * Urutan tab saat berpindah mode edit ⇄ baca.
   *
   * Blok "Teks pesan" menukar dua elemen fokusable yang menempati posisi tab
   * yang sama: <Textarea> (mode edit) dan <pre role="button"> (mode baca).
   * Kalau pergantian dibiarkan apa adanya, elemen lama dilepas dari DOM,
   * fokus jatuh ke <body>, lalu penjaga fokus menariknya ke awal dialog —
   * Tab berikutnya terasa "meloncat" ke atas.
   *
   * Solusinya: kita catat dari mana mode edit dimasuki (`editReturnRef`) dan
   * ke mana fokus harus mendarat setelah re-render (`pendingFocusRef`), lalu
   * memindahkannya di useLayoutEffect — sebelum browser sempat memicu blur ke
   * <body>. Hasilnya posisi tab tetap di blok teks yang sama.
   */
  const preTextRef = useRef<HTMLPreElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editToggleRef = useRef<HTMLButtonElement | null>(null);
  const editReturnRef = useRef<"pre" | "button">("pre");
  const pendingFocusRef = useRef<"pre" | "button" | "textarea" | null>(null);

  /** Masuk mode edit; `from` menentukan tempat fokus kembali saat keluar. */
  const enterEditing = useCallback((from: "pre" | "button") => {
    editReturnRef.current = from;
    pendingFocusRef.current = "textarea";
    setEditing(true);
  }, []);

  /** Keluar mode edit dan kembalikan fokus ke pemicu awalnya. */
  const exitEditing = useCallback(() => {
    pendingFocusRef.current = editReturnRef.current;
    setEditing(false);
  }, []);

  useIsoLayoutEffect(() => {
    const want = pendingFocusRef.current;
    if (!want) return;
    pendingFocusRef.current = null;
    const el =
      want === "textarea"
        ? textareaRef.current
        : want === "button"
          ? editToggleRef.current
          : preTextRef.current;
    if (!el || !document.contains(el)) return;
    try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
    if (want === "textarea" && textareaRef.current) {
      // Kursor di akhir teks, bukan menyeleksi semuanya.
      const len = textareaRef.current.value.length;
      try { textareaRef.current.setSelectionRange(len, len); } catch { /* ignore */ }
    }
  }, [editing]);

  const url = current?.url;
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

  /**
   * Penjaga fokus untuk konten dinamis: saat dialog masih terbuka lalu isinya
   * berubah (masuk/keluar mode edit, tombol retry hilang, progres kiriman
   * muncul/hilang, foto di-refresh), elemen yang sedang fokus bisa dilepas
   * dari DOM. Browser lalu memindahkan fokus ke <body> — di luar dialog —
   * sehingga Tab berikutnya "meloncat" ke konten di belakang overlay.
   * Kita pantau mutasi DOM + focusin dan tarik fokus kembali ke dalam dialog.
   *
   * Optimasi: observer hanya melihat `childList` (tanpa atribut/teks), setiap
   * batch mutasi disaring dulu — kalau tidak ada node yang DILEPAS atau fokus
   * masih berada di dalam dialog, tidak ada kerja DOM sama sekali. Penjadwalan
   * ulang dikoalesi lewat satu timer debounce + satu rAF, jadi badai mutasi
   * (progres kiriman, foto refresh) tetap menghasilkan maksimal satu
   * perhitungan fokus per frame.
   */
  useEffect(() => {
    if (!open) return;
    const root = contentRef.current;
    if (!root) return;

    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** Layer Radix (popover/select/menu) yang sedang terbuka di portal luar. */
    let portalLayer: Element | null = null;
    let layerObserver: MutationObserver | null = null;

    const PORTAL_LAYER_SELECTOR =
      '[data-radix-popper-content-wrapper],[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"]';

    const portalLayerOpen = () => !!portalLayer && document.contains(portalLayer);

    /** Cek super-murah: apakah fokus sudah hilang dari dialog? */
    const focusEscaped = () => {
      const node = contentRef.current;
      if (!node || !document.contains(node)) return false;
      // Selama layer portal masih terbuka, fokus di dalamnya SAH.
      if (portalLayerOpen()) return false;
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return true;
      return !node.contains(active);
    };

    const runRefocus = () => {
        const node = contentRef.current;
        if (!node || !document.contains(node)) return;
        if (portalLayerOpen()) return;
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body && node.contains(active)) return;
        // Prioritas 1: elemen pemicu popover/select yang tadi memegang fokus
        // di dalam dialog (mis. tombol "Pilih kontak"). Radix biasanya sudah
        // mengembalikannya sendiri, tapi di Android WebView sering meleset ke
        // <body> — di situ kita pulihkan manual.
        const back = layerTriggerRef.current;
        if (back && document.contains(back) && node.contains(back)) {
          layerTriggerRef.current = null;
          try { back.focus({ preventScroll: true }); return; } catch { /* ignore */ }
        }
        // Prioritaskan area konten (tabIndex -1) agar pembaca layar tetap
        // berada dalam konteks dialog tanpa memicu tombol aksi.
        const target =
          scrollRef.current ??
          node.querySelector<HTMLElement>(
            'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
          ) ??
          node;
        try { target.focus({ preventScroll: true }); } catch { /* ignore */ }
    };

    /** Koalesi: 1 timer + 1 rAF, tidak peduli berapa kali dipanggil. */
    const scheduleRefocus = () => {
      if (timer !== null || raf !== 0) return;
      timer = setTimeout(() => {
        timer = null;
        if (!focusEscaped()) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          runRefocus();
        });
      }, 50);
    };

    const observer = new MutationObserver((records) => {
      // Hanya mutasi yang MELEPAS node bisa membuang fokus. Selain itu abaikan
      // tanpa menyentuh DOM sedikit pun.
      let removed = false;
      for (const r of records) {
        if (r.removedNodes.length > 0) { removed = true; break; }
      }
      if (!removed) return;
      if (!focusEscaped()) return;
      scheduleRefocus();
    });
    observer.observe(root, { childList: true, subtree: true });

    const onFocusIn = (e: FocusEvent) => {
      const node = contentRef.current;
      const target = e.target as Node | null;
      if (!node || !target) return;
      if (node.contains(target)) {
        // Catat kandidat pemicu: elemen interaktif terakhir di dalam dialog.
        const el = target instanceof HTMLElement ? target : null;
        if (el && typeof el.focus === "function" && el !== scrollRef.current) {
          layerTriggerRef.current = el;
        }
        return;
      }
      // Popover/select/tooltip Radix dirender di portal luar dialog — itu
      // masih "di dalam" konteks dialog secara logis, jangan direbut.
      const el = target instanceof Element ? target : (target.parentElement ?? null);
      const layer = el?.closest(PORTAL_LAYER_SELECTOR) ?? null;
      if (layer) {
        // Layer portal aktif: matikan sementara penjaga fokus, lalu pantau
        // sampai layer dilepas dari DOM agar fokus bisa dipulihkan ke pemicu.
        portalLayer = layer;
        layerObserver?.disconnect();
        layerObserver = new MutationObserver(() => {
          if (portalLayerOpen()) return;
          portalLayer = null;
          layerObserver?.disconnect();
          layerObserver = null;
          scheduleRefocus();
        });
        layerObserver.observe(document.body, { childList: true, subtree: true });
        return;
      }
      scheduleRefocus();
    };
    document.addEventListener("focusin", onFocusIn, true);

    return () => {
      if (timer !== null) clearTimeout(timer);
      if (raf !== 0) cancelAnimationFrame(raf);
      observer.disconnect();
      layerObserver?.disconnect();
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [open]);
  const crossChannel = !!live && liveChannel === "chat";
  const snapshotDup = current?.duplicate ?? null;
  const dup = useMemo(
    () => (live
      ? { at: live.at, status: live.status, destination: snapshotDup?.destination, fingerprint: live.fingerprint, summary: live.summary }
      : snapshotDup),
    [live, snapshotDup],
  );
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
  const original = current?.text ?? "";
  const edited = draft !== original;

  const handleRetry = useCallback(async () => {
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
  }, [current, retrying]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finish(false)}>
      <DialogContent
        ref={contentRef}
        data-testid="wa-preview-dialog"
        // Radix sudah menyetel role="dialog" + aria-labelledby/aria-describedby
        // (dari DialogTitle & DialogDescription di bawah). aria-modal ditulis
        // eksplisit agar pembaca layar di Android WebView tetap mengunci
        // pembacaan ke dalam dialog walau overlay tidak terdeteksi modal.
        aria-modal="true"
        // Fokus awal diarahkan ke area konten (bukan tombol kirim) supaya
        // pembaca layar membacakan judul + deskripsi lebih dulu dan pengguna
        // tidak sengaja mengirim dengan Enter. Trap fokus & Esc ditangani Radix.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          scrollRef.current?.focus();
        }}
        // Saat dialog tertutup (kirim, batal, ESC, atau klik backdrop) fokus
        // dikembalikan ke elemen pemicu asli, bukan ke <body> — sehingga
        // Tab berikutnya melanjutkan urutan dari tombol tersebut.
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreTriggerFocus();
        }}
        // Perilaku tutup dibuat eksplisit & konsisten:
        // - ESC: saat mode edit aktif, ESC pertama keluar dari editor (draft
        //   tetap tersimpan); ESC berikutnya membatalkan dialog.
        // - Klik/tap backdrop: sama dengan tombol "Batal".
        onEscapeKeyDown={(e) => {
          if (editing) {
            e.preventDefault();
            // ESC pertama hanya keluar dari editor; fokus mendarat kembali di
            // elemen pemicunya (teks pesan / tombol Edit), bukan ke awal
            // dialog — jadi Tab berikutnya melanjutkan dari posisi yang sama.
            exitEditing();
            return;
          }
          e.preventDefault();
          finish(false);
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
          finish(false);
        }}
        onInteractOutside={(e) => {
          e.preventDefault();
          finish(false);
        }}
        // Fallback trap Tab/Shift+Tab: di sebagian Android WebView fokus bisa
        // "lolos" ke konten di belakang overlay. Kita gulung fokus secara
        // manual saat mencapai elemen pertama/terakhir di dalam dialog.
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const root = contentRef.current;
          if (!root) return;
          const active0 = document.activeElement as HTMLElement | null;
          // Popover/select/menu Radix di portal mengelola Tab-nya sendiri —
          // jangan gulung fokus balik ke dialog selagi layer itu terbuka.
          if (
            active0 &&
            !root.contains(active0) &&
            active0.closest('[data-radix-popper-content-wrapper],[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"]')
          ) return;
          const focusables = Array.from(
            root.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement);
          if (focusables.length === 0) return;
          const first = focusables[0]!;
          const last = focusables[focusables.length - 1]!;
          const active = document.activeElement as HTMLElement | null;
          if (!e.shiftKey && (active === last || !root.contains(active))) {
            e.preventDefault();
            first.focus();
          } else if (e.shiftKey && (active === first || !root.contains(active))) {
            e.preventDefault();
            last.focus();
          }
        }}
        className="flex max-h-[92svh] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-0 overflow-clip p-0 sm:max-h-[88svh] sm:w-full sm:max-w-md"
      >
        <DialogHeader className="shrink-0 border-b bg-muted/30 py-3 pl-ms-4 pr-14 sm:py-4 sm:pl-ms-5 sm:pr-16">
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

        <div
          ref={scrollRef}
          data-testid="wa-preview-scroll"
          tabIndex={-1}
          className="min-h-0 flex-1 space-ms-3 overflow-y-auto overscroll-contain px-ms-3 py-ms-3 focus:outline-none sm:px-ms-5 sm:py-ms-4"
        >
          {current?.peer && (current.peer.phone || current.peer.accountUserId) ? (
            <MemoDebtQuickActions
              peerPhone={current.peer.phone ?? null}
              peerName={current.peer.name ?? null}
              peerAccountUserId={current.peer.accountUserId ?? null}
            />
          ) : null}
          {dupActive && dup ? (
            <DuplicateNotice
              dup={dup}
              crossChannel={crossChannel}
              payloadMatches={payloadMatches}
              forceDisabledReason={forceDisabledReason}
              curFp={curFp}
              currentSummary={current?.currentSummary}
              liveLog={liveLog}
              liveChannel={liveChannel}
            />
          ) : null}
          {current?.previousLog && current.previousLog.length > 0 ? (
            <MemoSendLogViewer entries={current.previousLog} defaultOpen={dupActive && dup!.status !== "in-flight"} />
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
                <Button
                  ref={editToggleRef}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-ms-2 text-ms-2xs"
                  aria-pressed={editing}
                  onClick={() => (editing ? exitEditing() : enterEditing("button"))}
                >
                  <Pencil className="mr-1 h-3 w-3" /> {editing ? "Selesai" : "Edit"}
                </Button>
              </div>
            </div>
            {editing ? (
              <Textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={8}
                aria-label="Teks pesan yang akan dikirim"
                className="min-h-[8rem] max-h-[45svh] resize-y bg-background font-sans text-ms-xs leading-relaxed"
                placeholder="Tulis pesan untuk MCM…"
                onKeyDown={(e) => {
                  // Ctrl/Cmd+Enter = selesai mengedit, sama seperti tombol
                  // "Selesai" — tanpa perlu men-Tab keluar dari textarea.
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    exitEditing();
                  }
                }}
              />
            ) : (
              <pre
                ref={preTextRef}
                data-testid="wa-preview-text"
                role="button"
                tabIndex={0}
                aria-label="Teks pesan — aktifkan untuk mengedit"
                className="wa-message-text max-h-[38svh] cursor-text overflow-auto overscroll-contain rounded-md bg-background p-ms-2 font-sans text-ms-xs leading-relaxed text-foreground"
                onClick={() => enterEditing("pre")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    enterEditing("pre");
                  }
                }}
                title="Klik untuk mengedit"
              >
{draft || <span className="italic text-muted-foreground">(kosong — klik untuk mengetik)</span>}
              </pre>
            )}
          </div>

          {url ? <LinkSection url={url} /> : null}

          <AttachmentsSection
            previews={previews}
            expected={expected}
            missing={missing}
            canRetry={canRetry}
            retrying={retrying}
            onRetry={handleRetry}
            hasUrl={!!url}
          />

          {/* Radix Checkbox dirender sebagai <button role="checkbox">, sehingga
              pembungkus <label> TIDAK memberi nama aksesibel. Nama diambil
              eksplisit dari teks lewat aria-labelledby. */}
          <label className="flex items-start gap-ms-2 rounded-lg border p-ms-2 text-ms-2xs leading-snug text-muted-foreground sm:p-ms-3 sm:text-ms-xs">
            <Checkbox
              checked={skip}
              onCheckedChange={(c) => setSkip(c === true)}
              aria-labelledby="wa-preview-skip-label"
              className="mt-0.5"
            />
            <span id="wa-preview-skip-label">
              Jangan tampilkan pratinjau ini lagi (bisa diaktifkan kembali dari Pengaturan)
            </span>
          </label>
        </div>

        <div
          data-testid="wa-preview-footer"
          className="grid shrink-0 grid-cols-1 gap-ms-2 border-t bg-muted/20 px-ms-3 py-ms-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-ms-5"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <span className="truncate text-ms-2xs text-muted-foreground" aria-live="polite">
            {photoCount > 0 ? `${photoCount} foto + teks` : "Teks saja"}
          </span>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-ms-2 sm:flex">
            <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => finish(false)}>
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
                className="min-h-11 min-w-0 bg-warning text-warning-foreground hover:bg-warning disabled:opacity-50 sm:min-h-9"
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
                className="min-h-11 min-w-0 bg-success text-white hover:bg-success sm:min-h-9"
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