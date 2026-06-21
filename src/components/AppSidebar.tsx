import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Home, Package, Wallet, Lock, Tags, ClipboardList, Scale, PackagePlus, User, Users } from "lucide-react";
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
  { title: "Hutang & Piutang", url: "/hutang-piutang", icon: Wallet },
  { title: "Pratinjau Label", url: "/label-preview", icon: Tags },
  { title: "Profil Akun", url: "/profil", icon: User },
  { title: "Pengaturan Kunci", url: "/pengaturan-kunci", icon: Lock },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const isActive = (path: string) =>
    path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/");

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
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
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
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.title}</span>
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