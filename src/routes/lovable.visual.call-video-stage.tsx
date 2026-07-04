/**
 * Harness publik (no-auth) untuk uji e2e sinkronisasi objectFit /
 * objectPosition antara video "remote" dan preview lokal, termasuk saat
 * swap kamera front↔back tanpa reload.
 *
 * Harness ini tidak menyentuh WebRTC/Supabase — hanya mereka-ulang
 * kontrak style di `CallScreen`: dua elemen `<video>` selalu menerima
 * style YANG SAMA dari `computeVideoStyle`, dan tiap kamera menyimpan
 * fit/pos/custom-nya sendiri.
 *
 * URL: /lovable/visual/call-video-stage
 * Robots: noindex,nofollow.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  computeVideoStyle, videoFitClassFor,
  type VideoFit, type VideoPosPreset, type VideoPosXY,
} from "@/lib/call-video-style";

export const Route = createFileRoute("/lovable/visual/call-video-stage")({
  head: () => ({
    meta: [
      { title: "Harness · Call Video Stage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Harness,
});

type Facing = "user" | "environment";

function Harness() {
  const [facing, setFacing] = useState<Facing>("user");
  const [fitFront, setFitFront] = useState<VideoFit>("cover");
  const [fitBack, setFitBack] = useState<VideoFit>("cover");
  const [posFront, setPosFront] = useState<VideoPosPreset>("center");
  const [posBack, setPosBack] = useState<VideoPosPreset>("center");
  const [customFront, setCustomFront] = useState<VideoPosXY | null>(null);
  const [customBack, setCustomBack] = useState<VideoPosXY | null>(null);
  const [swapped, setSwapped] = useState(false);

  const fit = facing === "user" ? fitFront : fitBack;
  const pos = facing === "user" ? posFront : posBack;
  const custom = facing === "user" ? customFront : customBack;
  const style = useMemo(() => computeVideoStyle(fit, pos, custom), [fit, pos, custom]);
  const cls = videoFitClassFor(fit);

  function toggleFit() {
    if (facing === "user") setFitFront((f) => (f === "cover" ? "contain" : "cover"));
    else setFitBack((f) => (f === "cover" ? "contain" : "cover"));
  }
  function cyclePos() {
    const next = (p: VideoPosPreset): VideoPosPreset =>
      p === "center" ? "top"
      : p === "top" ? "right"
      : p === "right" ? "bottom"
      : p === "bottom" ? "left"
      : "center";
    if (facing === "user") { setPosFront(next); setCustomFront(null); }
    else { setPosBack(next); setCustomBack(null); }
  }
  function drag20x80() {
    if (facing === "user") setCustomFront({ x: 20, y: 80 });
    else setCustomBack({ x: 20, y: 80 });
  }

  // Susunan mirror CallScreen: elemen "besar" dan "kecil" ditukar via
  // `swapped`, tapi keduanya SELALU pakai `style` yang sama.
  const bigTestId = swapped ? "local" : "remote";
  const smallTestId = swapped ? "remote" : "local";

  return (
    <div className="min-h-screen bg-black p-4 text-white">
      <div className="relative h-64 w-full bg-neutral-900">
        <video
          data-testid={bigTestId}
          data-role={swapped ? "local-big" : "remote-big"}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full ${cls} bg-black`}
          style={style}
        />
        <video
          data-testid={smallTestId}
          data-role={swapped ? "remote-small" : "local-small"}
          autoPlay
          playsInline
          muted
          className={`absolute bottom-2 right-2 h-16 w-24 rounded border ${cls} bg-black`}
          style={style}
        />
      </div>
      <div
        data-testid="stage-state"
        data-facing={facing}
        data-fit={fit}
        data-pos={pos}
        data-custom={custom ? `${custom.x},${custom.y}` : ""}
        data-swapped={String(swapped)}
        className="mt-2 text-xs"
      >
        facing={facing} fit={fit} pos={pos} custom={custom ? `${custom.x},${custom.y}` : "-"} swapped={String(swapped)}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button data-testid="btn-toggle-fit" onClick={toggleFit}
          className="rounded bg-white/10 px-3 py-1 text-sm">Toggle Crop/Fit</button>
        <button data-testid="btn-cycle-pos" onClick={cyclePos}
          className="rounded bg-white/10 px-3 py-1 text-sm">Cycle posisi</button>
        <button data-testid="btn-drag" onClick={drag20x80}
          className="rounded bg-white/10 px-3 py-1 text-sm">Drag custom (20,80)</button>
        <button data-testid="btn-swap" onClick={() => setSwapped((s) => !s)}
          className="rounded bg-white/10 px-3 py-1 text-sm">Swap besar/kecil</button>
        <button data-testid="btn-flip" onClick={() =>
          setFacing((f) => (f === "user" ? "environment" : "user"))}
          className="rounded bg-white/10 px-3 py-1 text-sm">Flip kamera</button>
      </div>
    </div>
  );
}