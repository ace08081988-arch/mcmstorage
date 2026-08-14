import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { SkipToContent } from "@/components/SkipToContent";
import {
  Search,
  ChevronRight,
  Home,
  LogOut,
  Settings,
  User as UserIcon,
  Lock,
  MonitorSmartphone,
  Command as CommandIcon,
  Sparkles,
} from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/NotificationBell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useOrgName } from "@/lib/org-name";
import { cn } from "@/lib/utils";

/**
 * Peta label untuk breadcrumb. Sengaja dibuat lokal (tidak import dari
 * AppSidebar) untuk menjaga AppSidebar tetap sebagai SSOT navigasi mobile
 * dengan scroll-guard-nya yang rumit. Kalau ada rute baru, cukup tambah
 * satu baris di sini — bila tidak ada mapping, breadcrumb akan
 * memakai segmen path dengan title-case.
 */
const ROUTE_LABELS: Record<string, { label: string; group?: string }> = {
  "/": { label: "Beranda" },
  "/dashboard": { label: "Dasbor", group: "Utama" },
  "/gudang": { label: "Gudang & Supplier", group: "Operasional" },
  "/ecer": { label: "Penyiapan Ecer", group: "Operasional" },
  "/pos-kasir": { label: "POS Kasir Curah", group: "Operasional" },
  "/pos-kasir/ringkasan": { label: "Ringkasan POS", group: "Operasional" },
  "/request": { label: "Penyiapan Request", group: "Operasional" },
  "/tugas": { label: "Tugas Pegawai", group: "Operasional" },
  "/tugas-baru": { label: "Buat Tugas", group: "Operasional" },
  "/label-preview": { label: "Pratinjau Label", group: "Operasional" },
  "/chat": { label: "Chat", group: "Komunikasi" },
  "/catatan": { label: "Catatan", group: "Komunikasi" },
  "/balas-cepat": { label: "Balas Cepat", group: "Komunikasi" },
  "/buku-alamat": { label: "Buku Alamat", group: "Komunikasi" },
  "/notifikasi": { label: "Notifikasi", group: "Komunikasi" },
  "/hutang-piutang": { label: "Hutang & Piutang", group: "Keuangan" },
  "/profil": { label: "Profil Akun", group: "Akun" },
  "/pengaturan-kunci": { label: "Pengaturan Kunci", group: "Akun" },
  "/sesi": { label: "Sesi & Perangkat", group: "Akun" },
  "/audit": { label: "Audit Rute", group: "Sistem" },
  "/diagnostics": { label: "Diagnostik", group: "Sistem" },
  "/email-queue": { label: "Antrian Email", group: "Sistem" },
  "/pengaturan-apk": { label: "Rilis APK", group: "Sistem" },
  "/admin-denial-log": { label: "Log Penolakan", group: "Sistem" },
  "/pengaturan-oauth-google": { label: "OAuth Google", group: "Sistem" },
};

/** Untuk /gudang/pesanan/abc kita cari prefix terpanjang yang cocok. */
function resolveBreadcrumb(pathname: string): { label: string; group?: string }[] {
  if (pathname === "/" || pathname === "") return [{ label: "Beranda" }];
  const segs = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; group?: string }[] = [];
  let acc = "";
  for (const seg of segs) {
    acc += "/" + seg;
    const hit = ROUTE_LABELS[acc];
    if (hit) {
      crumbs.push(hit);
    } else {
      // Fallback: title-case segmen. Skip param-like segmen (>=32 char hash/uuid).
      if (seg.length >= 24) continue;
      const nice = seg
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      crumbs.push({ label: nice });
    }
  }
  return crumbs.length ? crumbs : [{ label: "Beranda" }];
}

/** Daftar rute yang bisa dicari lewat command palette. */
const SEARCH_ITEMS: { label: string; url: string; group: string; hint?: string }[] = [
  { label: "Beranda", url: "/", group: "Utama", hint: "Halaman utama" },
  { label: "Dasbor", url: "/dashboard", group: "Utama", hint: "Ringkasan KPI" },
  { label: "Gudang & Supplier", url: "/gudang", group: "Operasional" },
  { label: "Penyiapan Ecer", url: "/ecer", group: "Operasional" },
  { label: "POS Kasir Curah", url: "/pos-kasir", group: "Operasional" },
  { label: "Ringkasan POS Kasir", url: "/pos-kasir/ringkasan", group: "Operasional" },
  { label: "Penyiapan Request", url: "/request", group: "Operasional" },
  { label: "Tugas Pegawai", url: "/tugas", group: "Operasional" },
  { label: "Buat Tugas", url: "/tugas-baru", group: "Operasional" },
  { label: "Chat", url: "/chat", group: "Komunikasi" },
  { label: "Catatan", url: "/catatan", group: "Komunikasi" },
  { label: "Balas Cepat", url: "/balas-cepat", group: "Komunikasi" },
  { label: "Buku Alamat", url: "/buku-alamat", group: "Komunikasi" },
  { label: "Notifikasi", url: "/notifikasi", group: "Komunikasi" },
  { label: "Hutang & Piutang", url: "/hutang-piutang", group: "Keuangan" },
  { label: "Profil Akun", url: "/profil", group: "Akun" },
  { label: "Pengaturan Kunci", url: "/pengaturan-kunci", group: "Akun" },
  { label: "Sesi & Perangkat", url: "/sesi", group: "Akun" },
];

function useMe() {
  const [me, setMe] = useState<{ email: string | null; avatar: string | null; name: string | null }>({
    email: null,
    avatar: null,
    name: null,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { getCurrentUser } = await import("@/lib/current-user");
      const user = await getCurrentUser();
      if (cancelled || !user) return;
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      setMe({
        email: user.email ?? null,
        avatar: (meta.avatar_url as string) || (meta.picture as string) || null,
        name: (meta.full_name as string) || (meta.name as string) || null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return me;
}

function initialsFor(name: string | null, email: string | null): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const chars = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return chars.toUpperCase() || "U";
}

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const me = useMe();
  const org = useOrgName();
  const [cmdOpen, setCmdOpen] = useState(false);

  const crumbs = useMemo(() => resolveBreadcrumb(pathname), [pathname]);

  // ⌘K / Ctrl+K opens the command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (url: string) => {
    setCmdOpen(false);
    void navigate({ to: url });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  };

  const groupedSearch = useMemo(() => {
    const out = new Map<string, typeof SEARCH_ITEMS>();
    for (const it of SEARCH_ITEMS) {
      const arr = out.get(it.group) ?? [];
      arr.push(it);
      out.set(it.group, arr);
    }
    return Array.from(out.entries());
  }, []);

  return (
    <header
      className={cn(
        // Ruang notch/status bar + cutout samping (landscape) diambil dari
        // `--app-safe-*`; tinggi konten header tetap 14 (h-14 di baris dalam).
        "app-safe-header sticky top-0 z-30 flex min-h-14 items-center gap-ms-2 backdrop-blur-md",
        "border-b border-primary/15 bg-background/85 supports-[backdrop-filter]:bg-background/70",
      )}
      style={{
        boxShadow: "0 1px 0 0 color-mix(in oklab, var(--primary) 12%, transparent)",
      }}
    >
      {/* Skip link — target Tab pertama, memudahkan lompat ke konten */}
      <SkipToContent />
      <SidebarTrigger className="h-9 w-9 shrink-0 rounded-lg hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:inline-flex hidden" />
      {/* Mobile: no sidebar trigger here (moved to bottom nav "Menu"), spacer for balance */}
      <span aria-hidden className="ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg md:hidden">
        <span
          className="h-6 w-6 rounded-md ring-1 ring-primary/30"
          style={{ background: "color-mix(in oklab, var(--primary) 14%, transparent)" }}
        />
      </span>

      {/* Breadcrumb — hidden on very narrow screens, visible from sm up */}
      <nav
        aria-label="Breadcrumb"
        className="hidden min-w-0 flex-1 items-center gap-ms-1 text-ms-sm sm:flex"
      >
        <Link
          to="/"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="Beranda"
        >
          <Home className="h-4 w-4" />
        </Link>
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <div key={i} className="flex min-w-0 items-center gap-ms-1">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              {c.group && !isLast ? (
                <span className="hidden text-ms-2xs font-medium uppercase tracking-wider text-muted-foreground md:inline">
                  {c.group}
                </span>
              ) : null}
              <span
                className={cn(
                  "truncate rounded-md px-ms-2 py-1 text-ms-sm",
                  isLast
                    ? "bg-primary/8 font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
                aria-current={isLast ? "page" : undefined}
              >
                {c.label}
              </span>
            </div>
          );
        })}
      </nav>

      {/* Mobile: page title, centered, tracking tight untuk kesan premium */}
      <div className="flex min-w-0 flex-1 items-center justify-center sm:hidden">
        <span className="truncate text-ms-base font-semibold tracking-tight">
          {crumbs[crumbs.length - 1]?.label ?? "Ace Storage"}
        </span>
      </div>

      {/* Search trigger */}
      <button
        type="button"
        onClick={() => setCmdOpen(true)}
        className={cn(
          "group ml-auto hidden h-9 items-center gap-ms-2 rounded-lg border bg-muted/40 px-ms-3 text-ms-sm text-muted-foreground shadow-sm transition-all",
          "hover:border-primary/40 hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "md:inline-flex md:w-64 lg:w-80",
        )}
        aria-label="Buka pencarian cepat"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate text-left">Cari menu…</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border bg-background px-1.5 font-mono text-ms-2xs font-medium text-muted-foreground opacity-100">
          <CommandIcon className="h-3 w-3" />K
        </kbd>
      </button>

      {/* Mobile: hanya notifikasi + avatar; search dipindah ke drawer sidebar (cmd+K tetap aktif) */}
      <div className="ml-auto sm:hidden">
        <NotificationBell />
      </div>

      {/* Desktop / tablet: notifikasi */}
      <div className="hidden sm:block">
        <NotificationBell />
      </div>

      {/* Profile menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Menu akun"
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1 ring-border transition-all",
              "hover:ring-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            <Avatar className="h-8 w-8">
              {me.avatar ? <AvatarImage src={me.avatar} alt="" /> : null}
              <AvatarFallback className="bg-gradient-to-br from-primary to-primary/70 text-ms-2xs font-semibold text-primary-foreground">
                {initialsFor(me.name, me.email)}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex items-center gap-ms-3 py-ms-2">
            <Avatar className="h-9 w-9">
              {me.avatar ? <AvatarImage src={me.avatar} alt="" /> : null}
              <AvatarFallback className="bg-gradient-to-br from-primary to-primary/70 text-ms-2xs font-semibold text-primary-foreground">
                {initialsFor(me.name, me.email)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-ms-sm font-semibold">
                {me.name || me.email?.split("@")[0] || "Pengguna"}
              </div>
              <div className="truncate text-ms-2xs font-normal text-muted-foreground">
                {me.email || org.full}
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/profil" className="flex items-center gap-ms-2">
              <UserIcon className="h-4 w-4 text-muted-foreground" />
              <span>Profil Akun</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/pengaturan-kunci" className="flex items-center gap-ms-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span>Pengaturan Kunci</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/sesi" className="flex items-center gap-ms-2">
              <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
              <span>Sesi &amp; Perangkat</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/dashboard" className="flex items-center gap-ms-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <span>Dasbor</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => void signOut()}
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Keluar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Command palette */}
      <CommandDialog open={cmdOpen} onOpenChange={setCmdOpen}>
        <CommandInput placeholder="Cari halaman atau menu…" />
        <CommandList>
          <CommandEmpty>Tidak ada hasil.</CommandEmpty>
          {groupedSearch.map(([group, items], gi) => (
            <div key={group}>
              {gi > 0 ? <CommandSeparator /> : null}
              <CommandGroup heading={group}>
                {items.map((it) => (
                  <CommandItem
                    key={it.url}
                    value={`${it.label} ${it.url} ${it.hint ?? ""}`}
                    onSelect={() => go(it.url)}
                    className="flex items-center gap-ms-2"
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{it.label}</span>
                    <span className="text-ms-2xs uppercase tracking-wider text-muted-foreground">
                      {it.url}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
      </CommandDialog>
    </header>
  );
}