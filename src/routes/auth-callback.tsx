import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MailWarning, ShieldCheck, ArrowRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

const SAFE_PATH = /^\/(?!\/)[^\s\\]*$/;
const FORBIDDEN_TARGETS = new Set(["/auth", "/auth-callback"]);

function safeTarget(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (value.length > 512 || !SAFE_PATH.test(value) || /[\r\n]/.test(value)) {
    return "/";
  }
  // Cegah loop balik ke halaman verifikasi / login.
  const pathOnly = value.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (FORBIDDEN_TARGETS.has(pathOnly)) return "/";
  return value;
}

export const Route = createFileRoute("/auth-callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Memproses Verifikasi — MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "done" | "manual" | "error">("loading");
  const [message, setMessage] = useState("Sedang memeriksa tautan verifikasi Anda…");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [target] = useState(() => {
    if (typeof window === "undefined") return "/";
    const params = new URLSearchParams(window.location.search);
    const redirect = safeTarget(params.get("redirect"));
    return redirect !== "/" ? redirect : safeTarget(params.get("next"));
  });

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        const code = url.searchParams.get("code");
        const callbackError =
          hash.get("error_description") ??
          hash.get("error") ??
          url.searchParams.get("error_description") ??
          url.searchParams.get("error");

        if (callbackError) throw new Error(callbackError.replace(/\+/g, " "));

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          await supabase.auth.getSession();
        }

        const { data, error } = await supabase.auth.getUser();
        if (cancelled) return;

        if (error || !data.user) {
          setStatus("manual");
          setMessage("Email Anda sudah terverifikasi. Silakan masuk dengan email dan kata sandi.");
          toast.success("Email terverifikasi. Silakan masuk.");
          window.history.replaceState({}, document.title, "/auth-callback");
          return;
        }

        setStatus("done");
        setMessage("Verifikasi berhasil. Anda akan diarahkan ke aplikasi sebentar lagi.");
        toast.success("Verifikasi berhasil");
        window.history.replaceState({}, document.title, "/auth-callback");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage("Tautan verifikasi tidak dapat diproses.");
        setErrorDetail(err instanceof Error ? err.message : "Terjadi kesalahan tidak dikenal.");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Countdown & redirect after success
  useEffect(() => {
    if (status !== "done") return;
    const tick = window.setInterval(() => {
      setCountdown((n) => (n > 0 ? n - 1 : 0));
    }, 1000);
    const timeout = window.setTimeout(() => {
      navigate({ to: target, replace: true });
      // Fallback keras kalau router tertahan gate.
      window.setTimeout(() => {
        if (window.location.pathname === "/auth-callback") {
          window.location.assign(target);
        }
      }, 800);
    }, 3000);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(timeout);
    };
  }, [status, navigate, target]);

  const goNow = () => {
    navigate({ to: target, replace: true });
    window.setTimeout(() => {
      if (window.location.pathname === "/auth-callback") {
        window.location.assign(target);
      }
    }, 400);
  };

  const retry = () => {
    window.location.reload();
  };

  const banner = {
    loading: {
      Icon: Loader2,
      iconClass: "animate-spin text-primary",
      bgClass: "bg-primary/10 border-primary/20",
      title: "Memproses verifikasi",
      badge: "Sedang memeriksa…",
    },
    done: {
      Icon: CheckCircle2,
      iconClass: "text-emerald-600",
      bgClass: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900",
      title: "Verifikasi berhasil",
      badge: "Akun aktif",
    },
    manual: {
      Icon: ShieldCheck,
      iconClass: "text-primary",
      bgClass: "bg-primary/10 border-primary/20",
      title: "Email terverifikasi",
      badge: "Silakan masuk",
    },
    error: {
      Icon: MailWarning,
      iconClass: "text-destructive",
      bgClass: "bg-destructive/10 border-destructive/30",
      title: "Verifikasi gagal",
      badge: "Perlu tindakan",
    },
  }[status];

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md">
        {/* Status banner */}
        <div className={`rounded-t-2xl border border-b-0 p-4 flex items-center gap-3 ${banner.bgClass}`}>
          <banner.Icon className={`h-6 w-6 shrink-0 ${banner.iconClass}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">{banner.title}</p>
            <p className="text-xs opacity-80">{banner.badge}</p>
          </div>
        </div>

        <div className="rounded-b-2xl border bg-card p-6 shadow-sm">
          <p className="text-sm text-foreground/90">{message}</p>

          {status === "error" && errorDetail && (
            <p className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground break-words">
              Detail: {errorDetail}
            </p>
          )}

          {/* Langkah selanjutnya */}
          <div className="mt-4 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground/80 mb-1">Langkah selanjutnya</p>
            {status === "loading" && (
              <p>Mohon tunggu sebentar, jangan tutup halaman ini.</p>
            )}
            {status === "done" && (
              <ul className="list-disc pl-4 space-y-1">
                <li>Anda akan dibawa ke aplikasi dalam {countdown} detik.</li>
                <li>Perangkat baru mungkin diminta verifikasi tambahan sekali (SMS/email) sebelum masuk dashboard.</li>
              </ul>
            )}
            {status === "manual" && (
              <p>Sesi belum aktif di perangkat ini. Silakan masuk dengan email & kata sandi yang Anda daftarkan.</p>
            )}
            {status === "error" && (
              <ul className="list-disc pl-4 space-y-1">
                <li>Tautan mungkin sudah kedaluwarsa atau sudah digunakan.</li>
                <li>Coba muat ulang halaman ini, atau minta tautan baru dari halaman Masuk.</li>
              </ul>
            )}
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-col gap-2">
            {status === "done" && (
              <button
                onClick={goNow}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Lanjut ke aplikasi <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {(status === "manual" || status === "error") && (
              <Link
                to="/auth"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Ke halaman Masuk <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            {status === "error" && (
              <button
                onClick={retry}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <RefreshCw className="h-4 w-4" /> Coba lagi
              </button>
            )}
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          Butuh bantuan? Hubungi admin toko atau minta tautan verifikasi baru.
        </p>
      </section>
    </main>
  );
}