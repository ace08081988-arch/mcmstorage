import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, Loader2, MapPin, Send, XCircle, AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import { SendLogViewer } from "@/components/SendLogViewer";
import type { SendLogEntry } from "@/lib/send-log";
import { useLiveSendLogStatus } from "@/lib/send-log";
import { useLiveIdemByIds, channelFromKey } from "@/lib/idempotency";
import { InflightStepProgress } from "@/components/InflightStepProgress";
import type { SendPayloadSummary } from "@/lib/idempotency";
import { SendPayloadDiff } from "@/components/SendPayloadDiff";
import { FingerprintInfoTooltip } from "@/components/FingerprintInfoTooltip";

export type ChatSharePreviewData = {
  conversationTitle: string;
  caption: string;
  photoCount: number;
  /** Hingga 4 thumbnail untuk pratinjau visual. */
  thumbs: string[];
  /** Total foto yang sebenarnya akan dikirim (>= thumbs.length). */
  totalPhotos: number;
  /** Foto yang tidak bisa diunduh dari storage (gagal ditambahkan). */
  missingPhotos: number;
  mapsUrl: string | null;
};

/** Info duplikat saat idempotency key terdeteksi (klik ganda dalam ~5 menit). */
export type ChatShareDuplicateInfo = {
  at: number;
  status: "in-flight" | "done" | "failed";
  /** Label tujuan kiriman sebelumnya untuk ditampilkan di banner duplikat. */
  destination?: string;
  /** Fingerprint payload kiriman sebelumnya. Dipakai untuk membandingkan
   *  dengan payload saat ini agar tombol "Kirim ulang (paksa)" hanya aktif
   *  saat konten benar-benar sama. */
  fingerprint?: string;
  /** Ringkasan payload kiriman sebelumnya — dipakai untuk menampilkan
   *  detail PERBEDAAN field saat fingerprint tidak cocok. */
  summary?: SendPayloadSummary;
};

/** Status hidup pengiriman ke chat — dipakai untuk menampilkan progres di dialog. */
export type ChatShareLiveStatus = {
  /** Apakah caption teks dikirim. */
  captionStep: boolean;
  captionStatus: "pending" | "running" | "ok" | "fail";
  /** Total foto yang akan dikirim (= totalPhotos di data). */
  photosTotal: number;
  photosSent: number;
  photosFailed: number;
  photoCurrent: number | null;
  locationStep: boolean;
  locationStatus: "pending" | "running" | "ok" | "fail";
  /** Status akhir, null saat masih berjalan / belum dimulai. */
  outcome: null | { kind: "success" | "partial" | "failed" | "cancelled"; messageCount: number; error?: string };
};

function StepRow({ label, status, hint }: { label: string; status: "pending" | "running" | "ok" | "fail"; hint?: string }) {
  const icon =
    status === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
    : status === "fail" ? <XCircle className="h-3.5 w-3.5 text-destructive" />
    : status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    : <span className="inline-block h-3.5 w-3.5 rounded-full border border-muted-foreground/40" />;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/**
 * Dialog konfirmasi sebelum mengirim paket eceran ke chat aplikasi.
 * Menampilkan caption persis seperti yang akan dikirim, jumlah foto, dan link Maps.
 * Setelah klik "Kirim sekarang", panel progres tampil dan diakhiri dengan status
 * berhasil / sebagian gagal / gagal sehingga operator tahu hasilnya tanpa menebak.
 */
export function ChatSharePreviewDialog({
  open,
  onOpenChange,
  data,
  sending,
  onConfirm,
  status,
  onRetry,
  duplicate,
  onForceSend,
  previousLog,
  currentFingerprint,
  currentSummary,
  idemIdsKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ChatSharePreviewData | null;
  sending: boolean;
  onConfirm: () => void;
  status?: ChatShareLiveStatus | null;
  onRetry?: () => void;
  duplicate?: ChatShareDuplicateInfo | null;
  onForceSend?: () => void;
  previousLog?: SendLogEntry[];
  /** Fingerprint payload yang akan dikirim sekarang. */
  currentFingerprint?: string;
  /** Ringkasan payload yang akan dikirim sekarang — untuk diff payload. */
  currentSummary?: SendPayloadSummary;
  /** Daftar shot ID (ter-sort, koma) yang dipakai untuk melacak idempotency
   *  lintas channel — bila WA/Chat untuk shot yang sama sedang in-flight,
   *  banner dan tombol dialog ini ikut tersinkron secara real-time. */
  idemIdsKey?: string;
}) {
  const progressActive = !!status && (sending || !!status.outcome);
  const totalSteps = (status?.captionStep ? 1 : 0) + (status?.photosTotal ?? 0) + (status?.locationStep ? 1 : 0);
  const doneSteps = (status?.captionStatus === "ok" ? 1 : 0)
    + (status?.photosSent ?? 0) + (status?.photosFailed ?? 0)
    + (status?.locationStatus === "ok" || status?.locationStatus === "fail" ? 1 : 0);
  const pct = totalSteps > 0 ? Math.min(100, Math.round((doneSteps / totalSteps) * 100)) : 0;
  const outcome = status?.outcome ?? null;
  // Live: pantau record idempotency untuk shot yang sama lintas channel.
  const live = useLiveIdemByIds(idemIdsKey);
  const liveChannel = live ? channelFromKey(live.key) : "unknown";
  // Pantau log langkah kiriman in-flight (channel manapun) untuk key idempotency
  // yang sama. Saat WA sedang berjalan, operator melihat progres-nya di sini.
  const liveInflightKey = live && live.status === "in-flight" ? live.key : null;
  const liveLog = useLiveSendLogStatus(liveInflightKey);
  // Gabungkan dengan snapshot `duplicate` dari caller. Live lebih diutamakan
  // saat statusnya in-flight (channel manapun) atau saat status snapshot
  // sudah usang (mis. snapshot "in-flight" lalu live menjadi "done").
  const effectiveDup = (live
    ? {
        at: live.at,
        status: live.status,
        destination: duplicate?.destination,
        fingerprint: live.fingerprint,
        summary: live.summary ?? duplicate?.summary,
      }
    : duplicate) ?? null;
  const crossChannel = !!live && liveChannel === "wa";
  const dupActive = !!effectiveDup && effectiveDup.status !== "failed" && !progressActive && !outcome;
  const dupAgoSec = effectiveDup ? Math.max(0, Math.round((Date.now() - effectiveDup.at) / 1000)) : 0;
  const dupAgoLabel = dupAgoSec < 60 ? `${dupAgoSec} detik lalu` : `${Math.round(dupAgoSec / 60)} menit lalu`;
  const dupAbsLabel = effectiveDup ? new Date(effectiveDup.at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  const dupStatusLabel = effectiveDup ? (effectiveDup.status === "in-flight" ? "Masih berjalan" : effectiveDup.status === "done" ? "Sudah terkirim" : "Gagal") : "";
  // Hanya izinkan "Kirim ulang (paksa)" jika fingerprint payload saat ini
  // sama dengan fingerprint kiriman sebelumnya yang dicatat oleh idempotency.
  // Mencegah operator mengirim konten berbeda (caption/foto/lokasi berubah)
  // di bawah idempotency key yang sama secara tidak sengaja.
  const dupFp = effectiveDup?.fingerprint;
  const payloadMatches = !!dupFp && !!currentFingerprint && dupFp === currentFingerprint;
  const forceDisabledReason = !payloadMatches
    ? (!dupFp
        ? "Tidak ada sidik jari payload kiriman sebelumnya — tunggu jeda idempotency selesai (≈5 menit) sebelum mengirim ulang."
        : "Payload (caption / foto / lokasi) berbeda dari kiriman sebelumnya. Tombol paksa dinonaktifkan agar konten berbeda tidak terkirim dengan key idempotency yang sama.")
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!sending) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pratinjau kiriman chat</DialogTitle>
          <DialogDescription>
            {data ? <>Akan dikirim ke <span className="font-medium text-foreground">{data.conversationTitle}</span>. Periksa format sebelum mengirim.</> : "Menyiapkan…"}
          </DialogDescription>
        </DialogHeader>

        {data && (
          <div className="space-y-3 text-sm">
            {effectiveDup && !progressActive && !outcome ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2.5 text-[12px] text-amber-900 dark:text-amber-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {effectiveDup.status === "in-flight"
                      ? (crossChannel
                          ? "Kiriman WhatsApp untuk paket ini sedang berjalan."
                          : "Klik ganda terdeteksi — kiriman sebelumnya masih berjalan.")
                      : "Klik ganda terdeteksi — paket ini baru saja terkirim."}
                  </div>
                  <div className="mt-0.5 opacity-90">
                    {effectiveDup.status === "in-flight"
                      ? `Dimulai ${dupAgoLabel}. Tombol "Kirim sekarang" dinonaktifkan hingga ${crossChannel ? "kiriman WA" : "kiriman sebelumnya"} selesai agar tidak terkirim dua kali.`
                      : `Dikirim ${dupAgoLabel}. Tombol "Kirim sekarang" dinonaktifkan untuk mencegah pesan dobel. Gunakan "Kirim ulang (paksa)" hanya jika Anda yakin perlu mengirim ulang.`}
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-[11.5px]">
                    <dt className="font-medium opacity-80">Waktu</dt>
                    <dd className="break-words"><span className="font-mono">{dupAbsLabel}</span> <span className="opacity-70">({dupAgoLabel})</span></dd>
                    <dt className="font-medium opacity-80">Tujuan</dt>
                    <dd className="break-words">{effectiveDup.destination ?? data.conversationTitle}{crossChannel ? " · via WhatsApp" : ""}</dd>
                    <dt className="font-medium opacity-80">Status</dt>
                    <dd className="break-words">{dupStatusLabel}</dd>
                  </dl>
                {effectiveDup.status !== "in-flight" ? (
                  <div
                    className={
                      "mt-2 rounded-md border px-2 py-1.5 text-[11px] " +
                      (payloadMatches
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                        : "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200")
                    }
                  >
                    <span className="inline-flex items-start gap-1">
                      <span className="flex-1">
                        {payloadMatches
                          ? "Payload identik dengan kiriman sebelumnya — aman untuk dikirim ulang bila perlu."
                          : forceDisabledReason}
                      </span>
                      <FingerprintInfoTooltip
                        matches={payloadMatches}
                        previousFp={dupFp}
                        currentFp={currentFingerprint}
                        previous={effectiveDup.summary}
                        current={currentSummary}
                      />
                    </span>
                  </div>
                ) : null}
                {effectiveDup.status !== "in-flight" && !payloadMatches ? (
                  <SendPayloadDiff previous={effectiveDup.summary} current={currentSummary} />
                ) : null}
                {effectiveDup.status === "in-flight" ? (
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
            {previousLog && previousLog.length > 0 ? (
              <SendLogViewer entries={previousLog} defaultOpen={!!duplicate && duplicate.status !== "in-flight"} />
            ) : null}
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Caption</h3>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 font-sans text-[12.5px] leading-snug">{data.caption || "(kosong)"}</pre>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Foto · {data.totalPhotos}
                {data.missingPhotos > 0 && (
                  <span className="ml-1 font-normal normal-case text-amber-600">({data.missingPhotos} gagal diunduh)</span>
                )}
              </h3>
              {data.totalPhotos === 0 ? (
                <p className="text-xs text-muted-foreground">Tidak ada foto yang dapat dilampirkan.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {data.thumbs.slice(0, 4).map((u, i) => (
                    <div key={i} className="h-14 w-14 overflow-hidden rounded border bg-muted">
                      <img src={u} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ))}
                  {data.totalPhotos > 4 && (
                    <div className="flex h-14 w-14 items-center justify-center rounded border bg-muted text-xs font-semibold text-muted-foreground">
                      +{data.totalPhotos - 4}
                    </div>
                  )}
                </div>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">Tiap foto dikirim sebagai pesan terpisah.</p>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Link Maps</h3>
              {data.mapsUrl ? (
                <a
                  href={data.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 truncate rounded-md border bg-muted/40 px-2 py-1 text-[12px] text-primary hover:underline"
                >
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{data.mapsUrl}</span>
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">Tidak ada lokasi yang dilampirkan.</p>
              )}
            </section>
          </div>
        )}

        {progressActive && status ? (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {outcome ? "Hasil pengiriman" : "Mengirim…"}
              </h3>
              <span className="text-[11px] text-muted-foreground">{doneSteps}/{totalSteps} langkah</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={
                  outcome?.kind === "failed" ? "h-full bg-destructive transition-all"
                  : outcome?.kind === "partial" ? "h-full bg-amber-500 transition-all"
                  : outcome?.kind === "success" ? "h-full bg-emerald-600 transition-all"
                  : "h-full bg-primary transition-all"
                }
                style={{ width: `${outcome ? 100 : pct}%` }}
              />
            </div>
            <div className="space-y-1">
              {status.captionStep && (
                <StepRow label="Caption teks" status={status.captionStatus} />
              )}
              {status.photosTotal > 0 && (
                <StepRow
                  label="Foto"
                  status={
                    status.photosSent + status.photosFailed >= status.photosTotal
                      ? (status.photosFailed === 0 ? "ok" : status.photosSent === 0 ? "fail" : "ok")
                      : status.photoCurrent !== null ? "running" : "pending"
                  }
                  hint={`${status.photosSent}/${status.photosTotal}${status.photosFailed > 0 ? ` · ${status.photosFailed} gagal` : ""}`}
                />
              )}
              {status.locationStep && (
                <StepRow label="Link Maps" status={status.locationStatus} />
              )}
            </div>
            {outcome ? (
              <div
                className={
                  "flex items-start gap-2 rounded-md border p-2 text-[12px] " +
                  (outcome.kind === "success" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                  : outcome.kind === "partial" ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                  : outcome.kind === "cancelled" ? "border-muted-foreground/30 bg-muted text-muted-foreground"
                  : "border-destructive/40 bg-destructive/10 text-destructive")
                }
              >
                {outcome.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                : outcome.kind === "partial" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                : outcome.kind === "cancelled" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {outcome.kind === "success" ? `Berhasil dikirim (${outcome.messageCount} pesan).`
                    : outcome.kind === "partial" ? `Sebagian terkirim (${outcome.messageCount} pesan, ${status.photosFailed} foto gagal).`
                    : outcome.kind === "cancelled" ? "Pengiriman dibatalkan."
                    : "Gagal mengirim."}
                  </div>
                  {outcome.error ? <div className="mt-0.5 break-words opacity-80">{outcome.error}</div> : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          {outcome ? (
            <>
              {(outcome.kind === "failed" || outcome.kind === "partial") && onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={sending}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" /> Coba lagi
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                Tutup
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={sending}
                className="inline-flex h-9 items-center justify-center rounded-md border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Batal
              </button>
              {dupActive ? (
                <button
                  type="button"
                  onClick={onForceSend}
                  disabled={sending || !data || !onForceSend || effectiveDup?.status === "in-flight" || !payloadMatches}
                  title={
                    effectiveDup?.status === "in-flight"
                      ? (crossChannel ? "Kiriman WhatsApp untuk paket ini masih berjalan" : "Kiriman sebelumnya masih berjalan")
                      : !payloadMatches
                        ? (forceDisabledReason ?? "Payload berbeda dari kiriman sebelumnya")
                        : "Kirim ulang meski klik ganda terdeteksi"
                  }
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-amber-500 bg-amber-500 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50"
                >
                  <ShieldAlert className="h-4 w-4" />
                  Kirim ulang (paksa)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={sending || !data || live?.status === "in-flight"}
                  title={live?.status === "in-flight" ? (crossChannel ? "Kiriman WhatsApp untuk paket ini masih berjalan — tunggu selesai" : "Kiriman sebelumnya masih berjalan") : undefined}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? "Mengirim…" : live?.status === "in-flight" ? "Menunggu kiriman lain…" : "Kirim sekarang"}
                </button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}