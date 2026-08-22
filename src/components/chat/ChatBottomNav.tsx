import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Phone, Home, Warehouse, Menu } from "lucide-react";
import { useMemo, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { useUnreadStatus } from "@/lib/chat";
import { useBottomNavHeightSync } from "@/lib/use-bottom-nav-height";
import { useViewportAnchor } from "@/lib/use-viewport-anchor";
import { cn } from "@/lib/utils";

type Item = {
  to: "/chat" | "/panggilan" | "/" | "/gudang";
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
  const { toggleSidebar } = useSidebar();
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
  // Keyboard terbuka -> bar hilang, spacer harus 0 (tanpa dead-space).
  useBottomNavHeightSync(navRef, !keyboardOpen);
  // Baris bawah berisi tujuan yang paling sering dipakai harian: chat,
  // panggilan, lalu jalan pintas keluar dari area chat (Beranda & Gudang)
  // supaya tidak perlu bolak-balik lewat drawer. "Pembaruan" dan "Fitur"
  // tetap tersedia lewat tombol Menu.
  const items: Item[] = [
    { to: "/chat", label: "Chat", Icon: MessageCircle, badge: unread, badgeLoading: unreadLoading },
    { to: "/panggilan", label: "Panggilan", Icon: Phone },
    { to: "/", label: "Beranda", Icon: Home },
    { to: "/gudang", label: "Gudang", Icon: Warehouse },
  ];
  // Hitung item aktif sekali per perubahan path. Menghindari kondisi di mana
  // `startsWith` mem-match prefix yang tumpang-tindih (mis. "/panggilan"
  // vs "/panggilan-baru"): kita cocokkan persis atau segmen `${to}/`.
  const activeTo = useMemo(() => {
    const match = items.find((it) =>
      it.to === "/" ? path === "/" : path === it.to || path.startsWith(`${it.to}/`),
    );
    return match?.to;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

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
      // `var(--app-safe-bottom,env(safe-area-inset-bottom,0px))` untuk notch/home indicator iOS.
      // Latar solid (tanpa transparansi/blur) supaya konten yang lewat di
      // baliknya tidak "menembus" bar dan kontras label tetap konsisten.
      className="app-static-bottom-bar fixed inset-x-0 bottom-0 mx-auto grid max-w-2xl grid-cols-5 items-stretch border-t border-[var(--wa-border)] bg-[var(--wa-header)] [--chat-nav-h:calc(var(--ms-tap)+1.25rem+var(--app-safe-bottom,env(safe-area-inset-bottom,0px)))]"
      style={{
        transition: "opacity 160ms ease-out",
        opacity: keyboardOpen ? 0 : 1,
        pointerEvents: keyboardOpen ? "none" : undefined,
        visibility: keyboardOpen ? "hidden" : "visible",
      }}
    >
      {/* Tanpa indikator meluncur: status aktif cukup ditandai pill + warna
          ikon/label, sehingga bar terasa tenang dan tidak "berlari". */}
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
              "group/tab relative flex min-h-11 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 outline-none transition-colors duration-200 min-[400px]:px-1",
              "focus-visible:ring-2 focus-visible:ring-[var(--wa-green)]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--wa-header)]",
              active
                ? "text-[var(--wa-green)]"
                : "text-[var(--wa-text-muted)] hover:text-[var(--wa-text)]",
            )}
          >
            <span
              aria-hidden="true"
              data-nav-icon
              className={cn(
                // Pill ikon ringan; tanpa animasi skala supaya bar terasa
                // tenang dan tidak "berdenyut" saat berpindah tab.
                "relative grid h-6 w-10 place-items-center rounded-full transition-colors duration-200 min-[400px]:w-12",
                active ? "bg-[var(--wa-green)]/12" : "bg-transparent",
              )}
            >
              <Icon className="h-[22px] w-[22px]" />
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
                "w-full min-w-0 truncate text-center text-ms-xs leading-ms-tight tracking-ms-tight",
                active ? "font-semibold" : "font-normal",
              )}
            >
              {label}
            </span>
          </Link>
        );
      })}
      {/* Tab ke-5: keluar dari area chat. Tap = buka menu utama aplikasi
          (Beranda/Gudang/Ecer/dll) tanpa harus menekan tombol kembali
          berkali-kali. Ini menghilangkan "jebakan" area chat di HP. */}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Keluar dari chat, buka menu utama aplikasi"
        className={cn(
          "group/tab relative flex min-h-11 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 outline-none transition-colors duration-200 min-[400px]:px-1",
          "focus-visible:ring-2 focus-visible:ring-[var(--wa-green)]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--wa-header)]",
          "text-[var(--wa-text-muted)] hover:text-[var(--wa-text)]",
        )}
      >
        <span
          aria-hidden="true"
          data-nav-icon
          className="relative grid h-6 w-10 place-items-center rounded-full transition-colors duration-200 min-[400px]:w-12"
        >
          <Menu className="h-[22px] w-[22px]" />
        </span>
        <span
          aria-hidden="true"
          data-nav-label
          className="w-full min-w-0 truncate text-center text-ms-xs font-normal leading-ms-tight tracking-ms-tight"
        >
          Menu
        </span>
      </button>
    </nav>
  );
}
