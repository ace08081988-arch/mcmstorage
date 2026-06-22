import { Link, useNavigate, useRouterState, useMatchRoute } from "@tanstack/react-router";
import { Home, Package, Wallet, Lock, Tags, ClipboardList, Scale, PackagePlus, User, Users, ClipboardCheck, MessageCircle, Activity } from "lucide-react";
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

const items = [
  { title: "Beranda", url: "/", icon: Home },
  { title: "Gudang & Supplier", url: "/gudang", icon: Package },
  { title: "Penyiapan Ecer", url: "/ecer", icon: Scale },
  { title: "Penyiapan Request", url: "/request", icon: PackagePlus },
  { title: "Tugas Pegawai", url: "/tugas", icon: ClipboardList },
  { title: "Manajemen Pegawai", url: "/manajemen-pegawai", icon: Users },
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
      </SidebarContent>
      <SidebarFooter className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
        <CompactModeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}