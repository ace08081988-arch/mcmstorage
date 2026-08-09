import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Phone, Bell, LayoutGrid } from "lucide-react";
import { useMemo, useRef } from "react";
import { useUnreadStatus } from "@/lib/chat";
import { useBottomNavHeightSync } from "@/lib/use-bottom-nav-height";
import { useViewportAnchor } from "@/lib/use-viewport-anchor";
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
  // Bar bawah diposisikan dengan CSS `fixed bottom-0` dan dikompensasi
  // ke visual viewport lewat class `.app-static-bottom-bar`
  // (`translate3d(0, -var(--vv-anchor-offset-lock), 0)`). Kompensasi ini
  // mencegah bar terdorong keluar layar atau terlihat naik-turun saat
  // address bar Chrome / WebView mengembang-menciut saat scroll.
  // Hook tetap dipanggil untuk menjalankan engine pengukuran & status keyboard.
  const { keyboardOpen } = useViewportAnchor({ lock: true });
  const navRef = useRef<HTMLElement | null>(null);
  useBottomNavHeightSync(navRef);
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
      ref={navRef}
      aria-label="Navigasi utama chat"
      // Fixed di viewport bawah supaya tidak "goyang" ikut scroll pada
      // Android WebView dengan dynamic viewport (URL-bar auto-hide).
      // `--chat-nav-h` tetap diekspos untuk FAB & spacer content.
      // `--chat-nav-h` diwarisi dari container route (lihat masing-masing
      // route chat). Fallback lokal disediakan bila nav dipakai tanpa
      // container yang menyetel variabel tersebut. Nilai sudah mencakup
      // `var(--app-safe-bottom, env(safe-area-inset-bottom, 0px))` untuk notch/home indicator iOS.
      className="app-static-bottom-bar fixed inset-x-0 bottom-0 mx-auto grid max-w-2xl grid-cols-4 items-end border-t bg-[var(--wa-header)]/95 backdrop-blur [--chat-nav-h:calc(var(--ms-tap)+1.25rem+var(--app-safe-bottom, env(safe-area-inset-bottom, 0px)))]"
      style={{
        transition: "opacity 160ms ease-out",
        opacity: keyboardOpen ? 0 : 1,
        pointerEvents: keyboardOpen ? "none" : undefined,
        visibility: keyboardOpen ? "hidden" : "visible",
      }}
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
              // px-0.5 di base → cukup ruang untuk label "Pembaruan" pada
              // 360px tanpa memotong; naik ke px-1 mulai 400px.
              "group/tab relative flex min-h-[var(--ms-tap)] flex-col items-center justify-center gap-ms-1 px-0.5 py-1 outline-none transition-colors duration-200 min-[400px]:px-1",
              "focus-visible:ring-2 focus-visible:ring-[var(--wa-green)]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--wa-header)]",
              active ? "text-[var(--wa-green)]" : "text-[var(--wa-text-muted)] hover:text-[var(--wa-text)]",
            )}
          >
            <span
              aria-hidden="true"
              data-nav-icon
              className={cn(
                // Lebar pill ikon menyempit di 360px supaya keempat kolom
                // tidak berdesakan; melebar lagi mulai 400px.
                "relative grid h-7 w-10 place-items-center rounded-full transition-[background-color,transform] duration-200 min-[400px]:w-12",
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
                  className="absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-ms-2xs font-semibold leading-none text-destructive-foreground ring-2 ring-[var(--wa-header)]"
                  aria-hidden="true"
                >
                  {badge > 99 ? "99+" : badge}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden="true"
              data-nav-label
              className={cn(
                "w-full min-w-0 truncate text-center text-ms-2xs leading-ms-tight tracking-ms-tight",
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