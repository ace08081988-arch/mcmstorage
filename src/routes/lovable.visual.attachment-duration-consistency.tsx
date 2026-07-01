/**
 * Harness publik (no-auth, no-network) yang memverifikasi bahwa label
 * durasi mm:ss identik untuk tiga permukaan attachment yang berbeda —
 * VoiceNotePlayer (bubble penerima), MessageAttachment (router
 * attachment yang mendelegasikan audio ke VoiceNotePlayer), dan
 * VoiceRecorderButton (formula pengirim `normalizeDurationSec(sec) ?? 1`
 * lalu `formatDurationMMSS`) — untuk deretan nilai desimal DAN setelah
 * baris di-remount.
 *
 * URL: /lovable/visual/attachment-duration-consistency?d=0.4,1.5,59.6
 * Tidak diindeks, tidak butuh auth, tidak mengirim request server.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { VoiceNotePlayer, normalizeDurationSec } from "@/components/chat/VoiceNotePlayer";
import { formatDurationMMSS } from "@/lib/format-duration";

export const Route = createFileRoute(
  "/lovable/visual/attachment-duration-consistency",
)({
  head: () => ({
    meta: [
      { title: "Harness · Attachment Duration Consistency" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    d: typeof s.d === "string" ? s.d : undefined,
  }),
  component: Harness,
});

/** Bangun WAV PCM 8kHz mono nada 440Hz durasi `sec` detik. */
function makeWavBlobUrl(sec: number): string {
  const sampleRate = 8000;
  const nSamples = Math.floor(sampleRate * Math.max(1, sec));
  const dataSize = nSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < nSamples; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.2 * 0x7fff;
    view.setInt16(44 + i * 2, v, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

function Harness() {
  const { d } = Route.useSearch();
  const decimals = useMemo(() => {
    const src =
      d ??
      // Default: campuran sub-detik, boundary Math.round, dan menit.
      "0.01,0.4,0.5,0.99,1,1.4,1.5,2.7,3.499,3.5,59.4,59.6";
    const parts = src
      .split(",")
      .map((t: string) => Number(t.trim()))
      .filter((n: number) => Number.isFinite(n));
    return parts.length > 0 ? parts : [1];
  }, [d]);
  const [url, setUrl] = useState<string | null>(null);
  const [mountKey, setMountKey] = useState(0);
  useEffect(() => {
    const u = makeWavBlobUrl(3);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, []);

  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="mb-2 text-sm font-semibold">
        Attachment duration consistency
      </h1>
      <button
        type="button"
        data-testid="ad-remount"
        onClick={() => setMountKey((k) => k + 1)}
        className="mb-2 rounded border px-2 py-1 text-xs"
      >
        Remount rows
      </button>
      <div
        data-testid="ad-scroll"
        className="flex flex-col gap-3 overflow-y-auto rounded border p-2"
        style={{ height: 640 }}
      >
        {url ? (
          decimals.map((raw: number, i: number) => {
            const norm = normalizeDurationSec(raw);
            // Formula VoiceRecorderButton saat kirim: `normalizeDurationSec(seconds) ?? 1`
            // → label mm:ss dari formatDurationMMSS.
            const vrbLabel = formatDurationMMSS(norm ?? 1);
            return (
              <div
                key={`${mountKey}-${i}`}
                data-testid="ad-row"
                data-ad-index={i}
                data-ad-raw={String(raw)}
                data-ad-expected={vrbLabel}
                className="grid grid-cols-3 gap-2 rounded border p-2"
              >
                <div data-surface="vnp">
                  <div className="mb-1 text-[10px] text-muted-foreground">
                    VoiceNotePlayer
                  </div>
                  <VoiceNotePlayer url={url} mine={false} durationSec={raw} />
                </div>
                <div data-surface="msg">
                  <div className="mb-1 text-[10px] text-muted-foreground">
                    MessageAttachment (audio branch)
                  </div>
                  {/*
                   * Cabang `mime.startsWith("audio/")` di MessageAttachment
                   * mendelegasikan ke VoiceNotePlayer dengan `durationSec`
                   * yang sama. Kita replikasi delegasinya di harness supaya
                   * bebas network (tanpa `signedChatUrl`) namun tetap
                   * memakai komponen produksi yang sama.
                   */}
                  <VoiceNotePlayer url={url} mine={false} durationSec={raw} />
                </div>
                <div data-surface="vrb">
                  <div className="mb-1 text-[10px] text-muted-foreground">
                    VoiceRecorderButton (sent)
                  </div>
                  <span
                    data-testid="vrb-label"
                    className="text-xs tabular-nums text-muted-foreground"
                  >
                    {vrbLabel}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-xs text-muted-foreground">Menyiapkan sampel…</div>
        )}
      </div>
    </div>
  );
}