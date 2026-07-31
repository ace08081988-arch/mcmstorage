import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Warehouse, PackageSearch, MessageCircle, Menu } from "lucide-react";
import { useMemo } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { useUnreadStatus } from "@/lib/chat";
import { useViewportAnchor } from "@/lib/use-viewport-anchor";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation premium untuk mobile. Menampilkan 4 rute inti + tombol
 * "Menu" yang membuka sidebar drawer (menu sekunder). Sembunyi otomatis di
 * >= md karena desktop pakai sidebar penuh.
 *
 * Palet Noir & Gold: latar hitam pekat, aksen emas (primary), safe-area
 * bawah untuk iOS/Android gesture bar.
 */
type Item = {
  to: "/" | "/gudang" | "/ecer" | "/chat";
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  badgeLoading?: boolean;
};

export function MobileBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { count: unread, isLoading: unreadLoading } = useUnreadStatus();
  const { toggleSidebar } = useSidebar();
  // Bar bawah diposisikan murni dengan CSS `fixed bottom-0` supaya tidak
  // bergerak/terasa lag mengikuti perhitungan JS. Kompensasi visual viewport
  // dihentikan untuk elemen ini; hanya status keyboard tetap dipantau agar
  // bar bisa disembunyikan saat keyboard virtual terbuka.
  // `anchorStyle` (mode lock) hanya mengompensasi pergerakan address bar
  // browser — nilainya dihaluskan per-frame di engine sehingga bar tidak
  // terlihat loncat saat address bar mengembang/menciut.
  const { keyboardOpen, anchorStyle } = useViewportAnchor({ lock: true });

  // Area MCM Chat (Chat/Panggilan/Pembaruan/Fitur) sudah punya bottom nav
  // sendiri (ChatBottomNav) dengan sub-tab yang tidak tersedia di sini.
  // Sembunyikan bottom nav global agar tidak menutupi sub-tab tersebut.
  // Semua hook dipanggil sebelum early-return (React error #310 kalau tidak).
  const activeTo = useMemo(() => {
    // "/" cocokkan persis, rute lain gunakan prefix segmen.
    if (path === "/") return "/" as const;
    const hit = (["/gudang", "/ecer", "/chat"] as const).find(
      (to) => path === to || path.startsWith(`${to}/`),
    );
    return hit;
  }, [path]);

  const hideOnChatFamily =
    path === "/chat" ||
    path.startsWith("/chat/") ||
    path === "/panggilan" ||
    path.startsWith("/panggilan/") ||
    path === "/pembaruan" ||
    path.startsWith("/pembaruan/") ||
    path === "/fitur" ||
    path.startsWith("/fitur/");
  if (hideOnChatFamily) return null;

  const items: Item[] = [
    { to: "/", label: "Beranda", Icon: Home },
    { to: "/gudang", label: "Gudang", Icon: Warehouse },
    { to: "/ecer", label: "Ecer", Icon: PackageSearch },
    { to: "/chat", label: "Chat", Icon: MessageCircle, badge: unread, badgeLoading: unreadLoading },
  ];

  // Index tab aktif untuk menggerakkan indikator "pill" bergeser mulus.
  // 5 slot total (4 link + tombol Menu). Bila rute saat ini tidak
  // termasuk 4 tab utama (mis. /dashboard, /hutang-piutang, /catatan,
  // /tugas, /pos-kasir, /pengaturan-*, dll.), indikator meluncur ke
  // slot "Menu" supaya user tahu halaman aktif berasal dari drawer.
  const menuActive = !activeTo && path !== "/";
  const primaryIndex = activeTo ? items.findIndex((it) => it.to === activeTo) : -1;
  const slotCount = items.length + 1; // +1 untuk tombol "Menu"
  const activeIndex = primaryIndex >= 0 ? primaryIndex : menuActive ? items.length : -1;

  return (
    <nav
      aria-label="Navigasi utama"
      className={cn(
        // z-index & padding safe-area diatur lewat `.app-static-bottom-bar`
        // (skala tunggal di styles.css) supaya bar tidak pernah tertutup
        // toolbar browser, FAB, atau notifikasi.
        "fixed inset-x-0 bottom-0 md:hidden",
        "app-static-bottom-bar",
        "border-t border-primary/15",
        "bg-background/92 backdrop-blur-xl supports-[backdrop-filter]:bg-background/78",
      )}
      style={{
        ...anchorStyle,
        transition: "opacity 160ms ease-out",
        opacity: keyboardOpen ? 0 : 1,
        pointerEvents: keyboardOpen ? "none" : undefined,
        visibility: keyboardOpen ? "hidden" : "visible",
        boxShadow: "0 -8px 24px -12px color-mix(in oklab, var(--primary) 22%, transparent)",
      }}
    >
      <div className="relative mx-auto flex max-w-md items-stretch justify-around px-1 pt-1.5">
        {/* Indikator pill yang meluncur antar tab. Menggunakan transform
            supaya GPU-accelerated dan mulus di WebView Android. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-0 top-1.5 h-8 rounded-full",
            "transition-[transform,opacity,width] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            "motion-reduce:transition-none",
            activeIndex >= 0 ? "opacity-100" : "opacity-0",
          )}
          style={{
            width: `calc((100% - 0.5rem) / ${slotCount})`,
            transform: `translateX(calc(0.25rem + ${Math.max(activeIndex, 0)} * 100%))`,
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--primary) 18%, transparent), color-mix(in oklab, var(--primary) 8%, transparent))",
            boxShadow:
              "inset 0 0 0 1px color-mix(in oklab, var(--primary) 30%, transparent), 0 4px 12px -6px color-mix(in oklab, var(--primary) 45%, transparent)",
          }}
        />
        {items.map(({ to, label, Icon, badge, badgeLoading }) => {
          const active = activeTo === to;
          // Saat Chat punya unread, langsung buka /chat dengan filter "Belum
          // dibaca" aktif — mengetuk tab (atau badge di dalamnya) memfokuskan
          // user ke daftar pesan yang belum dibaca, bukan campur semua chat.
          const chatUnreadFocus = to === "/chat" && (badge ?? 0) > 0;
          return (
            <Link
              key={to}
              to={to}
              search={chatUnreadFocus ? { filter: "unread" } : undefined}
              aria-current={active ? "page" : undefined}
              aria-label={
                badgeLoading
                  ? `${label}, memuat jumlah belum dibaca`
                  : badge && badge > 0
                    ? `${label}, ${badge} belum dibaca`
                    : label
              }
              className={cn(
                "group/tab relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[0.65625rem] leading-tight transition-colors duration-300 active:scale-[0.96] motion-reduce:active:scale-100",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span
                aria-hidden
                data-nav-icon
                className={cn(
                  "relative grid h-8 w-14 place-items-center rounded-full transition-transform duration-300 ease-out",
                  active ? "-translate-y-0.5 scale-105" : "scale-100",
                  "motion-reduce:transform-none motion-reduce:transition-none",
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] transition-transform duration-300 ease-out",
                    active ? "drop-shadow-[0_2px_6px_color-mix(in_oklab,var(--primary)_55%,transparent)]" : "",
                    "motion-reduce:transition-none",
                  )}
                />
                {badgeLoading ? (
                  // Placeholder saat data unread masih dimuat pertama kali.
                  // Bentuk pill kecil dengan shimmer halus supaya slot badge
                  // tidak "kosong-lalu-loncat" begitu angka datang. Warna
                  // pakai muted supaya tidak menyaingi badge merah asli.
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -right-0.5 -top-0.5 block h-4 min-w-[16px] animate-pulse rounded-full bg-muted/70 ring-2 ring-background motion-reduce:animate-none"
                  />
                ) : badge && badge > 0 ? (
                  <span className="pointer-events-none absolute -right-0.5 -top-0.5">
                    {/* Halo pulse — beri kesan hidup tanpa menggeser layout.
                        `motion-reduce:hidden` menghormati preferensi user. */}
                    <span
                      aria-hidden
                      className="absolute inset-0 -z-10 animate-ping rounded-full bg-destructive/60 motion-reduce:hidden"
                    />
                    <span className="relative inline-flex min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[0.59375rem] font-semibold leading-none text-destructive-foreground shadow">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  </span>
                ) : null}
              </span>
              <span
                data-nav-label
                className={cn(
                  "transition-all duration-300 ease-out tracking-tight",
                  active ? "font-semibold opacity-100" : "font-normal opacity-80",
                  "motion-reduce:transition-none",
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={
            unreadLoading && activeTo !== "/chat"
              ? "Buka menu, memuat jumlah chat belum dibaca"
              : unread > 0 && activeTo !== "/chat"
                ? `Buka menu, ${unread} chat belum dibaca`
                : "Buka menu"
          }
          aria-current={menuActive ? "page" : undefined}
          className={cn(
            "relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[0.65625rem] leading-tight text-muted-foreground transition-colors duration-300 active:scale-[0.96] motion-reduce:active:scale-100",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            menuActive && "text-primary",
          )}
        >
          <span
            aria-hidden
            data-nav-icon
            className={cn(
              "grid h-8 w-14 place-items-center rounded-full bg-transparent transition-transform duration-300 ease-out",
              menuActive ? "-translate-y-0.5 scale-105" : "scale-100",
              "motion-reduce:transform-none motion-reduce:transition-none",
            )}
          >
            <Menu
              className={cn(
                "h-[18px] w-[18px] transition-transform duration-300 ease-out",
                menuActive
                  ? "drop-shadow-[0_2px_6px_color-mix(in_oklab,var(--primary)_55%,transparent)]"
                  : "",
                "motion-reduce:transition-none",
              )}
            />
            {/* Badge chat belum dibaca — muncul di ikon Menu HANYA saat user
                sedang tidak berada di tab Chat, supaya sinyal tetap terlihat
                meski notifikasi ada di rute lain (mis. /notifikasi, /tugas).
                Angka dihilangkan (dot-only) supaya tidak duplikat visual
                dengan badge di tab Chat itu sendiri. */}
            {unreadLoading && activeTo !== "/chat" ? (
              <span className="pointer-events-none absolute -right-0.5 -top-0.5">
                <span
                  aria-hidden
                  className="block h-2.5 w-2.5 animate-pulse rounded-full bg-muted/70 ring-2 ring-background motion-reduce:animate-none"
                />
              </span>
            ) : unread > 0 && activeTo !== "/chat" ? (
              <span className="pointer-events-none absolute -right-0.5 -top-0.5">
                <span
                  aria-hidden
                  className="absolute inset-0 -z-10 animate-ping rounded-full bg-destructive/60 motion-reduce:hidden"
                />
                <span className="relative block h-2.5 w-2.5 rounded-full bg-destructive shadow ring-2 ring-background" />
              </span>
            ) : null}
          </span>
          <span
            data-nav-label
            className={cn(
              "transition-all duration-300 ease-out tracking-tight",
              menuActive ? "font-semibold opacity-100" : "font-normal opacity-80",
              "motion-reduce:transition-none",
            )}
          >
            Menu
          </span>
        </button>
      </div>
    </nav>
  );
}