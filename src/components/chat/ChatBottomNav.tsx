import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Phone, Bell, LayoutGrid } from "lucide-react";
import { useMemo } from "react";
import { useUnreadTotal } from "@/lib/chat";

type Item = {
  to: "/chat" | "/panggilan" | "/pembaruan" | "/fitur";
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  badge?: number;
};

/**
 * Bottom navigation ala WhatsApp untuk area chat.
 * Chat / Panggilan / Pembaruan / Fitur — sticky di bawah, hormati safe-area iOS.
 */
export function ChatBottomNav() {
  const unread = useUnreadTotal();
  // Ambil pathname saja lewat selector; scroll / hash / state lain tidak
  // memicu re-render, sehingga highlight tidak "berkedip" saat konten digulir.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items: Item[] = [
    { to: "/chat", label: "Chat", Icon: MessageCircle, badge: unread },
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
      {items.map(({ to, label, Icon, badge }) => {
        const active = activeTo === to;
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? "page" : undefined}
            className={
              "relative flex flex-1 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[11px] leading-snug transition " +
              (active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <span
              className={
                "grid h-7 w-14 place-items-center rounded-full transition " +
                (active ? "bg-primary/15" : "")
              }
            >
              <Icon className="h-5 w-5" />
              {badge && badge > 0 ? (
                <span
                  className="absolute right-[calc(50%-1.75rem)] top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white"
                  aria-label={`${badge} belum dibaca`}
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </span>
            <span className={active ? "font-semibold" : ""}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}