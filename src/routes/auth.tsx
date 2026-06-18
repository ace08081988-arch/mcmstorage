import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Masuk \u2014 MCM Storage" },
      { name: "description", content: "Masuk ke MCM Storage dengan kode OTP via email." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: mode === "signup" },
    });
    setLoading(false);
    if (error) {
      const msg = /signups not allowed|not found|user not found/i.test(error.message)
        ? "Akun belum terdaftar. Silakan Daftar dulu."
        : error.message;
      toast.error(msg);
      return;
    }
    toast.success(mode === "signup" ? "Kode pendaftaran dikirim" : "Kode OTP dikirim ke email");
    setStep("otp");
    setResendIn(60);
  };

  const resendOtp = async () => {
    if (resendIn > 0 || loading) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: mode === "signup" },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Kode OTP dikirim ulang");
    setResendIn(60);
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length < 6) return;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });
    setLoading(false);
    if (error) {
      toast.error("Kode salah atau kedaluwarsa");
      return;
    }
    toast.success("Berhasil masuk");
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="text-center">
          <img
            src="/icon-512.png"
            alt="MCM Storage"
            className="mx-auto h-16 w-16 rounded-2xl"
          />
          <h1 className="mt-3 text-lg font-semibold tracking-tight">MCM Storage</h1>
          <p className="text-xs text-muted-foreground">
            {step === "email"
              ? mode === "signup"
                ? "Daftar akun baru — kami kirim kode ke email"
                : "Masuk ke akun Anda dengan kode OTP"
              : `Kode dikirim ke ${email}`}
          </p>
        </div>

        {step === "email" && (
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
        )}

        {step === "email" ? (
          <form onSubmit={sendOtp} className="space-y-3">
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
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Mengirim…" : mode === "signup" ? "Daftar & kirim kode" : "Kirim kode OTP"}
            </button>
            <p className="text-center text-[11px] text-muted-foreground">
              {mode === "login"
                ? "Belum punya akun? Pilih tab Daftar di atas."
                : "Sudah punya akun? Pilih tab Masuk di atas."}
            </p>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="6 digit kode"
              className="w-full rounded-md border bg-background px-3 py-2 text-center text-lg tracking-[0.5em] outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={loading || otp.length < 6}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Memverifikasi…" : "Masuk"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOtp("");
                setStep("email");
              }}
              className="w-full text-center text-xs text-muted-foreground hover:underline"
            >
              Ganti email
            </button>
            <button
              type="button"
              onClick={resendOtp}
              disabled={resendIn > 0 || loading}
              className="w-full text-center text-xs text-muted-foreground hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {resendIn > 0 ? `Kirim ulang kode (${resendIn}s)` : "Kirim ulang kode"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}