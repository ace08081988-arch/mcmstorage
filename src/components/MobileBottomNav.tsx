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
      <div className="mx-auto flex max-w-md items-stretch justify-around px-1 pt-1.5">
        {items.map(({ to, label, Icon, badge }) => {
          const active = activeTo === to;
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              aria-label={badge && badge > 0 ? `${label}, ${badge} belum dibaca` : label}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[10.5px] leading-tight transition-colors duration-300",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "relative grid h-8 w-14 place-items-center rounded-full transition-all duration-300 ease-out",
                  active
                    ? "bg-primary/12 ring-1 ring-primary/25"
                    : "bg-transparent",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {badge && badge > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9.5px] font-semibold leading-none text-destructive-foreground shadow">
                    {badge > 99 ? "99+" : badge}
                  </span>
                ) : null}
              </span>
              <span className={active ? "font-semibold tracking-tight" : "tracking-tight"}>
                {label}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Buka menu"
          className={cn(
            "relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 text-[10.5px] leading-tight text-muted-foreground transition-colors duration-300",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <span
            aria-hidden
            className="grid h-8 w-14 place-items-center rounded-full bg-transparent"
          >
            <Menu className="h-[18px] w-[18px]" />
          </span>
          <span className="tracking-tight">Menu</span>
        </button>
      </div>
    </nav>
  );
}