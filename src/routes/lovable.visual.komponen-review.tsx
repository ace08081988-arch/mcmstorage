/**
 * Halaman review internal untuk semua varian komponen layout dari
 * docs/responsive-layout-rules.md. Menampilkan tiap komponen secara
 * berdampingan pada lebar 320 / 360 / 411 / 480 px supaya QA wrapping
 * & overflow bisa dilakukan dalam satu pandangan.
 *
 * Tidak diindeks, tidak butuh auth, tidak ada network — fixture statis.
 * URL: /lovable/visual/komponen-review
 */
import { createFileRoute } from "@tanstack/react-router";
import { Boxes, Hash, Package, Scale, CheckCircle2 } from "lucide-react";

const WIDTHS = [320, 360, 411, 480] as const;

export const Route = createFileRoute("/lovable/visual/komponen-review")({
  component: KomponenReviewPage,
  head: () => ({
    meta: [
      { title: "Review komponen responsif" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

/* ──────────────── Komponen referensi ──────────────── */

function CocokPill({ target = 250, unit = "g" }: { target?: number; unit?: string }) {
  const label = `Cocok: produk + ${target}${unit}`;
  return (
    <button
      type="button"
      className="flex w-fit min-w-0 max-w-full items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground"
      title={label}
    >
      <span className="h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{label}</span>
    </button>
  );
}

function CountChip({ count, suffix = "item", maxW = "7rem" }: { count: number; suffix?: string; maxW?: string }) {
  const label = `${count} ${suffix}`;
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center rounded-full border bg-background px-1.5 text-[11px] font-medium leading-none text-muted-foreground tabular-nums"
      style={{ maxWidth: maxW }}
      title={label}
    >
      <span className="min-w-0 truncate whitespace-nowrap">{label}</span>
    </span>
  );
}

function CategoryHeader({ name, count }: { name: string; count: number }) {
  return (
    <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-primary" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-snug" title={name}>{name}</h3>
        <CountChip count={count} />
      </div>
    </header>
  );
}

function HeroCardMini({ name, product, target, ref }: { name: string; product: string; target: string; ref: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="relative bg-gradient-to-br from-primary/95 via-primary to-primary/80 px-3 pb-3 pt-3 text-primary-foreground">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.18em] text-primary-foreground/80">
              <Scale className="h-3 w-3 shrink-0" />
              <span className="truncate">Detail penyiapan ecer</span>
            </div>
            <h2 className="mt-2 break-words text-base font-bold leading-snug">{name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 leading-none text-primary-foreground/85">
              <span className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full bg-white/15 px-2 text-[11px] leading-none">
                <Package className="h-3 w-3 shrink-0" />
                <span className="truncate">{product}</span>
              </span>
              <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/15 px-2 text-[11px] leading-none">
                Target <b className="ml-0.5">{target}</b>
              </span>
              <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-400/25 px-2 text-[11px] font-semibold leading-none text-emerald-50 ring-1 ring-emerald-300/50">
                <CheckCircle2 className="h-3 w-3 shrink-0" /> Aktif
              </span>
              <span className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/10 px-2 font-mono text-[11px] leading-none text-primary-foreground/90">
                <Hash className="h-3 w-3 shrink-0" /> {ref}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon, label, value, sub,
}: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string;
}) {
  return (
    <div className="grid min-h-[40px] grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-2 py-2">
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] uppercase leading-none text-muted-foreground">
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <div className="flex min-w-0 items-center justify-end gap-1.5 text-right text-sm font-semibold leading-snug text-foreground">
        <span className="min-w-0 truncate [overflow-wrap:anywhere]">{value}</span>
        {sub && (
          <span className="shrink-0 whitespace-nowrap text-[11px] font-normal leading-none text-muted-foreground">
            · {sub}
          </span>
        )}
      </div>
    </div>
  );
}

/* ──────────────── Fixture ──────────────── */

const LONG = "MinyakGorengTropikalSawitMurniLimaLiterRefillEkonomis";

function Showcase() {
  return (
    <div className="space-y-4 p-3 text-foreground">
      <section className="space-y-2">
        <SectionTitle title="Pill “Cocok: produk + Xunit”" />
        <div className="space-y-1 rounded-lg border bg-card p-2">
          <CocokPill target={250} unit="g" />
          <CocokPill target={1000} unit="g" />
          <CocokPill target={12} unit="pcs" />
        </div>
      </section>

      <section className="space-y-2">
        <SectionTitle title="Chip “{n} item” pada header kategori" />
        <div className="overflow-hidden rounded-xl border bg-card">
          <CategoryHeader name="Sembako" count={12} />
          <CategoryHeader name="Kategori dengan nama panjang yang harus terpotong rapi" count={345} />
          <CategoryHeader name={LONG} count={1} />
        </div>
      </section>

      <section className="space-y-2">
        <SectionTitle title="Hero card" />
        <HeroCardMini
          name="Gula Pasir Gulaku Premium Kuning 1kg"
          product="GULAKU 1KG"
          target="250 g"
          ref="A1B2C3D4E5F60718"
        />
        <HeroCardMini name={LONG} product="TROPICAL5L" target="1000 g" ref="9F8E7D6C5B4A3210" />
      </section>

      <section className="space-y-2">
        <SectionTitle title="DetailRow" />
        <div className="divide-y rounded-xl border bg-card px-3">
          <DetailRow
            icon={<Package className="h-3.5 w-3.5" />}
            label="Produk gudang"
            value={<span className="font-semibold">{LONG}</span>}
            sub="Stok: 12,5 kg"
          />
          <DetailRow
            icon={<Scale className="h-3.5 w-3.5" />}
            label="Target per kotak"
            value={<span className="font-semibold">250 g</span>}
            sub="Total 5000 g · aktual 4870 g"
          />
          <DetailRow
            icon={<Boxes className="h-3.5 w-3.5" />}
            label="Jumlah penyiapan"
            value={<span className="font-semibold">20 kotak</span>}
            sub="97% dari target"
          />
          <DetailRow
            icon={<Hash className="h-3.5 w-3.5" />}
            label="ID judul referensi panjang"
            value={<span className="font-mono text-xs">A1B2C3D4E5F60718</span>}
          />
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase leading-none tracking-[0.08em] text-muted-foreground">
      {title}
    </h2>
  );
}

/* ──────────────── Halaman ──────────────── */

function KomponenReviewPage() {
  return (
    <div className="min-h-screen bg-muted/30 p-4 text-foreground">
      <header className="mx-auto mb-4 max-w-6xl space-y-1">
        <h1 className="text-lg font-bold leading-snug">Review komponen responsif</h1>
        <p className="text-xs text-muted-foreground">
          Pratinjau pill Cocok, chip {"{n}"} item, hero card, dan DetailRow pada lebar Android
          320 / 360 / 411 / 480 px. Aturan: <code className="rounded bg-muted px-1">docs/responsive-layout-rules.md</code>.
        </p>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        {WIDTHS.map((w) => (
          <figure key={w} className="space-y-2">
            <figcaption className="flex items-center justify-between text-[11px] font-semibold uppercase leading-none tracking-[0.08em] text-muted-foreground">
              <span>Lebar {w}px</span>
              <span className="tabular-nums text-muted-foreground/70">{w}×</span>
            </figcaption>
            <div
              className="overflow-hidden rounded-2xl border bg-background shadow-sm"
              style={{ width: w, maxWidth: "100%" }}
              data-visual-frame={w}
            >
              <Showcase />
            </div>
          </figure>
        ))}
      </div>

      <footer className="mx-auto mt-6 max-w-6xl text-[11px] leading-snug text-muted-foreground">
        Halaman ini noindex. Tidak ada network call, fixture statis — aman dibuka tanpa login.
      </footer>
    </div>
  );
}