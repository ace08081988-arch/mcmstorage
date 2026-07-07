import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MailWarning, ShieldCheck, ArrowRight, RefreshCw, Bug, Copy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logAuthDebug, readAuthDebug, clearAuthDebug, formatAuthDebug, type AuthDebugEvent } from "@/lib/auth-debug";

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
  const [showDebug, setShowDebug] = useState(false);
  const [debugEvents, setDebugEvents] = useState<AuthDebugEvent[]>([]);
  const [target] = useState(() => {
    if (typeof window === "undefined") return "/";
    const params = new URLSearchParams(window.location.search);
    const redirect = safeTarget(params.get("redirect"));
    return redirect !== "/" ? redirect : safeTarget(params.get("next"));
  });

  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();

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

        logAuthDebug("callback", "callback loaded", {
          hasHash: url.hash.length > 0,
          hasAccessToken: !!accessToken,
          hasRefreshToken: !!refreshToken,
          hasCode: !!code,
          hasError: !!callbackError,
          errorText: callbackError ?? null,
          target,
          pathname: url.pathname,
        });

        if (callbackError) throw new Error(callbackError.replace(/\+/g, " "));

        if (accessToken && refreshToken) {
          logAuthDebug("callback", "setSession: start");
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            logAuthDebug("callback", "setSession: failed", { error: error.message }, "error");
            throw error;
          }
          logAuthDebug("callback", "setSession: ok");
        } else if (code) {
          logAuthDebug("callback", "exchangeCodeForSession: start", { codeLen: code.length });
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            logAuthDebug("callback", "exchangeCodeForSession: failed", { error: error.message }, "error");
            throw error;
          }
          logAuthDebug("callback", "exchangeCodeForSession: ok");
        } else {
          logAuthDebug("callback", "no tokens/code — fallback getSession()", undefined, "warn");
          await supabase.auth.getSession();
        }

        const { data, error } = await supabase.auth.getUser();
        if (cancelled) return;
        logAuthDebug("callback", "getUser result", {
          hasUser: !!data.user,
          userId: data.user?.id ?? null,
          email: data.user?.email ?? null,
          emailConfirmedAt: data.user?.email_confirmed_at ?? null,
          error: error?.message ?? null,
          elapsedMs: Math.round(performance.now() - t0),
        }, error ? "error" : "info");

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
        logAuthDebug("callback", "unhandled error", {
          error: err instanceof Error ? err.message : String(err),
          elapsedMs: Math.round(performance.now() - t0),
        }, "error");
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

  // Muat ulang buffer debug tiap kali panel dibuka atau status berubah.
  useEffect(() => {
    if (!showDebug) return;
    setDebugEvents(readAuthDebug());
  }, [showDebug, status]);

  const copyDebug = async () => {
    const text = formatAuthDebug(readAuthDebug());
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Log auth disalin");
    } catch {
      toast.error("Gagal menyalin — salin manual dari kotak di bawah.");
    }
  };

  const wipeDebug = () => {
    clearAuthDebug();
    setDebugEvents([]);
    toast.message("Log auth dibersihkan");
  };

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

        {/* Panel debug ringkas */}
        <div className="mt-3 rounded-xl border bg-card">
          <button
            type="button"
            onClick={() => setShowDebug((s) => !s)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showDebug}
          >
            <Bug className="h-3.5 w-3.5" />
            {showDebug ? "Sembunyikan" : "Tampilkan"} log debug auth
            <span className="ml-auto text-[10px] opacity-70">{debugEvents.length || readAuthDebug().length} event</span>
          </button>
          {showDebug && (
            <div className="border-t px-4 py-3 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void copyDebug()}
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-muted"
                >
                  <Copy className="h-3 w-3" /> Salin
                </button>
                <button
                  type="button"
                  onClick={wipeDebug}
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-muted"
                >
                  Bersihkan
                </button>
              </div>
              {debugEvents.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Belum ada event.</p>
              ) : (
                <div className="max-h-60 overflow-auto rounded-md border bg-muted/30 p-2">
                  <ul className="space-y-1 font-mono text-[10.5px] leading-snug">
                    {debugEvents.slice().reverse().map((e, i) => (
                      <li key={i} className={
                        e.level === "error" ? "text-destructive"
                        : e.level === "warn" ? "text-amber-600 dark:text-amber-400"
                        : "text-foreground/80"
                      }>
                        <span className="opacity-60">{new Date(e.ts).toLocaleTimeString()} </span>
                        <span className="font-semibold">{e.scope}:</span> {e.msg}
                        {e.data && (
                          <span className="opacity-70"> {JSON.stringify(e.data)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Token disembunyikan otomatis. Log tersimpan di perangkat ini saja (localStorage), maks 50 event.
                Dapat juga dilihat di <span className="font-mono">/diagnostics</span>.
              </p>
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          Butuh bantuan? Hubungi admin toko atau minta tautan verifikasi baru.
        </p>
      </section>
    </main>
  );
}