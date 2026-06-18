import { useEffect, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/lib/confirm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PatternPad, patternToString } from "./PatternPad";
import {
  getLockConfig,
  setLockConfig,
  hashSecret,
  randomSalt,
  isBiometricAvailable,
  type LockConfig,
} from "@/lib/app-lock";

type Props = {
  uid: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

type Step = "method" | "create" | "confirm" | "options";

export function AppLockSetup({ uid, open, onOpenChange }: Props) {
  const [method, setMethod] = useState<"pin" | "pattern">("pin");
  const [step, setStep] = useState<Step>("method");
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [pat1, setPat1] = useState<number[]>([]);
  const [pat2, setPat2] = useState<number[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [biometric, setBiometric] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [idleMin, setIdleMin] = useState(2);
  const [lockOnHide, setLockOnHide] = useState(true);
  const existing = open ? getLockConfig(uid) : null;

  useEffect(() => {
    if (!open) return;
    setStep("method");
    setPin1("");
    setPin2("");
    setPat1([]);
    setPat2([]);
    setResetKey((k) => k + 1);
    isBiometricAvailable().then(setBioAvailable);
    if (existing) {
      setMethod(existing.method);
      setBiometric(existing.biometric);
      setIdleMin(Math.round((existing.idleMs || 0) / 60000));
      setLockOnHide(existing.lockOnHide);
    } else {
      setBiometric(false);
      setIdleMin(2);
      setLockOnHide(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const goCreate = (m: "pin" | "pattern") => {
    setMethod(m);
    setPin1("");
    setPin2("");
    setPat1([]);
    setPat2([]);
    setResetKey((k) => k + 1);
    setStep("create");
  };

  const saveAll = async (secret: string) => {
    const salt = randomSalt();
    const hash = await hashSecret(secret, salt);
    const cfg: LockConfig = {
      method,
      hash,
      salt,
      biometric: biometric && bioAvailable,
      idleMs: Math.max(0, idleMin) * 60000,
      lockOnHide,
    };
    setLockConfig(uid, cfg);
    toast.success("Kunci aplikasi disimpan");
    onOpenChange(false);
  };

  const disableLock = async () => {
    if (!(await confirm({
      title: "Nonaktifkan kunci aplikasi?",
      description: "Aplikasi tidak akan meminta PIN/pola/biometrik lagi sampai Anda mengaktifkannya kembali.",
      confirmText: "Nonaktifkan",
      destructive: true,
    }))) return;
    setLockConfig(uid, null);
    toast.success("Kunci aplikasi dimatikan");
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    if (method === "pin") {
      if (pin1.length < 4 || pin1.length > 8) {
        toast.error("PIN harus 4-8 digit");
        return;
      }
      if (pin1 !== pin2) {
        toast.error("PIN tidak cocok");
        setPin2("");
        return;
      }
      await saveAll(pin1);
    } else {
      if (pat1.length < 4) {
        toast.error("Pola minimal 4 titik");
        return;
      }
      if (patternToString(pat1) !== patternToString(pat2)) {
        toast.error("Pola tidak cocok");
        setPat2([]);
        setResetKey((k) => k + 1);
        return;
      }
      await saveAll(patternToString(pat1));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kunci Aplikasi</DialogTitle>
          <DialogDescription>
            Lindungi aplikasi dengan PIN, pola, atau sidik jari.
          </DialogDescription>
        </DialogHeader>

        {step === "method" && (
          <div className="space-y-3">
            {existing && (
              <div className="rounded-md border bg-muted/30 p-2 text-[11px]">
                Saat ini aktif: <b>{existing.method.toUpperCase()}</b>
                {existing.biometric ? " + Sidik jari" : ""}
              </div>
            )}
            <button
              onClick={() => goCreate("pin")}
              className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-accent"
            >
              <div>
                <div className="text-sm font-medium">🔢 PIN</div>
                <div className="text-[11px] text-muted-foreground">
                  4-8 digit angka
                </div>
              </div>
              <span className="text-xs text-muted-foreground">Pilih →</span>
            </button>
            <button
              onClick={() => goCreate("pattern")}
              className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-accent"
            >
              <div>
                <div className="text-sm font-medium">⬣ Pola</div>
                <div className="text-[11px] text-muted-foreground">
                  Hubungkan minimal 4 titik
                </div>
              </div>
              <span className="text-xs text-muted-foreground">Pilih →</span>
            </button>
            <button
              onClick={() => setStep("options")}
              className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-accent"
            >
              <div>
                <div className="text-sm font-medium">⚙️ Opsi Lain</div>
                <div className="text-[11px] text-muted-foreground">
                  Sidik jari, auto-lock, dll.
                </div>
              </div>
              <span className="text-xs text-muted-foreground">Buka →</span>
            </button>
            {existing && (
              <Button
                variant="destructive"
                className="w-full"
                onClick={disableLock}
              >
                Nonaktifkan Kunci
              </Button>
            )}
          </div>
        )}

        {step === "create" && method === "pin" && (
          <div className="space-y-3">
            <Label>Buat PIN baru (4-8 digit)</Label>
            <Input
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={8}
              value={pin1}
              onChange={(e) => setPin1(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("method")}>
                Kembali
              </Button>
              <Button
                onClick={() => {
                  if (pin1.length < 4) {
                    toast.error("PIN minimal 4 digit");
                    return;
                  }
                  setStep("confirm");
                }}
              >
                Lanjut
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "create" && method === "pattern" && (
          <div className="space-y-3">
            <Label>Buat pola baru (≥ 4 titik)</Label>
            <div className="flex justify-center">
              <PatternPad
                resetKey={resetKey}
                onComplete={setPat1}
                onChange={setPat1}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("method")}>
                Kembali
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPat1([]);
                  setResetKey((k) => k + 1);
                }}
              >
                Ulangi
              </Button>
              <Button
                onClick={() => {
                  if (pat1.length < 4) {
                    toast.error("Pola minimal 4 titik");
                    return;
                  }
                  setPat2([]);
                  setResetKey((k) => k + 1);
                  setStep("confirm");
                }}
              >
                Lanjut
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "confirm" && method === "pin" && (
          <div className="space-y-3">
            <Label>Ulangi PIN</Label>
            <Input
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={8}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("create")}>
                Kembali
              </Button>
              <Button onClick={handleConfirm}>Simpan</Button>
            </DialogFooter>
          </div>
        )}

        {step === "confirm" && method === "pattern" && (
          <div className="space-y-3">
            <Label>Ulangi pola</Label>
            <div className="flex justify-center">
              <PatternPad
                resetKey={resetKey}
                onComplete={setPat2}
                onChange={setPat2}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("create")}>
                Kembali
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPat2([]);
                  setResetKey((k) => k + 1);
                }}
              >
                Ulangi
              </Button>
              <Button onClick={handleConfirm}>Simpan</Button>
            </DialogFooter>
          </div>
        )}

        {step === "options" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Sidik jari</Label>
                <p className="text-[11px] text-muted-foreground">
                  {bioAvailable
                    ? "Aktifkan unlock dengan sidik jari"
                    : "Tidak tersedia di perangkat ini"}
                </p>
              </div>
              <Switch
                checked={biometric && bioAvailable}
                disabled={!bioAvailable}
                onCheckedChange={setBiometric}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Kunci saat aplikasi keluar fokus</Label>
                <p className="text-[11px] text-muted-foreground">
                  Tab/aplikasi disembunyikan → langsung terkunci
                </p>
              </div>
              <Switch checked={lockOnHide} onCheckedChange={setLockOnHide} />
            </div>
            <div className="space-y-1">
              <Label>Auto-lock setelah idle (menit)</Label>
              <Input
                type="number"
                min={0}
                max={60}
                value={idleMin}
                onChange={(e) => setIdleMin(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
              />
              <p className="text-[11px] text-muted-foreground">0 = nonaktif</p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("method")}>
                Kembali
              </Button>
              <Button
                onClick={() => {
                  if (!existing) {
                    toast.error("Buat PIN atau pola dulu");
                    return;
                  }
                  const updated: LockConfig = {
                    ...existing,
                    biometric: biometric && bioAvailable,
                    idleMs: Math.max(0, idleMin) * 60000,
                    lockOnHide,
                  };
                  setLockConfig(uid, updated);
                  toast.success("Pengaturan disimpan");
                  onOpenChange(false);
                }}
              >
                Simpan Opsi
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}