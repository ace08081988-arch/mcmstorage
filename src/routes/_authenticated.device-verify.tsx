import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  getClientDeviceFingerprint,
  markDeviceTrustedLocal,
} from "@/lib/device-fingerprint";
import {
  checkDeviceOtpEmailStatus,
  requestDeviceOtp,
  verifyDeviceOtp,
} from "@/lib/device.functions";

// Hanya izinkan path internal yang aman: harus diawali "/" tunggal,
// bukan "//host" (protocol-relative), bukan URL absolut, bukan skema seperti
// "javascript:" atau "data:", dan tidak boleh mengandung CR/LF.
const SAFE_PATH = /^\/(?!\/)[^\s\\]*$/;
const safeRedirect = z
  .string()
  .max(512)
  .refine((v) => SAFE_PATH.test(v) && !/[\r\n]/.test(v), {
    message: "invalid redirect",
  });
const searchSchema = z.object({
  redirect: safeRedirect.optional().catch(undefined),
});

function sanitizeRedirect(value: string | undefined): string {
  if (!value) return "/";
  return SAFE_PATH.test(value) && !/[\r\n]/.test(value) && value.length <= 512
    ? value
    : "/";
}

export const Route = createFileRoute("/_authenticated/device-verify")({
  validateSearch: searchSchema,
  component: DeviceVerifyPage,
});

function DeviceVerifyPage() {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/_authenticated/device-verify" });
  const safeTarget = sanitizeRedirect(redirect);
  const [stage, setStage] = useState<"loading" | "otp" | "error">("loading");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string>("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [emailWarning, setEmailWarning] = useState<string | null>(null);
  const deviceHashRef = useRef<string>("");
  const userIdRef = useRef<string>("");
  const pollAbortRef = useRef<{ cancelled: boolean } | null>(null);

  const pollEmailDelivery = (messageId: string) => {
    if (pollAbortRef.current) pollAbortRef.current.cancelled = true;
    const flag = { cancelled: false };
    pollAbortRef.current = flag;
    const started = Date.now();
    const tick = async () => {
      if (flag.cancelled) return;
      try {
        const r = await checkDeviceOtpEmailStatus({ data: { messageId } });
        if (flag.cancelled) return;
        if (r.status === "sent") {
          toast.success("Email OTP berhasil terkirim");
          return;
        }
        if (r.status === "failed" || r.status === "dlq" || r.status === "suppressed") {
          toast.error(`Email gagal: ${r.error ?? r.status}`);
          setEmailWarning("Email gagal terkirim. Coba kirim ulang atau hubungi admin.");
          return;
        }
      } catch {
        /* ignore transient errors */
      }
      if (Date.now() - started >= 10_000) {
        toast.warning("Email belum terkirim dalam 10 detik, sedang dicoba ulang…");
        return;
      }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: ures } = await supabase.auth.getUser();
      if (!ures.user) {
        navigate({ to: "/auth", replace: true });
        return;
      }
      userIdRef.current = ures.user.id;
      const hash = await getClientDeviceFingerprint();
      deviceHashRef.current = hash;
      try {
        const r = await requestDeviceOtp({ data: { deviceHash: hash } });
        if (cancelled) return;
        if (r.trusted) {
          markDeviceTrustedLocal(userIdRef.current, hash);
          navigate({ to: safeTarget, replace: true });
          return;
        }
        setChallengeId(r.challengeId);
        setMaskedEmail(r.maskedEmail);
        if (!r.emailSent) {
          setEmailWarning(
            "Kode dibuat tapi email tidak terkirim. Hubungi admin atau aktifkan Email di Cloud → Emails.",
          );
        } else if (r.messageId) {
          pollEmailDelivery(r.messageId);
        }
        setStage("otp");
        setCooldown(60);
      } catch (e) {
        setStage("error");
        toast.error(e instanceof Error ? e.message : "Gagal memulai verifikasi");
      }
    })();
    return () => {
      cancelled = true;
      if (pollAbortRef.current) pollAbortRef.current.cancelled = true;
    };
  }, [navigate, safeTarget]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeId || code.length !== 6) return;
    setBusy(true);
    try {
      await verifyDeviceOtp({
        data: {
          challengeId,
          code,
          deviceHash: deviceHashRef.current,
        },
      });
      markDeviceTrustedLocal(userIdRef.current, deviceHashRef.current);
      toast.success("Device terverifikasi");
      navigate({ to: safeTarget, replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verifikasi gagal");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setBusy(true);
    setEmailWarning(null);
    try {
      const r = await requestDeviceOtp({
        data: { deviceHash: deviceHashRef.current },
      });
      if (r.trusted) {
        markDeviceTrustedLocal(userIdRef.current, deviceHashRef.current);
        navigate({ to: safeTarget, replace: true });
        return;
      }
      setChallengeId(r.challengeId);
      setMaskedEmail(r.maskedEmail);
      if (!r.emailSent) {
        setEmailWarning(
          "Kode dibuat tapi email tidak terkirim. Hubungi admin atau aktifkan Email di Cloud → Emails.",
        );
      } else if (r.messageId) {
        pollEmailDelivery(r.messageId);
      }
      setCooldown(60);
      toast.success("Kode baru dikirim");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim ulang");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Verifikasi device baru</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Demi keamanan, masukkan kode 6 digit yang kami kirim ke{" "}
            <strong>{maskedEmail || "email Anda"}</strong>.
          </p>
        </div>

        {stage === "loading" && (
          <p className="text-center text-sm text-muted-foreground">
            Memeriksa device…
          </p>
        )}

        {stage === "error" && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-destructive">Gagal memulai verifikasi.</p>
            <button
              onClick={() => location.reload()}
              className="rounded-md border px-3 py-2 text-sm"
            >
              Coba lagi
            </button>
          </div>
        )}

        {stage === "otp" && (
          <form onSubmit={submit} className="space-y-3">
            {emailWarning && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
                {emailWarning}
              </p>
            )}
            <input
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="••••••"
              className="w-full rounded-md border bg-background px-3 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Memverifikasi…" : "Verifikasi"}
            </button>
            <div className="flex items-center justify-between text-[11px]">
              <button
                type="button"
                onClick={resend}
                disabled={busy || cooldown > 0}
                className="text-muted-foreground hover:underline disabled:opacity-50"
              >
                {cooldown > 0 ? `Kirim ulang (${cooldown}s)` : "Kirim ulang kode"}
              </button>
              <button
                type="button"
                onClick={signOut}
                className="text-muted-foreground hover:underline"
              >
                Batal, keluar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}