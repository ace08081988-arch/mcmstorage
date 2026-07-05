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

const AREAS: Array<{ key: AreaKey; label: string; hint: string }> = [
  { key: "chat", label: "Komunikasi (Chat, Kontak)", hint: "Selalu terbuka untuk semua akun." },
  { key: "gudang", label: "Gudang & Stok", hint: "Butuh akun MCM Storage — RLS memblokir akun Chat-only." },
  { key: "penjualan", label: "Penjualan & Pembelian", hint: "Butuh akun MCM Storage — laporan & mutasi stok terkunci." },
  { key: "hutang_piutang", label: "Hutang & Piutang", hint: "Butuh akun MCM Storage — pencatatan debts terproteksi RLS." },
  { key: "penyiapan", label: "Penyiapan Pegawai", hint: "Butuh akun MCM Storage — RPC prep_* menolak akun Chat-only." },
  { key: "pos_kasir", label: "POS Kasir", hint: "Butuh akun MCM Storage — tergantung stok gudang." },
];

export function AccessStatusCard() {
  const [loading, setLoading] = useState(true);
  const [chatOnly, setChatOnly] = useState<boolean | null>(null);
  const [emailConfirmed, setEmailConfirmed] = useState<boolean>(false);
  const [email, setEmail] = useState<string | null>(null);

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
                return (
                  <li
                    key={a.key}
                    className="flex items-start gap-2 rounded-md border bg-background p-2"
                    data-testid={`access-area-${a.key}`}
                    data-allowed={ok ? "1" : "0"}
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
