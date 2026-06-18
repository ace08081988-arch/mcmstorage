import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Theme = "light" | "dark" | "system";
type FontFamily = "sans" | "serif" | "mono" | "display";
type FontSize = "sm" | "md" | "lg" | "xl";

const LS = {
  theme: "app-theme",
  font: "app-font",
  size: "app-font-size",
  accent: "app-accent",
  radius: "app-radius",
};

const ACCENTS: { id: string; label: string; value: string; swatch: string }[] = [
  { id: "emerald", label: "Hijau",  value: "oklch(0.62 0.17 155)", swatch: "#10b981" },
  { id: "blue",    label: "Biru",   value: "oklch(0.60 0.18 250)", swatch: "#3b82f6" },
  { id: "violet",  label: "Ungu",   value: "oklch(0.58 0.22 295)", swatch: "#8b5cf6" },
  { id: "rose",    label: "Merah",  value: "oklch(0.63 0.22 20)",  swatch: "#f43f5e" },
  { id: "amber",   label: "Kuning", value: "oklch(0.78 0.16 80)",  swatch: "#f59e0b" },
  { id: "slate",   label: "Netral", value: "oklch(0.30 0.04 260)", swatch: "#475569" },
];

function resolveTheme(t: Theme): "light" | "dark" {
  if (t === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return t;
}

export function applyAppearance() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = (localStorage.getItem(LS.theme) as Theme | null) ?? "dark";
  const font = (localStorage.getItem(LS.font) as FontFamily | null) ?? "sans";
  const size = (localStorage.getItem(LS.size) as FontSize | null) ?? "md";
  const accentId = localStorage.getItem(LS.accent) ?? "emerald";
  const radius = Number(localStorage.getItem(LS.radius) ?? "0.625");

  root.classList.toggle("dark", resolveTheme(theme) === "dark");
  root.dataset.font = font;
  root.dataset.fontSize = size;
  const accent = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0];
  root.style.setProperty("--primary", accent.value);
  root.style.setProperty("--ring", accent.value);
  root.style.setProperty("--radius", `${radius}rem`);
}

export function AppearanceInit() {
  useEffect(() => {
    applyAppearance();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (localStorage.getItem(LS.theme) === "system") applyAppearance();
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return null;
}

export function AppearanceSettings({ triggerClassName }: { triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [font, setFont] = useState<FontFamily>("sans");
  const [size, setSize] = useState<FontSize>("md");
  const [accent, setAccent] = useState<string>("emerald");
  const [radius, setRadius] = useState<number>(0.625);

  useEffect(() => {
    setTheme((localStorage.getItem(LS.theme) as Theme) ?? "dark");
    setFont((localStorage.getItem(LS.font) as FontFamily) ?? "sans");
    setSize((localStorage.getItem(LS.size) as FontSize) ?? "md");
    setAccent(localStorage.getItem(LS.accent) ?? "emerald");
    setRadius(Number(localStorage.getItem(LS.radius) ?? "0.625"));
  }, [open]);

  const save = (k: string, v: string) => {
    localStorage.setItem(k, v);
    applyAppearance();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className={
            triggerClassName ??
            "inline-flex h-8 items-center justify-center rounded-md border px-2 text-[11px] font-medium hover:bg-accent"
          }
          title="Pengaturan tampilan"
          aria-label="Pengaturan tampilan"
        >
          🎨 Tampilan
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pengaturan tampilan</DialogTitle>
          <DialogDescription>Atur tema, font, ukuran, warna aksen, dan kelengkungan sudut.</DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Tema</p>
          <div className="grid grid-cols-3 gap-2">
            {([
              { v: "light",  label: "☀️ Terang" },
              { v: "dark",   label: "🌙 Gelap" },
              { v: "system", label: "🖥️ Sistem" },
            ] as { v: Theme; label: string }[]).map((o) => (
              <button
                key={o.v}
                onClick={() => { setTheme(o.v); save(LS.theme, o.v); }}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium hover:bg-accent ${theme === o.v ? "border-primary bg-accent" : ""}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Jenis font</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { v: "sans",    label: "Sans (Inter)",        family: "Inter, system-ui, sans-serif" },
              { v: "serif",   label: "Serif (Merriweather)", family: "Merriweather, Georgia, serif" },
              { v: "mono",    label: "Mono (JetBrains)",    family: "'JetBrains Mono', monospace" },
              { v: "display", label: "Display (Space Grotesk)", family: "'Space Grotesk', sans-serif" },
            ] as { v: FontFamily; label: string; family: string }[]).map((o) => (
              <button
                key={o.v}
                onClick={() => { setFont(o.v); save(LS.font, o.v); }}
                style={{ fontFamily: o.family }}
                className={`rounded-md border px-2 py-2 text-left text-xs font-medium hover:bg-accent ${font === o.v ? "border-primary bg-accent" : ""}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Ukuran teks</p>
          <div className="grid grid-cols-4 gap-2">
            {([
              { v: "sm", label: "A−" },
              { v: "md", label: "A" },
              { v: "lg", label: "A+" },
              { v: "xl", label: "A++" },
            ] as { v: FontSize; label: string }[]).map((o) => (
              <button
                key={o.v}
                onClick={() => { setSize(o.v); save(LS.size, o.v); }}
                className={`rounded-md border px-2 py-1.5 text-xs font-semibold hover:bg-accent ${size === o.v ? "border-primary bg-accent" : ""}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Warna aksen</p>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                onClick={() => { setAccent(a.id); save(LS.accent, a.id); }}
                title={a.label}
                aria-label={a.label}
                className={`h-8 w-8 rounded-full border-2 ${accent === a.id ? "border-foreground" : "border-transparent"}`}
                style={{ backgroundColor: a.swatch }}
              />
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Kelengkungan sudut: {radius.toFixed(2)}rem</p>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={radius}
            onChange={(e) => {
              const v = Number(e.target.value);
              setRadius(v);
              save(LS.radius, String(v));
            }}
            className="w-full"
          />
        </section>

        <button
          onClick={() => {
            [LS.theme, LS.font, LS.size, LS.accent, LS.radius].forEach((k) => localStorage.removeItem(k));
            applyAppearance();
            setOpen(false);
          }}
          className="mt-2 w-full rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Kembalikan ke bawaan
        </button>
      </DialogContent>
    </Dialog>
  );
}