import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Mic } from "lucide-react";
import { formatDurationMMSS } from "@/lib/format-duration";

// Konsisten dengan attachment_duration_sec di DB / attachmentDurationSec di serverFn:
// bilangan bulat, minimal 1 detik, dibulatkan ke atas dari sumber apa pun.
export function normalizeDurationSec(input: number | null | undefined): number | null {
  if (input == null) return null;
  if (!isFinite(input) || input <= 0) return null;
  return Math.max(1, Math.round(input));
}

// Format durasi tersentralisasi di src/lib/format-duration.ts agar konsisten
// antara VoiceNotePlayer, VoiceRecorderButton, dan lampiran lain.

export function VoiceNotePlayer({
  url,
  mine,
  durationSec,
}: {
  url: string;
  mine: boolean;
  /** Durasi tersimpan dari server (attachment_duration_sec). Dipakai agar label tetap konsisten saat remount. */
  durationSec?: number | null;
}) {
  const initial = useMemo(() => normalizeDurationSec(durationSec) ?? 0, [durationSec]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number>(initial);
  const [ready, setReady] = useState<boolean>(initial > 0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onLoaded = () => {
      const d = a.duration;
      // Prioritaskan nilai server (initial) supaya label tidak berubah saat remount.
      // Hanya pakai metadata audio jika server tidak menyediakan durasi.
      if (initial > 0) {
        setDuration(initial);
      } else if (isFinite(d) && d > 0) {
        setDuration(d);
      }
      setReady(true);
    };
    const onTime = () => setCurrent(a.currentTime);
    const onEnd = () => {
      setPlaying(false);
      setCurrent(0);
      try { a.currentTime = 0; } catch { /* ignore */ }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    // Jika durasi server sudah ada, tandai siap segera sebelum metadata audio termuat.
    if (initial > 0) setReady(true);
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("durationchange", onLoaded);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("durationchange", onLoaded);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
    // initial ikut dependency agar update prop durationSec (mis. setelah refetch) terpakai.
  }, [initial]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      // Pause any other playing voice notes on the page.
      document.querySelectorAll<HTMLAudioElement>("audio[data-voice-note]").forEach((el) => {
        if (el !== a && !el.paused) el.pause();
      });
      void a.play().catch(() => setPlaying(false));
    } else {
      a.pause();
    }
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const v = Number(e.target.value);
    a.currentTime = (v / 1000) * duration;
    setCurrent(a.currentTime);
  };

  const progress = duration > 0 ? Math.min(1000, Math.round((current / duration) * 1000)) : 0;
  // Label durasi:
  // - Saat memutar / sedang berjalan → posisi saat ini.
  // - Diam & metadata audio siap → durasi audio.
  // - Diam & belum siap tapi ada nilai server ternormalisasi → tampilkan itu
  //   supaya tidak pernah muncul "00:00" saat loading.
  // - Tidak ada info sama sekali → tampilkan em dash, bukan "00:00".
  const showCurrent = playing || current > 0;
  const fallback = initial > 0 ? initial : (ready && duration > 0 ? duration : null);
  const label = showCurrent
    ? formatDurationMMSS(current)
    : fallback != null
      ? formatDurationMMSS(fallback)
      : "—:—";

  return (
    <div
      className={`flex items-center gap-2 rounded-full px-2 py-1.5 ${
        mine ? "bg-primary-foreground/10" : "bg-background/70 border border-border"
      }`}
      style={{ minWidth: 200, maxWidth: 260 }}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Jeda voice note" : "Putar voice note"}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition active:scale-95 ${
          mine ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary text-primary-foreground"
        }`}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="relative flex items-center">
          <input
            type="range"
            min={0}
            max={1000}
            value={progress}
            onChange={onSeek}
            aria-label="Posisi voice note"
            className="vn-range h-1 w-full cursor-pointer appearance-none bg-transparent"
            style={{
              background: `linear-gradient(to right, currentColor ${progress / 10}%, rgba(127,127,127,0.35) ${progress / 10}%)`,
              borderRadius: 9999,
            }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] leading-snug opacity-70">
          <span className="inline-flex items-center gap-1">
            <Mic className="h-3 w-3" />
            Voice note
          </span>
          <span>{label}</span>
        </div>
      </div>
      <audio ref={audioRef} src={url} preload="metadata" data-voice-note className="hidden" />
    </div>
  );
}