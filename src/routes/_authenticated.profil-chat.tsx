import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft, Search, QrCode, Smile, KeyRound, Lock, Users, MessageSquare,
  Bell, RefreshCcw, Link as LinkIcon, Accessibility, Languages, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useMyProfile, useAvatarSignedUrl } from "@/lib/profile";
import { useState } from "react";
import { ProfileQrDialog } from "@/components/chat/ProfileQrDialog";

export const Route = createFileRoute("/_authenticated/profil-chat")({
  component: ProfilChatPage,
});

type Row = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  to?: string;
  soon?: boolean;
};

const ROWS: Row[] = [
  { icon: KeyRound, title: "Akun", desc: "Notifikasi keamanan, ganti nomor", to: "/sesi" },
  { icon: Lock, title: "Privasi", desc: "Akun diblokir, pesan sementara", to: "/pengaturan-kunci" },
  { icon: Users, title: "Daftar", desc: "Kelola orang dan grup", to: "/buku-alamat" },
  { icon: MessageSquare, title: "Chat", desc: "Tema, wallpaper, riwayat obrolan", to: "/chat-audit" },
  { icon: Bell, title: "Notifikasi", desc: "Pesan, grup & nada dering panggilan", to: "/chat" },
  { icon: RefreshCcw, title: "Penyimpanan dan data", desc: "Penggunaan jaringan, unduh otomatis", to: "/pengaturan-penyimpanan" },
  { icon: LinkIcon, title: "Facebook & Instagram", desc: "Hubungkan untuk menjangkau lebih banyak pelanggan", to: "/pengaturan-integrasi-sosial" },
  { icon: Accessibility, title: "Aksesibilitas", desc: "Tingkatkan kontras, animasi", to: "/pengaturan-aksesibilitas" },
  { icon: Languages, title: "Bahasa Aplikasi", desc: "Bahasa Indonesia (perangkat)", to: "/pengaturan-bahasa" },
];

function initialOf(name: string | null | undefined): string {
  const s = (name ?? "").trim();
  if (!s) return "?";
  return s[0]!.toUpperCase();
}

function ProfilChatPage() {
  const router = useRouter();
  const { data: profile } = useMyProfile();
  const { data: avatarUrl } = useAvatarSignedUrl(profile?.avatar_url ?? null);

  const name = profile?.display_name || profile?.email?.split("@")[0] || "Saya";
  const initial = initialOf(name);
  const [qrOpen, setQrOpen] = useState(false);

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center gap-4 bg-background px-4 py-3">
        <button
          type="button"
          aria-label="Kembali"
          onClick={() => router.history.back()}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-lg font-semibold">Pengaturan</h1>
        <button
          type="button"
          aria-label="Cari"
          onClick={() => toast.info("Pencarian pengaturan segera hadir.")}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-accent"
        >
          <Search className="h-5 w-5" />
        </button>
      </header>

      {/* Profile card */}
      <section className="flex items-center gap-4 px-4 py-4">
        <div className="relative h-16 w-16 shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-full bg-orange-950 text-3xl font-medium text-orange-300">
              {initial}
            </div>
          )}
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xl font-medium">{name}</div>
          <button
            type="button"
            onClick={() => toast.info("Status kustom segera hadir.")}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            <Smile className="h-3.5 w-3.5" />
            Saat ini saya sedang…
          </button>
        </div>
        <button
          type="button"
          aria-label="Kode QR profil"
          onClick={() => setQrOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-lg hover:bg-accent"
        >
          <QrCode className="h-6 w-6 text-primary" />
        </button>
      </section>

      <div className="h-px bg-border" />

      {/* Rows */}
      <ul className="py-1">
        {ROWS.map((r) => {
          const content = (
            <div className="flex items-center gap-4 px-4 py-3 active:bg-accent/60 hover:bg-accent/40">
              <r.icon className="h-6 w-6 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base">{r.title}</div>
                <div className="truncate text-sm text-muted-foreground">{r.desc}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            </div>
          );
          if (r.soon || !r.to) {
            return (
              <li key={r.title}>
                <button
                  type="button"
                  onClick={() => toast.info(`${r.title} — segera hadir.`)}
                  className="block w-full text-left"
                >
                  {content}
                </button>
              </li>
            );
          }
          return (
            <li key={r.title}>
              <Link to={r.to as "/sesi"}>{content}</Link>
            </li>
          );
        })}
      </ul>

      <ProfileQrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        name={name}
        email={profile?.email ?? null}
        phone={profile?.phone ?? null}
        userId={profile?.id ?? null}
        avatarUrl={avatarUrl ?? null}
      />
    </main>
  );
}
