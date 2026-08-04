/**
 * Sumber tunggal (SSOT) class untuk item menu navigasi.
 *
 * Dipakai oleh `AppSidebar` (menu asli) DAN harness visual
 * `/lovable/visual/menu-variants`, supaya snapshot regression selalu
 * menguji gaya yang benar-benar dipakai aplikasi — bukan salinan yang
 * bisa drift saat tema / token warna diubah.
 */
export const SIDEBAR_NAV_ITEM_CLASS =
  "group/nav relative h-auto min-h-12 overflow-hidden rounded-2xl border border-sidebar-border/40 bg-sidebar-accent/15 px-ms-2.5 py-ms-2 font-medium text-sidebar-foreground/90 backdrop-blur-sm transition-all duration-200 hover:border-primary/30 hover:bg-sidebar-accent/40 hover:-translate-y-[1px] hover:shadow-[0_6px_18px_-10px_color-mix(in_oklab,var(--primary)_55%,transparent)] active:translate-y-0 active:scale-[0.985] data-[active=true]:border-primary/45 data-[active=true]:bg-gradient-to-br data-[active=true]:from-primary/22 data-[active=true]:via-primary/8 data-[active=true]:to-transparent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-[inset_0_1px_0_color-mix(in_oklab,var(--primary)_35%,transparent),0_8px_24px_-12px_color-mix(in_oklab,var(--primary)_70%,transparent)]";

/** Ikon kotak di kiri label item sidebar (state aktif vs idle). */
export function sidebarNavIconClass(active: boolean): string {
  return (
    "grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition-all duration-200 " +
    (active
      ? "border-primary/45 bg-primary/20 text-primary shadow-[0_0_16px_-4px_color-mix(in_oklab,var(--primary)_75%,transparent)]"
      : "border-sidebar-border/50 bg-sidebar/60 text-muted-foreground group-hover/nav:border-primary/25 group-hover/nav:text-primary")
  );
}

/** Label teks item sidebar. */
export function sidebarNavLabelClass(active: boolean): string {
  return (
    "truncate text-ms-sm tracking-[-0.005em] " +
    (active ? "font-semibold text-sidebar-accent-foreground" : "")
  );
}
