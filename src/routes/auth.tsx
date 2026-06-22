import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/integrations/supabase/client";
import { ApkDownloadBanner } from "@/components/ApkDownloadBanner";
import { PublicFooter } from "@/components/PublicFooter";
import { ResetCacheButton } from "@/components/ResetCacheButton";

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
    links: [{ rel: "canonical", href: "https://mcmstorage.lovable.app/auth" }],
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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
        <ApkDownloadBanner />
        <div className="text-center">
          <img
            src="/icon-512.png"
            alt="MCM Storage"
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

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alamat@email.com"
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
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-2 px-4 pb-4 text-center">
        <p className="text-[11px] text-muted-foreground">
          Halaman gagal muat? Coba bersihkan cache aplikasi.
        </p>
        <ResetCacheButton fullWidth />
      </div>
      <PublicFooter />
    </div>
  );
}