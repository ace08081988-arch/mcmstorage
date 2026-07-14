/**
 * Kartu status verifikasi email — muncul di /profil.
 *
 * - Menampilkan indikator progres saat `email_confirmed_at` masih kosong.
 * - Tombol "Kirim ulang email verifikasi" memanggil `supabase.auth.resend`.
 * - Polling `auth.getUser()` tiap 5 detik saat kartu terlihat & tab aktif,
 *   sampai email dikonfirmasi. Berhenti otomatis saat sudah terkonfirmasi
 *   atau saat tab di-background (menghindari kebocoran request).
 * - Setelah konfirmasi terdeteksi: transisi ke state "Terverifikasi" dan
 *   berhenti polling.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  MailCheck,
  MailWarning,
  RefreshCw,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

const POLL_INTERVAL_MS = 5000;
// Cooldown resend supaya tidak kena rate-limit Supabase (default 60 dtk).
const RESEND_COOLDOWN_MS = 60_000;

function formatSecs(ms: number) {
  return Math.max(0, Math.ceil(ms / 1000));
}

export function EmailVerificationStatus() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [resending, setResending] = useState(false);
  const [nextResendAt, setNextResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = async () => {
    const { data } = await supabase.auth.getUser();
    if (!mountedRef.current) return;
    const u = data.user;
    setEmail(u?.email ?? null);
    setConfirmedAt(u?.email_confirmed_at ?? u?.confirmed_at ?? null);
    setLastCheckedAt(Date.now());
    setPollCount((c) => c + 1);
    setLoading(false);
  };

  // Load awal.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling saat email belum terkonfirmasi + tab aktif.
  useEffect(() => {
    if (loading || confirmedAt) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        await refresh();
      }
      if (cancelled) return;
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, confirmedAt]);

  // Detak "now" tiap detik supaya countdown cooldown & progress hidup.
  useEffect(() => {
    if (confirmedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [confirmedAt]);

  // Reaksi realtime: dengarkan onAuthStateChange — Supabase memicu
  // USER_UPDATED saat email dikonfirmasi lewat tab lain.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "USER_UPDATED" || event === "SIGNED_IN") {
        void refresh();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const cooldownLeft = nextResendAt ? Math.max(0, nextResendAt - now) : 0;

  const doResend = async () => {
    if (!email || resending || cooldownLeft > 0) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
      });
      if (error) throw error;
      setNextResendAt(Date.now() + RESEND_COOLDOWN_MS);
      toast.success("Email verifikasi dikirim ulang.", {
        description: `Kirim ke ${email}. Cek inbox / spam.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Gagal mengirim ulang";
      toast.error(msg);
    } finally {
      if (mountedRef.current) setResending(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-ms-base">Verifikasi email</CardTitle>
          <CardDescription>Memeriksa status verifikasi…</CardDescription>
        </CardHeader>
        <CardContent className="space-ms-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-40" />
        </CardContent>
      </Card>
    );
  }

  // Tidak ada email → tidak relevan.
  if (!email) return null;

  const verified = Boolean(confirmedAt);

  return (
    <Card
      aria-labelledby="email-verify-title"
      className={verified ? "border-emerald-500/40" : "border-amber-500/40"}
      data-testid="email-verify-card"
      data-state={verified ? "verified" : "pending"}
    >
      <CardHeader>
        <div className="flex items-center gap-ms-2">
          {verified ? (
            <CheckCircle2
              className="h-5 w-5 text-emerald-500"
              aria-hidden="true"
            />
          ) : (
            <MailWarning
              className="h-5 w-5 text-amber-500"
              aria-hidden="true"
            />
          )}
          <CardTitle id="email-verify-title" className="text-ms-base">
            Verifikasi email
          </CardTitle>
          <Badge
            variant={verified ? "default" : "secondary"}
            className="ml-auto"
            data-testid="email-verify-badge"
          >
            {verified ? "Terverifikasi" : "Menunggu"}
          </Badge>
        </div>
        <CardDescription>
          {verified ? (
            <>
              Email <b>{email}</b> sudah dikonfirmasi
              {confirmedAt && (
                <>
                  {" "}
                  pada{" "}
                  <time dateTime={confirmedAt}>
                    {new Date(confirmedAt).toLocaleString("id-ID")}
                  </time>
                </>
              )}
              . Fitur yang butuh email terkonfirmasi (mis. upgrade akun) kini
              terbuka.
            </>
          ) : (
            <>
              Kami mengirim tautan verifikasi ke <b>{email}</b>. Buka email
              itu untuk mengaktifkan akun. Halaman ini otomatis memantau
              status.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-ms-3">
        {!verified && (
          <>
            {/* Indikator progres polling */}
            <div
              className="space-y-1.5 rounded-md border bg-muted/30 p-ms-2.5"
              data-testid="email-verify-progress"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-ms-2 text-ms-sm">
                <Loader2
                  className="h-4 w-4 animate-spin text-primary"
                  aria-hidden="true"
                />
                <span>Menunggu konfirmasi email…</span>
                <span className="ml-auto text-ms-2xs text-muted-foreground">
                  Cek #{pollCount}
                </span>
              </div>
              <Progress
                value={((now / POLL_INTERVAL_MS) % 1) * 100}
                className="h-1.5"
                aria-label="Progres pengecekan berikutnya"
              />
              <p className="text-ms-2xs text-muted-foreground">
                {lastCheckedAt
                  ? `Cek terakhir: ${new Date(lastCheckedAt).toLocaleTimeString("id-ID")} · Pengecekan berikutnya tiap ${POLL_INTERVAL_MS / 1000} detik.`
                  : `Pengecekan berjalan tiap ${POLL_INTERVAL_MS / 1000} detik.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-ms-2">
              <Button
                type="button"
                onClick={doResend}
                disabled={resending || cooldownLeft > 0}
                className="gap-ms-2"
                data-testid="email-verify-resend"
              >
                {resending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <MailCheck className="h-4 w-4" aria-hidden="true" />
                )}
                {cooldownLeft > 0
                  ? `Kirim ulang (${formatSecs(cooldownLeft)}s)`
                  : "Kirim ulang email verifikasi"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void refresh()}
                className="gap-ms-2"
                data-testid="email-verify-check-now"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Cek sekarang
              </Button>
            </div>

            <p className="text-ms-2xs text-muted-foreground">
              Sudah klik tautan tapi masih "Menunggu"? Coba tombol <b>Cek
              sekarang</b> atau muat ulang halaman.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
