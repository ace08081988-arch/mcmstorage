/**
 * Bagian ringan dari sistem appearance yang WAJIB ada di initial bundle:
 *   - konstanta LS/ACCENTS/BG_PRESETS (dipakai oleh halaman
 *     Pengaturan Tampilan dan Beranda),
 *   - `applyAppearance()` — pipeline penerapan tema ke `document`,
 *   - `<AppearanceInit />` — memasang listener sistem sekali di root.
 *
 * Sebelumnya semua ini berada di satu file dengan komponen
 * `AppearanceSettings` (dialog besar). Karena `<AppearanceInit />` dipasang
 * di `__root.tsx`, seluruh modul termasuk dialog ikut ke chunk root —
 * membuat lazy-load `AppearanceSettings` dari halaman lain menjadi
 * percuma. Split ini memisahkan "yang selalu perlu" dari "yang hanya
 * perlu saat dialog dibuka".
 */
import { useEffect } from "react";

type Theme = "light" | "dark" | "system";
type FontFamily = "sans" | "serif" | "mono" | "display";
type FontSize = "sm" | "md" | "lg" | "xl";

export const LS = {
  theme: "app-theme",
  font: "app-font",
  size: "app-font-size",
  accent: "app-accent",
  radius: "app-radius",
  bgImage: "app-bg-image",
  bgOverlay: "app-bg-overlay",
  bgBlur: "app-bg-blur",
};

export const ACCENTS: { id: string; label: string; value: string; swatch: string }[] = [
  { id: "emerald", label: "Hijau",  value: "oklch(0.62 0.17 155)", swatch: "#10b981" },
  { id: "blue",    label: "Biru",   value: "oklch(0.60 0.18 250)", swatch: "#3b82f6" },
  { id: "violet",  label: "Ungu",   value: "oklch(0.58 0.22 295)", swatch: "#8b5cf6" },
  { id: "rose",    label: "Merah",  value: "oklch(0.63 0.22 20)",  swatch: "#f43f5e" },
  { id: "amber",   label: "Kuning", value: "oklch(0.78 0.16 80)",  swatch: "#f59e0b" },
  { id: "slate",   label: "Netral", value: "oklch(0.30 0.04 260)", swatch: "#475569" },
];

export const BG_PRESETS: { id: string; label: string; url: string }[] = [
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
  const theme = (localStorage.getItem(LS.theme) as Theme | null) ?? "dark";
  const font = (localStorage.getItem(LS.font) as FontFamily | null) ?? "sans";
  const size = (localStorage.getItem(LS.size) as FontSize | null) ?? "md";
  const accentId = localStorage.getItem(LS.accent) ?? "emerald";
  const radius = Number(localStorage.getItem(LS.radius) ?? "0.625");
  const bgImage = localStorage.getItem(LS.bgImage) ?? "";
  const bgOverlay = Number(localStorage.getItem(LS.bgOverlay) ?? "0.7");
  const bgBlur = Number(localStorage.getItem(LS.bgBlur) ?? "0");

  root.classList.toggle("dark", resolveTheme(theme) === "dark");
  root.dataset.font = font;
  root.dataset.fontSize = size;
  const accent = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0];
  root.style.setProperty("--primary", accent.value);
  root.style.setProperty("--ring", accent.value);
  root.style.setProperty("--primary-foreground", "oklch(0.985 0 0)");
  root.style.setProperty("--radius", `${radius}rem`);
  root.style.setProperty(
    "--app-bg-image",
    bgImage ? `url("${bgImage.replace(/"/g, '\\"')}")` : "none",
  );
  root.style.setProperty("--app-bg-overlay", String(bgImage ? bgOverlay : 1));
  root.style.setProperty("--app-bg-blur", `${bgImage ? bgBlur : 0}px`);
  if (bgImage) root.dataset.hasBg = "1";
  else delete root.dataset.hasBg;
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