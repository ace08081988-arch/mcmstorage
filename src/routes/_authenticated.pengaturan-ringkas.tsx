import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Accessibility,
  Bell,
  BellOff,
  ChevronRight,
  Contrast,
  Gauge,
  Moon,
  Palette,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Sun,
  Vibrate,
  Wifi,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { Switch } from "@/components/ui/switch";
import { LS, applyAppearance } from "@/components/appearance-init";
import { useAppPrefs } from "@/lib/app-prefs";
import { loadPrefs, savePrefs, type NotifPrefs } from "@/lib/notif-prefs";
import { cn } from "@/lib/utils";
import type { ComponentType, ReactNode, SVGProps } from "react";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;
type ThemeChoice = "light" | "dark" | "system";

/**
 * Pengaturan Ringkas — satu layar berisi setelan yang paling sering dipakai
 * harian (tema, ukuran huruf, kontras/animasi, notifikasi, hemat kuota),
 * semuanya bisa diubah langsung di tempat tanpa berpindah halaman.
 *
 * Halaman ini TIDAK menggantikan hub `/pengaturan`: semua setelan lanjutan
 * tetap ada di sana dan ditautkan dari bagian bawah layar ini.
 */
const FONT_STEPS: ReadonlyArray<{ v: number; label: string }> = [
  { v: 0.9, label: "Kecil" },
  { v: 1, label: "Normal" },
  { v: 1.15, label: "Besar" },
  { v: 1.3, label: "Sangat besar" },
];

const THEMES: ReadonlyArray<{ v: ThemeChoice; label: string; Icon: LucideIcon }> = [
  { v: "light", label: "Terang", Icon: Sun },
  { v: "dark", label: "Gelap", Icon: Moon },
  { v: "system", label: "Sistem", Icon: Smartphone },
];

const ADVANCED: ReadonlyArray<{ to: string; title: string; desc: string; Icon: LucideIcon }> = [
  {
    to: "/pengaturan",
    title: "Semua pengaturan",
    desc: "Hub lengkap: akun, privasi, integrasi, sistem.",
    Icon: Settings2,
  },
  {
    to: "/pengaturan-tampilan",
    title: "Tampilan lanjutan",
    desc: "Preset tema, warna aksen, sudut, efek permukaan.",
    Icon: Palette,
  },
  {
    to: "/notifikasi",
    title: "Notifikasi lanjutan",
    desc: "Per-jenis, per-kanal, dan jam Jangan Ganggu.",
    Icon: Bell,
  },
  {
    to: "/pengaturan-aksesibilitas",
    title: "Aksesibilitas lanjutan",
    desc: "Detail kontras, gerak, dan target sentuh.",
    Icon: Accessibility,
  },
];

export const Route = createFileRoute("/_authenticated/pengaturan-ringkas")({
  head: () => ({
    meta: [
      { title: "Pengaturan Ringkas · Ace Storage" },
      {
        name: "description",
        content:
          "Atur cepat tema, ukuran huruf, kontras, notifikasi, dan hemat kuota Ace Storage dalam satu layar.",
      },
      { property: "og:title", content: "Pengaturan Ringkas · Ace Storage" },
      {
        property: "og:description",
        content:
          "Panel setelan harian Ace Storage: tema, huruf, notifikasi, hemat kuota — plus tautan ke pengaturan lanjutan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PengaturanRingkas,
});

function readTheme(): ThemeChoice {
  if (typeof window === "undefined") return "dark";
  const raw = localStorage.getItem(LS.theme);
  return raw === "light" || raw === "system" ? raw : raw === "dark" ? "dark" : "dark";
}

function PengaturanRingkas() {
  const { prefs, set } = useAppPrefs();
  const [theme, setTheme] = useState<ThemeChoice>("dark");
  const [notif, setNotif] = useState<NotifPrefs | null>(null);

  // Baca nilai yang bergantung browser setelah hydrate supaya SSR & klien
  // merender markup yang sama (hindari hydration mismatch).
  useEffect(() => {
    setTheme(readTheme());
    setNotif(loadPrefs());
  }, []);

  const pickTheme = useCallback((v: ThemeChoice) => {
    setTheme(v);
    try {
      localStorage.setItem(LS.theme, v);
    } catch {
      /* storage penuh — tema tetap diterapkan untuk sesi ini */
    }
    applyAppearance();
  }, []);

  const patchNotif = useCallback((patch: (p: NotifPrefs) => NotifPrefs) => {
    setNotif((cur) => {
      if (!cur) return cur;
      const next = patch(cur);
      savePrefs(next);
      return next;
    });
  }, []);

  const allNotifOff =
    !!notif && !Object.values(notif.enabledKinds).some(Boolean);

  return (
    <div className="min-h-screen bg-background pb-safe">
      <SettingsHeader
        title="Pengaturan Ringkas"
        subtitle="Setelan yang paling sering dipakai"
        icon={SlidersHorizontal}
      />

      <div className="mx-auto max-w-3xl space-ms-4 px-ms-3 py-ms-3 sm:px-ms-4 sm:py-ms-4">
        {/* Tema */}
        <Panel title="Tema" hint="Berlaku di perangkat ini." Icon={Palette}>
          <div
            role="group"
            aria-label="Pilih tema"
            className="grid grid-cols-3 gap-ms-2 px-ms-3 pb-ms-3"
          >
            {THEMES.map(({ v, label, Icon }) => {
              const active = theme === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => pickTheme(v)}
                  aria-pressed={active}
                  className={cn(
                    "flex min-h-[var(--ms-tap)] flex-col items-center justify-center gap-1 rounded-xl border px-ms-2 py-ms-2 text-ms-2xs transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-primary/40 bg-primary/10 font-semibold text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Ukuran huruf */}
        <Panel title="Ukuran huruf" hint="Perbesar teks agar mudah dibaca." Icon={Gauge}>
          <div
            role="group"
            aria-label="Ukuran huruf"
            className="grid grid-cols-4 gap-ms-2 px-ms-3 pb-ms-3"
          >
            {FONT_STEPS.map(({ v, label }) => {
              const active = Math.abs(prefs.fontScale - v) < 0.02;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => set({ fontScale: v })}
                  aria-pressed={active}
                  className={cn(
                    "min-h-[var(--ms-tap)] rounded-xl border px-ms-1 text-ms-2xs transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-primary/40 bg-primary/10 font-semibold text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Kenyamanan baca */}
        <Panel title="Kenyamanan" Icon={Accessibility}>
          <ToggleRow
            Icon={Contrast}
            title="Kontras tinggi"
            desc="Teks dan garis lebih tegas saat di luar ruangan."
            checked={prefs.highContrast}
            onChange={(v) => set({ highContrast: v })}
          />
          <ToggleRow
            Icon={Smartphone}
            title="Kurangi animasi"
            desc="Matikan efek gerak supaya terasa lebih ringan."
            checked={prefs.reduceMotion}
            onChange={(v) => set({ reduceMotion: v })}
          />
        </Panel>

        {/* Notifikasi */}
        <Panel
          title="Notifikasi"
          hint={allNotifOff ? "Semua notifikasi mati." : undefined}
          Icon={allNotifOff ? BellOff : Bell}
        >
          {notif ? (
            <>
              <ToggleRow
                Icon={Bell}
                title="Pesan chat"
                desc="Pemberitahuan pesan masuk dari pelanggan & pegawai."
                checked={notif.enabledKinds.chat}
                onChange={(v) =>
                  patchNotif((p) => ({
                    ...p,
                    enabledKinds: { ...p.enabledKinds, chat: v },
                  }))
                }
              />
              <ToggleRow
                Icon={Bell}
                title="Tugas & penyiapan"
                desc="Pegawai submit penyiapan, tugas selesai / gagal."
                checked={notif.enabledKinds.tugas}
                onChange={(v) =>
                  patchNotif((p) => ({
                    ...p,
                    enabledKinds: { ...p.enabledKinds, tugas: v },
                  }))
                }
              />
              <ToggleRow
                Icon={Bell}
                title="Pesanan"
                desc="Pesanan baru, pengiriman, dan pembayaran."
                checked={notif.enabledKinds.order}
                onChange={(v) =>
                  patchNotif((p) => ({
                    ...p,
                    enabledKinds: { ...p.enabledKinds, order: v },
                  }))
                }
              />
              <ToggleRow
                Icon={Vibrate}
                title="Getar"
                desc="Getarkan HP saat notifikasi masuk."
                checked={notif.vibrate}
                onChange={(v) => patchNotif((p) => ({ ...p, vibrate: v }))}
              />
              <ToggleRow
                Icon={BellOff}
                title={`Jangan ganggu (${notif.dnd.start}–${notif.dnd.end})`}
                desc="Diamkan notifikasi pada jam istirahat."
                checked={notif.dnd.enabled}
                onChange={(v) =>
                  patchNotif((p) => ({ ...p, dnd: { ...p.dnd, enabled: v } }))
                }
              />
            </>
          ) : (
            <div className="px-ms-3 pb-ms-3 text-ms-2xs text-muted-foreground">
              Memuat preferensi notifikasi…
            </div>
          )}
        </Panel>

        {/* Kuota */}
        <Panel title="Hemat kuota" Icon={Wifi}>
          <ToggleRow
            Icon={Wifi}
            title="Unduh media otomatis (Wi-Fi)"
            desc="Foto & lampiran diunduh sendiri saat tersambung Wi-Fi."
            checked={prefs.autoDownloadWifi}
            onChange={(v) => set({ autoDownloadWifi: v })}
          />
          <ToggleRow
            Icon={Smartphone}
            title="Unduh media otomatis (data seluler)"
            desc="Matikan agar kuota tidak cepat habis."
            checked={prefs.autoDownloadCellular}
            onChange={(v) => set({ autoDownloadCellular: v })}
          />
        </Panel>

        {/* Tautan lanjutan */}
        <section aria-labelledby="lanjutan">
          <h2
            id="lanjutan"
            className="mb-1.5 px-1 text-ms-2xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Pengaturan lanjutan
          </h2>
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <ul className="divide-y divide-border/70">
              {ADVANCED.map(({ to, title, desc, Icon }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className={cn(
                      "group flex min-h-[var(--ms-tap)] items-center gap-ms-3 px-ms-3 py-ms-3 transition-colors",
                      "hover:bg-accent/50 active:bg-accent",
                      "focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    )}
                  >
                    <span
                      aria-hidden
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15"
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ms-sm font-medium leading-tight">
                        {title}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-ms-2xs leading-snug text-muted-foreground">
                        {desc}
                      </span>
                    </span>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function Panel({
  title,
  hint,
  Icon,
  children,
}: {
  title: string;
  hint?: string;
  Icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-ms-2 px-ms-3 pb-ms-2 pt-ms-3">
        <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <h2 className="text-ms-sm font-semibold leading-tight">{title}</h2>
        {hint ? (
          <span className="ml-auto truncate text-ms-2xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      <div className="divide-y divide-border/70">{children}</div>
    </section>
  );
}

function ToggleRow({
  Icon,
  title,
  desc,
  checked,
  onChange,
}: {
  Icon: LucideIcon;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-[var(--ms-tap)] cursor-pointer items-center gap-ms-3 px-ms-3 py-ms-3">
      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-ms-sm font-medium leading-tight">{title}</span>
        <span className="mt-0.5 block text-ms-2xs leading-snug text-muted-foreground">
          {desc}
        </span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </label>
  );
}
