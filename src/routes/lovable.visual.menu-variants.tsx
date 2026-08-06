/**
 * Harness visual untuk SELURUH variasi menu aplikasi.
 *
 * Tujuan: mengunci warna & gaya menu (token semantik Noir & Gold) supaya
 * perubahan CSS/tema tidak membuat menu kembali tidak konsisten antar
 * permukaan (sidebar, bottom nav utama, bottom nav chat, pill tabs).
 *
 * Komponen yang dirender adalah komponen ASLI aplikasi (PillsTabs,
 * SidebarMenuButton + class SSOT dari `menu-item-classes`,
 * MobileBottomNav, ChatBottomNav) — bukan salinan markup — sehingga
 * regresi tema langsung tertangkap.
 *
 * Query param:
 *   ?theme=light|dark   → set class `dark` di <html>.
 *   ?nav=main|chat      → pilih bottom nav yang dirender (keduanya fixed).
 *
 * Marker DOM untuk spec:
 *   [data-menu-shot="sidebar"|"pills"|"bottom-nav"]
 *   [data-menu-item][data-menu-surface][data-menu-state="active"|"idle"]
 *   [data-menu-label] / [data-menu-badge]
 *
 * URL: /lovable/visual/menu-variants — noindex, tanpa auth.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Home, Warehouse, PackageSearch, MessageCircle, Boxes, Tags } from "lucide-react";
import {
  SidebarProvider,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_NAV_ITEM_CLASS,
  sidebarNavIconClass,
  sidebarNavLabelClass,
} from "@/components/shell/menu-item-classes";
import { PillsTabs } from "@/components/shell/PillsTabs";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { ChatBottomNav } from "@/components/chat/ChatBottomNav";

type Search = { theme?: "light" | "dark"; nav?: "main" | "chat" };

export const Route = createFileRoute("/lovable/visual/menu-variants")({
  validateSearch: (raw: Record<string, unknown>): Search => ({
    theme: raw["theme"] === "dark" ? "dark" : "light",
    nav: raw["nav"] === "chat" ? "chat" : "main",
  }),
  head: () => ({
    meta: [
      { title: "Audit Visual Menu — Ace" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: MenuVariantsHarness,
});

const SIDEBAR_ITEMS = [
  { title: "Beranda", icon: Home },
  { title: "Gudang", icon: Warehouse },
  { title: "Ecer", icon: PackageSearch },
  { title: "Chat", icon: MessageCircle },
] as const;

const TABS = [
  { k: "stok", label: "Stok", icon: Boxes },
  { k: "kategori", label: "Kategori", icon: Tags },
  { k: "riwayat", label: "Riwayat", icon: PackageSearch },
] as const;

function MenuVariantsHarness() {
  const { theme, nav } = Route.useSearch();
  const [tab, setTab] = useState<(typeof TABS)[number]["k"]>("stok");

  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.toggle("dark", theme === "dark");
    return () => {
      root.classList.toggle("dark", had);
    };
  }, [theme]);

  return (
    <SidebarProvider>
      <main
        data-menu-harness
        data-menu-theme={theme}
        className="min-h-screen w-full bg-background pb-40 text-foreground"
      >
        <header className="p-ms-4">
          <h1 className="text-ms-lg font-bold">Audit Visual Menu</h1>
          <p className="text-ms-xs text-muted-foreground">
            Tema: {theme} · Bottom nav: {nav}
          </p>
        </header>

        {/* Sidebar menu — item aktif & idle memakai class SSOT. */}
        <section data-menu-shot="sidebar" className="bg-sidebar p-ms-3">
          <SidebarMenu className="gap-ms-1.5">
            {SIDEBAR_ITEMS.map((item, i) => {
              const active = i === 0;
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={active}
                    className={SIDEBAR_NAV_ITEM_CLASS}
                    data-menu-item
                    data-menu-surface="sidebar"
                    data-menu-state={active ? "active" : "idle"}
                  >
                    <span aria-hidden className={sidebarNavIconClass(active)}>
                      <item.icon className="h-[17px] w-[17px]" />
                    </span>
                    <span data-menu-label className={sidebarNavLabelClass(active)}>
                      {item.title}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </section>

        {/* Pill tabs — dipakai di Gudang, Riwayat, dll. */}
        <section data-menu-shot="pills" className="py-ms-3">
          <PillsTabs
            tabs={TABS}
            value={tab}
            onChange={setTab}
            ariaLabel="Tab audit menu"
          />
        </section>

        <section data-menu-shot="bottom-nav">
          {nav === "chat" ? <ChatBottomNav /> : <MobileBottomNav />}
        </section>
      </main>
    </SidebarProvider>
  );
}
