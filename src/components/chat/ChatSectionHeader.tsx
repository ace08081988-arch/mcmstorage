import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { goBackOr } from "@/lib/back-nav";
import { cn } from "@/lib/utils";

type Props = {
  /** Judul halaman (satu baris, otomatis truncate di layar sempit). */
  title: string;
  /** Tampilkan tombol kembali. Default: true. */
  showBack?: boolean;
  /** Tujuan fallback saat tidak ada riwayat. Default: "/chat". */
  fallbackTo?: string;
  /** Tombol aksi di sisi kanan. */
  actions?: React.ReactNode;
  /** Baris tambahan di bawah judul (pencarian, chip filter, dsb). */
  children?: React.ReactNode;
  className?: string;
};

/**
 * Header seragam untuk seluruh menu area chat (Chat, Panggilan, Pembaruan,
 * Fitur, Daftar, Sesi, Pengaturan, dst).
 *
 * Tujuannya menghilangkan kesan "pindah menu = pindah aplikasi":
 * - permukaan, tinggi, dan ukuran judul sama di semua halaman
 * - tombol kembali selalu di posisi yang sama (kiri, tap target 44px)
 * - safe-area notch dihormati sehingga judul tidak pernah terpotong
 */
export function ChatSectionHeader({
  title,
  showBack = true,
  fallbackTo = "/chat",
  actions,
  children,
  className,
}: Props) {
  const router = useRouter();
  return (
    <div
      className={cn(
        "wa-header sticky top-0 z-30 border-b border-[var(--wa-border)]",
        className,
      )}
      style={{ paddingTop: "var(--app-safe-top, env(safe-area-inset-top, 0px))" }}
    >
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-ms-2 px-ms-2 py-ms-2">
        {showBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 touch-manipulation rounded-full"
            aria-label="Kembali"
            onClick={() => goBackOr(router, { to: fallbackTo as "/chat" })}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        ) : (
          <span className="w-ms-1" aria-hidden />
        )}
        <h1 className="truncate text-ms-lg font-semibold tracking-tight">{title}</h1>
        <div className="flex shrink-0 items-center gap-ms-1 justify-self-end">{actions}</div>
      </header>
      {children}
    </div>
  );
}
