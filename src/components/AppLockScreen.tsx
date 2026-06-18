import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PatternPad, patternToString } from "./PatternPad";
import {
  authenticateBiometric,
  setLocked,
  verifySecret,
  type LockConfig,
} from "@/lib/app-lock";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@tanstack/react-router";

type Props = {
  uid: string;
  cfg: LockConfig;
};

export function AppLockScreen({ uid, cfg }: Props) {
  const [pin, setPin] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const bioTriedRef = useRef(false);
  const navigate = useNavigate();

  const unlock = () => {
    setLocked(uid, false);
  };

  const tryBiometric = async () => {
    if (!cfg.biometric) return;
    setBusy(true);
    const ok = await authenticateBiometric("Buka kunci MCM Storage");
    setBusy(false);
    if (ok) unlock();
  };

  useEffect(() => {
    if (cfg.biometric && !bioTriedRef.current) {
      bioTriedRef.current = true;
      tryBiometric();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryPin = async () => {
    if (pin.length < 4) return;
    setBusy(true);
    const ok = await verifySecret(cfg, pin);
    setBusy(false);
    if (ok) {
      unlock();
      setPin("");
    } else {
      setAttempts((a) => a + 1);
      setPin("");
      toast.error("PIN salah");
    }
  };

  const tryPattern = async (seq: number[]) => {
    if (seq.length < 4) return;
    setBusy(true);
    const ok = await verifySecret(cfg, patternToString(seq));
    setBusy(false);
    if (ok) {
      unlock();
    } else {
      setAttempts((a) => a + 1);
      setResetKey((k) => k + 1);
      toast.error("Pola salah");
    }
  };

  const signOut = async () => {
    setLocked(uid, false);
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur">
      <div className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-6 shadow-lg">
        <div className="text-center">
          <div className="text-3xl">🔒</div>
          <h2 className="mt-2 text-lg font-semibold">Aplikasi Terkunci</h2>
          <p className="text-[12px] text-muted-foreground">
            {cfg.method === "pin"
              ? "Masukkan PIN untuk membuka"
              : "Gambar pola untuk membuka"}
          </p>
        </div>

        {cfg.method === "pin" ? (
          <div className="space-y-3">
            <Input
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") tryPin();
              }}
              placeholder="••••"
              className="text-center text-2xl tracking-[0.5em]"
              disabled={busy}
            />
            <Button className="w-full" onClick={tryPin} disabled={busy || pin.length < 4}>
              Buka
            </Button>
          </div>
        ) : (
          <div className="flex justify-center">
            <PatternPad
              resetKey={resetKey}
              onComplete={tryPattern}
              disabled={busy}
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          {cfg.biometric && (
            <Button variant="outline" onClick={tryBiometric} disabled={busy}>
              👆 Gunakan Sidik Jari
            </Button>
          )}
          {attempts >= 3 && (
            <Button variant="ghost" size="sm" onClick={signOut}>
              Lupa kunci? Keluar & masuk ulang
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}