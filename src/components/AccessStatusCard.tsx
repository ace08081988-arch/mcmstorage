/**
 * Kartu status izin akun — tampil di halaman /profil di atas
 * <UpgradeToStorageCard/>. Tujuannya: sebelum meng-upgrade, pengguna
 * bisa melihat mode akses saat ini (MCM Chat vs MCM Storage) dan
 * daftar area yang diblokir/dibuka RLS beserta alasan penolakan yang
 * jelas — bukan sekadar toast "tidak memiliki akses" saat gagal.
 */
import { useEffect, useState } from "react";
import {
  ShieldCheck,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  MailWarning,
  Info,
  ChevronDown,
  ArrowRight,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type AreaKey =
  | "chat"
  | "gudang"
  | "penjualan"
  | "hutang_piutang"
  | "penyiapan"
  | "pos_kasir";

type AreaSpec = {
  key: AreaKey;
  label: string;
  hint: string;
  /** Tabel/RPC yang diperiksa RLS untuk area ini. */
  tables: string[];
  /** Policy USING/WITH CHECK yang menentukan izin (ringkasan). */
  policy: string;
  /** Langkah konkret untuk membuka akses (urut). */
  steps: string[];
};

const AREAS: AreaSpec[] = [
  {
    key: "chat",
    label: "Komunikasi (Chat, Kontak)",
    hint: "Selalu terbuka untuk semua akun.",
    tables: ["conversations", "messages", "conversation_members", "address_book"],
    policy: "auth.uid() = user_id (tanpa cek chat_only)",
    steps: [
      "Tidak ada tindakan diperlukan.",
      "Jika toast tetap muncul: pastikan Anda sudah masuk (session belum expired), lalu muat ulang halaman.",
    ],
  },
  {
    key: "gudang",
    label: "Gudang & Stok",
    hint: "Butuh akun MCM Storage — RLS memblokir akun Chat-only.",
    tables: [
      "warehouse_items",
      "warehouse_item_variants",
      "warehouse_category_variants",
    ],
    policy: "user_id = auth.uid() AND NOT is_chat_only(auth.uid())",
    steps: [
      "Verifikasi email dulu (lihat kartu ‘Status verifikasi email’ di bawah).",
      "Buka kartu ‘Upgrade ke MCM Storage’ → tekan tombol upgrade.",
      "Aplikasi memuat ulang otomatis; policy is_chat_only(uid) langsung menjadi false pada query berikutnya.",
      "Jika tetap 42501 setelah upgrade: keluar lalu masuk kembali agar token JWT segar.",
    ],
  },
  {
    key: "penjualan",
    label: "Penjualan & Pembelian",
    hint: "Butuh akun MCM Storage — laporan & mutasi stok terkunci.",
    tables: ["sales", "purchases", "customers", "suppliers"],
    policy: "user_id = auth.uid() AND NOT is_chat_only(auth.uid())",
    steps: [
      "Upgrade ke MCM Storage terlebih dulu (buka Gudang & Stok tidak cukup — semua tabel penjualan pakai policy yang sama).",
      "Setelah upgrade, coba catat 1 penjualan dummy. Jika 42501 tetap muncul, laporkan lewat menu bantuan — bukan hanya retry.",
    ],
  },
  {
    key: "hutang_piutang",
    label: "Hutang & Piutang",
    hint: "Butuh akun MCM Storage — pencatatan debts terproteksi RLS.",
    tables: ["debts", "debt_payments", "customer_payments", "supplier_payments"],
    policy: "user_id = auth.uid() AND NOT is_chat_only(auth.uid())",
    steps: [
      "Upgrade ke MCM Storage.",
      "Pastikan customer/supplier terkait juga milik Anda (kolom user_id sama) — RLS menolak baris milik akun lain, ini bukan bug.",
    ],
  },
  {
    key: "penyiapan",
    label: "Penyiapan Pegawai",
    hint: "Butuh akun MCM Storage — RPC prep_* menolak akun Chat-only.",
    tables: [
      "prep_tasks",
      "prep_task_items",
      "prep_submissions",
      "ready_packages",
    ],
    policy: "SECURITY DEFINER RPC memeriksa is_chat_only(auth.uid())",
    steps: [
      "Upgrade ke MCM Storage — RPC prep_* menolak dengan 401/403 selama akun masih chat-only.",
      "Untuk pegawai (worker portal): akun pemilik yang menerbitkan link harus MCM Storage, PIN pegawai tidak butuh upgrade.",
    ],
  },
  {
    key: "pos_kasir",
    label: "POS Kasir",
    hint: "Butuh akun MCM Storage — tergantung stok gudang.",
    tables: ["warehouse_items (baca)", "sales (tulis)"],
    policy: "Bergantung pada policy Gudang & Penjualan di atas",
    steps: [
      "Upgrade ke MCM Storage — POS membaca stok langsung dari warehouse_items.",
      "Jika total stok = 0 setelah upgrade, isi minimal 1 item di halaman Gudang, lalu buka ulang POS.",
    ],
  },
];

export function AccessStatusCard() {
  const [loading, setLoading] = useState(true);
  const [chatOnly, setChatOnly] = useState<boolean | null>(null);
  const [emailConfirmed, setEmailConfirmed] = useState<boolean>(false);
  const [email, setEmail] = useState<string | null>(null);
  const [openArea, setOpenArea] = useState<AreaKey | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      const confirmed = Boolean(
        userData.user?.email_confirmed_at || userData.user?.confirmed_at,
      );
      if (!uid) {
        if (alive) setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("chat_only")
        .eq("id", uid)
        .maybeSingle();
      if (!alive) return;
      setChatOnly(Boolean(data?.chat_only));
      setEmailConfirmed(confirmed);
      setEmail(userData.user?.email ?? null);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const isStorage = chatOnly === false;
  const modeLabel = loading
    ? "Memeriksa…"
    : chatOnly === null
      ? "Tidak diketahui"
      : isStorage
        ? "MCM Storage (akses penuh)"
        : "MCM Chat saja (akses terbatas)";

  const allowed = (key: AreaKey) => {
    if (key === "chat") return true;
    return isStorage;
  };

  const toggleArea = (key: AreaKey) =>
    setOpenArea((prev) => (prev === key ? null : key));

  return (
    <Card
      aria-labelledby="access-status-title"
      className={
        loading
          ? "border-muted"
          : isStorage
            ? "border-emerald-500/40"
            : "border-amber-500/40"
      }
    >
      <CardHeader>
        <div className="flex items-center gap-2">
          {loading ? (
            <ShieldCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          ) : isStorage ? (
            <Unlock className="h-5 w-5 text-emerald-500" aria-hidden="true" />
          ) : (
            <Lock className="h-5 w-5 text-amber-500" aria-hidden="true" />
          )}
          <CardTitle id="access-status-title" className="text-base">
            Status izin akun
          </CardTitle>
          <Badge
            data-testid="access-mode-badge"
            variant={isStorage ? "default" : "secondary"}
            className="ml-auto"
          >
            {loading ? "…" : isStorage ? "Storage" : "Chat-only"}
          </Badge>
        </div>
        <CardDescription>
          Ringkasan mode akses akun Anda saat ini. Area yang terkunci akan
          menolak aksi dengan RLS (kode <code>42501</code>) — toast akan
          menampilkan tombol <b>Perbaiki Akses</b> yang membawa Anda ke sini.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : (
          <>
            <div
              className="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5"
              data-testid="access-mode-summary"
            >
              <Info className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 text-sm">
                <div className="font-medium">{modeLabel}</div>
                <div className="text-[11px] text-muted-foreground">
                  {isStorage
                    ? "Semua fitur MCM Storage terbuka. Tidak ada aksi yang perlu Anda lakukan di sini."
                    : "Akun ini didaftarkan sebagai MCM Chat. RLS di backend menolak tabel storage (warehouse_items, sales, purchases, debts, prep_*, dst). Upgrade di kartu di bawah untuk membuka semuanya."}
                </div>
              </div>
            </div>

            {!emailConfirmed && email && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-amber-800 dark:text-amber-200"
                data-testid="access-email-warning"
                role="status"
              >
                <MailWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div className="text-[12px]">
                  Email <b>{email}</b> belum diverifikasi. Upgrade akan
                  dikunci sampai email dikonfirmasi — cek inbox atau kirim
                  ulang dari kartu upgrade di bawah.
                </div>
              </div>
            )}

            <ul className="space-y-1.5" data-testid="access-area-list">
              {AREAS.map((a) => {
                const ok = allowed(a.key);
                const open = openArea === a.key;
                return (
                  <li
                    key={a.key}
                    className="rounded-md border bg-background"
                    data-testid={`access-area-${a.key}`}
                    data-allowed={ok ? "1" : "0"}
                  >
                    <button
                      type="button"
                      onClick={() => toggleArea(a.key)}
                      aria-expanded={open}
                      aria-controls={`access-area-${a.key}-detail`}
                      className="flex w-full items-start gap-2 p-2 text-left"
                      data-testid={`access-area-${a.key}-toggle`}
                    >
                      {ok ? (
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                          aria-label="Terbuka"
                        />
                      ) : (
                        <XCircle
                          className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                          aria-label="Terkunci"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{a.label}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {ok ? "Terbuka — akun Anda diizinkan." : a.hint}
                        </div>
                      </div>
                      <Badge
                        variant={ok ? "secondary" : "outline"}
                        className="ml-2 shrink-0 text-[10px]"
                      >
                        {ok ? "Terbuka" : "Terkunci"}
                      </Badge>
                      <ChevronDown
                        className={`ml-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                    {open && (
                      <div
                        id={`access-area-${a.key}-detail`}
                        className="space-y-2 border-t bg-muted/20 px-3 py-2.5 text-[12px]"
                        data-testid={`access-area-${a.key}-detail`}
                      >
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Tabel / RPC diperiksa RLS
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {a.tables.map((t) => (
                              <code
                                key={t}
                                className="rounded bg-background px-1.5 py-0.5 text-[10.5px]"
                              >
                                {t}
                              </code>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Policy Postgres
                          </div>
                          <code className="mt-0.5 block break-words rounded bg-background px-1.5 py-1 text-[10.5px]">
                            {a.policy}
                          </code>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Langkah perbaikan
                          </div>
                          <ol className="mt-1 space-y-1">
                            {a.steps.map((s, i) => (
                              <li key={i} className="flex gap-1.5">
                                <span className="shrink-0 font-semibold text-muted-foreground">
                                  {i + 1}.
                                </span>
                                <span>{s}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                        {!ok && (
                          <a
                            href="#upgrade-to-storage"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                            data-testid={`access-area-${a.key}-cta`}
                          >
                            Menuju kartu upgrade
                            <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {!isStorage && (
              <p className="text-[11px] text-muted-foreground">
                Alasan penolakan yang akan Anda lihat di toast:
                <br />
                • <code>42501</code> — <i>permission denied</i> dari policy RLS Postgres.
                <br />
                • <code>PGRST301</code> — token JWT tidak mengizinkan akses tabel storage.
                <br />
                • <code>401/403</code> — RPC storage (mis. <code>prep_*</code>) menolak akun chat-only.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
