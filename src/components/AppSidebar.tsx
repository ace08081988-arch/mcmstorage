import { Link, useNavigate, useRouterState, useMatchRoute } from "@tanstack/react-router";
import { Home, Package, Wallet, Lock, Tags, ClipboardList, Scale, PackagePlus, User, ClipboardCheck, MessageCircle, Activity, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { CompactModeToggle } from "@/components/CompactModeToggle";
import { ResetCacheButton } from "@/components/ResetCacheButton";
import { useConversations } from "@/lib/chat";

const items = [
  { title: "Beranda", url: "/", icon: Home },
  { title: "Gudang & Supplier", url: "/gudang", icon: Package },
  { title: "Penyiapan Ecer", url: "/", hash: "ecer", icon: Scale },
  { title: "Penyiapan Request", url: "/request", icon: PackagePlus },
  { title: "Penyiapan Produk", url: "/tugas", icon: ClipboardList },
  { title: "Chat", url: "/chat", icon: MessageCircle },
  { title: "Hutang & Piutang", url: "/hutang-piutang", icon: Wallet },
  { title: "Pratinjau Label", url: "/label-preview", icon: Tags },
  { title: "Profil Akun", url: "/profil", icon: User },
  { title: "Pengaturan Kunci", url: "/pengaturan-kunci", icon: Lock },
  { title: "Audit Rute", url: "/audit", icon: ClipboardCheck },
  { title: "Diagnostik", url: "/diagnostics", icon: Activity },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const { data: conversations } = useConversations();
  const [chatQuery, setChatQuery] = useState("");
  const filteredConversations = useMemo(() => {
    const q = chatQuery.trim().toLowerCase();
    const list = conversations ?? [];
    if (!q) return list.slice(0, 6);
    return list
      .filter((c) => (c.display_title ?? "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [conversations, chatQuery]);
  const hasConversations = (conversations ?? []).length > 0;
  // Highlight mengikuti route aktif sepenuhnya — tidak terpengaruh search params
  // (mis. /ecer?item=…&highlight=…) maupun child route (mis. /chat/$id, /gudang/pesanan/$id).
  const isActive = (path: string) => {
    if (path === "/") return pathname === "/";
    // exact match selalu menang
    if (pathname === path) return true;
    // fuzzy untuk child route bertingkat
    return !!matchRoute({ to: path, fuzzy: true });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-3 text-sm font-semibold">MCM Storage</SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                    className="group/3d relative overflow-hidden rounded-lg border border-transparent bg-gradient-to-b from-sidebar-accent/40 to-sidebar/0 shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.06),0_1px_2px_0_hsl(0_0%_0%/0.25)] transition-all duration-150 hover:-translate-y-px hover:border-sidebar-border/60 hover:from-sidebar-accent/70 hover:shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.1),0_4px_10px_-2px_hsl(0_0%_0%/0.35)] active:translate-y-px active:shadow-[inset_0_2px_4px_0_hsl(0_0%_0%/0.35)] data-[active=true]:border-primary/40 data-[active=true]:bg-gradient-to-b data-[active=true]:from-primary/25 data-[active=true]:to-primary/5 data-[active=true]:shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.15),0_6px_14px_-4px_color-mix(in_oklab,var(--primary)_55%,transparent)]"
                  >
                    <Link
                      to={item.url}
                      preload="intent"
                      className="flex items-center gap-2"
                      onPointerDown={(e) => {
                        if (!isMobile) return;
                        // Hanya tap utama (mouse kiri / sentuh) — biarkan ctrl/shift-click default
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
                        e.preventDefault();
                        setOpenMobile(false);
                        if (pathname !== item.url) {
                          void navigate({ to: item.url });
                        }
                      }}
                    >
                      <item.icon className="h-4 w-4 shrink-0 drop-shadow-[0_1px_0_hsl(0_0%_0%/0.4)] transition-transform duration-150 group-hover/3d:scale-110 group-active/3d:scale-95" />
                      <span className="drop-shadow-[0_1px_0_hsl(0_0%_0%/0.35)]">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {hasConversations && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>
              {chatQuery ? "Hasil pencarian chat" : "Percakapan terbaru"}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="relative mb-1 px-2">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={chatQuery}
                  onChange={(e) => setChatQuery(e.target.value)}
                  placeholder="Cari nama lawan bicara…"
                  className="h-8 w-full rounded-md border bg-background pl-7 pr-7 text-xs outline-none ring-0 placeholder:text-muted-foreground focus:border-primary"
                />
                {chatQuery && (
                  <button
                    type="button"
                    onClick={() => setChatQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="Bersihkan pencarian"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {filteredConversations.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-muted-foreground">
                  Tidak ada percakapan cocok dengan "{chatQuery}".
                </div>
              )}
              <SidebarMenu>
                {filteredConversations.map((c) => {
                  const active = pathname === `/chat/${c.id}`;
                  return (
                    <SidebarMenuItem key={c.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={c.display_title}
                        size="sm"
                      >
                        <Link
                          to="/chat/$conversationId"
                          params={{ conversationId: c.id }}
                          preload="intent"
                          className="flex items-center gap-2"
                          onPointerDown={(e) => {
                            if (!isMobile) return;
                            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
                            e.preventDefault();
                            setOpenMobile(false);
                            if (!active) {
                              void navigate({
                                to: "/chat/$conversationId",
                                params: { conversationId: c.id },
                              });
                            }
                          }}
                        >
                          <MessageCircle className="h-4 w-4 shrink-0" />
                          <span className="truncate">{c.display_title}</span>
                          {c.unread > 0 && (
                            <span className="ml-auto inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                              {c.unread > 99 ? "99+" : c.unread}
                            </span>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
        <CompactModeToggle />
        <ResetCacheButton fullWidth variant="ghost" size="sm" label="Reset cache" />
      </SidebarFooter>
    </Sidebar>
  );
}