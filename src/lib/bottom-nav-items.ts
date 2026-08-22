import { Home, Warehouse, PackageSearch, MessageCircle } from "lucide-react";

/**
 * Sumber tunggal urutan & label tab bar bawah.
 *
 * Dipakai oleh `MobileBottomNav` (area aplikasi) dan `ChatBottomNav`
 * (area Ace Chat) supaya urutan dan labelnya identik di semua halaman:
 * Beranda → Gudang → Ecer → Chat → Menu.
 */
export type BottomNavItem = {
  to: "/" | "/gudang" | "/ecer" | "/chat";
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

export const BOTTOM_NAV_ITEMS: readonly BottomNavItem[] = [
  { to: "/", label: "Beranda", Icon: Home },
  { to: "/gudang", label: "Gudang", Icon: Warehouse },
  { to: "/ecer", label: "Ecer", Icon: PackageSearch },
  { to: "/chat", label: "Chat", Icon: MessageCircle },
] as const;

/** Cocokkan pathname ke tab aktif (persis untuk "/", prefix segmen untuk lainnya). */
export function activeBottomNavTo(path: string): BottomNavItem["to"] | undefined {
  if (path === "/") return "/";
  return BOTTOM_NAV_ITEMS.find(
    (it) => it.to !== "/" && (path === it.to || path.startsWith(`${it.to}/`)),
  )?.to;
}
