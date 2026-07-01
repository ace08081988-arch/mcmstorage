/**
 * Deterministic visual harness for daftar produk (ecer card + hero badges).
 *
 * Konsumsi: tests/visual/produk-list.public.spec.ts pada 4 lebar
 * Android umum (320 / 360 / 411 / 480) untuk memastikan badge Status,
 * nama produk, dan baris detail tidak wrap/overflow lagi.
 *
 * Fixture sengaja menekan kasus problematik:
 *  - nama produk sangat panjang tanpa spasi
 *  - semua varian status pada baris yang sama
 *  - sub-keterangan + nilai panjang pada DetailRow
 *
 * Tidak ada network/auth/waktu dinamis — byte-stable antar mesin.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Boxes, CheckCircle2, Hash, Package, Scale } from "lucide-react";
import { StatusBadge, type StatusVariant } from "@/components/StatusBadge";
import { EcerLabel, EcerMeta } from "@/components/ecer/Typography";

type Part = "hero" | "detail-rows" | "status-grid" | "all";

export const Route = createFileRoute("/lovable/visual/produk-list")({
  component: VisualHarness,
  validateSearch: (s: Record<string, unknown>): { part: Part } => {
    const p = s.part as Part | undefined;
    const allowed: Part[] = ["hero", "detail-rows", "status-grid", "all"];
    return { part: allowed.includes(p as Part) ? (p as Part) : "all" };
  },
  head: () => ({
    meta: [
      { title: "Visual harness — produk list" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

const HERO_FIXTURES: { name: string; product: string; target: string; ref: string }[] = [
  {
    name: "Gula Pasir Gulaku Premium Kuning 1kg",
    product: "GULAKU 1KG",
    target: "250 g",
    ref: "A1B2C3D4E5F60718",
  },
  {
    // Stress: nama panjang tanpa spasi untuk menguji [overflow-wrap:anywhere]
    name: "MinyakGorengTropikalSawitMurniLimaLiterRefillEkonomis",
    product: "TROPICAL5L",
    target: "1000 g",
    ref: "9F8E7D6C5B4A3210",
  },
  {
    name: "Beras",
    product: "BERAS LOKAL",
    target: "500 g",
    ref: "00112233AABBCCDD",
  },
];

const STATUS_VARIANTS: { variant: StatusVariant; label: string }[] = [
  { variant: "menunggu", label: "menunggu" },
  { variant: "siap", label: "siap" },
  { variant: "selesai", label: "selesai" },
  { variant: "hutang", label: "Sisa Rp 1.250.000" },
  { variant: "lunas", label: "✓ Lunas" },
  { variant: "kelebihan", label: "Kelebihan Rp 75.000" },
  { variant: "info", label: "info" },
  { variant: "danger", label: "danger" },
];

function HeroCard({ name, product, target, ref }: typeof HERO_FIXTURES[number]) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="relative bg-gradient-to-br from-primary/95 via-primary to-primary/80 px-4 pb-4 pt-4 text-primary-foreground">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-primary-foreground/80">
              <Scale className="h-3 w-3 shrink-0" />
              <span className="truncate">Detail penyiapan ecer</span>
            </div>
            <h2 className="mt-2 break-words text-base font-bold leading-snug">{name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] leading-none text-primary-foreground/85">
              <span className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full bg-white/15 px-2 leading-none">
                <Package className="h-3 w-3 shrink-0" />
                <span className="truncate">{product}</span>
              </span>
              <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/15 px-2 leading-none">
                Target <b className="ml-0.5">{target}</b>
              </span>
              <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-400/25 px-2 font-semibold leading-none text-emerald-50 ring-1 ring-emerald-300/50">
                <CheckCircle2 className="h-3 w-3 shrink-0" /> Aktif
              </span>
              <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/10 px-2 font-mono leading-none text-primary-foreground/90">
                <Hash className="h-3 w-3 shrink-0" /> {ref}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="grid min-h-[40px] grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-2 py-2">
      <EcerLabel className="flex min-w-0 items-center gap-1.5 leading-none">
        <span className="shrink-0 text-muted-foreground/70">{icon}</span>
        <span className="truncate">{label}</span>
      </EcerLabel>
      <div className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-1.5 gap-y-0 text-right text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
        <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
        {sub && (
          <EcerMeta as="span" className="min-w-0 truncate font-normal leading-none">
            · {sub}
          </EcerMeta>
        )}
      </div>
    </div>
  );
}

function StatusGrid() {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      {STATUS_VARIANTS.map((s) => (
        <div key={s.variant} className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              Produk dengan nama panjang sekali pelanggan A {s.variant}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Pelanggan Tanpa Nama · 30 Jun 2026, 03.15
            </div>
          </div>
          <StatusBadge variant={s.variant}>{s.label}</StatusBadge>
        </div>
      ))}
    </div>
  );
}

function DetailRows() {
  return (
    <div className="rounded-xl border bg-card divide-y px-4">
      <DetailRow icon={<Package className="h-3.5 w-3.5" />} label="Produk gudang"
        value={<span className="font-semibold">MinyakGorengTropikalSawitMurniLimaLiterRefillEkonomis</span>}
        sub="Stok: 12,5 kg" />
      <DetailRow icon={<Scale className="h-3.5 w-3.5" />} label="Target per kotak"
        value={<span className="font-semibold">250 g</span>}
        sub="Total target 5000 g · aktual 4870 g" />
      <DetailRow icon={<Boxes className="h-3.5 w-3.5" />} label="Jumlah penyiapan"
        value={<span className="font-semibold">20 kotak</span>}
        sub="97% dari target" />
      <DetailRow icon={<Hash className="h-3.5 w-3.5" />} label="ID judul referensi yang panjang"
        value={<span className="font-mono text-xs">A1B2C3D4E5F60718</span>} />
    </div>
  );
}

function VisualHarness() {
  const { part } = Route.useSearch();
  return (
    <div className="min-h-screen bg-background p-3 text-foreground" data-press-scope="on">
      <div className="mx-auto max-w-3xl space-y-4">
        {(part === "all" || part === "hero") && (
          <section data-visual-part="hero" className="space-y-3">
            {HERO_FIXTURES.map((h) => (
              <HeroCard key={h.ref} {...h} />
            ))}
          </section>
        )}
        {(part === "all" || part === "status-grid") && (
          <section data-visual-part="status-grid">
            <StatusGrid />
          </section>
        )}
        {(part === "all" || part === "detail-rows") && (
          <section data-visual-part="detail-rows">
            <DetailRows />
          </section>
        )}
      </div>
    </div>
  );
}
