/**
 * Harness publik (no-auth, no-network) untuk memverifikasi UI pemutar
 * voice note yang tampil di bubble chat: play/pause, progress bar
 * (input range), dan label durasi tetap konsisten saat daftar
 * di-scroll seperti transkrip chat virtualized.
 *
 * URL: /lovable/visual/voice-note-player
 * Tidak diindeks, tidak butuh auth, tidak mengirim request server.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { VoiceNotePlayer } from "@/components/chat/VoiceNotePlayer";

export const Route = createFileRoute("/lovable/visual/voice-note-player")({
  head: () => ({
    meta: [
      { title: "Harness · VoiceNotePlayer" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    d: typeof s.d === "string" ? s.d : undefined,
  }),
  component: VoiceNotePlayerHarness,
});

/** Bangun WAV PCM 8kHz mono nada 440Hz durasi `sec` detik. */
function makeWavBlobUrl(sec: number): string {
  const sampleRate = 8000;
  const nSamples = Math.floor(sampleRate * sec);
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
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
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
  const blob = new Blob([buf], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

function VoiceNotePlayerHarness() {
  const { d } = Route.useSearch();
  // Mode "decimals": render satu baris per nilai desimal untuk memverifikasi
  // normalisasi `attachmentDurationSec` menjadi bilangan bulat ≥ 1 pada label.
  const decimals = useMemo(() => {
    if (!d) return null;
    const parts = d
      .split(",")
      .map((t) => Number(t.trim()))
      .filter((n) => Number.isFinite(n));
    return parts.length > 0 ? parts : null;
  }, [d]);
  const [url, setUrl] = useState<string | null>(null);
  const [mountKey, setMountKey] = useState(0);
  useEffect(() => {
    const u = makeWavBlobUrl(3);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, []);
  // 40 baris untuk mensimulasikan scroll transkrip panjang.
  const rows = useMemo(() => Array.from({ length: 40 }, (_, i) => i), []);
  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="mb-3 text-sm font-semibold">Voice note preview list</h1>
      <button
        type="button"
        data-testid="vn-remount"
        onClick={() => setMountKey((k) => k + 1)}
        className="mb-2 rounded border px-2 py-1 text-xs"
      >
        Remount rows
      </button>
      <div
        data-testid="vn-scroll"
        className="flex flex-col gap-2 overflow-y-auto rounded border p-2"
        style={{ height: 480 }}
      >
        {url ? decimals ? (
          decimals.map((raw, i) => (
            <div
              key={`${mountKey}-dec-${i}`}
              data-vn-index={i}
              data-vn-raw={String(raw)}
              className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
            >
              <VoiceNotePlayer url={url} mine={i % 2 === 1} durationSec={raw} />
            </div>
          ))
        ) : (
          rows.map((i) => (
            <div
              key={`${mountKey}-${i}`}
              data-vn-index={i}
              className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}
            >
              <VoiceNotePlayer url={url} mine={i % 2 === 1} durationSec={3} />
            </div>
          ))
        ) : (
          <div className="text-xs text-muted-foreground">Menyiapkan sampel…</div>
        )}
      </div>
    </div>
  );
}