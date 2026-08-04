/**
 * Halaman preview tema (internal QA, noindex).
 *
 * Menampilkan SELURUH token warna tema + variasi komponen menu
 * (sidebar item, pill tabs, badge, tombol, link) dalam satu halaman
 * untuk verifikasi konsistensi warna sebelum rilis.
 *
 * URL: /pratinjau-tema  — toggle terang/gelap tanpa mengubah preferensi
 * tersimpan (class `dark` dipulihkan saat keluar halaman).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Home, Warehouse, PackageSearch, MessageCircle, Boxes, Tags, Palette, Sun, Moon,
  Search, Copy, Check, X,
} from "lucide-react";
import {
  SidebarProvider, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  SIDEBAR_NAV_ITEM_CLASS, sidebarNavIconClass, sidebarNavLabelClass,
} from "@/components/shell/menu-item-classes";
import { PillsTabs } from "@/components/shell/PillsTabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/pratinjau-tema")({
  head: () => ({
    meta: [
      { title: "Pratinjau Tema & Komponen — MCM Storage" },
      {
        name: "description",
        content:
          "Katalog internal token warna tema dan variasi komponen menu, badge, tombol, serta link untuk verifikasi konsistensi visual sebelum rilis.",
      },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Pratinjau Tema & Komponen — MCM Storage" },
      {
        property: "og:description",
        content: "Verifikasi konsistensi warna tema dan komponen menu sebelum rilis.",
      },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ThemePreviewPage,
});

const TOKEN_GROUPS: Array<{ title: string; tokens: string[] }> = [
  { title: "Permukaan", tokens: ["background", "foreground", "card", "card-foreground", "popover", "popover-foreground", "muted", "muted-foreground"] },
  { title: "Brand & aksi", tokens: ["primary", "primary-foreground", "secondary", "secondary-foreground", "accent", "accent-foreground"] },
  { title: "Status", tokens: ["success", "success-foreground", "success-soft", "warning", "warning-foreground", "warning-soft", "info", "info-foreground", "info-soft", "destructive", "destructive-foreground"] },
  { title: "Kanal WA", tokens: ["wa", "wa-foreground", "wa-strong", "wa-soft"] },
  { title: "Garis & fokus", tokens: ["border", "input", "ring"] },
  { title: "Sidebar", tokens: ["sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring"] },
];

const BUTTON_VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "wa", "waSoft", "link"] as const;
const BUTTON_SIZES = ["sm", "default", "lg"] as const;
const BADGE_VARIANTS = ["default", "secondary", "destructive", "outline"] as const;

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

function useResolvedTokens(deps: unknown) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const g of TOKEN_GROUPS) {
      for (const t of g.tokens) next[t] = cs.getPropertyValue(`--${t}`).trim();
    }
    setValues(next);
  }, [deps]);
  return values;
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-ms-4 shadow-sm">
      <h2 className="text-ms-lg font-semibold tracking-[-0.01em] text-card-foreground">{title}</h2>
      {desc ? <p className="mt-1 text-ms-xs text-muted-foreground">{desc}</p> : null}
      <div className="mt-ms-3">{children}</div>
    </section>
  );
}

function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(label ? `${label} disalin` : "Disalin ke clipboard");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Gagal menyalin");
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground ${className ?? ""}`}
      onClick={handle}
      aria-label={`Salin ${label || value}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function ThemePreviewPage() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    setDark(had);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.toggle("dark", dark);
    return () => {
      root.classList.toggle("dark", had);
    };
  }, [dark]);

  const tokens = useResolvedTokens(dark);
  const [tab, setTab] = useState<(typeof TABS)[number]["k"]>("stok");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filteredGroups = TOKEN_GROUPS.map((g) => ({
    ...g,
    tokens: g.tokens.filter((t) => {
      const value = tokens[t] || "";
      return t.toLowerCase().includes(q) || value.toLowerCase().includes(q);
    }),
  })).filter((g) => g.tokens.length > 0);

  return (
    <SidebarProvider>
      <main data-theme-preview className="min-h-screen w-full bg-background text-foreground">
        <div className="mx-auto flex max-w-4xl flex-col gap-ms-4 p-ms-4 pb-24">
          <header className="flex items-start justify-between gap-ms-3">
            <div>
              <h1 className="flex items-center gap-ms-2 text-ms-2xl font-bold tracking-[-0.015em]">
                <Palette className="h-5 w-5 text-primary" aria-hidden />
                Pratinjau Tema
              </h1>
              <p className="mt-1 text-ms-xs text-muted-foreground">
                Semua token warna & variasi komponen menu dalam satu halaman.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDark((v) => !v)}
              aria-pressed={dark}
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {dark ? "Terang" : "Gelap"}
            </Button>
          </header>

          <Section title="Panel pencarian token" desc="Ketik nama token atau nilai warna, lalu tap tombol salin.">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari token (contoh: success, wa, #3b82f6)..."
                className="pl-9 pr-9"
                aria-label="Cari token warna"
              />
              {query ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setQuery("")}
                  aria-label="Hapus pencarian"
                >
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            <p className="mt-2 text-ms-2xs text-muted-foreground">
              {q
                ? `${filteredGroups.reduce((n, g) => n + g.tokens.length, 0)} token cocok`
                : `${Object.keys(tokens).length} token tersedia`}
            </p>
          </Section>

          {filteredGroups.length === 0 && q ? (
            <Section title="Hasil pencarian">
              <p className="text-ms-sm text-muted-foreground">Tidak ada token yang cocok dengan “{query}”.</p>
            </Section>
          ) : null}

          {filteredGroups.map((group) => (
            <Section key={group.title} title={`Token — ${group.title}`}>
              <ul className="grid grid-cols-1 gap-ms-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.tokens.map((t) => (
                  <li
                    key={t}
                    data-token={t}
                    className="group flex items-center justify-between gap-ms-2 rounded-xl border border-border/50 bg-background/60 p-ms-2"
                  >
                    <div className="flex min-w-0 items-center gap-ms-2">
                      <span
                        aria-hidden
                        className="h-9 w-9 shrink-0 rounded-lg border border-border/60"
                        style={{ background: `var(--${t})` }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-ms-xs font-medium">--{t}</span>
                        <span className="block truncate text-ms-2xs text-muted-foreground">
                          {tokens[t] || "—"}
                        </span>
                      </span>
                    </div>
                    <CopyButton
                      value={`--${t}: ${tokens[t] || ""}`}
                      label={t}
                      className="opacity-60 group-hover:opacity-100"
                    />
                  </li>
                ))}
              </ul>
            </Section>
          ))}

          <Section title="Tombol" desc="Semua varian × ukuran, termasuk state disabled.">
            <div className="flex flex-col gap-ms-3">
              {BUTTON_VARIANTS.map((v) => (
                <div key={v} className="flex flex-wrap items-center gap-ms-2">
                  <span className="w-20 shrink-0 text-ms-2xs text-muted-foreground">{v}</span>
                  {BUTTON_SIZES.map((s) => (
                    <Button key={s} variant={v} size={s}>
                      {s}
                    </Button>
                  ))}
                  <Button variant={v} disabled>
                    disabled
                  </Button>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Badge & link" desc="Hover badge lalu tap ikon salin untuk menyalin nilai/className.">
            <div className="flex flex-wrap items-center gap-ms-2">
              {BADGE_VARIANTS.map((v) => (
                <div
                  key={v}
                  className="group flex items-center gap-0.5 rounded-lg border border-transparent hover:border-border/50"
                >
                  <Badge variant={v}>{v}</Badge>
                  <CopyButton value={v} label={`varian ${v}`} className="opacity-0 group-hover:opacity-60" />
                </div>
              ))}
              {[
                { label: "success", className: "border-success/30 bg-success/10 text-success" },
                { label: "warning", className: "border-warning/30 bg-warning/10 text-warning" },
                { label: "info", className: "border-info/30 bg-info/10 text-info" },
              ].map((b) => (
                <div
                  key={b.label}
                  className="group flex items-center gap-0.5 rounded-lg border border-transparent hover:border-border/50"
                >
                  <Badge className={b.className}>{b.label}</Badge>
                  <CopyButton value={b.className} label={`class ${b.label}`} className="opacity-0 group-hover:opacity-60" />
                </div>
              ))}
            </div>
            <div className="mt-ms-3 flex flex-wrap items-center gap-ms-4 text-ms-sm">
              <a href="#top" className="text-primary underline-offset-4 hover:underline">
                Link primary
              </a>
              <a href="#top" className="text-muted-foreground underline-offset-4 hover:underline">
                Link sekunder
              </a>
              <a href="#top" className="text-destructive underline-offset-4 hover:underline">
                Link destruktif
              </a>
            </div>
          </Section>

          <Section title="Item menu sidebar" desc="Class SSOT yang dipakai AppSidebar (aktif & idle).">
            <div className="rounded-xl bg-sidebar p-ms-3">
              <SidebarMenu className="gap-ms-1.5">
                {SIDEBAR_ITEMS.map((item, i) => {
                  const active = i === 0;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        isActive={active}
                        className={SIDEBAR_NAV_ITEM_CLASS}
                        data-menu-item
                        data-menu-state={active ? "active" : "idle"}
                      >
                        <span aria-hidden className={sidebarNavIconClass(active)}>
                          <item.icon className="h-[17px] w-[17px]" />
                        </span>
                        <span className={sidebarNavLabelClass(active)}>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </div>
          </Section>

          <Section title="Pill tabs">
            <PillsTabs tabs={TABS} value={tab} onChange={setTab} ariaLabel="Tab pratinjau tema" />
          </Section>
        </div>
      </main>
    </SidebarProvider>
  );
}
