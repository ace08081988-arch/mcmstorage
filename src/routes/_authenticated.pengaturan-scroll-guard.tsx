import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { RotateCcw, CheckCircle2 } from "lucide-react";
import {
  DEFAULT_SCROLL_GUARD,
  SCROLL_GUARD_BOUNDS,
  useScrollGuardConfig,
} from "@/lib/scroll-guard-config";

export const Route = createFileRoute("/_authenticated/pengaturan-scroll-guard")({
  head: () => ({
    meta: [{ title: "Pengaturan Scroll-Guard · MCM Storage" }],
  }),
  component: PengaturanScrollGuardPage,
});

function PengaturanScrollGuardPage() {
  const { cfg, set, reset } = useScrollGuardConfig();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const isDefault =
    cfg.cooldownMs === DEFAULT_SCROLL_GUARD.cooldownMs &&
    cfg.driftPx === DEFAULT_SCROLL_GUARD.driftPx &&
    cfg.longPressMs === DEFAULT_SCROLL_GUARD.longPressMs;

  const flashSaved = () => {
    setSavedAt(Date.now());
    window.setTimeout(() => setSavedAt(null), 1400);
  };

  return (
    <div className="mx-auto w-full max-w-2xl p-4 space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Pengaturan Scroll-Guard</h1>
        <p className="text-sm text-muted-foreground leading-snug">
          Sesuaikan seberapa ketat menu sidebar menolak tap saat sedang scroll. Nilai lebih tinggi = lebih aman dari salah-tap, lebih rendah = lebih responsif.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Parameter deteksi</CardTitle>
          <CardDescription className="text-xs">
            Perubahan tersimpan otomatis di perangkat ini. Reset kapan saja untuk kembali ke default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SliderRow
            label="Cooldown setelah scroll"
            help="Durasi window setelah scroll berhenti — selama ini semua tap ditolak."
            unit="ms"
            value={cfg.cooldownMs}
            defaultValue={DEFAULT_SCROLL_GUARD.cooldownMs}
            bounds={SCROLL_GUARD_BOUNDS.cooldownMs}
            onChange={(v) => {
              set({ cooldownMs: v });
              flashSaved();
            }}
          />
          <SliderRow
            label="Ambang pergerakan (drift)"
            help="Jika pointer bergeser lebih dari nilai ini selama tap, dianggap scroll, bukan klik."
            unit="px"
            value={cfg.driftPx}
            defaultValue={DEFAULT_SCROLL_GUARD.driftPx}
            bounds={SCROLL_GUARD_BOUNDS.driftPx}
            onChange={(v) => {
              set({ driftPx: v });
              flashSaved();
            }}
          />
          <SliderRow
            label="Batas tekan-lama"
            help="Tap yang lebih lama dari nilai ini dianggap long-press dan tidak memicu navigasi."
            unit="ms"
            value={cfg.longPressMs}
            defaultValue={DEFAULT_SCROLL_GUARD.longPressMs}
            bounds={SCROLL_GUARD_BOUNDS.longPressMs}
            onChange={(v) => {
              set({ longPressMs: v });
              flashSaved();
            }}
          />

          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isDefault}
              onClick={() => {
                reset();
                flashSaved();
              }}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset default
            </Button>
            <span
              aria-live="polite"
              className={`flex items-center gap-1 text-xs font-medium transition-opacity ${
                savedAt ? "opacity-100 text-emerald-600" : "opacity-0"
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Tersimpan
            </span>
          </div>
        </CardContent>
      </Card>

      <TestArea cooldownMs={cfg.cooldownMs} driftPx={cfg.driftPx} longPressMs={cfg.longPressMs} />
    </div>
  );
}

function SliderRow({
  label,
  help,
  unit,
  value,
  defaultValue,
  bounds,
  onChange,
}: {
  label: string;
  help: string;
  unit: string;
  value: number;
  defaultValue: number;
  bounds: { min: number; max: number; step: number };
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium leading-snug">{label}</label>
        <div className="text-sm tabular-nums">
          <span className="font-semibold">{value}</span>
          <span className="ml-0.5 text-muted-foreground">{unit}</span>
          {value !== defaultValue && (
            <span className="ml-2 text-[11px] text-muted-foreground">
              (default {defaultValue}
              {unit})
            </span>
          )}
        </div>
      </div>
      <Slider
        value={[value]}
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        onValueChange={(vs) => onChange(vs[0] ?? value)}
      />
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{help}</p>
    </div>
  );
}

/**
 * Kotak uji-coba live: replikasi logika NavLinkItem persis, tanpa navigasi
 * beneran — user bisa tap/geser di sini untuk merasakan efek slider.
 */
function TestArea({
  cooldownMs,
  driftPx,
  longPressMs,
}: {
  cooldownMs: number;
  driftPx: number;
  longPressMs: number;
}) {
  const [lastEvent, setLastEvent] = useState<string>("—");
  const [tapCount, setTapCount] = useState(0);
  const [rejectCount, setRejectCount] = useState(0);
  const scrollUntilRef = useRef(0);
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const bump = () => {
      scrollUntilRef.current = Date.now() + cooldownMs;
    };
    el.addEventListener("scroll", bump, { passive: true });
    return () => el.removeEventListener("scroll", bump);
  }, [cooldownMs]);

  const isScrollActive = () => Date.now() < scrollUntilRef.current;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Uji-coba di perangkat ini</CardTitle>
        <CardDescription className="text-xs">
          Tap kartu di bawah untuk memicu "navigasi"; scroll di dalamnya untuk melihat guard menolak tap.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          ref={boxRef}
          className="h-40 overflow-auto rounded-lg border bg-muted/30"
          style={{ touchAction: "pan-y" }}
        >
          <div className="p-2 space-y-2" style={{ minHeight: 480 }}>
            {["A", "B", "C", "D", "E", "F"].map((k) => (
              <div
                key={k}
                role="button"
                tabIndex={0}
                className="rounded-md border bg-background px-3 py-3 text-sm font-medium select-none"
                onPointerDown={(e) => {
                  if (isScrollActive()) {
                    startRef.current = null;
                    setLastEvent(`Ditolak (cooldown ${cooldownMs}ms aktif)`);
                    setRejectCount((n) => n + 1);
                    return;
                  }
                  startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
                }}
                onPointerMove={(e) => {
                  const s = startRef.current;
                  if (!s) return;
                  if (
                    Math.abs(e.clientX - s.x) > driftPx ||
                    Math.abs(e.clientY - s.y) > driftPx
                  ) {
                    startRef.current = null;
                  }
                }}
                onPointerCancel={() => {
                  startRef.current = null;
                }}
                onPointerUp={(e) => {
                  const s = startRef.current;
                  startRef.current = null;
                  if (!s) return;
                  if (isScrollActive()) {
                    setLastEvent("Ditolak (scroll masih aktif)");
                    setRejectCount((n) => n + 1);
                    return;
                  }
                  const dx = Math.abs(e.clientX - s.x);
                  const dy = Math.abs(e.clientY - s.y);
                  const dt = Date.now() - s.t;
                  if (dx > driftPx || dy > driftPx) {
                    setLastEvent(`Ditolak (drift ${Math.max(dx, dy).toFixed(0)}px > ${driftPx}px)`);
                    setRejectCount((n) => n + 1);
                    return;
                  }
                  if (dt > longPressMs) {
                    setLastEvent(`Ditolak (tekan ${dt}ms > ${longPressMs}ms)`);
                    setRejectCount((n) => n + 1);
                    return;
                  }
                  setLastEvent(`Tap OK · item ${k} (dt=${dt}ms, drift=${Math.max(dx, dy).toFixed(0)}px)`);
                  setTapCount((n) => n + 1);
                }}
              >
                Item {k}
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="text-muted-foreground">Tap diterima</div>
            <div className="text-base font-semibold tabular-nums text-emerald-600">{tapCount}</div>
          </div>
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="text-muted-foreground">Tap ditolak</div>
            <div className="text-base font-semibold tabular-nums text-amber-600">{rejectCount}</div>
          </div>
          <div className="rounded-md border bg-muted/30 p-2">
            <div className="text-muted-foreground">Status</div>
            <div className="text-[11px] font-medium leading-tight break-words">{lastEvent}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}