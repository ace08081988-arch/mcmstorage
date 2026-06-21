import { useEffect, useRef, useState } from "react";
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
  bgImage: "app-bg-image",
  bgOverlay: "app-bg-overlay",
  bgBlur: "app-bg-blur",
};

const ACCENTS: { id: string; label: string; value: string; swatch: string }[] = [
  { id: "emerald", label: "Hijau",  value: "oklch(0.62 0.17 155)", swatch: "#10b981" },
  { id: "blue",    label: "Biru",   value: "oklch(0.60 0.18 250)", swatch: "#3b82f6" },
  { id: "violet",  label: "Ungu",   value: "oklch(0.58 0.22 295)", swatch: "#8b5cf6" },
  { id: "rose",    label: "Merah",  value: "oklch(0.63 0.22 20)",  swatch: "#f43f5e" },
  { id: "amber",   label: "Kuning", value: "oklch(0.78 0.16 80)",  swatch: "#f59e0b" },
  { id: "slate",   label: "Netral", value: "oklch(0.30 0.04 260)", swatch: "#475569" },
];

const BG_PRESETS: { id: string; label: string; url: string }[] = [
  { id: "none",     label: "Tanpa foto", url: "" },
  { id: "mountain", label: "Gunung",     url: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1600&q=80" },
  { id: "ocean",    label: "Laut",       url: "https://images.unsplash.com/photo-1505142468610-359e7d316be0?auto=format&fit=crop&w=1600&q=80" },
  { id: "forest",   label: "Hutan",      url: "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1600&q=80" },
  { id: "sunset",   label: "Senja",      url: "https://images.unsplash.com/photo-1495616811223-4d98c6e9c869?auto=format&fit=crop&w=1600&q=80" },
  { id: "abstract", label: "Abstrak",    url: "https://images.unsplash.com/photo-1557672172-298e090bd0f1?auto=format&fit=crop&w=1600&q=80" },
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
  const body = document.body;
  const theme = (localStorage.getItem(LS.theme) as Theme | null) ?? "dark";
  const font = (localStorage.getItem(LS.font) as FontFamily | null) ?? "sans";
  const size = (localStorage.getItem(LS.size) as FontSize | null) ?? "md";
  const accentId = localStorage.getItem(LS.accent) ?? "emerald";
  const radius = Number(localStorage.getItem(LS.radius) ?? "0.625");
  const bgImage = localStorage.getItem(LS.bgImage) ?? "";
  const bgOverlay = Number(localStorage.getItem(LS.bgOverlay) ?? "0.7");
  const bgBlur = Number(localStorage.getItem(LS.bgBlur) ?? "0");

  root.classList.toggle("dark", resolveTheme(theme) === "dark");
  if (body) {
    body.dataset.font = font;
    body.dataset.fontSize = size;
  }
  const accent = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0];
  root.style.setProperty("--primary", accent.value);
  root.style.setProperty("--ring", accent.value);
  root.style.setProperty("--radius", `${radius}rem`);
  root.style.setProperty(
    "--app-bg-image",
    bgImage ? `url("${bgImage.replace(/"/g, '\\"')}")` : "none",
  );
  root.style.setProperty("--app-bg-overlay", String(bgImage ? bgOverlay : 1));
  root.style.setProperty("--app-bg-blur", `${bgImage ? bgBlur : 0}px`);
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

export function AppearanceSettings({ triggerClassName, compact = false }: { triggerClassName?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [font, setFont] = useState<FontFamily>("sans");
  const [size, setSize] = useState<FontSize>("md");
  const [accent, setAccent] = useState<string>("emerald");
  const [radius, setRadius] = useState<number>(0.625);
  const [bgImage, setBgImage] = useState<string>("");
  const [bgOverlay, setBgOverlay] = useState<number>(0.7);
  const [bgBlur, setBgBlur] = useState<number>(0);
  const [announce, setAnnounce] = useState<string>("");
  const resetBtnRef = useRef<HTMLButtonElement | null>(null);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashAnnouncement = (msg: string) => {
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    // Kosongkan dulu agar pembaca layar mengumumkan ulang teks yang sama.
    setAnnounce("");
    requestAnimationFrame(() => setAnnounce(msg));
    announceTimerRef.current = setTimeout(() => setAnnounce(""), 3000);
  };

  useEffect(() => () => {
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
  }, []);

  useEffect(() => {
    setTheme((localStorage.getItem(LS.theme) as Theme) ?? "dark");
    setFont((localStorage.getItem(LS.font) as FontFamily) ?? "sans");
    setSize((localStorage.getItem(LS.size) as FontSize) ?? "md");
    setAccent(localStorage.getItem(LS.accent) ?? "emerald");
    setRadius(Number(localStorage.getItem(LS.radius) ?? "0.625"));
    setBgImage(localStorage.getItem(LS.bgImage) ?? "");
    setBgOverlay(Number(localStorage.getItem(LS.bgOverlay) ?? "0.7"));
    setBgBlur(Number(localStorage.getItem(LS.bgBlur) ?? "0"));
  }, [open]);

  const save = (k: string, v: string) => {
    localStorage.setItem(k, v);
    applyAppearance();
  };

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      alert("Ukuran foto maksimal 4MB. Pilih foto lain.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      setBgImage(url);
      save(LS.bgImage, url);
    };
    reader.readAsDataURL(file);
  };

  const handleResetBg = () => {
    // Catat perubahan yang BENAR-BENAR terjadi sebelum kita ubah state.
    const changes: string[] = [];
    if (bgImage !== "") changes.push("foto latar dihapus");
    if (bgOverlay !== 0.7) {
      changes.push(`overlay ${Math.round(bgOverlay * 100)} persen menjadi 70 persen`);
    }
    if (bgBlur !== 0) changes.push(`blur ${bgBlur} piksel menjadi 0 piksel`);

    if (changes.length === 0) {
      // Sudah default — beri umpan balik singkat sekali saja, jangan ulang pesan reset.
      flashAnnouncement("Pengaturan foto latar sudah pada nilai default.");
      requestAnimationFrame(() => resetBtnRef.current?.focus());
      return;
    }

    setBgImage("");
    setBgOverlay(0.7);
    setBgBlur(0);
    [LS.bgImage, LS.bgOverlay, LS.bgBlur].forEach((k) => localStorage.removeItem(k));
    applyAppearance();
    flashAnnouncement(`Pengaturan diperbarui: ${changes.join(", ")}.`);
    // Kembalikan fokus ke tombol Reset agar urutan tab tetap konsisten.
    requestAnimationFrame(() => resetBtnRef.current?.focus());
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
          {compact ? "🎨" : "🎨 Tampilan"}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
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

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground">Foto latar</p>
            <div className="flex items-center gap-3">
              <button
                ref={resetBtnRef}
                onClick={handleResetBg}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline"
                title="Reset preset, overlay, dan blur ke default"
                aria-label="Reset foto latar, kegelapan overlay, dan blur ke default"
                aria-controls="appearance-bg-preview"
              >
                ↺ Reset
              </button>
              {bgImage && (
                <button
                  onClick={() => {
                    setBgImage("");
                    localStorage.removeItem(LS.bgImage);
                    applyAppearance();
                    flashAnnouncement("Foto latar dihapus.");
                    requestAnimationFrame(() => resetBtnRef.current?.focus());
                  }}
                  className="text-[11px] font-medium text-destructive hover:underline"
                  aria-label="Hapus foto latar"
                  aria-controls="appearance-bg-preview"
                >
                  Hapus latar
                </button>
              )}
            </div>
          </div>

          {/* Pengumuman transien untuk pembaca layar */}
          <div role="status" aria-live="assertive" aria-atomic="true" className="sr-only">
            {announce}
          </div>

          {/* Pratinjau langsung */}
          <div
            id="appearance-bg-preview"
            role="group"
            aria-label="Pratinjau foto latar"
            className="relative h-32 w-full overflow-hidden rounded-md border"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                backgroundImage: bgImage ? `url("${bgImage}")` : undefined,
                backgroundColor: bgImage ? undefined : "var(--muted)",
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: bgImage ? `blur(${bgBlur}px)` : undefined,
                transform: "scale(1.06)",
              }}
            />
            {bgImage && (
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background: `color-mix(in oklab, var(--background) ${Math.round(bgOverlay * 100)}%, transparent)`,
                }}
              />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <p className="text-sm font-semibold text-foreground">Pratinjau langsung</p>
              <p
                className="text-[11px] text-muted-foreground"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {bgImage
                  ? `Foto latar aktif. Overlay ${Math.round(bgOverlay * 100)} persen, blur ${bgBlur} piksel.`
                  : "Belum ada foto latar."}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {BG_PRESETS.map((p) => {
              const active = (p.url === "" && !bgImage) || bgImage === p.url;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setBgImage(p.url);
                    if (p.url) save(LS.bgImage, p.url);
                    else { localStorage.removeItem(LS.bgImage); applyAppearance(); }
                  }}
                  className={`relative h-14 overflow-hidden rounded-md border text-[10px] font-medium hover:opacity-90 ${active ? "border-primary ring-2 ring-primary" : "border-muted"}`}
                  style={p.url ? { backgroundImage: `url("${p.url}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                  title={p.label}
                >
                  <span className="absolute inset-x-0 bottom-0 bg-black/50 px-1 py-0.5 text-white">
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="mt-1 inline-flex w-full cursor-pointer items-center justify-center rounded-md border border-dashed px-3 py-2 text-xs font-medium hover:bg-accent">
            📷 Unggah foto dari perangkat
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            />
          </label>

          {bgImage && (
            <>
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">
                  Kegelapan overlay: {Math.round(bgOverlay * 100)}%
                </p>
                <input
                  type="range"
                  min={0}
                  max={0.95}
                  step={0.05}
                  value={bgOverlay}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setBgOverlay(v);
                    save(LS.bgOverlay, String(v));
                  }}
                  className="w-full"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">
                  Blur foto: {bgBlur}px
                </p>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  value={bgBlur}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setBgBlur(v);
                    save(LS.bgBlur, String(v));
                  }}
                  className="w-full"
                />
              </div>
            </>
          )}
        </section>

        <button
          onClick={() => {
            [LS.theme, LS.font, LS.size, LS.accent, LS.radius, LS.bgImage, LS.bgOverlay, LS.bgBlur].forEach((k) => localStorage.removeItem(k));
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