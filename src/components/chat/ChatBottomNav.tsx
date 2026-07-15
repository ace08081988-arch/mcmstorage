import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Phone, Bell, LayoutGrid } from "lucide-react";
import { useUnreadStatus } from "@/lib/chat";
import { cn } from "@/lib/utils";

type Item = {
  to: "/chat" | "/panggilan" | "/pembaruan" | "/fitur";
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  badgeLoading?: boolean;
};

/**
 * Bottom navigation ala WhatsApp untuk area chat.
 * Chat / Panggilan / Pembaruan / Fitur — sticky di bawah, hormati safe-area iOS.
 *
 * Layout pakai grid 4 kolom sama rata supaya label panjang seperti
 * "Panggilan" dan "Pembaruan" tidak saling tumpang tindih di 390/411px.
 * Setiap label di-truncate dan setiap tab memiliki min tap target 44px.
 */
export function ChatBottomNav() {
  const { count: unread, isLoading: unreadLoading } = useUnreadStatus();
  // Ambil pathname saja lewat selector; scroll / hash / state lain tidak
  // memicu re-render, sehingga highlight tidak "berkedip" saat konten digulir.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items: Item[] = [
    { to: "/chat", label: "Chat", Icon: MessageCircle, badge: unread, badgeLoading: unreadLoading },
    { to: "/panggilan", label: "Panggilan", Icon: Phone },
    { to: "/pembaruan", label: "Pembaruan", Icon: Bell },
    { to: "/fitur", label: "Fitur", Icon: LayoutGrid },
  ];
  // Hitung item aktif sekali per perubahan path. Menghindari kondisi di mana
  // `startsWith` mem-match prefix yang tumpang-tindih (mis. "/panggilan"
  // vs "/panggilan-baru"): kita cocokkan persis atau segmen `${to}/`.
  const activeTo = useMemo(() => {
    const match = items.find(
      (it) => path === it.to || path.startsWith(`${it.to}/`),
    );
    return match?.to;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const activeIndex = activeTo ? items.findIndex((it) => it.to === activeTo) : -1;

  return (
    <nav
      aria-label="Navigasi utama chat"
      className="relative sticky bottom-0 z-20 mt-auto grid shrink-0 grid-cols-4 items-end border-t bg-[var(--wa-header)]/95 backdrop-blur"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.25rem)" }}
    >
      {/* Indikator aktif — pill halus yang meluncur di bawah ikon aktif. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-1 left-0 h-1 rounded-full transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          activeIndex >= 0 ? "opacity-100" : "opacity-0",
        )}
        style={{
          width: "25%",
          transform: `translateX(calc(${Math.max(activeIndex, 0)} * 100%))`,
          background:
            "linear-gradient(90deg, color-mix(in oklab, var(--wa-green) 70%, transparent), color-mix(in oklab, var(--wa-green) 40%, transparent))",
        }}
      />
      {items.map(({ to, label, Icon, badge, badgeLoading }) => {
        const active = activeTo === to;
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? "page" : undefined}
            aria-label={
              badgeLoading
                ? `${label}, memuat jumlah belum dibaca`
                : badge && badge > 0
                  ? `${label}, ${badge} belum dibaca`
                  : label
            }
            className={cn(
              "group/tab relative flex min-h-[var(--ms-tap)] flex-col items-center justify-center gap-0.5 px-1 py-1 outline-none transition-colors duration-200",
              "focus-visible:ring-2 focus-visible:ring-[var(--wa-green)]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--wa-header)]",
              active ? "text-[var(--wa-green)]" : "text-[var(--wa-text-muted)] hover:text-[var(--wa-text)]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "relative grid h-7 w-12 place-items-center rounded-full transition-[background-color,transform] duration-200",
                active ? "bg-[var(--wa-green)]/15 scale-100" : "bg-transparent scale-95 group-hover/tab:scale-100",
              )}
            >
              <Icon className="h-5 w-5" />
              {badgeLoading ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-0.5 -top-0.5 block h-4 min-w-[16px] animate-pulse rounded-full bg-[var(--wa-text-muted)]/40 ring-2 ring-[var(--wa-header)] motion-reduce:animate-none"
                />
              ) : badge && badge > 0 ? (
                <span
                  className="absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-ms-2xs font-semibold text-white ring-2 ring-[var(--wa-header)]"
                  aria-hidden="true"
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "w-full min-w-0 truncate text-center text-ms-2xs leading-tight",
                active ? "font-semibold" : "font-normal",
              )}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}