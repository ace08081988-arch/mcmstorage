import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Accessibility,
  Bell,
  ChevronRight,
  ContactRound,
  Database,
  Download,
  Facebook,
  Globe,
  KeyRound,
  Languages,
  Lock,
  MessageCircle,
  MessageSquare,
  MonitorSmartphone,
  Package,
  Palette,
  Search,
  ShieldCheck,
  Smartphone,
  SlidersHorizontal,
  Gauge,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { Input } from "@/components/ui/input";
import { useAdminStatus } from "@/hooks/use-is-admin";
import { isHiddenMenuUrl } from "@/lib/hidden-menu-routes";
import { cn } from "@/lib/utils";
import type { ComponentType, SVGProps } from "react";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>;

type SettingEntry = {
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  /** Butuh peran admin? Kalau `true`, kartu disembunyikan bagi non-admin. */
  adminOnly?: boolean;
  /** Kata kunci ekstra untuk pencarian (mis. sinonim / istilah teknis). */
  keywords?: string;
};

type SettingCategory = {
  key: string;
  label: string;
  hint?: string;
  entries: ReadonlyArray<SettingEntry>;
};

/**
 * Hub Pengaturan — satu pintu masuk untuk semua sub-halaman `/pengaturan-*`
 * dan halaman terkait (profil, sesi, notifikasi). Menggantikan navigasi
 * yang tersebar di sidebar dengan tampilan modern: search live +
 * kategori-kategori kartu dengan ikon & deskripsi. Menu ini tidak
 * memindahkan logika apa pun — hanya kumpulan link ke halaman yang sudah
 * ada. Halaman-halaman aslinya tetap bisa diakses lewat URL langsung dan
 * lewat sidebar (jika masih di-list di sana), jadi hub ini aditif.
 */
const CATEGORIES: ReadonlyArray<SettingCategory> = [
  {
    key: "cepat",
    label: "Akses Cepat",
    hint: "Setelan harian dalam satu layar.",
    entries: [
      {
        title: "Pengaturan Ringkas",
        description: "Tema, ukuran huruf, kontras, notifikasi, hemat kuota — semua di satu halaman.",
        to: "/pengaturan-ringkas",
        icon: SlidersHorizontal,
        keywords: "ringkas cepat quick tema huruf notifikasi kuota",
      },
    ],
  },
  {
    key: "tampilan",
    label: "Tampilan & Aksesibilitas",
    hint: "Tema, warna, font, mode aplikasi.",
    entries: [
      {
        title: "Tampilan",
        description: "Tema terang/gelap, warna aksen, ukuran & jenis font.",
        to: "/pengaturan-tampilan",
        icon: Palette,
        keywords: "tema dark mode light aksen font ukuran",
      },
      {
        title: "Aksesibilitas",
        description: "Kontras tinggi, reduce motion, target tap besar.",
        to: "/pengaturan-aksesibilitas",
        icon: Accessibility,
        keywords: "kontras motion animasi tap target",
      },
      {
        title: "Bahasa",
        description: "Bahasa antarmuka aplikasi.",
        to: "/pengaturan-bahasa",
        icon: Languages,
        keywords: "language locale indonesia inggris",
      },
      {
        title: "Mode Aplikasi",
        description: "Beralih antara Ace Storage penuh atau Ace Chat.",
        to: "/pengaturan-app-mode",
        icon: Sparkles,
        keywords: "chat storage variant apk",
      },
    ],
  },
  {
    key: "akun",
    label: "Akun & Keamanan",
    hint: "Profil, kunci aplikasi, sesi aktif.",
    entries: [
      {
        title: "Profil Akun",
        description: "Nama, foto, kontak, dan info toko.",
        to: "/profil",
        icon: User,
        keywords: "nama foto avatar bio",
      },
      {
        title: "Kunci Aplikasi",
        description: "PIN, biometrik, dan durasi auto-lock.",
        to: "/pengaturan-kunci",
        icon: Lock,
        keywords: "pin password biometric fingerprint",
      },
      {
        title: "Sesi & Perangkat",
        description: "Daftar perangkat login dan sesi aktif.",
        to: "/sesi",
        icon: MonitorSmartphone,
        keywords: "device logout keluar",
      },
      {
        title: "Buku Alamat",
        description: "Kontak pelanggan, supplier, dan pegawai.",
        to: "/buku-alamat",
        icon: ContactRound,
        keywords: "kontak alamat pelanggan supplier",
      },
    ],
  },
  {
    key: "privasi",
    label: "Privasi & Data",
    hint: "Kontrol data pribadi dan penyimpanan.",
    entries: [
      {
        title: "Privasi",
        description: "Siapa yang bisa melihat status & profil Anda.",
        to: "/pengaturan-privasi",
        icon: ShieldCheck,
        keywords: "visibility publik privat status",
      },
      {
        title: "Penyimpanan & Data",
        description: "Ukuran cache lokal, ekspor & bersihkan data.",
        to: "/pengaturan-penyimpanan",
        icon: Database,
        keywords: "cache storage ekspor hapus bersihkan",
      },
    ],
  },
  {
    key: "aplikasi",
    label: "Aplikasi & Perangkat",
    hint: "Notifikasi, unduhan, pengaturan sistem HP.",
    entries: [
      {
        title: "Notifikasi",
        description: "Preferensi notifikasi pesan, order, dan sistem.",
        to: "/notifikasi",
        icon: Bell,
        keywords: "push email notif pemberitahuan",
      },
      {
        title: "Ace Chat",
        description: "Preferensi chat, tampilan bubble, dan suara.",
        to: "/profil-chat",
        icon: MessageCircle,
        keywords: "chat pesan suara bubble",
      },
      {
        title: "Unduh Aplikasi",
        description: "APK Ace Storage & Ace Chat untuk Android.",
        to: "/download",
        icon: Download,
        keywords: "apk android unduh install",
      },
      {
        title: "Scroll-Guard",
        description: "Cegah tap tak sengaja saat scroll di HP.",
        to: "/pengaturan-scroll-guard",
        icon: Smartphone,
        keywords: "scroll tap accident inertia",
      },
      {
        title: "Notifikasi Performa",
        description: "Nyalakan/matikan peringatan \u201CScroll terasa berat\u201D.",
        to: "/pengaturan-performa",
        icon: Gauge,
        keywords: "performa fps lag scroll berat peringatan toast",
      },
    ],
  },
  {
    key: "integrasi",
    label: "Integrasi & Domain",
    hint: "Hubungkan layanan pihak ketiga.",
    entries: [
      {
        title: "Domain Kustom",
        description: "Kelola domain kustom untuk aplikasi & email.",
        to: "/pengaturan-domain",
        icon: Globe,
        adminOnly: true,
        keywords: "domain dns custom",
      },
      {
        title: "Facebook & Instagram",
        description: "Hubungkan Halaman FB & IG untuk share status.",
        to: "/pengaturan-integrasi-sosial",
        icon: Facebook,
        adminOnly: true,
        keywords: "facebook instagram sosial share",
      },
      {
        title: "OAuth Google (BYOK)",
        description: "Kunci OAuth Google Anda sendiri untuk sign-in.",
        to: "/pengaturan-oauth-google",
        icon: KeyRound,
        adminOnly: true,
        keywords: "google oauth sso login byok",
      },
      {
        title: "Notifikasi WA Penyiapan",
        description: "Terima WA otomatis saat pegawai submit penyiapan (berhasil/gagal) lewat webhook n8n.",
        to: "/pengaturan-notifikasi-wa",
        icon: MessageSquare,
        adminOnly: true,
        keywords: "whatsapp wa webhook n8n notifikasi submit penyiapan request",
      },
    ],
  },
  {
    key: "sistem",
    label: "Sistem",
    hint: "Hanya untuk admin.",
    entries: [
      {
        title: "Rilis APK",
        description: "Kelola versi APK yang tersedia untuk pegawai.",
        to: "/pengaturan-apk",
        icon: Package,
        adminOnly: true,
        keywords: "apk release android versi",
      },
      {
        title: "Diagnostik",
        description: "Alat diagnosa jaringan, session, dan realtime.",
        to: "/diagnostics",
        icon: Wrench,
        adminOnly: true,
        keywords: "diagnostik debug jaringan session",
      },
    ],
  },
];

export const Route = createFileRoute("/_authenticated/pengaturan")({
  head: () => ({
    meta: [
      { title: "Pengaturan · Ace Storage" },
      {
        name: "description",
        content:
          "Semua pengaturan Ace Storage dalam satu tempat — tampilan, akun, privasi, notifikasi, integrasi, dan sistem.",
      },
    ],
  }),
  component: PengaturanHub,
});

function PengaturanHub() {
  const [q, setQ] = useState("");
  const { isAdmin } = useAdminStatus();

  // Filter admin-only sekali di depan; filter search dilakukan per-render
  // dengan memoisasi supaya idle input tidak menyebabkan rekomputasi array.
  const visibleCategories = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CATEGORIES.map((cat) => {
      const entries = cat.entries.filter((e) => {
        // Rute teknis tidak pernah tampil di hub Pengaturan.
        if (isHiddenMenuUrl(e.to)) return false;
        if (e.adminOnly && !isAdmin) return false;
        if (!needle) return true;
        const hay = `${e.title} ${e.description} ${e.keywords ?? ""} ${cat.label}`.toLowerCase();
        return hay.includes(needle);
      });
      return { ...cat, entries };
    }).filter((c) => c.entries.length > 0);
  }, [q, isAdmin]);

  const totalCount = useMemo(
    () =>
      CATEGORIES.reduce(
        (n, c) =>
          n
          + c.entries.filter(
            (e) => !isHiddenMenuUrl(e.to) && (!e.adminOnly || isAdmin),
          ).length,
        0,
      ),
    [isAdmin],
  );
  const shownCount = visibleCategories.reduce((n, c) => n + c.entries.length, 0);

  return (
    <div className="min-h-screen bg-background pb-safe">
      <SettingsHeader
        title="Pengaturan"
        subtitle={
          q.trim()
            ? `${shownCount} dari ${totalCount} pengaturan cocok`
            : `${totalCount} pengaturan tersedia`
        }
      />

      <div className="mx-auto max-w-3xl px-ms-3 py-ms-3 sm:px-ms-4 sm:py-ms-4">
        {/* Search — sticky di bawah header supaya tetap terlihat saat scroll */}
        <div className="bar-solid sticky top-[52px] z-10 -mx-3 mb-3 border-b border-border/50 bg-background/85 px-ms-3 py-ms-2 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:top-[60px] sm:-mx-4 sm:px-ms-4">
          <label htmlFor="pengaturan-search" className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="pengaturan-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari pengaturan… (mis. tema, pin, notifikasi)"
              maxLength={80}
              className="h-10 pl-9 text-ms-sm"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
        </div>

        {visibleCategories.length === 0 ? (
          <div className="rounded-xl border border-dashed p-ms-6 text-center text-ms-sm text-muted-foreground">
            Tidak ada pengaturan yang cocok dengan{" "}
            <span className="font-medium text-foreground">"{q.trim()}"</span>.
          </div>
        ) : (
          <div className="space-ms-5">
            {visibleCategories.map((cat) => (
              <section key={cat.key} aria-labelledby={`cat-${cat.key}`}>
                <div className="mb-1.5 flex items-baseline justify-between px-1">
                  <h2
                    id={`cat-${cat.key}`}
                    className="text-ms-2xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {cat.label}
                  </h2>
                  {cat.hint && !q.trim() ? (
                    <span className="hidden text-ms-2xs text-muted-foreground sm:inline">
                      {cat.hint}
                    </span>
                  ) : null}
                </div>
                <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <ul className="divide-y divide-border/70">
                    {cat.entries.map((entry) => (
                      <li key={entry.to}>
                        <SettingLink entry={entry} />
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SettingLink({ entry }: { entry: SettingEntry }) {
  const Icon = entry.icon;
  return (
    <Link
      to={entry.to}
      className={cn(
        "group flex items-center gap-ms-3 px-ms-3 py-ms-3 transition-colors",
        "hover:bg-accent/50 active:bg-accent focus-visible:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15 transition-transform group-hover:scale-[1.03]"
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ms-sm font-medium leading-tight">
          {entry.title}
          {entry.adminOnly ? (
            <span className="ml-1.5 rounded bg-warning/15 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-warning dark:text-warning">
              Admin
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-ms-2xs leading-snug text-muted-foreground line-clamp-2">
          {entry.description}
        </span>
      </span>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}