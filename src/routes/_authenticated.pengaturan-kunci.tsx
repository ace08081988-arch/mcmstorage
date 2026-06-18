import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { confirm } from "@/lib/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PatternPad, patternToString } from "@/components/PatternPad";
import {
  APP_LOCK_EVENT,
  getLockConfig,
  hashSecret,
  isBiometricAvailable,
  randomSalt,
  requestLockNow,
  setLockConfig,
  type LockConfig,
} from "@/lib/app-lock";
import {
  AUTO_LOCK_EVENT,
  isAutoLockEnabled,
  setAutoLockEnabled,
} from "@/lib/auto-lock";

export const Route = createFileRoute("/_authenticated/pengaturan-kunci")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pengaturan Kunci Aplikasi · MCM Storage" },
      {
        name: "description",
        content:
          "Atur PIN, pola, sidik jari, auto-lock saat idle, dan kunci saat keluar fokus dalam satu halaman.",
      },
    ],
  }),
  component: PengaturanKunci,
});

function PengaturanKunci() {
  const [uid, setUid] = useState<string | null>(null);
  const [cfg, setCfg] = useState<LockConfig | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [autoLock, setAutoLock] = useState(false);

  // PIN form
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  // Pattern form
  const [pat1, setPat1] = useState<number[]>([]);
  const [pat2, setPat2] = useState<number[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [editor, setEditor] = useState<"none" | "pin" | "pattern">("none");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const id = data.user?.id ?? null;
      setUid(id);
      if (id) {
        setCfg(getLockConfig(id));
        setAutoLock(isAutoLockEnabled(id));
      }
    });
    isBiometricAvailable().then(setBioAvailable);
  }, []);

  useEffect(() => {
    if (!uid) return;
    const sync = () => {
      setCfg(getLockConfig(uid));
      setAutoLock(isAutoLockEnabled(uid));
    };
    window.addEventListener(APP_LOCK_EVENT, sync);
    window.addEventListener(AUTO_LOCK_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(APP_LOCK_EVENT, sync);
      window.removeEventListener(AUTO_LOCK_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [uid]);

  if (!uid) {
    return (
      <div className="mx-auto max-w-2xl p-4 text-sm text-muted-foreground">
        Memuat…
      </div>
    );
  }

  const saveSecret = async (
    method: "pin" | "pattern",
    secret: string,
  ) => {
    const salt = randomSalt();
    const hash = await hashSecret(secret, salt);
    const next: LockConfig = {
      method,
      hash,
      salt,
      biometric: cfg?.biometric ?? false,
      idleMs: cfg?.idleMs ?? 2 * 60000,
      lockOnHide: cfg?.lockOnHide ?? true,
    };
    setLockConfig(uid, next);
    toast.success(
      cfg
        ? `${method === "pin" ? "PIN" : "Pola"} diperbarui`
        : "Kunci aplikasi diaktifkan",
    );
    setEditor("none");
    setPin1("");
    setPin2("");
    setPat1([]);
    setPat2([]);
    setResetKey((k) => k + 1);
  };

  const handleSavePin = async () => {
    if (pin1.length < 4 || pin1.length > 8) {
      toast.error("PIN harus 4-8 digit");
      return;
    }
    if (pin1 !== pin2) {
      toast.error("PIN tidak cocok");
      return;
    }
    await saveSecret("pin", pin1);
  };

  const handleSavePattern = async () => {
    if (pat1.length < 4) {
      toast.error("Pola minimal 4 titik");
      return;
    }
    if (patternToString(pat1) !== patternToString(pat2)) {
      toast.error("Pola tidak cocok");
      return;
    }
    await saveSecret("pattern", patternToString(pat1));
  };

  const updateOption = (patch: Partial<LockConfig>) => {
    if (!cfg) {
      toast.error("Buat PIN atau pola dulu");
      return;
    }
    setLockConfig(uid, { ...cfg, ...patch });
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
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Pengaturan Kunci Aplikasi</h1>
          <Link
            to="/"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Beranda
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Atur metode kunci, sidik jari, auto-lock saat idle, dan kunci saat
          aplikasi keluar fokus.
        </p>
      </header>

      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Status</div>
            <div className="text-xs text-muted-foreground">
              {cfg
                ? `Aktif — ${cfg.method === "pin" ? "PIN" : "Pola"}${cfg.biometric ? " + Sidik jari" : ""}`
                : "Belum diaktifkan"}
            </div>
          </div>
          <div className="flex gap-2">
            {cfg && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => requestLockNow()}
              >
                Kunci Sekarang
              </Button>
            )}
            {cfg && (
              <Button size="sm" variant="destructive" onClick={disableLock}>
                Nonaktifkan
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div>
          <h2 className="text-sm font-medium">Metode Kunci</h2>
          <p className="text-xs text-muted-foreground">
            Pilih salah satu sebagai metode utama. Mengubah metode akan
            menggantikan kredensial sebelumnya.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant={editor === "pin" ? "default" : "outline"}
            onClick={() => {
              setEditor(editor === "pin" ? "none" : "pin");
              setPin1("");
              setPin2("");
            }}
          >
            🔢 {cfg?.method === "pin" ? "Ubah PIN" : "Atur PIN"}
          </Button>
          <Button
            variant={editor === "pattern" ? "default" : "outline"}
            onClick={() => {
              setEditor(editor === "pattern" ? "none" : "pattern");
              setPat1([]);
              setPat2([]);
              setResetKey((k) => k + 1);
            }}
          >
            ⬣ {cfg?.method === "pattern" ? "Ubah Pola" : "Atur Pola"}
          </Button>
        </div>

        {editor === "pin" && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <Label>PIN baru (4-8 digit)</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin1}
              onChange={(e) => setPin1(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
            <Label>Ulangi PIN</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditor("none")}>
                Batal
              </Button>
              <Button onClick={handleSavePin}>Simpan PIN</Button>
            </div>
          </div>
        )}

        {editor === "pattern" && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div>
              <Label>Gambar pola baru (≥ 4 titik)</Label>
              <div className="mt-2 flex justify-center">
                <PatternPad
                  resetKey={resetKey}
                  onComplete={setPat1}
                  onChange={setPat1}
                />
              </div>
              <div className="mt-1 text-center text-[11px] text-muted-foreground">
                {pat1.length} titik
              </div>
            </div>
            <div>
              <Label>Ulangi pola</Label>
              <div className="mt-2 flex justify-center">
                <PatternPad
                  resetKey={resetKey + 1}
                  onComplete={setPat2}
                  onChange={setPat2}
                />
              </div>
              <div className="mt-1 text-center text-[11px] text-muted-foreground">
                {pat2.length} titik
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setPat1([]);
                  setPat2([]);
                  setResetKey((k) => k + 2);
                }}
              >
                Ulangi
              </Button>
              <Button variant="outline" onClick={() => setEditor("none")}>
                Batal
              </Button>
              <Button onClick={handleSavePattern}>Simpan Pola</Button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <h2 className="text-sm font-medium">Opsi Tambahan</h2>

        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>Sidik jari</Label>
            <p className="text-[11px] text-muted-foreground">
              {bioAvailable
                ? "Buka kunci dengan sidik jari (selain PIN/pola)"
                : "Tidak tersedia di perangkat ini"}
            </p>
          </div>
          <Switch
            checked={!!cfg?.biometric && bioAvailable}
            disabled={!cfg || !bioAvailable}
            onCheckedChange={(v) => updateOption({ biometric: v })}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <Label>Kunci saat aplikasi keluar fokus</Label>
            <p className="text-[11px] text-muted-foreground">
              Tab atau aplikasi disembunyikan → langsung terkunci
            </p>
          </div>
          <Switch
            checked={!!cfg?.lockOnHide}
            disabled={!cfg}
            onCheckedChange={(v) => updateOption({ lockOnHide: v })}
          />
        </div>

        <div className="space-y-1">
          <Label>Auto-lock setelah idle (menit)</Label>
          <Input
            type="number"
            min={0}
            max={60}
            disabled={!cfg}
            value={Math.round((cfg?.idleMs ?? 0) / 60000)}
            onChange={(e) => {
              const m = Math.max(0, Math.min(60, Number(e.target.value) || 0));
              updateOption({ idleMs: m * 60000 });
            }}
          />
          <p className="text-[11px] text-muted-foreground">
            0 = nonaktif. Tersimpan otomatis saat diubah.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <div>
            <Label>Hapus sesi saat tutup tab</Label>
            <p className="text-[11px] text-muted-foreground">
              Logout otomatis saat tab/aplikasi ditutup
            </p>
          </div>
          <Switch
            checked={autoLock}
            onCheckedChange={(v) => {
              setAutoLock(v);
              setAutoLockEnabled(uid, v);
              toast.success(
                v ? "Kunci otomatis aktif" : "Kunci otomatis dimatikan",
              );
            }}
          />
        </div>
      </section>
    </div>
  );
}