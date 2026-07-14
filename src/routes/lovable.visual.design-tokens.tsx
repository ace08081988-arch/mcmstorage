/**
 * Halaman QA internal untuk memverifikasi design tokens (`--ms-*`) dan
 * primitif shadcn (Button, Input, Card, Badge) pada berbagai lebar layar
 * dalam SATU halaman — tanpa perlu membuka route lain.
 *
 * Fitur:
 * - Preset lebar container: 360 / 390 / 411 / 480 / 768 / 1024 / 100%.
 * - Input lebar custom (px) + tombol handle drag (native `resize: horizontal`).
 * - Slider skala font root (12–22px) yang mengganti `font-size` <html>
 *   sementara halaman ini dibuka (dipulihkan saat unmount). Semua token
 *   `--ms-*` berbasis rem sehingga skala terasa realistis.
 * - Katalog: typography scale, spacing scale, Button variants × sizes,
 *   Input, Card, Badge.
 *
 * URL: /lovable/visual/design-tokens
 * Tidak diindeks (noindex), tidak butuh auth, tidak ada network call.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ruler, Type, Boxes, Palette } from "lucide-react";

export const Route = createFileRoute("/lovable/visual/design-tokens")({
  head: () => ({
    meta: [
      { title: "Design Tokens Preview — MCM Storage" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "description", content: "Internal QA untuk token --ms-* dan primitif shadcn pada berbagai lebar." },
    ],
  }),
  component: DesignTokensPreview,
});

const WIDTH_PRESETS: Array<{ label: string; value: number | "full" }> = [
  { label: "360", value: 360 },
  { label: "390", value: 390 },
  { label: "411", value: 411 },
  { label: "480", value: 480 },
  { label: "768", value: 768 },
  { label: "1024", value: 1024 },
  { label: "100%", value: "full" },
];

const TYPOGRAPHY_SAMPLES: Array<{ token: string; note: string }> = [
  { token: "text-ms-2xs", note: "0.6875rem / 11px" },
  { token: "text-ms-xs", note: "0.75rem / 12px" },
  { token: "text-ms-sm", note: "0.8125rem / 13px" },
  { token: "text-ms-base", note: "0.9375rem / 15px — body" },
  { token: "text-ms-md", note: "1rem / 16px — anti-zoom iOS" },
  { token: "text-ms-lg", note: "1.125rem / 18px" },
  { token: "text-ms-xl", note: "1.25rem / 20px" },
  { token: "text-ms-2xl", note: "1.5rem / 24px — heading kartu" },
  { token: "text-ms-3xl", note: "1.75rem / 28px — heading halaman" },
  { token: "text-ms-4xl", note: "2.125rem / 34px — hero" },
];

const SPACING_STEPS: Array<{ n: number; rem: string }> = [
  { n: 1, rem: "0.25rem / 4px" },
  { n: 2, rem: "0.5rem / 8px" },
  { n: 3, rem: "0.75rem / 12px" },
  { n: 4, rem: "1rem / 16px" },
  { n: 5, rem: "1.25rem / 20px" },
  { n: 6, rem: "1.5rem / 24px" },
];

function DesignTokensPreview() {
  const [widthPreset, setWidthPreset] = useState<number | "full">(411);
  const [customWidth, setCustomWidth] = useState<string>("411");
  const [fontPx, setFontPx] = useState<number>(16);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  // Terapkan font-size ke <html> sementara halaman ini dibuka; pulihkan
  // saat unmount agar aplikasi lain tidak terpengaruh.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.fontSize;
    root.style.fontSize = `${fontPx}px`;
    return () => {
      root.style.fontSize = prev;
    };
  }, [fontPx]);

  // Ukur lebar aktual stage (berguna saat memakai resize handle native).
  useEffect(() => {
    if (!stageRef.current) return;
    const el = stageRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMeasuredWidth(Math.round(entry.contentRect.width));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stageWidthStyle = useMemo<React.CSSProperties>(() => {
    if (widthPreset === "full") return { width: "100%" };
    return { width: `${widthPreset}px` };
  }, [widthPreset]);

  function applyCustomWidth() {
    const n = Number.parseInt(customWidth, 10);
    if (Number.isFinite(n) && n >= 240 && n <= 1920) setWidthPreset(n);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Toolbar — di luar stage, tidak ikut diskalakan lebar */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-ms-3 p-ms-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-ms-lg font-semibold tracking-tight">Design Tokens Preview</h1>
            <p className="truncate text-ms-xs text-muted-foreground">
              Verifikasi <code>--ms-*</code> di berbagai lebar & skala font.
            </p>
          </div>
          <div className="flex items-center gap-ms-2 text-ms-xs text-muted-foreground">
            <Ruler className="size-4 shrink-0" aria-hidden />
            <span className="tabular-nums">
              stage:&nbsp;
              <strong className="text-foreground">
                {measuredWidth ?? "—"}
              </strong>
              px · root:&nbsp;
              <strong className="text-foreground">{fontPx}px</strong>
            </span>
          </div>
        </div>

        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-ms-2 px-ms-4 pb-ms-3">
          {WIDTH_PRESETS.map((p) => {
            const active = widthPreset === p.value;
            return (
              <Button
                key={p.label}
                size="sm"
                variant={active ? "default" : "outline"}
                onClick={() => {
                  setWidthPreset(p.value);
                  if (typeof p.value === "number") setCustomWidth(String(p.value));
                }}
                aria-pressed={active}
              >
                {p.label}
              </Button>
            );
          })}
          <div className="flex items-center gap-ms-2">
            <label htmlFor="custom-width" className="text-ms-xs text-muted-foreground">
              custom
            </label>
            <Input
              id="custom-width"
              type="number"
              inputMode="numeric"
              min={240}
              max={1920}
              className="h-9 w-24"
              value={customWidth}
              onChange={(e) => setCustomWidth(e.target.value)}
              onBlur={applyCustomWidth}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyCustomWidth();
              }}
            />
            <span className="text-ms-xs text-muted-foreground">px</span>
          </div>
          <div className="flex items-center gap-ms-2">
            <label htmlFor="font-scale" className="text-ms-xs text-muted-foreground">
              root font
            </label>
            <input
              id="font-scale"
              type="range"
              min={12}
              max={22}
              step={1}
              value={fontPx}
              onChange={(e) => setFontPx(Number(e.target.value))}
              className="w-32 accent-primary"
            />
            <span className="w-8 text-right text-ms-xs tabular-nums text-muted-foreground">
              {fontPx}
            </span>
          </div>
        </div>
      </header>

      {/* Stage */}
      <div className="mx-auto flex justify-center px-ms-4 py-ms-6">
        <div
          ref={stageRef}
          className="max-w-full min-w-[240px] resize-x overflow-auto rounded-ms-card border-2 border-dashed border-border bg-card shadow"
          style={stageWidthStyle}
        >
          <div className="space-ms-6 p-ms-4">
            <TypographySection />
            <SpacingSection />
            <ButtonSection />
            <InputSection />
            <CardSection />
            <BadgeSection />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-ms-2 border-b border-border/60 pb-ms-2">
      <Icon className="size-4 shrink-0 text-primary" aria-hidden />
      <h2 className="min-w-0 truncate text-ms-base font-semibold">{title}</h2>
      <span className="ml-auto shrink-0 text-ms-2xs uppercase tracking-wide text-muted-foreground">
        {hint}
      </span>
    </div>
  );
}

function TypographySection() {
  return (
    <section className="space-ms-3">
      <SectionHeader icon={Type} title="Typography — text-ms-*" hint="rem-based" />
      <ul className="space-ms-2">
        {TYPOGRAPHY_SAMPLES.map((s) => (
          <li
            key={s.token}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-ms-3"
          >
            <span className={`min-w-0 truncate ${s.token}`}>
              Toko Kifa · MCM Storage 1234567890
            </span>
            <span className="shrink-0 text-ms-2xs tabular-nums text-muted-foreground">
              {s.token} · {s.note}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SpacingSection() {
  return (
    <section className="space-ms-3">
      <SectionHeader icon={Boxes} title="Spacing — --ms-space-*" hint="rem-based" />
      <div className="space-ms-2">
        {SPACING_STEPS.map((s) => (
          <div key={s.n} className="grid grid-cols-[6ch_minmax(0,1fr)_auto] items-center gap-ms-3">
            <span className="text-ms-xs tabular-nums text-muted-foreground">
              ms-{s.n}
            </span>
            <div className="h-3 rounded-sm bg-primary/20">
              <div
                className="h-full rounded-sm bg-primary"
                style={{ width: `var(--ms-space-${s.n})` }}
              />
            </div>
            <span className="shrink-0 text-ms-2xs tabular-nums text-muted-foreground">
              {s.rem}
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-ms-3 pt-ms-2">
        {[2, 3, 4, 6].map((n) => (
          <div key={n} className="rounded-md border border-border/60">
            <div className={`p-ms-${n} bg-muted/40`}>
              <div className="rounded-sm bg-primary/70 py-1 text-center text-ms-2xs font-medium text-primary-foreground">
                p-ms-{n}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ButtonSection() {
  const variants = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;
  const sizes = ["sm", "default", "lg", "icon"] as const;
  return (
    <section className="space-ms-3">
      <SectionHeader icon={Palette} title="Button — variant × size" hint="min-tap 44px" />
      {variants.map((v) => (
        <div key={v} className="space-ms-2">
          <p className="text-ms-2xs uppercase tracking-wide text-muted-foreground">{v}</p>
          <div className="flex flex-wrap items-center gap-ms-2">
            {sizes.map((s) => (
              <Button key={s} variant={v} size={s}>
                {s === "icon" ? "★" : `${v}·${s}`}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function InputSection() {
  return (
    <section className="space-ms-3">
      <SectionHeader icon={Type} title="Input" hint="text-ms-md ≥ 16px" />
      <div className="space-ms-2">
        <Input placeholder="Cari produk…" />
        <Input type="email" placeholder="email@toko.id" defaultValue="ace@mcm.id" />
        <Input disabled placeholder="disabled" />
      </div>
    </section>
  );
}

function CardSection() {
  return (
    <section className="space-ms-3">
      <SectionHeader icon={Boxes} title="Card" hint="p-ms-6" />
      <Card>
        <CardHeader>
          <CardTitle>Ringkasan Pesanan</CardTitle>
          <CardDescription>
            Preview kartu default — padding memakai <code>p-ms-6</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-ms-sm text-muted-foreground">
            Body kartu menggunakan <code>text-ms-sm</code> supaya konsisten dengan seluruh halaman
            saat pengguna mengganti skala font aplikasi.
          </p>
        </CardContent>
        <CardFooter className="gap-ms-2">
          <Button size="sm" variant="outline">
            Batal
          </Button>
          <Button size="sm">Konfirmasi</Button>
        </CardFooter>
      </Card>
    </section>
  );
}

function BadgeSection() {
  const variants = ["default", "secondary", "outline", "destructive"] as const;
  return (
    <section className="space-ms-3">
      <SectionHeader icon={Palette} title="Badge" hint="text-ms-xs" />
      <div className="flex flex-wrap items-center gap-ms-2">
        {variants.map((v) => (
          <Badge key={v} variant={v}>
            {v}
          </Badge>
        ))}
        <Badge>12</Badge>
        <Badge variant="secondary">Baru</Badge>
        <Badge variant="destructive">Belum bayar</Badge>
      </div>
    </section>
  );
}