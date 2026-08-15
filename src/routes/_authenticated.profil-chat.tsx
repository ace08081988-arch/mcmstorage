import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Search, QrCode, Smile, KeyRound, Lock, Users, MessageSquare,
  Bell, RefreshCcw, Link as LinkIcon, Accessibility, Languages, ChevronRight,
  UserPlus, Download, Loader2,
  Copy, Check, Palette, QrCode as QrCodeIcon,
  ShieldCheck, AlertTriangle, ClipboardCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useMyProfile, useAvatarSignedUrl, useMyProfileRealtime } from "@/lib/profile";
import { useState } from "react";
import { ProfileQrDialog } from "@/components/chat/ProfileQrDialog";
import { ApkQrDialog, type ApkQrTarget } from "@/components/ApkQrDialog";
import { formatInviteCode } from "@/lib/invite";
import {
  getLatestApkVariants,
  getApkVariantDetail,
  validateChatApkLink,
  type ApkRelease,
  type ValidateApkLinkResult,
} from "@/lib/apk.functions";
import { trackApkDownload } from "@/lib/apk-download-track";
import { goBackOr } from "@/lib/back-nav";
import {
  useChatApkHistory,
  recordChatApkDownload,
  clearChatApkHistory,
  formatAgoID,
} from "@/lib/chat-apk-history";
import { History, Trash2 } from "lucide-react";
import {
import { ChatSectionHeader } from "@/components/chat/ChatSectionHeader";
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

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
  { icon: Palette, title: "Tampilan", desc: "Tema, aksen, font, latar & preset", to: "/pengaturan-tampilan" },
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
  const [apkPickerOpen, setApkPickerOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [qrTarget, setQrTarget] = useState<ApkQrTarget | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<
    | (ValidateApkLinkResult & { checkedUrl: string })
    | null
  >(null);
  const validateFn = useServerFn(validateChatApkLink);

  const validateClipboardLink = async () => {
    let url = "";
    try {
      url = (await navigator.clipboard.readText()).trim();
    } catch {
      toast.error("Tidak bisa membaca clipboard. Salin ulang lalu coba lagi.");
      return;
    }
    if (!url) {
      toast.error("Clipboard kosong. Salin link unduh terlebih dahulu.");
      return;
    }
    setValidating(true);
    try {
      const res = await validateFn({ data: { url } });
      setValidation({ ...res, checkedUrl: url });
      if (res.active) {
        toast.success("Link masih aktif.");
      } else if (res.reason === "expired") {
        toast.message("Link kedaluwarsa — tersedia link baru.");
      } else if (res.reason === "not_found") {
        toast.error("Berkas APK sudah tidak tersedia.");
      } else if (res.reason === "unpublished") {
        toast.error("Versi ini sudah tidak dipublikasikan.");
      } else if (res.reason === "wrong_variant") {
        toast.error("Link bukan APK Ace Chat.");
      } else if (res.reason === "invalid_url") {
        toast.error("Format link tidak dikenali.");
      } else {
        toast.error("Gagal memvalidasi link. Coba lagi.");
      }
    } catch {
      toast.error("Gagal memvalidasi link. Coba lagi.");
    } finally {
      setValidating(false);
    }
  };

  const copyLink = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      trackApkDownload("chat", "copy_file");
      toast.success("Link unduh disalin — tempel di perangkat lain.");
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
    } catch {
      toast.error("Gagal menyalin link. Coba lagi.");
    }
  };

  // Pintasan unduh APK Chat saja — ambil URL varian chat terbaru.
  const fetchApk = useServerFn(getLatestApkVariants);
  const apkQuery = useQuery({
    queryKey: ["latest-apk-variants"],
    queryFn: () => fetchApk(),
    staleTime: 60_000,
  });
  const chatApk = apkQuery.data?.chat ?? null;

  // Daftar semua versi (untuk dialog pemilih versi).
  const fetchDetail = useServerFn(getApkVariantDetail);
  const detailQuery = useQuery({
    queryKey: ["apk-variant-detail", "chat"],
    queryFn: () => fetchDetail({ data: { variant: "chat" } }),
    staleTime: 60_000,
    enabled: apkPickerOpen,
  });
  const chatReleases = detailQuery.data?.releases ?? [];
  const history = useChatApkHistory();
  const latestKey = chatReleases[0]?.name ?? null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-background">
      {/* Top bar */}
      <ChatSectionHeader
        title="Pengaturan"
        actions={
          <button
            type="button"
            aria-label="Cari"
            onClick={() => toast.info("Pencarian pengaturan segera hadir.")}
            className="grid h-11 w-11 place-items-center rounded-full hover:bg-accent"
          >
            <Search className="h-5 w-5" />
          </button>
        }
      />

      {/* Profile card */}
      <section className="flex items-center gap-ms-4 px-ms-4 py-ms-4">
        <div className="relative h-16 w-16 shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name}
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-full bg-orange-950 text-ms-3xl font-medium text-orange-300">
              {initial}
            </div>
          )}
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-ms-xl font-medium">{name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-ms-1.5">
            <button
              type="button"
              onClick={() => toast.info("Status kustom segera hadir.")}
              className="inline-flex items-center gap-ms-1.5 rounded-full bg-muted px-ms-2.5 py-1 text-ms-xs text-muted-foreground hover:bg-accent"
            >
              <Smile className="h-3.5 w-3.5" />
              Saat ini saya sedang…
            </button>
            {profile?.invite_code ? (
              <Link
                to="/undang"
                className="inline-flex items-center gap-ms-1.5 rounded-full bg-primary/10 px-ms-2.5 py-1 font-mono text-ms-xs tabular-nums tracking-widest text-primary hover:bg-primary/20"
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
      <div className="px-ms-4 pt-3">
        {chatApk?.url ? (
          <button
            type="button"
            onClick={() => setApkPickerOpen(true)}
            className="flex w-full items-center gap-ms-4 rounded-xl border bg-primary/5 px-ms-4 py-ms-3 text-left hover:bg-primary/10"
          >
            <Download className="h-6 w-6 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-ms-base font-medium">Unduh APK Ace Chat</div>
              <div className="truncate text-ms-sm text-muted-foreground">
                Terbaru: {chatApk.versionName ? `v${chatApk.versionName}` : "?"}
                {chatApk.sizeMB ? ` · ${chatApk.sizeMB} MB` : ""} · Pilih versi
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          </button>
        ) : (
          <div className="flex items-center gap-ms-4 rounded-xl border bg-muted/40 px-ms-4 py-ms-3 text-muted-foreground">
            {apkQuery.isLoading ? (
              <Loader2 className="h-6 w-6 shrink-0 animate-spin" />
            ) : (
              <Download className="h-6 w-6 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-ms-base font-medium">Unduh APK Ace Chat</div>
              <div className="truncate text-ms-sm">
                {apkQuery.isLoading
                  ? "Memuat versi terbaru..."
                  : "APK belum tersedia — buka halaman /download."}
              </div>
            </div>
            <Link
              to="/download"
              className="text-ms-xs font-semibold text-primary hover:underline"
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
            <div className="flex items-center gap-ms-4 px-ms-4 py-ms-3 active:bg-accent/60 hover:bg-accent/40">
              <r.icon className="h-6 w-6 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-ms-base">{r.title}</div>
                <div className="truncate text-ms-sm text-muted-foreground">{r.desc}</div>
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

      <Dialog open={apkPickerOpen} onOpenChange={setApkPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pilih versi Ace Chat</DialogTitle>
            <DialogDescription>
              Unduh versi terbaru atau pilih rilis sebelumnya bila diperlukan.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-ms-2 rounded-lg border bg-muted/20 px-ms-2.5 py-ms-2">
            <div className="flex min-w-0 items-center gap-ms-1.5 text-ms-2xs text-muted-foreground">
              <ClipboardCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                Cek apakah link yang Anda salin masih bisa dipakai.
              </span>
            </div>
            <button
              type="button"
              onClick={validateClipboardLink}
              disabled={validating}
              className="inline-flex items-center gap-ms-1.5 rounded-md border bg-background px-ms-2.5 py-1 text-ms-2xs font-medium hover:bg-accent disabled:opacity-60"
            >
              {validating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              {validating ? "Memeriksa..." : "Validasi link tersalin"}
            </button>
          </div>
          {validation && (
            <div
              className={`rounded-lg border px-ms-3 py-ms-2 text-ms-xs ${
                validation.active
                  ? "border-success/40 bg-success/10 text-success dark:text-success"
                  : validation.reason === "expired"
                  ? "border-warning/40 bg-warning/10 text-warning dark:text-warning"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
              role="status"
            >
              <div className="flex items-start gap-ms-2">
                {validation.active ? (
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">
                    {validation.active
                      ? "Link masih aktif"
                      : validation.reason === "expired"
                      ? "Link kedaluwarsa"
                      : validation.reason === "not_found"
                      ? "Berkas sudah tidak tersedia"
                      : validation.reason === "unpublished"
                      ? "Versi sudah tidak dipublikasikan"
                      : validation.reason === "wrong_variant"
                      ? "Link bukan APK Ace Chat"
                      : validation.reason === "invalid_url"
                      ? "Format link tidak dikenali"
                      : "Gagal memvalidasi"}
                  </div>
                  <div className="mt-0.5 truncate opacity-80">
                    {validation.name
                      ? `${
                          validation.versionName
                            ? `v${validation.versionName}`
                            : validation.name
                        }${
                          validation.sizeMB ? ` · ${validation.sizeMB} MB` : ""
                        }`
                      : validation.checkedUrl}
                  </div>
                  {validation.freshUrl && !validation.active && (
                    <div className="mt-2 flex flex-wrap gap-ms-1.5">
                      <a
                        href={validation.freshUrl}
                        onClick={() => {
                          if (!validation.name) return;
                          trackApkDownload("chat", "button");
                          recordChatApkDownload({
                            name: validation.name,
                            versionName: validation.versionName,
                            versionCode: validation.versionCode,
                            url: validation.freshUrl!,
                            sizeMB: validation.sizeMB,
                          });
                        }}
                        className="inline-flex items-center gap-ms-1 rounded-md border bg-background px-ms-2 py-1 text-ms-2xs font-medium text-foreground hover:bg-accent"
                      >
                        <Download className="h-3 w-3" />
                        Unduh link baru
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!validation.freshUrl) return;
                          try {
                            await navigator.clipboard.writeText(
                              validation.freshUrl,
                            );
                            toast.success("Link baru disalin.");
                          } catch {
                            toast.error("Gagal menyalin.");
                          }
                        }}
                        className="inline-flex items-center gap-ms-1 rounded-md border bg-background px-ms-2 py-1 text-ms-2xs font-medium text-foreground hover:bg-accent"
                      >
                        <Copy className="h-3 w-3" />
                        Salin link baru
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setValidation(null)}
                  aria-label="Tutup"
                  className="text-current opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </div>
            </div>
          )}
          {history.length > 0 && (
            <section className="rounded-lg border bg-muted/30 p-ms-2">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <div className="flex items-center gap-ms-1.5 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <History className="h-3.5 w-3.5" />
                  Riwayat unduhan Anda ({history.length})
                </div>
                <button
                  type="button"
                  onClick={() => {
                    clearChatApkHistory();
                    toast.success("Riwayat unduhan dihapus.");
                  }}
                  className="inline-flex items-center gap-ms-1 text-ms-2xs font-medium text-muted-foreground hover:text-destructive"
                  aria-label="Hapus riwayat unduhan"
                >
                  <Trash2 className="h-3 w-3" />
                  Hapus
                </button>
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {history.slice(0, 8).map((h) => (
                  <li key={`${h.name}-${h.downloadedAt}`}>
                    <a
                      href={h.url}
                      onClick={() => {
                        trackApkDownload("chat", "copy_page");
                        recordChatApkDownload({
                          name: h.name,
                          versionName: h.versionName,
                          versionCode: h.versionCode,
                          url: h.url,
                          sizeMB: h.sizeMB,
                        });
                      }}
                      className="flex items-center gap-ms-2 rounded-md px-ms-2 py-1.5 hover:bg-accent"
                    >
                      <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-ms-xs font-medium">
                          {h.versionName ? `v${h.versionName}` : h.name}
                          {h.versionCode !== null && (
                            <span className="ml-1 text-ms-2xs text-muted-foreground">
                              (build {h.versionCode})
                            </span>
                          )}
                        </div>
                        <div className="truncate text-ms-2xs text-muted-foreground">
                          {formatAgoID(h.downloadedAt)}
                          {h.sizeMB ? ` · ${h.sizeMB} MB` : ""}
                        </div>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {detailQuery.isLoading ? (
            <div className="flex items-center justify-center gap-ms-2 py-ms-6 text-ms-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Memuat daftar versi...
            </div>
          ) : chatReleases.length === 0 ? (
            <p className="py-ms-6 text-center text-ms-sm text-muted-foreground">
              Belum ada rilis APK yang tersedia.
            </p>
          ) : (
            <ul className="max-h-[60vh] space-ms-2 overflow-y-auto pr-1">
              {chatReleases.map((r: ApkRelease) => {
                const isLatest = r.name === latestKey;
                return (
                  <li key={r.name}>
                    <div
                      className={`flex items-center gap-ms-2 rounded-lg border px-ms-3 py-ms-2.5 transition ${
                        isLatest
                          ? "border-primary/60 bg-primary/5"
                          : ""
                      }`}
                    >
                    <a
                      href={r.url}
                      onClick={() => {
                        trackApkDownload("chat", isLatest ? "button" : "copy_page");
                        recordChatApkDownload({
                          name: r.name,
                          versionName: r.versionName ?? null,
                          versionCode: r.versionCode ?? null,
                          url: r.url,
                          sizeMB: r.sizeMB ?? null,
                        });
                      }}
                      className="flex min-w-0 flex-1 items-center gap-ms-3"
                    >
                      <Download
                        className={`h-5 w-5 shrink-0 ${
                          isLatest ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-ms-2">
                          <span className="truncate text-ms-sm font-medium">
                            {r.versionName ? `v${r.versionName}` : r.name}
                            {r.versionCode !== null && (
                              <span className="ml-1 text-ms-2xs text-muted-foreground">
                                (build {r.versionCode})
                              </span>
                            )}
                          </span>
                          {isLatest && (
                            <span className="rounded-full bg-primary px-ms-2 py-0.5 text-ms-2xs font-semibold text-primary-foreground">
                              Terbaru
                            </span>
                          )}
                          {r.belowMinimum && !isLatest && (
                            <span className="rounded-full bg-warning/15 px-ms-2 py-0.5 text-ms-2xs font-semibold text-warning dark:text-warning">
                              Lawas
                            </span>
                          )}
                        </div>
                        <div className="truncate text-ms-2xs text-muted-foreground">
                          {r.sizeMB ? `${r.sizeMB} MB` : "Ukuran ?"}
                          {r.updatedAt
                            ? ` · ${new Date(r.updatedAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}`
                            : ""}
                        </div>
                      </div>
                    </a>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          void copyLink(r.name, r.url);
                        }}
                        aria-label="Salin link unduh"
                        title="Salin link unduh"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border hover:bg-accent"
                      >
                        {copiedKey === r.name ? (
                          <Check className="h-4 w-4 text-success" />
                        ) : (
                          <Copy className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setQrTarget({
                            label: r.versionName ? `Ace Chat v${r.versionName}` : r.name,
                            url: r.url,
                            meta: r.sizeMB ? `${r.sizeMB} MB` : undefined,
                          });
                        }}
                        aria-label="Tampilkan QR unduh"
                        title="Pindai QR untuk unduh di perangkat lain"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border hover:bg-accent"
                      >
                        <QrCodeIcon className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <ApkQrDialog target={qrTarget} onOpenChange={(o) => { if (!o) setQrTarget(null); }} />
    </main>
  );
}
