import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Phone, Bell, LayoutGrid } from "lucide-react";
import { useMemo } from "react";
import { useUnreadStatus } from "@/lib/chat";

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
  return (
    <nav
      aria-label="Navigasi utama chat"
      className="sticky bottom-0 z-20 mt-auto flex shrink-0 items-stretch justify-around border-t bg-background/95 backdrop-blur px-1 pt-1"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.25rem)" }}
    >
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
            className={
              "relative flex flex-1 flex-col items-center gap-0.5 rounded-lg px-ms-2 py-1.5 text-ms-2xs leading-snug transition-colors duration-300 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
              (active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <span
              aria-hidden="true"
              className={
                "grid h-7 w-14 place-items-center rounded-full transition-[background-color,transform] duration-300 ease-out " +
                (active ? "bg-primary/15 scale-100" : "bg-transparent scale-95")
              }
            >
              <Icon className="h-5 w-5" />
              {badgeLoading ? (
                <span
                  aria-hidden="true"
                  className="absolute right-[calc(50%-1.75rem)] top-0.5 block h-4 min-w-[16px] animate-pulse rounded-full bg-muted/70 ring-2 ring-background motion-reduce:animate-none"
                />
              ) : badge && badge > 0 ? (
                <span
                  className="absolute right-[calc(50%-1.75rem)] top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-ms-2xs font-semibold text-white"
                  aria-hidden="true"
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </span>
            <span aria-hidden="true" className={active ? "font-semibold" : ""}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}