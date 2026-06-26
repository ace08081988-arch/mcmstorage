import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { ApkDownloadBanner } from "@/components/ApkDownloadBanner";
import { PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Masuk atau Daftar — MCM Storage" },
      { name: "description", content: "Masuk ke akun MCM Storage atau daftar akun baru dengan kode OTP yang dikirim langsung ke email Anda." },
      { property: "og:title", content: "Masuk atau Daftar — MCM Storage" },
      { property: "og:description", content: "Masuk ke akun MCM Storage atau daftar akun baru dengan kode OTP yang dikirim langsung ke email Anda." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://mcmstorage.lovable.app/auth" },
    ],
    links: [
      { rel: "canonical", href: "https://mcmstorage.lovable.app/auth" },
      { rel: "preload", as: "image", href: "/icon-512.png", fetchPriority: "high" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    if (mode === "signup") {
      if (password.length < 8) {
        toast.error("Kata sandi minimal 8 karakter");
        return;
      }
      if (password !== confirmPassword) {
        toast.error("Konfirmasi kata sandi tidak cocok");
        return;
      }
      setLoading(true);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      setLoading(false);
      if (error) {
        const msg = /already registered|already exists|user.*exists/i.test(error.message)
          ? "Email sudah terdaftar. Silakan Masuk."
          : /pwned|breach|compromised/i.test(error.message)
            ? "Kata sandi ini pernah bocor. Pakai kata sandi lain."
            : friendlyError(error);
        toast.error(msg, {
          action: {
            label: "Bantuan",
            onClick: () =>
              navigate({
                to: "/error",
                search: { kind: "auth", title: "Pendaftaran gagal", message: error.message, from: "/auth" },
              }),
          },
        });
        return;
      }
      toast.success(
        "Pendaftaran berhasil. Cek email Anda untuk verifikasi sebelum masuk.",
        { duration: 8000 },
      );
      setMode("login");
      setPassword("");
      setConfirmPassword("");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      const msg = /email not confirmed|not.*confirmed/i.test(error.message)
        ? "Email belum diverifikasi. Cek inbox untuk link verifikasi."
        : /invalid login credentials/i.test(error.message)
        ? "Email atau kata sandi salah (atau belum daftar)"
        : friendlyError(error);
      toast.error(msg, {
        action: {
          label: "Bantuan",
          onClick: () =>
            navigate({
              to: "/error",
              search: { kind: "auth", title: "Gagal masuk", message: error.message, from: "/auth" },
            }),
        },
      });
      return;
    }
    toast.success("Berhasil masuk");
    navigate({ to: "/", replace: true });
  };

  const sendReset = async () => {
    if (!email) {
      toast.error("Isi email dulu untuk reset kata sandi");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast.success("Tautan reset dikirim ke email");
  };

  const resendVerification = async () => {
    if (!email) {
      toast.error("Isi email dulu untuk kirim ulang verifikasi");
      return;
    }
    if (resendCooldown > 0) return;
    setLoading(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast.success("Email verifikasi dikirim ulang. Cek inbox Anda.");
    setResendCooldown(60);
  };

  const signInWithApple = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("apple", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      toast.error(friendlyError(result.error));
      return;
    }
    if (result.redirected) return;
    toast.success("Berhasil masuk");
    navigate({ to: "/", replace: true });
  };

  const signInWithGoogle = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      toast.error(friendlyError(result.error));
      return;
    }
    if (result.redirected) return;
    toast.success("Berhasil masuk");
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
        <ApkDownloadBanner />
        <div className="text-center">
          <img
            src="/icon-512.png"
            alt="MCM Storage"
            width={64}
            height={64}
            fetchPriority="high"
            className="mx-auto h-16 w-16 rounded-2xl"
          />
          <h1 className="mt-3 text-lg font-semibold tracking-tight">Masuk ke MCM Storage</h1>
          <p className="text-xs text-muted-foreground">
            {mode === "signup"
              ? "Buat akun baru dengan email & kata sandi"
              : "Masuk dengan email & kata sandi Anda"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded px-2 py-1.5 font-medium ${mode === "login" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Masuk
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded px-2 py-1.5 font-medium ${mode === "signup" ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            Daftar
          </button>
        </div>

        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.3-.4-3.5z"/>
          </svg>
          Lanjutkan dengan Google
        </button>

        <button
          type="button"
          onClick={signInWithApple}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-md border bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16.365 1.43c0 1.14-.43 2.23-1.2 3.04-.81.86-2.13 1.52-3.21 1.43-.13-1.12.43-2.29 1.16-3.04.83-.86 2.25-1.49 3.25-1.43zM20.5 17.27c-.58 1.33-.86 1.93-1.61 3.1-1.05 1.64-2.53 3.69-4.37 3.7-1.63.02-2.05-1.06-4.27-1.05-2.22.01-2.68 1.07-4.31 1.05-1.84-.02-3.24-1.86-4.29-3.5C-.83 17.18-1.13 12.46.5 9.74c1.16-1.93 2.99-3.06 4.71-3.06 1.76 0 2.86 1.06 4.31 1.06 1.41 0 2.27-1.06 4.3-1.06 1.53 0 3.15.83 4.31 2.27-3.78 2.07-3.17 7.47-1.63 8.32z"/>
          </svg>
          Lanjutkan dengan Apple
        </button>

        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          atau
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alamat@email.com"
            aria-label="Alamat email"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "Kata sandi (min. 8 karakter)" : "Kata sandi"}
              aria-label="Kata sandi"
              className="w-full rounded-md border bg-background px-3 py-2 pr-16 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
              aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            >
              {showPassword ? "Sembunyi" : "Lihat"}
            </button>
          </div>
          {mode === "signup" && (
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Konfirmasi kata sandi"
              aria-label="Konfirmasi kata sandi"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Memproses…" : mode === "signup" ? "Daftar" : "Masuk"}
          </button>
          {mode === "login" && (
            <button
              type="button"
              onClick={sendReset}
              disabled={loading}
              className="w-full text-center text-[11px] text-muted-foreground hover:underline disabled:opacity-50"
            >
              Lupa kata sandi?
            </button>
          )}
          <button
            type="button"
            onClick={resendVerification}
            disabled={loading || resendCooldown > 0}
            className="w-full text-center text-[11px] text-muted-foreground hover:underline disabled:opacity-50"
          >
            {resendCooldown > 0
              ? `Kirim ulang email verifikasi (${resendCooldown}s)`
              : "Kirim ulang email verifikasi"}
          </button>
          <p className="text-center text-[11px] text-muted-foreground">
            {mode === "login"
              ? "Belum punya akun? Pilih tab Daftar di atas."
              : "Sudah punya akun? Pilih tab Masuk di atas."}
          </p>
        </form>
      </div>
      </main>
      <PublicFooter />
    </div>
  );
}