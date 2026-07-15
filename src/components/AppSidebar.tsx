import { Link, useNavigate, useRouterState, useMatchRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getScrollGuardConfig } from "@/lib/scroll-guard-config";
import { useAdminStatus } from "@/hooks/use-is-admin";
import { ADMIN_ONLY_URLS, filterSidebarItemsForAdmin } from "@/lib/admin-sidebar-visibility";
import { supabase } from "@/integrations/supabase/client";

/**
 * Global "scroll aktif" flag. Sekali ada scroll event dari elemen apapun
 * (SidebarContent, body, sheet overlay), semua NavLinkItem yang sedang
 * memegang startRef akan membatalkan tap sampai 250ms setelah scroll
 * terakhir — supaya inertial scroll tidak "mendarat" jadi klik.
 */
let __scrollActiveUntil = 0;
function isScrollActive() {
  return Date.now() < __scrollActiveUntil;
}
if (typeof window !== "undefined" && !(window as any).__navScrollGuard) {
  (window as any).__navScrollGuard = true;
  const bump = () => {
    __scrollActiveUntil = Date.now() + getScrollGuardConfig().cooldownMs;
  };
  window.addEventListener("scroll", bump, { capture: true, passive: true });
  window.addEventListener("wheel", bump, { capture: true, passive: true });
  window.addEventListener("touchmove", bump, { capture: true, passive: true });
}

/**
 * Hint kecil "Scroll dulu selesai" yang muncul dekat titik tap ketika
 * scroll-guard menolak navigasi — supaya user paham kenapa halaman tidak
 * berpindah, bukan mengira menu-nya rusak. Throttle 900ms per hint.
 */
let __lastHintAt = 0;
/**
 * Live region persisten untuk pembaca layar. Kita simpan satu <div>
 * `role="status"` `aria-live="polite"` di DOM sepanjang sesi, lalu
 * update `textContent`-nya saat guard menolak tap. Membuat elemen baru
 * setiap kali TIDAK reliabel di NVDA/JAWS/VoiceOver — perubahan
 * `textContent` pada region yang sudah ada jauh lebih konsisten
 * di-announce.
 */
function ensureLiveRegion(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let node = document.getElementById("mcm-scroll-guard-live") as HTMLElement | null;
  if (node) return node;
  node = document.createElement("div");
  node.id = "mcm-scroll-guard-live";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.setAttribute("aria-atomic", "true");
  // Visually hidden tapi tetap ter-render supaya AT membacanya.
  node.style.cssText = [
    "position:fixed",
    "width:1px",
    "height:1px",
    "padding:0",
    "margin:-1px",
    "overflow:hidden",
    "clip:rect(0 0 0 0)",
    "white-space:nowrap",
    "border:0",
  ].join(";");
  document.body.appendChild(node);
  return node;
}

function showScrollGuardHint(x: number, y: number, reason: "scroll" | "drift") {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const now = Date.now();
  if (now - __lastHintAt < 900) return;
  __lastHintAt = now;
  const cfg = getScrollGuardConfig();
  const text = reason === "scroll" ? cfg.hintScrollText : cfg.hintDriftText;
  if (!text) return; // teks kosong = matikan hint sepenuhnya

  // 1) Update live region persisten — inilah yang dibaca screen reader.
  //    Prefix "Navigasi ditolak:" memberi konteks kenapa fokus tidak
  //    berpindah, karena user AT tidak melihat pil visual di dekat jari.
  const live = ensureLiveRegion();
  if (live) {
    // Kosongkan dulu supaya perubahan terdeteksi walau teks identik.
    live.textContent = "";
    window.setTimeout(() => {
      live.textContent = `Navigasi ditolak: ${text}`;
    }, 30);
  }

  // 2) Pil visual — MURNI dekoratif, disembunyikan dari AT supaya
  //    tidak menduplikasi pengumuman dari live region di atas.
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("data-testid", "scroll-guard-hint");
  el.setAttribute("data-reason", reason);
  el.textContent = text;
  const vw = window.innerWidth;
  const left = Math.max(8, Math.min(vw - 200, x + 12));
  const top = Math.max(8, y - 44);
  const fade = Math.max(0, cfg.hintFadeMs);
  const hold = Math.max(fade + 60, cfg.hintHoldMs);
  el.style.cssText = [
    "position:fixed",
    `left:${left}px`,
    `top:${top}px`,
    "z-index:9999",
    "pointer-events:none",
    "padding:6px 10px",
    "border-radius:9999px",
    "font-size:11px",
    "font-weight:500",
    "line-height:1.2",
    "letter-spacing:0.01em",
    "background:hsl(var(--foreground) / 0.92)",
    "color:hsl(var(--background))",
    "box-shadow:0 4px 12px hsl(var(--foreground) / 0.18)",
    "backdrop-filter:blur(4px)",
    "opacity:0",
    "transform:translateY(4px)",
    `transition:opacity ${fade}ms ease-out, transform ${fade}ms ease-out`,
  ].join(";");
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });
  window.setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-4px)";
  }, hold);
  window.setTimeout(() => {
    el.remove();
  }, hold + fade + 20);

  // 3) Untuk pengguna yang mengaktifkan `prefers-reduced-motion`,
  //    ganti transisi jadi instan supaya tidak ada slide/fade.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    el.style.transition = "opacity 0ms, transform 0ms";
  }
}
import { Home, Package, Wallet, Lock, Tags, ClipboardList, Scale, PackagePlus, User, ClipboardCheck, MessageCircle, Activity, Sparkles, Mail, Wifi, WifiOff, RefreshCw, BellRing, NotebookPen, MessageSquarePlus, ContactRound, MonitorSmartphone, ShieldAlert, KeyRound, Calculator, BarChart3, LayoutDashboard, ChevronDown, MoreHorizontal, Settings } from "lucide-react";
import { useIsFetching } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { CompactModeToggle } from "@/components/CompactModeToggle";
import { ReduceMotionToggle } from "@/components/ReduceMotionToggle";
import { useConversations } from "@/lib/chat";
import { useOrgName } from "@/lib/org-name";
import { isChatOnly, CHAT_ONLY_GROUP_LABELS } from "@/lib/app-mode";

/**
 * Tap-safe navigation link. On mobile WebViews (411px APK) a plain
 * `onPointerDown` handler navigated on the very first touch — so scrolling
 * the sidebar with a finger that happened to start on a menu item would
 * instantly change halaman. Kita pantau posisi pointerdown lalu hanya
 * memicu navigasi pada pointerup jika gerakan < 10px (bukan scroll).
 */
function NavLinkItem({
  item,
  isMobile,
  pathname,
  setOpenMobile,
  navigate,
  children,
}: {
  item: { title: string; url: string; icon: typeof Home };
  isMobile: boolean;
  pathname: string;
  setOpenMobile: (open: boolean) => void;
  navigate: ReturnType<typeof useNavigate>;
  children: React.ReactNode;
}) {
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  return (
    <Link
      to={item.url}
      preload="intent"
      className="flex min-w-0 items-center gap-ms-2.5"
      onPointerDown={(e) => {
        if (!isMobile) return;
        if (e.pointerType === "mouse") return;
        if (isScrollActive()) {
          startRef.current = null;
          showScrollGuardHint(e.clientX, e.clientY, "scroll");
          return;
        }
        startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      }}
      onPointerMove={(e) => {
        const s = startRef.current;
        if (!s) return;
        const dx = Math.abs(e.clientX - s.x);
        const dy = Math.abs(e.clientY - s.y);
        // Gerakan > driftPx = user sedang scroll, batalkan intent tap.
        const { driftPx } = getScrollGuardConfig();
        if (dx > driftPx || dy > driftPx) startRef.current = null;
      }}
      onPointerCancel={() => {
        startRef.current = null;
      }}
      onPointerUp={(e) => {
        if (!isMobile) return;
        if (e.pointerType === "mouse") return;
        const s = startRef.current;
        startRef.current = null;
        if (!s) return;
        // Scroll sempat aktif selama gesture — jangan pernah navigasi.
        if (isScrollActive()) {
          showScrollGuardHint(e.clientX, e.clientY, "scroll");
          return;
        }
        const dx = Math.abs(e.clientX - s.x);
        const dy = Math.abs(e.clientY - s.y);
        const dt = Date.now() - s.t;
        // Bukan tap kalau ada scroll drift atau tekan-lama.
        const { driftPx, longPressMs } = getScrollGuardConfig();
        if (dx > driftPx || dy > driftPx || dt > longPressMs) {
          if (dx > driftPx || dy > driftPx) showScrollGuardHint(e.clientX, e.clientY, "drift");
          return;
        }
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        setOpenMobile(false);
        if (pathname !== item.url) {
          void navigate({ to: item.url });
        }
      }}
    >
      {children}
    </Link>
  );
}

function OrgHeader() {
  const { full, short, logo } = useOrgName();
  return (
    <div className="flex items-center gap-ms-2.5">
      {logo ? (
        <img
          src={logo}
          alt=""
          aria-hidden
          className="h-8 w-8 shrink-0 rounded-md object-cover ring-1 ring-border shadow-sm"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/70 text-ms-xs font-bold tracking-tight text-primary-foreground shadow-sm ring-1 ring-primary/20"
        >
          {short}
        </span>
      )}
      <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
        <div className="font-display truncate text-ms-base font-semibold leading-tight tracking-tight text-foreground">
          {full}
        </div>
        <div className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground/80">
          Manajemen Operasional
        </div>
      </div>
    </div>
  );
}

/**
 * Menu dikelompokkan supaya tidak terbaca seperti daftar panjang yang
 * datar. Tiap grup punya satu peran kerja yang jelas; urutan dalam grup
 * mengikuti alur harian operator (Beranda → Operasional → Komunikasi →
 * Keuangan → Akun → Sistem).
 */
type NavItem = { title: string; url: string; icon: typeof Home };
/**
 * `mobilePrimary` = tampil langsung di menu utama mobile. Group lain
 * disembunyikan di balik toggle "Lainnya" agar layar mobile tidak penuh.
 * Desktop selalu menampilkan semua group.
 */
const groups: { label: string; items: ReadonlyArray<NavItem>; mobilePrimary?: boolean }[] = [
  {
    label: "Utama",
    mobilePrimary: true,
    items: [
      { title: "Dasbor", url: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Operasional",
    mobilePrimary: true,
    items: [
      { title: "Gudang & Supplier", url: "/gudang", icon: Package },
      { title: "Request Order", url: "/request", icon: PackagePlus },
      { title: "Penyiapan Ecer", url: "/ecer", icon: Scale },
      { title: "POS Kasir", url: "/pos-kasir", icon: Calculator },
      { title: "Tugas Pegawai", url: "/tugas", icon: ClipboardList },
    ],
  },
  {
    label: "Komunikasi",
    mobilePrimary: true,
    items: [
      { title: "Chat", url: "/chat", icon: MessageCircle },
      { title: "Catatan", url: "/catatan", icon: NotebookPen },
      { title: "Balas Cepat", url: "/balas-cepat", icon: MessageSquarePlus },
      { title: "Buku Alamat", url: "/buku-alamat", icon: ContactRound },
      { title: "Notifikasi", url: "/notifikasi", icon: BellRing },
    ],
  },
  {
    label: "Pembayaran & Keuangan",
    mobilePrimary: true,
    items: [
      { title: "Hutang & Piutang", url: "/hutang-piutang", icon: Wallet },
    ],
  },
  {
    label: "Riwayat & Audit",
    items: [
      { title: "Audit Rute", url: "/audit", icon: ClipboardCheck },
      { title: "Diagnostik", url: "/diagnostics", icon: Activity },
    ],
  },
  {
    label: "Akun",
    items: [
      { title: "Beranda", url: "/", icon: Home },
      { title: "Profil Akun", url: "/profil", icon: User },
      { title: "Pengaturan", url: "/pengaturan", icon: Settings },
      { title: "Pengaturan Kunci", url: "/pengaturan-kunci", icon: Lock },
      { title: "Sesi & Perangkat", url: "/sesi", icon: MonitorSmartphone },
    ],
  },
  {
    label: "Sistem",
    items: [
      { title: "Antrian Email", url: "/email-queue", icon: Mail },
      { title: "Rilis APK", url: "/pengaturan-apk", icon: Package },
      { title: "Pratinjau Label", url: "/label-preview", icon: Tags },
      { title: "Log Penolakan Admin", url: "/admin-denial-log", icon: ShieldAlert },
      { title: "OAuth Google (BYOK)", url: "/pengaturan-oauth-google", icon: KeyRound },
    ],
  },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const { data: conversations } = useConversations();
  // Re-render saat override mode diubah di /pengaturan-app-mode.
  const [modeTick, setModeTick] = useState(0);
  useEffect(() => {
    const on = () => setModeTick((n) => n + 1);
    window.addEventListener("mcm:app-mode-change", on);
    return () => window.removeEventListener("mcm:app-mode-change", on);
  }, []);
  // Chat-only bisa berasal dari (a) build/localStorage flag, atau (b)
  // profil akun (`profiles.chat_only`) — pengguna yang mendaftar via
  // pilihan "Chat" hanya boleh melihat fitur komunikasi walaupun sedang
  // membuka build MCM Storage penuh.
  const [dbChatOnly, setDbChatOnly] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) return;
        const { data } = await supabase
          .from("profiles")
          .select("chat_only")
          .eq("id", uid)
          .maybeSingle();
        if (!cancelled) setDbChatOnly(Boolean(data?.chat_only));
      } catch {
        /* abaikan — fallback ke flag build */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const chatOnly = isChatOnly() || dbChatOnly;
  // Sampai status admin dipastikan (`isCheckingAdmin`), perlakukan sebagai
  // non-admin agar menu admin TIDAK berkedip muncul lalu hilang untuk user
  // biasa. Setelah query `has_role` selesai, sidebar akan diperbarui.
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const adminVisible = isAdmin && !isCheckingAdmin;
  const baseGroups = chatOnly
    ? groups.filter((g) => CHAT_ONLY_GROUP_LABELS.has(g.label))
    : groups;
  // Sembunyikan menu admin-only dari non-admin supaya mereka tidak jatuh ke
  // halaman kosong / runtime error saat memanggil server fn admin. Daftar
  // URL & fungsi filter di-share dengan harness E2E supaya kontraknya
  // tidak drift; lihat `src/lib/admin-sidebar-visibility.ts`.
  void ADMIN_ONLY_URLS;
  const visibleGroups = baseGroups
    .map((g) => ({
      ...g,
      items: filterSidebarItemsForAdmin(g.items, adminVisible),
    }))
    .filter((g) => g.items.length > 0);
  void modeTick;
  // Mobile: bagi group ke "primary" (langsung tampil) dan "secondary"
  // (masuk drawer "Lainnya"). Desktop / chat-only tetap merender semua
  // group berurutan seperti biasa.
  const [showMore, setShowMore] = useState(false);
  const primaryGroups = isMobile
    ? visibleGroups.filter((g) => g.mobilePrimary)
    : visibleGroups;
  const secondaryGroups = isMobile
    ? visibleGroups.filter((g) => !g.mobilePrimary)
    : [];
  const chatFetching = useIsFetching({ queryKey: ["chat", "conversations"] });
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    // Tandai waktu sinkron tiap kali fetch chat selesai
    if (chatFetching === 0) setLastSyncAt(Date.now());
  }, [chatFetching]);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const syncState: "offline" | "syncing" | "online" = !online
    ? "offline"
    : chatFetching > 0
      ? "syncing"
      : "online";
  const fmtAgo = (ts: number | null) => {
    if (!ts) return "belum pernah";
    const sec = Math.max(0, Math.floor((nowTick - ts) / 1000));
    if (sec < 5) return "baru saja";
    if (sec < 60) return `${sec} dtk lalu`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} mnt lalu`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} jam lalu`;
    const day = Math.floor(hr / 24);
    return `${day} hari lalu`;
  };
  const lastSyncLabel = fmtAgo(lastSyncAt);
  const lastSyncTitle = lastSyncAt
    ? `Terakhir sinkron: ${new Date(lastSyncAt).toLocaleString()}`
    : "Belum ada sinkronisasi";
  const syncMeta = {
    offline: { label: "Offline", Icon: WifiOff, cls: "bg-destructive/15 text-destructive border-destructive/30" },
    syncing: { label: "Menyinkronkan", Icon: RefreshCw, cls: "bg-primary/10 text-primary border-primary/25" },
    online:  { label: "Online", Icon: Wifi, cls: "bg-primary/12 text-primary border-primary/25" },
  }[syncState];
  const chatCounts = (() => {
    const list = conversations ?? [];
    let unread = 0;
    let archivedUnread = 0;
    for (const c of list) {
      const u = c.unread ?? 0;
      if (u <= 0) continue;
      if (c.archived_at) archivedUnread += u;
      else unread += u;
    }
    return { unread, archivedUnread };
  })();
  // Highlight mengikuti route aktif sepenuhnya — tidak terpengaruh search params
  // (mis. /ecer?item=…&highlight=…) maupun child route (mis. /chat/$id, /gudang/pesanan/$id).
  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    // exact match selalu menang
    if (pathname === path) return true;
    // fuzzy untuk child route bertingkat
    return !!matchRoute({ to: path, fuzzy: true });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader
        className="relative overflow-hidden border-b border-sidebar-border/50 px-ms-3 py-ms-4"
        style={{
          background:
            "linear-gradient(140deg, color-mix(in oklab, var(--primary) 10%, transparent) 0%, transparent 55%)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-3 bottom-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, color-mix(in oklab, var(--primary) 45%, transparent), transparent)",
          }}
        />
        <OrgHeader />
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {(() => {
          const renderGroup = (group: typeof visibleGroups[number], gi: number) => (
          <SidebarGroup key={group.label} className="px-ms-2 py-1.5">
            {gi > 0 ? (
              <SidebarSeparator className="mx-0 mb-1.5 group-data-[collapsible=icon]:hidden" />
            ) : null}
            <SidebarGroupLabel className="flex items-center gap-ms-2 px-ms-2 pb-1 text-ms-2xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              <span
                aria-hidden
                className="inline-block h-[3px] w-[3px] rounded-full"
                style={{ background: "color-mix(in oklab, var(--primary) 65%, transparent)" }}
              />
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className="group/nav relative h-10 overflow-hidden rounded-xl px-ms-2.5 font-medium text-sidebar-foreground/85 transition-all duration-200 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground hover:translate-x-0.5 data-[active=true]:bg-gradient-to-r data-[active=true]:from-primary/20 data-[active=true]:via-primary/8 data-[active=true]:to-transparent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-semibold data-[active=true]:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary)_22%,transparent)] before:absolute before:left-0 before:top-1/2 before:h-6 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-gradient-to-b before:from-primary before:to-primary/60 before:opacity-0 before:transition-opacity data-[active=true]:before:opacity-100"
                      >
                        <NavLinkItem
                          item={item}
                          isMobile={isMobile}
                          pathname={pathname}
                          setOpenMobile={setOpenMobile}
                          navigate={navigate}
                        >
                          <item.icon
                            className={
                              "h-[17px] w-[17px] shrink-0 transition-colors " +
                              (active
                                ? "text-primary"
                                : "text-muted-foreground group-hover/nav:text-sidebar-foreground")
                            }
                          />
                          <span className="truncate text-ms-sm tracking-[-0.005em]">
                            {item.title}
                          </span>
                          {item.url === "/chat" && (chatCounts.unread > 0 || chatCounts.archivedUnread > 0) ? (
                            <span className="ml-auto flex items-center gap-ms-1 group-data-[collapsible=icon]:hidden">
                              {chatCounts.unread > 0 ? (
                                <span
                                  title={`${chatCounts.unread} pesan belum dibaca`}
                                  className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-ms-2xs font-semibold leading-none text-primary-foreground"
                                >
                                  {chatCounts.unread > 99 ? "99+" : chatCounts.unread}
                                </span>
                              ) : null}
                              {chatCounts.archivedUnread > 0 ? (
                                <span
                                  title={`${chatCounts.archivedUnread} pesan belum dibaca di arsip`}
                                  className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent/60 px-1.5 text-ms-2xs font-medium leading-none text-muted-foreground"
                                >
                                  {chatCounts.archivedUnread > 99 ? "99+" : chatCounts.archivedUnread}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </NavLinkItem>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          );
          const nodes: React.ReactNode[] = [];
          primaryGroups.forEach((g, gi) => nodes.push(renderGroup(g, gi)));
          if (isMobile && secondaryGroups.length > 0) {
            nodes.push(
              <SidebarGroup key="__more__" className="px-ms-2 py-1.5">
                <SidebarSeparator className="mx-0 mb-1.5 group-data-[collapsible=icon]:hidden" />
                <button
                  type="button"
                  onClick={() => setShowMore((v) => !v)}
                  aria-expanded={showMore}
                  aria-controls="mcm-sidebar-more"
                  className="group/nav flex h-10 w-full min-w-0 items-center gap-ms-2 rounded-xl border border-sidebar-border/50 bg-sidebar-accent/25 px-ms-2.5 text-ms-sm font-medium text-sidebar-foreground/90 transition-colors hover:border-primary/30 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                >
                  <span
                    aria-hidden
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md ring-1 ring-primary/20"
                    style={{ background: "color-mix(in oklab, var(--primary) 12%, transparent)" }}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5 text-primary" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left tracking-[-0.005em]">Lainnya</span>
                  <span className="shrink-0 text-ms-2xs font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                    {showMore ? "Tutup" : "Buka"}
                  </span>
                  <ChevronDown
                    className={
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform " +
                      (showMore ? "rotate-180" : "")
                    }
                  />
                </button>
              </SidebarGroup>,
            );
            if (showMore) {
              nodes.push(
                <div key="__more_content__" id="mcm-sidebar-more">
                  {secondaryGroups.map((g, i) => renderGroup(g, i + 1))}
                </div>,
              );
            }
          }
          return nodes;
        })()}
      </SidebarContent>
      <SidebarFooter className="gap-ms-2 border-t border-sidebar-border/40 px-ms-2 pb-2 pt-2 group-data-[collapsible=icon]:hidden">
        <div
          title={
            syncState === "syncing"
              ? "Menyegarkan badge Aktif/Arsip…"
              : syncState === "offline"
                ? `Tidak ada koneksi — badge mungkin tertinggal. ${lastSyncTitle}`
                : lastSyncTitle
          }
          className="flex min-w-0 items-center justify-between gap-ms-2 rounded-xl border border-sidebar-border/50 bg-sidebar-accent/20 px-ms-2.5 py-1.5 text-ms-2xs font-medium backdrop-blur-sm"
        >
          <span className="flex min-w-0 items-center gap-ms-2">
            <span className="relative inline-flex h-2 w-2 shrink-0">
              <span
                className={
                  "absolute inset-0 rounded-full " +
                  (syncState === "online"
                    ? "bg-primary shadow-[0_0_8px_1px_color-mix(in_oklab,var(--primary)_60%,transparent)]"
                    : syncState === "syncing"
                      ? "bg-primary/80 animate-pulse"
                      : "bg-destructive")
                }
              />
              {syncState === "online" ? (
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/50" />
              ) : null}
            </span>
            <span
              className={
                (syncState === "online"
                  ? "text-primary"
                  : syncState === "syncing"
                    ? "text-primary/85"
                    : "text-destructive") + " truncate"
              }
            >
              {syncMeta.label}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-ms-1.5">
            <span className="truncate text-muted-foreground">
              {syncState === "syncing" ? "…" : lastSyncLabel}
            </span>
            <button
              type="button"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["chat", "conversations"] });
              }}
              disabled={syncState !== "online"}
              title={
                syncState === "offline"
                  ? "Tidak ada koneksi"
                  : syncState === "syncing"
                    ? "Sedang sinkronisasi…"
                    : "Sinkronkan ulang percakapan"
              }
              aria-label="Sinkronkan ulang percakapan"
              className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-sidebar-border/60 bg-background/40 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-background/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${syncState === "syncing" ? "animate-spin" : ""}`} />
            </button>
          </span>
        </div>
        <div className="rounded-xl border border-sidebar-border/40 bg-sidebar-accent/15 p-ms-1">
          <CompactModeToggle />
          <ReduceMotionToggle />
        </div>
        {!chatOnly && (
          <a
            href="/download#chat"
            className="group/chat relative mt-1 flex items-center gap-ms-2.5 overflow-hidden rounded-xl px-ms-2.5 py-ms-2 text-ms-2xs font-medium text-foreground transition-all hover:translate-y-[-1px]"
            style={{
              background:
                "linear-gradient(135deg, color-mix(in oklab, var(--primary) 18%, transparent), color-mix(in oklab, var(--primary) 6%, transparent))",
              boxShadow:
                "inset 0 0 0 1px color-mix(in oklab, var(--primary) 35%, transparent), 0 4px 12px -6px color-mix(in oklab, var(--primary) 40%, transparent)",
            }}
            title="Unduh MCM Chat — APK khusus komunikasi, akun sama"
          >
            <span
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-primary-foreground shadow-sm ring-1 ring-primary/30"
              style={{
                background:
                  "linear-gradient(135deg, var(--primary), color-mix(in oklab, var(--primary) 70%, black))",
              }}
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </span>
            <span className="flex-1 leading-tight">
              Coba <b className="tracking-tight">MCM Chat</b>
              <span className="mt-0.5 block text-ms-2xs font-normal text-muted-foreground">APK khusus chat · akun sama</span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-primary/70 transition-transform group-hover/chat:translate-x-0.5" />
          </a>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}