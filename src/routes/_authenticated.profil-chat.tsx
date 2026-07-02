import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Search, QrCode, Smile, KeyRound, Lock, Users, MessageSquare,
  Bell, RefreshCcw, Link as LinkIcon, Accessibility, Languages, ChevronRight,
  UserPlus, Download, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useMyProfile, useAvatarSignedUrl, useMyProfileRealtime } from "@/lib/profile";
import { useState } from "react";
import { ProfileQrDialog } from "@/components/chat/ProfileQrDialog";
import { formatInviteCode } from "@/lib/invite";
import { getLatestApkVariants } from "@/lib/apk.functions";
import { trackApkDownload } from "@/lib/apk-download-track";

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
  { icon: UserPlus, title: "Undang teman", desc: "Bagikan PIN atau QR seperti BBM", to: "/undang" },
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
  // Jaga avatar & nama tetap sinkron dengan perubahan lintas-tab/lintas-perangkat.
  useMyProfileRealtime();
  const { data: profile } = useMyProfile();
  const { data: avatarUrl } = useAvatarSignedUrl(profile?.avatar_url ?? null);

  const name =
    profile?.display_name
    || (profile?.invite_code ? `PIN ${formatInviteCode(profile.invite_code)}` : null)
    || "Saya";
  const initial = initialOf(name);
  const [qrOpen, setQrOpen] = useState(false);

  // Pintasan unduh APK Chat saja — ambil URL varian chat terbaru.
  const fetchApk = useServerFn(getLatestApkVariants);
  const apkQuery = useQuery({
    queryKey: ["latest-apk-variants"],
    queryFn: () => fetchApk(),
    staleTime: 60_000,
  });
  const chatApk = apkQuery.data?.chat ?? null;

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
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => toast.info("Status kustom segera hadir.")}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <Smile className="h-3.5 w-3.5" />
              Saat ini saya sedang…
            </button>
            {profile?.invite_code ? (
              <Link
                to="/undang"
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-mono text-xs tabular-nums tracking-widest text-primary hover:bg-primary/20"
                aria-label="Undang teman lewat PIN"
              >
                PIN {formatInviteCode(profile.invite_code)}
              </Link>
            ) : null}
          </div>
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

      {/* Pintasan: unduh APK Chat saja tanpa membuka /download */}
      <div className="px-4 pt-3">
        {chatApk?.url ? (
          <a
            href={chatApk.url}
            onClick={() => trackApkDownload("chat", "button")}
            className="flex items-center gap-4 rounded-xl border bg-primary/5 px-4 py-3 hover:bg-primary/10"
          >
            <Download className="h-6 w-6 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium">Unduh APK MCM Chat</div>
              <div className="truncate text-sm text-muted-foreground">
                {chatApk.versionName ? `v${chatApk.versionName}` : "Versi terbaru"}
                {chatApk.sizeMB ? ` · ${chatApk.sizeMB} MB` : ""} · Langsung unduh
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          </a>
        ) : (
          <div className="flex items-center gap-4 rounded-xl border bg-muted/40 px-4 py-3 text-muted-foreground">
            {apkQuery.isLoading ? (
              <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
            ) : (
              <Download className="h-6 w-6 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium">Unduh APK MCM Chat</div>
              <div className="truncate text-sm">
                {apkQuery.isLoading
                  ? "Memuat versi terbaru..."
                  : "APK belum tersedia — buka halaman /download."}
              </div>
            </div>
            <Link
              to="/download"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Buka
            </Link>
          </div>
        )}
      </div>

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
        email={null}
        phone={profile?.phone ?? null}
        userId={profile?.id ?? null}
        avatarUrl={avatarUrl ?? null}
      />
    </main>
  );
}
