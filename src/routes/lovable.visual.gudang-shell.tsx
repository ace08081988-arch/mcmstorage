/**
 * Fixture QA untuk shell /gudang: menjalankan tiga state (loading / empty /
 * data) × dua tema (light / dark) berdampingan di lebar 320–768 tanpa
 * perlu backend/device-verify.
 *
 * Cek yang dipenuhi:
 * - Header sticky, pills, PageContainer, SummaryCard memakai token `--ms-*`.
 * - Tidak ada horizontal overflow.
 * - Tinggi + padding elemen identik antar viewport mobile (320/360/390/411).
 * - Spacing/tokens identik antar tema light/dark; hanya warna yang berubah.
 *
 * URL: /lovable/visual/gudang-shell?theme=dark|light|both  ·  noindex, tanpa
 * auth, tanpa network.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  Boxes,
  Truck,
  ShoppingCart,
  Banknote,
  ClipboardList,
  CreditCard,
  Users,
  Wallet,
  History,
  Package,
  AlertTriangle,
  PackageX,
} from "lucide-react";
import { useState } from "react";
import {
  PageContainer,
  PageHeader,
  PillsTabs,
  SummaryCard,
  type PillsTabItem,
} from "@/components/shell";

type TabKey =
  | "stok"
  | "supplier"
  | "beli"
  | "jual"
  | "pesanan"
  | "hutang"
  | "pelanggan"
  | "piutang"
  | "riwayat";

const TABS: ReadonlyArray<PillsTabItem<TabKey>> = [
  { k: "stok", label: "Stok", icon: Boxes },
  { k: "supplier", label: "Supplier", icon: Truck },
  { k: "beli", label: "Beli", icon: ShoppingCart },
  { k: "jual", label: "Jual", icon: Banknote },
  { k: "pesanan", label: "Pesanan", icon: ClipboardList },
  { k: "hutang", label: "Hutang", icon: CreditCard },
  { k: "pelanggan", label: "Pelanggan", icon: Users },
  { k: "piutang", label: "Piutang", icon: Wallet },
  { k: "riwayat", label: "Riwayat", icon: History },
];

const WIDTHS = [320, 360, 390, 411, 768] as const;
const STATES = ["loading", "empty", "data"] as const;
type State = (typeof STATES)[number];
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

export const Route = createFileRoute("/lovable/visual/gudang-shell")({
  head: () => ({
    meta: [
      { title: "Gudang shell — QA · Ace" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: z.object({
    state: z.enum(["loading", "empty", "data"]).optional(),
    variant: z.enum(["grid", "solo"]).optional(),
    theme: z.enum(["light", "dark", "both"]).optional(),
  }),
  component: GudangShellFixture,
});

function GudangShellFixture() {
  const search = Route.useSearch();
  // Mode "solo" me-render satu state tanpa wrapper 411-lebar-tetap, sehingga
  // media queries ikut viewport asli Playwright (390/411). Dipakai untuk
  // audit responsif; mode "grid" (default) untuk overview visual di desktop.
  if (search.variant === "solo") {
    const soloTheme: Theme = search.theme === "dark" ? "dark" : "light";
    return (
      <div
        data-fixture-state={search.state ?? "data"}
        data-fixture-mode="solo"
        data-fixture-theme={soloTheme}
        className={soloTheme === "dark" ? "dark" : undefined}
      >
        <ShellPreview state={search.state ?? "data"} />
      </div>
    );
  }
  const themesToRender: Theme[] =
    search.theme === "dark"
      ? ["dark"]
      : search.theme === "light"
        ? ["light"]
        : ["light", "dark"];
  return (
    <div
      className="min-h-screen bg-muted/10 p-ms-4" style={{ paddingTop: "calc(var(--app-safe-top, 0px) + 1rem)", paddingLeft: "calc(var(--app-safe-left, 0px) + 1rem)", paddingRight: "calc(var(--app-safe-right, 0px) + 1rem)" }}
    >
      <h1 className="mb-ms-4 text-ms-lg font-semibold tracking-tight">
        Gudang shell — loading · empty · data × light/dark × 320/360/390/411/768
      </h1>
      <div className="grid grid-cols-1 gap-ms-6 xl:grid-cols-2">
        {WIDTHS.map((w) => (
          <div key={w} className="space-ms-4">
            <div className="text-ms-2xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              viewport {w}px
            </div>
            {themesToRender.map((th) => (
              <div key={th} className="space-ms-2">
                <div className="text-ms-2xs uppercase tracking-[0.18em] text-muted-foreground">
                  theme {th}
                </div>
                <div className="flex flex-wrap gap-ms-4">
                  {STATES.map((s) => (
                    <StatePhone key={s} width={w} state={s} theme={th} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatePhone({ width, state, theme }: { width: number; state: State; theme: Theme }) {
  return (
    <div className="space-ms-2">
      <div
        data-fixture-state={state}
        data-fixture-width={width}
        data-fixture-theme={theme}
        className="overflow-hidden rounded-2xl border border-border/60 bg-background shadow"
        style={{ width: `${width}px` }}
      >
        <div className={theme === "dark" ? "dark" : undefined}>
          <ShellPreview state={state} />
        </div>
      </div>
      <div className="text-ms-2xs text-muted-foreground">
        {state} · {theme} · {width}px
      </div>
    </div>
  );
}

/** Salinan visual bagian sticky+main dari /gudang. Sengaja tidak import
 *  GudangPage supaya fixture bebas dari network/auth guard. */
function ShellPreview({ state }: { state: State }) {
  const [tab, setTab] = useState<TabKey>("stok");
  const loading = state === "loading";
  const empty = state === "empty";

  const summary = empty
    ? { totalProducts: 0, lowStock: 0, outOfStock: 0, totalSuppliers: 0 }
    : { totalProducts: 128, lowStock: 6, outOfStock: 2, totalSuppliers: 14 };
  const nilaiStok = empty ? "Rp 0" : "Rp 12,4jt";

  return (
    <div className="min-h-[720px] bg-gradient-to-b from-background to-muted/20 text-foreground">
      <PageHeader
        icon={Package}
        title="Gudang"
        subtitle="Inventaris · Pembukuan"
        stat={{ label: "Nilai stok", value: nilaiStok }}
      >
        <PillsTabs
          tabs={TABS}
          value={tab}
          onChange={setTab}
          ariaLabel="Bagian Gudang"
        />
      </PageHeader>

      <PageContainer>
        <section
          aria-label="Ringkasan inventaris"
          className="grid grid-cols-2 gap-ms-3 md:grid-cols-4"
        >
          <SummaryCard
            icon={Package}
            label="Total Produk"
            value={summary.totalProducts}
            tone="primary"
            loading={loading}
          />
          <SummaryCard
            icon={AlertTriangle}
            label="Stok Menipis"
            value={summary.lowStock}
            tone="warning"
            loading={loading}
          />
          <SummaryCard
            icon={PackageX}
            label="Stok Habis"
            value={summary.outOfStock}
            tone="danger"
            loading={loading}
          />
          <SummaryCard
            icon={Truck}
            label="Supplier"
            value={summary.totalSuppliers}
            tone="info"
            loading={loading}
          />
        </section>

        {loading ? (
          <LoadingBody />
        ) : empty ? (
          <EmptyBody />
        ) : (
          <DataBody />
        )}
      </PageContainer>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className="space-ms-3" data-testid="loading-body">
      <div className="h-10 w-full animate-pulse rounded-lg bg-muted/60" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 w-full animate-pulse rounded-lg bg-muted/50" />
      ))}
    </div>
  );
}

function EmptyBody() {
  return (
    <div
      data-testid="empty-body"
      className="rounded-2xl border border-dashed border-border/60 p-ms-6 text-center"
    >
      <p className="text-ms-base font-semibold">Belum ada data</p>
      <p className="mt-1 text-ms-sm text-muted-foreground">
        Tambahkan produk atau supplier untuk memulai.
      </p>
    </div>
  );
}

function DataBody() {
  const rows = [
    { name: "Beras Kifa 5kg", stock: "24 karton", price: "Rp 75.000" },
    { name: "Gula pasir 1kg", stock: "180 pcs", price: "Rp 16.500" },
    { name: "Minyak sawit 2L", stock: "42 pcs", price: "Rp 34.000" },
  ];
  return (
    <ul data-testid="data-body" className="space-ms-2">
      {rows.map((r) => (
        <li
          key={r.name}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-ms-3 rounded-xl border bg-card p-ms-3"
        >
          <div className="min-w-0">
            <p className="truncate text-ms-sm font-semibold">{r.name}</p>
            <p className="truncate text-ms-xs text-muted-foreground">{r.stock}</p>
          </div>
          <p className="shrink-0 text-ms-sm font-semibold tabular-nums">{r.price}</p>
        </li>
      ))}
    </ul>
  );
}