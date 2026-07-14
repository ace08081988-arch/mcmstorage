import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Warehouse, PackageSearch, MessageCircle, Menu } from "lucide-react";
import { useMemo } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { useUnreadTotal } from "@/lib/chat";
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
};

export function MobileBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const unread = useUnreadTotal();
  const { toggleSidebar } = useSidebar();

  const items: Item[] = [
    { to: "/", label: "Beranda", Icon: Home },
    { to: "/gudang", label: "Gudang", Icon: Warehouse },
    { to: "/ecer", label: "Ecer", Icon: PackageSearch },
    { to: "/chat", label: "Chat", Icon: MessageCircle, badge: unread },
  ];

  const activeTo = useMemo(() => {
    // "/" cocokkan persis, rute lain gunakan prefix segmen.
    if (path === "/") return "/" as const;
    const hit = items.slice(1).find(
      (it) => path === it.to || path.startsWith(`${it.to}/`),
    );
    return hit?.to;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

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
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "border-t border-primary/15",
        "bg-background/92 backdrop-blur-xl supports-[backdrop-filter]:bg-background/78",
      )}
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 0.25rem)",
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
        {items.map(({ to, label, Icon, badge }) => {
          const active = activeTo === to;
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              aria-label={badge && badge > 0 ? `${label}, ${badge} belum dibaca` : label}
              className={cn(
                "group/tab relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[10.5px] leading-tight transition-colors duration-300 active:scale-[0.96] motion-reduce:active:scale-100",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span
                aria-hidden
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
                {badge && badge > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9.5px] font-semibold leading-none text-destructive-foreground shadow">
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </span>
              <span
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
          aria-label="Buka menu"
          aria-current={menuActive ? "page" : undefined}
          className={cn(
            "relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[10.5px] leading-tight text-muted-foreground transition-colors duration-300 active:scale-[0.96] motion-reduce:active:scale-100",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            menuActive && "text-primary",
          )}
        >
          <span
            aria-hidden
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
          </span>
          <span
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