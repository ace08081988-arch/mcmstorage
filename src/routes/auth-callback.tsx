import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MailWarning } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

const SAFE_PATH = /^\/(?!\/)[^\s\\]*$/;

function safeTarget(value: unknown): string {
  if (typeof value !== "string") return "/";
  return value.length <= 512 && SAFE_PATH.test(value) && !/[\r\n]/.test(value)
    ? value
    : "/";
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
  const [message, setMessage] = useState("Memproses verifikasi akun…");
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
          setMessage("Email sudah diverifikasi. Silakan masuk dengan email dan kata sandi Anda.");
          toast.success("Email terverifikasi. Silakan masuk.");
          window.history.replaceState({}, document.title, "/auth/callback");
          return;
        }

        setStatus("done");
        setMessage("Verifikasi berhasil. Membuka aplikasi…");
        toast.success("Verifikasi berhasil");
        window.history.replaceState({}, document.title, "/auth/callback");
        navigate({ to: target, replace: true });
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Verifikasi gagal diproses.");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [navigate, target]);

  const Icon = status === "loading" ? Loader2 : status === "error" ? MailWarning : CheckCircle2;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-sm">
        <Icon
          className={`mx-auto h-8 w-8 ${status === "loading" ? "animate-spin text-primary" : status === "error" ? "text-destructive" : "text-emerald-500"}`}
          aria-hidden="true"
        />
        <h1 className="mt-4 text-lg font-semibold">Verifikasi akun</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        {(status === "manual" || status === "error") && (
          <Link
            to="/auth"
            className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
          >
            Masuk
          </Link>
        )}
      </section>
    </main>
  );
}