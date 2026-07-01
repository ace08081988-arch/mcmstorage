import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  Sparkles,
  LayoutGrid,
  Megaphone,
  Copy,
  Receipt,
  Users,
  Smile,
  UmbrellaOff,
  Bell,
  Camera,
  MoreVertical,
  ArrowDownRight,
  type LucideIcon,
} from "lucide-react";
import { ChatBottomNav } from "@/components/chat/ChatBottomNav";
import { useConversations } from "@/lib/chat";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/fitur")({
  component: FiturPage,
  head: () => ({
    meta: [
      { title: "Fitur · MCM Chat" },
      {
        name: "description",
        content:
          "Kelola bisnis dan obrolan MCM Chat: verifikasi, katalog, iklan, order, daftar kontak, salam, dan pesan tidak di tempat.",
      },
    ],
  }),
});

type Row = {
  Icon: LucideIcon;
  title: string;
  desc: string;
  to?: string;
  soon?: boolean;
};

function FiturPage() {
  const convs = useConversations();
  const convCount = convs.data?.length;

  const bisnis: Row[] = [
    {
      Icon: BadgeCheck,
      title: "Verifikasi Meta",
      desc: "Jelajahi keuntungan Bisnis Premium",
      to: "/pengaturan-integrasi-sosial",
    },
    {
      Icon: Sparkles,
      title: "Agen AI Anda",
      desc: "Kelola pengetahuan dan tanggapan AI",
      to: "/balas-cepat",
    },
    {
      Icon: LayoutGrid,
      title: "Katalog",
      desc: "Tampilkan produk dan layanan",
      to: "/gudang",
    },
    {
      Icon: Megaphone,
      title: "Pasang iklan",
      desc: "Buat iklan Instagram dan Facebook yang mengarahkan calon pelanggan ke chat",
      soon: true,
    },
    {
      Icon: Copy,
      title: "Kelola iklan",
      desc: "Lihat semua iklan Anda di satu tempat",
      soon: true,
    },
    {
      Icon: Receipt,
      title: "Order",
      desc: "Kelola orderan dan pembayaran",
      to: "/tugas",
    },
  ];

  const obrolan: Row[] = [
    {
      Icon: Users,
      title: "Daftar",
      desc: "Kelola orang dan grup",
      to: "/kontak",
    },
    {
      Icon: Smile,
      title: "Salam",
      desc: "Menyambut pelanggan baru secara otomatis",
      to: "/balas-cepat",
    },
    {
      Icon: UmbrellaOff,
      title: "Pesan tidak di tempat",
      desc: "Membalas pesan secara otomatis saat tidak di tempat",
      to: "/balas-cepat",
    },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 pt-3 pb-2 backdrop-blur">
        <h1 className="text-2xl font-semibold">Fitur</h1>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Link
            to="/notifikasi"
            aria-label="Pembaruan"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
          >
            <Bell className="h-5 w-5" />
          </Link>
          <button
            type="button"
            aria-label="Kamera"
            onClick={() => toast.info("Kamera segera hadir")}
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
          >
            <Camera className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Menu"
            onClick={() => toast.info("Menu segera hadir")}
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pt-3 pb-6">
        {/* Stat cards */}
        <div className="grid grid-cols-3 gap-2">
          <StatCard
            Icon={Receipt}
            value={convCount != null ? String(convCount) : "—"}
            label="Percakapan yang dimulai"
            trend={convCount != null && convCount > 0}
          />
          <StatCard Icon={LayoutGrid} value="— —" label="Tayangan katalog" />
          <StatCard Icon={Bell} value="— —" label="Tayangan status" />
        </div>

        <Section title="Kembangkan bisnis Anda">
          {bisnis.map((r) => (
            <FeatureRow key={r.title} {...r} />
          ))}
        </Section>

        <Section title="Kelola obrolan Anda">
          {obrolan.map((r) => (
            <FeatureRow key={r.title} {...r} />
          ))}
        </Section>
      </main>

      <ChatBottomNav />
    </div>
  );
}

function StatCard({
  Icon,
  value,
  label,
  trend,
}: {
  Icon: LucideIcon;
  value: string;
  label: string;
  trend?: boolean;
}) {
  return (
    <div className="rounded-2xl border p-3">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-2xl font-semibold leading-none">{value}</span>
        {trend ? <ArrowDownRight className="h-4 w-4 text-rose-500" /> : null}
      </div>
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{label}</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      <ul className="divide-y">{children}</ul>
    </section>
  );
}

function FeatureRow({ Icon, title, desc, to, soon }: Row) {
  const inner = (
    <div className="flex items-start gap-4 py-3.5">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center text-muted-foreground">
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-base font-medium">{title}</p>
          {soon ? (
            <span className="rounded-full border px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              Segera
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
          {desc}
        </p>
      </div>
    </div>
  );
  if (to && !soon) {
    return (
      <li>
        <Link to={to} className="block hover:bg-muted/40">
          {inner}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => toast.info(`${title} segera hadir`)}
        className="block w-full text-left hover:bg-muted/40"
      >
        {inner}
      </button>
    </li>
  );
}