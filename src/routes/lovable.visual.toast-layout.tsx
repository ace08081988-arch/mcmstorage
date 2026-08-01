/**
 * Harness publik (no-auth) untuk membandingkan dua variasi tata letak
 * pesan/toast terhadap header aplikasi.
 *
 *  Varian A — "Top below header": toast top-center, diturunkan di bawah
 *  header (perilaku produksi saat ini, offset 68px mobile / 76px desktop).
 *  Risiko: saat 2–3 toast bertumpuk, tumpukan tetap merambat ke area
 *  header/judul halaman dan menutupi aksi kanan-atas.
 *
 *  Varian B — "Bottom above nav": toast bottom-center, diangkat di atas
 *  bar navigasi bawah (--app-bottom-nav-h). Header sama sekali tidak
 *  tersentuh berapa pun jumlah toast.
 *
 * Halaman ini merender toast TIRUAN (bukan sonner) supaya perbandingan
 * deterministik untuk screenshot dan tidak bentrok dengan Toaster global.
 *
 * URL: /lovable/visual/toast-layout — noindex, tanpa auth, tanpa request server.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bell, Check, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/lovable/visual/toast-layout")({
  head: () => ({
    meta: [
      { title: "Harness · Tata letak toast" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ToastLayoutHarness,
});

type Variant = "a" | "b";

const MOCK = [
  { icon: Check, tone: "text-[hsl(var(--wa))]", title: "Penyiapan terkirim", desc: "3 produk dikirim ke pelanggan." },
  { icon: TriangleAlert, tone: "text-amber-500", title: "Stok menipis", desc: "Gula pasir tersisa 2,5 kg." },
  { icon: Bell, tone: "text-primary", title: "Pesan baru", desc: "Dompeng: sisa hutang sudah saya transfer." },
];

function MockToast({ item }: { item: (typeof MOCK)[number] }) {
  const Icon = item.icon;
  return (
    <div className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-border/70 bg-card/95 p-3 shadow-lg backdrop-blur">
      <Icon className={`mt-0.5 size-4 shrink-0 ${item.tone}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">{item.desc}</p>
      </div>
      <X className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </div>
  );
}

function ToastLayoutHarness() {
  const [variant, setVariant] = useState<Variant>("a");
  const [count, setCount] = useState(1);
  const items = MOCK.slice(0, count);

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
      {/* Header tiruan (tinggi ±56px, sama seperti AppHeader) */}
      <header
        data-testid="mock-header"
        className="absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between border-b border-border/60 bg-card/90 px-4 backdrop-blur"
      >
        <span className="text-base font-semibold">Gudang</span>
        <div className="flex items-center gap-3">
          <Bell className="size-5 text-muted-foreground" aria-hidden />
          <div className="size-8 rounded-full bg-muted" />
        </div>
      </header>

      {/* Konten tiruan */}
      <main className="h-full overflow-y-auto px-4 pb-28 pt-20">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              data-testid="pick-a"
              size="sm"
              variant={variant === "a" ? "default" : "outline"}
              onClick={() => setVariant("a")}
            >
              Varian A · atas
            </Button>
            <Button
              data-testid="pick-b"
              size="sm"
              variant={variant === "b" ? "default" : "outline"}
              onClick={() => setVariant("b")}
            >
              Varian B · bawah
            </Button>
            <Button data-testid="add-toast" size="sm" variant="secondary" onClick={() => setCount((c) => (c % 3) + 1)}>
              Jumlah toast: {count}
            </Button>
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-card/60 p-4">
              <p className="text-sm font-medium">Kartu konten #{i + 1}</p>
              <p className="text-xs text-muted-foreground">Baris pendukung untuk menilai keterbacaan.</p>
            </div>
          ))}
        </div>
      </main>

      {/* Bar bawah tiruan */}
      <nav
        data-testid="mock-bottom-nav"
        className="absolute inset-x-0 bottom-0 z-10 flex h-16 items-center justify-around border-t border-border/60 bg-card/90 backdrop-blur"
      >
        {["Beranda", "Gudang", "Chat", "Lainnya"].map((l) => (
          <span key={l} className="text-xs text-muted-foreground">
            {l}
          </span>
        ))}
      </nav>

      {/* Tumpukan toast */}
      <div
        data-testid={`toast-stack-${variant}`}
        data-variant={variant}
        className={
          variant === "a"
            ? "pointer-events-none absolute inset-x-3 top-[68px] z-20 flex flex-col gap-2"
            : "pointer-events-none absolute inset-x-3 bottom-[calc(4rem+0.75rem)] z-20 flex flex-col-reverse gap-2"
        }
      >
        {items.map((it) => (
          <MockToast key={it.title} item={it} />
        ))}
      </div>
    </div>
  );
}
