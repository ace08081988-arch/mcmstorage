import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MailWarning, ShieldCheck, ArrowRight, RefreshCw, Bug, Copy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logAuthDebug, readAuthDebug, clearAuthDebug, formatAuthDebug, type AuthDebugEvent } from "@/lib/auth-debug";
import { readPendingInvitePath } from "@/lib/pending-invite";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
      { title: "Memproses Verifikasi — Ace Storage" },
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
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const originalUrlRef = useRef<string>(
    typeof window !== "undefined" ? window.location.href : "",
  );
  const [target] = useState(() => {
    if (typeof window === "undefined") return "/";
    const params = new URLSearchParams(window.location.search);
    const redirect = safeTarget(params.get("redirect"));
    if (redirect !== "/") return redirect;
    const next = safeTarget(params.get("next"));
    if (next !== "/") return next;
    try {
      const stored = safeTarget(window.sessionStorage.getItem("mcm.postAuthRedirect"));
      window.sessionStorage.removeItem("mcm.postAuthRedirect");
      if (stored !== "/") return stored;
    } catch {
      /* ignore */
    }
    // Fallback terakhir: undangan yang masih pending di localStorage supaya
    // deep link `/i/<code>` tetap sampai walau URL `?redirect=` hilang di
    // roundtrip OAuth/email-verify.
    const pending = readPendingInvitePath();
    return pending ? safeTarget(pending) : "/";
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

  const resetAndRetry = async () => {
    setResetting(true);
    logAuthDebug("callback", "reset session & retry: start");
    try {
      try {
        await supabase.auth.signOut({ scope: "local" });
        logAuthDebug("callback", "reset: signOut ok");
      } catch (e) {
        logAuthDebug(
          "callback",
          "reset: signOut failed (lanjut bersihkan storage)",
          { error: e instanceof Error ? e.message : String(e) },
          "warn",
        );
      }
      // Bersihkan sisa token Supabase di storage lokal.
      try {
        const wipe = (store: Storage) => {
          const keys: string[] = [];
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            if (k && (k.startsWith("sb-") || k.includes("supabase.auth"))) keys.push(k);
          }
          keys.forEach((k) => store.removeItem(k));
          return keys.length;
        };
        const l = wipe(window.localStorage);
        const s = wipe(window.sessionStorage);
        logAuthDebug("callback", "reset: storage cleared", { localStorage: l, sessionStorage: s });
      } catch (e) {
        logAuthDebug(
          "callback",
          "reset: storage clear failed",
          { error: e instanceof Error ? e.message : String(e) },
          "warn",
        );
      }
      toast.message("Sesi dibersihkan. Mengulang verifikasi…");
      // Ulangi dengan URL awal (hash/token asli) supaya proses verifikasi jalan lagi.
      const url = originalUrlRef.current || window.location.href;
      window.location.replace(url);
    } finally {
      // Kalau replace gagal, kembalikan tombol.
      window.setTimeout(() => setResetting(false), 1500);
    }
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
      iconClass: "text-success",
      bgClass: "bg-success border-success dark:bg-success/30 dark:border-success",
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
    <main className="flex min-h-screen items-center justify-center bg-background px-ms-4 py-10">
      <section className="w-full max-w-md">
        {/* Status banner */}
        <div className={`rounded-t-2xl border border-b-0 p-ms-4 flex items-center gap-ms-3 ${banner.bgClass}`}>
          <banner.Icon className={`h-6 w-6 shrink-0 ${banner.iconClass}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-ms-sm font-semibold leading-tight">{banner.title}</p>
            <p className="text-ms-xs opacity-80">{banner.badge}</p>
          </div>
        </div>

        <div className="rounded-b-2xl border bg-card p-ms-6 shadow-sm">
          <p className="text-ms-sm text-foreground/90">{message}</p>

          {status === "error" && errorDetail && (
            <p className="mt-2 rounded-md bg-muted/50 px-ms-3 py-ms-2 text-ms-xs text-muted-foreground break-words">
              Detail: {errorDetail}
            </p>
          )}

          {/* Langkah selanjutnya */}
          <div className="mt-4 rounded-lg bg-muted/40 p-ms-3 text-ms-xs text-muted-foreground">
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
          <div className="mt-5 flex flex-col gap-ms-2">
            {status === "done" && (
              <button
                onClick={goNow}
                className="inline-flex w-full items-center justify-center gap-ms-2 rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Lanjut ke aplikasi <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {(status === "manual" || status === "error") && (
              <Link
                to="/auth"
                className="inline-flex w-full items-center justify-center gap-ms-2 rounded-md bg-primary px-ms-3 py-ms-2 text-ms-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Ke halaman Masuk <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            {status === "error" && (
              <button
                onClick={retry}
                className="inline-flex w-full items-center justify-center gap-ms-2 rounded-md border bg-background px-ms-3 py-ms-2 text-ms-sm font-medium hover:bg-muted"
              >
                <RefreshCw className="h-4 w-4" /> Coba lagi
              </button>
            )}
            {(status === "error" || status === "manual") && (
              <button
                onClick={() => setConfirmReset(true)}
                disabled={resetting}
                className="inline-flex w-full items-center justify-center gap-ms-2 rounded-md border bg-background px-ms-3 py-ms-2 text-ms-sm font-medium hover:bg-muted disabled:opacity-60"
                title="Bersihkan sesi lokal lalu jalankan ulang verifikasi"
              >
                {resetting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reset sesi & coba lagi
              </button>
            )}
          </div>

          <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset sesi & coba lagi?</AlertDialogTitle>
                <AlertDialogDescription>
                  Sesi login di perangkat ini akan dibersihkan (token Supabase di localStorage &amp; sessionStorage dihapus),
                  lalu proses verifikasi dijalankan ulang dengan tautan yang sama.
                  Anda mungkin perlu masuk kembali setelahnya.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={resetting}>Batal</AlertDialogCancel>
                <AlertDialogAction
                  disabled={resetting}
                  onClick={(e) => {
                    e.preventDefault();
                    void resetAndRetry();
                  }}
                >
                  {resetting ? "Memproses…" : "Ya, reset"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Panel debug ringkas */}
        <div className="mt-3 rounded-xl border bg-card">
          <button
            type="button"
            onClick={() => setShowDebug((s) => !s)}
            className="flex w-full items-center gap-ms-2 px-ms-4 py-ms-2.5 text-ms-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showDebug}
          >
            <Bug className="h-3.5 w-3.5" />
            {showDebug ? "Sembunyikan" : "Tampilkan"} log debug auth
            <span className="ml-auto text-ms-2xs opacity-70">{debugEvents.length || readAuthDebug().length} event</span>
          </button>
          {showDebug && (
            <div className="border-t px-ms-4 py-ms-3 space-ms-3">
              <div className="flex gap-ms-2">
                <button
                  type="button"
                  onClick={() => void copyDebug()}
                  className="inline-flex items-center gap-ms-1 rounded-md border bg-background px-ms-2.5 py-1 text-ms-2xs font-medium hover:bg-muted"
                >
                  <Copy className="h-3 w-3" /> Salin
                </button>
                <button
                  type="button"
                  onClick={wipeDebug}
                  className="inline-flex items-center gap-ms-1 rounded-md border bg-background px-ms-2.5 py-1 text-ms-2xs font-medium hover:bg-muted"
                >
                  Bersihkan
                </button>
              </div>
              {debugEvents.length === 0 ? (
                <p className="text-ms-2xs text-muted-foreground">Belum ada event.</p>
              ) : (
                <div className="max-h-60 overflow-auto rounded-md border bg-muted/30 p-ms-2">
                  <ul className="space-y-1 font-mono text-[10.5px] leading-snug">
                    {debugEvents.slice().reverse().map((e, i) => (
                      <li key={i} className={
                        e.level === "error" ? "text-destructive"
                        : e.level === "warn" ? "text-warning dark:text-warning"
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
              <p className="text-ms-2xs text-muted-foreground">
                Token disembunyikan otomatis. Log tersimpan di perangkat ini saja (localStorage), maks 50 event.
                Dapat juga dilihat di <span className="font-mono">/diagnostics</span>.
              </p>
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-ms-xs text-muted-foreground">
          Butuh bantuan? Hubungi admin toko atau minta tautan verifikasi baru.
        </p>
      </section>
    </main>
  );
}