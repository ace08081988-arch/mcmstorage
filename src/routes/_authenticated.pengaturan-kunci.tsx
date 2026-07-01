import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
  checkBiometricStatus,
  openBiometricEnrollment,
  openAppPermissionSettings,
  randomSalt,
  requestLockNow,
  setLockConfig,
  type BiometricStatus,
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

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "baru saja";
  if (s < 60) return `${s}d lalu`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m lalu`;
  const h = Math.round(m / 60);
  return `${h}j lalu`;
}

function labelPlatform(p: BiometricStatus["platform"]): string {
  return p === "android" ? "Android" : p === "ios" ? "iOS" : "Web";
}
function labelPermission(p: BiometricStatus["permission"]): string {
  return p === "granted" ? "diberikan" : p === "denied" ? "ditolak" : "belum diketahui";
}
function labelEnrolled(e: BiometricStatus["enrolled"]): string {
  return e === true ? "terdaftar" : e === false ? "belum terdaftar" : "tidak diketahui";
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "err";
}) {
  const dot =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "err"
        ? "bg-rose-500"
        : "bg-amber-500";
  return (
    <li className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-medium">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        {value}
      </span>
    </li>
  );
}

function PengaturanKunci() {
  const [uid, setUid] = useState<string | null>(null);
  const [cfg, setCfg] = useState<LockConfig | null>(null);
  const [bioStatus, setBioStatus] = useState<BiometricStatus>({ available: false, native: false });
  const [bioChecking, setBioChecking] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [openingPerm, setOpeningPerm] = useState(false);
  const [bioCheckedAt, setBioCheckedAt] = useState<number | null>(null);
  const [bioTick, setBioTick] = useState(0);
  const prevBioRef = useRef<BiometricStatus | null>(null);
  const bioAvailable = bioStatus.available;
  const [autoLock, setAutoLock] = useState(false);

  // Nama toko untuk caption WhatsApp
  const [shopName, setShopName] = useState("");
  const [shopSaved, setShopSaved] = useState("");
  useEffect(() => {
    const v = (typeof localStorage !== "undefined" && localStorage.getItem("shop:name")) || "";
    setShopName(v);
    setShopSaved(v);
  }, []);
  const saveShopName = () => {
    const v = shopName.trim().slice(0, 60);
    localStorage.setItem("shop:name", v);
    setShopSaved(v);
    toast.success(v ? `Nama toko disimpan: ${v}` : "Nama toko dikosongkan");
  };

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
    runBioCheck(false);
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

  // Cek ulang otomatis ketika user kembali dari Pengaturan Sistem.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") runBioCheck(true);
    };
    const onPageShow = () => runBioCheck(enrolling);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, cfg?.biometric, enrolling]);

  // Ticker untuk memperbarui label "Diperbarui …" secara relatif.
  useEffect(() => {
    const id = window.setInterval(() => setBioTick((t) => t + 1), 15000);
    return () => window.clearInterval(id);
  }, []);

  const runBioCheck = (interactive: boolean) => {
    setBioChecking(true);
    checkBiometricStatus().then((s) => {
      const prev = prevBioRef.current;
      setBioStatus(s);
      setBioChecking(false);
      setBioCheckedAt(Date.now());
      // Diff status dan tampilkan toast bila ada perubahan yang berarti.
      if (prev) {
        const diffs: string[] = [];
        if (prev.platform !== s.platform) {
          diffs.push(`Platform: ${labelPlatform(s.platform)}`);
        }
        if (prev.pluginLoaded !== s.pluginLoaded) {
          diffs.push(`Plugin biometrik: ${s.pluginLoaded ? "aktif" : "nonaktif"}`);
        }
        if (prev.permission !== s.permission) {
          diffs.push(`Izin: ${labelPermission(s.permission)}`);
        }
        if (prev.enrolled !== s.enrolled) {
          diffs.push(`Sidik jari: ${labelEnrolled(s.enrolled)}`);
        }
        if (diffs.length > 0) {
          const desc = diffs.join(" · ");
          if (s.available && !prev.available) {
            toast.success("Status perangkat berubah", { description: desc });
          } else if (!s.available && prev.available) {
            toast.warning("Status perangkat berubah", { description: desc });
          } else {
            toast("Status perangkat berubah", { description: desc });
          }
        }
      }
      prevBioRef.current = s;
      if (!interactive) return;
      if (s.available) {
        // Setelah pendaftaran berhasil, langsung aktifkan bila sudah ada kunci.
        const current = uid ? getLockConfig(uid) : null;
        if (current && !current.biometric && enrolling) {
          setLockConfig(uid!, { ...current, biometric: true });
          toast.success("Sidik jari terdeteksi & diaktifkan");
        } else {
          toast.success("Sidik jari terdeteksi");
        }
        setEnrolling(false);
      } else if (enrolling) {
        toast.error(s.reason || "Belum terdaftar");
      }
    });
  };

  const handleEnroll = async () => {
    setEnrolling(true);
    const opened = await openBiometricEnrollment();
    if (!opened) {
      setEnrolling(false);
      toast.error(
        bioStatus.native
          ? "Tidak bisa membuka Pengaturan otomatis. Buka manual: Setelan → Keamanan → Sidik Jari."
          : "Hanya bisa didaftarkan di APK Android",
      );
    } else {
      toast.message("Buka Pengaturan Sistem. Kembali ke aplikasi setelah sidik jari terdaftar.");
    }
  };

  const handleOpenPerm = async (preferBiometric = false) => {
    setOpeningPerm(true);
    const opened = await openAppPermissionSettings(undefined, { preferBiometric });
    setOpeningPerm(false);
    if (!opened) {
      toast.error(
        bioStatus.native
          ? "Tidak bisa membuka halaman izin. Buka manual: Setelan → Aplikasi → MCM Storage → Izin."
          : "Hanya tersedia di APK Android",
      );
    } else {
      toast.message(
        preferBiometric
          ? "Atur biometrik lalu kembali ke aplikasi — status akan diperbarui otomatis."
          : "Ubah izin lalu kembali ke aplikasi — status akan diperbarui otomatis.",
      );
    }
  };

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

      <section className="rounded-lg border p-4 space-y-2">
        <div>
          <div className="text-sm font-medium">Nama Toko</div>
          <div className="text-xs text-muted-foreground">
            Dipakai otomatis di caption MCM saat mengirim paket
            (mis. <em>“PEMBAYARAN DIKONFIRMASI - {shopSaved || "NAMA TOKO"}”</em>).
          </div>
        </div>
        <div className="flex gap-2">
          <Input
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="Mis. Ace Store"
            maxLength={60}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={saveShopName}
            disabled={shopName.trim() === shopSaved}
          >
            Simpan
          </Button>
        </div>
      </section>

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

        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="text-[12px] font-medium">Status Perangkat</div>
              <span
                key={bioTick}
                className="text-[10px] text-muted-foreground"
                aria-live="polite"
              >
                {bioChecking
                  ? "Memeriksa…"
                  : bioCheckedAt
                    ? `Diperbarui ${relTime(bioCheckedAt)}`
                    : "Belum diperiksa"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => runBioCheck(true)}
              disabled={bioChecking}
              className="text-[11px] font-medium text-primary underline disabled:opacity-50"
            >
              {bioChecking ? "Memeriksa…" : "Refresh"}
            </button>
          </div>
          {bioStatus.native && (
            <div className="mb-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => handleOpenPerm(false)}
                disabled={openingPerm}
              >
                {openingPerm ? "Membuka…" : "Buka pengaturan izin"}
              </Button>
            </div>
          )}
          <ul className="grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
            <StatusRow
              label="Platform"
              value={
                bioStatus.platform === "android"
                  ? "Android"
                  : bioStatus.platform === "ios"
                    ? "iOS"
                    : "Web (preview)"
              }
              tone={bioStatus.native ? "ok" : "warn"}
            />
            <StatusRow
              label="Plugin biometrik"
              value={bioStatus.pluginLoaded ? "Aktif" : "Tidak aktif"}
              tone={bioStatus.pluginLoaded ? "ok" : "warn"}
            />
            <StatusRow
              label="Izin sidik jari"
              value={
                bioStatus.permission === "granted"
                  ? "Diberikan"
                  : bioStatus.permission === "denied"
                    ? "Ditolak"
                    : "Belum diketahui"
              }
              tone={
                bioStatus.permission === "granted"
                  ? "ok"
                  : bioStatus.permission === "denied"
                    ? "err"
                    : "warn"
              }
            />
            <StatusRow
              label="Sidik jari terdaftar"
              value={
                bioStatus.enrolled === true
                  ? "Ya"
                  : bioStatus.enrolled === false
                    ? "Belum"
                    : "Tidak diketahui"
              }
              tone={
                bioStatus.enrolled === true
                  ? "ok"
                  : bioStatus.enrolled === false
                    ? "err"
                    : "warn"
              }
            />
          </ul>
          {bioStatus.reason && !bioAvailable && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Detail: <span className="font-mono">{bioStatus.code || "—"}</span>{" "}
              · {bioStatus.reason}
            </div>
          )}
          {(() => {
            const hasLock = !!cfg?.hash;
            const recs: {
              key: string;
              text: string;
              action?: { label: string; onClick: () => void; disabled?: boolean };
              secondary?: { label: string; onClick: () => void; disabled?: boolean };
            }[] = [];
            const permAction = {
              label: openingPerm ? "Membuka…" : "Buka pengaturan izin",
              onClick: () => handleOpenPerm(false),
              disabled: openingPerm,
            };
            const bioPageAction = {
              label: openingPerm ? "Membuka…" : "Buka pengaturan izin",
              onClick: () => handleOpenPerm(true),
              disabled: openingPerm,
            };
            if (!bioStatus.native) {
              recs.push({
                key: "web",
                text: "Sidik jari hanya bisa dipakai di APK Android. Buka aplikasi terpasang untuk mengaktifkan.",
              });
            } else if (!bioStatus.pluginLoaded) {
              recs.push({
                key: "plugin",
                text: "Plugin biometrik tidak termuat. Perbarui APK ke versi terbaru, lalu buka halaman ini kembali.",
                action: { label: "Cek ulang", onClick: () => runBioCheck(true), disabled: bioChecking },
              });
            } else {
              if (bioStatus.permission === "denied") {
                recs.push({
                  key: "perm",
                  text: "Izin sidik jari ditolak. Buka Pengaturan Sistem → Aplikasi → izinkan Biometrik untuk MCM Storage.",
                  action: permAction,
                });
              } else if (bioStatus.permission === "unknown") {
                recs.push({
                  key: "perm-check",
                  text: "Izin sidik jari belum diizinkan. Buka pengaturan izin untuk memberikan akses biometrik.",
                  action: permAction,
                  secondary: { label: "Cek ulang", onClick: () => runBioCheck(true), disabled: bioChecking },
                });
              }
              if (bioStatus.enrolled === false) {
                recs.push({
                  key: "enroll",
                  text: "Belum ada sidik jari terdaftar di perangkat. Daftarkan dulu di Pengaturan Sistem.",
                  action: { label: enrolling ? "Membuka…" : "Daftarkan sidik jari", onClick: handleEnroll, disabled: enrolling },
                  secondary: bioPageAction,
                });
              }
              if (!hasLock) {
                recs.push({
                  key: "pin",
                  text: "Buat PIN cadangan dulu — sidik jari butuh kunci utama sebagai fallback.",
                  action: { label: "Buat PIN", onClick: () => setEditor("pin") },
                });
              }
              if (bioAvailable && hasLock && !cfg?.biometric) {
                recs.push({
                  key: "toggle",
                  text: "Semua siap. Aktifkan switch Sidik jari di bawah untuk mulai memakainya.",
                });
              }
            }
            if (recs.length === 0 && bioAvailable && cfg?.biometric) {
              return (
                <div className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                  Sidik jari aktif dan siap dipakai.
                </div>
              );
            }
            if (recs.length === 0) return null;
            return (
              <div className="mt-3 space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">
                  Rekomendasi langkah
                </div>
                <ol className="space-y-1.5">
                  {recs.map((r, i) => (
                    <li
                      key={r.key}
                      className="flex items-start gap-2 rounded border bg-background px-2 py-1.5 text-[11px]"
                    >
                      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                        {i + 1}
                      </span>
                      <div className="flex-1 space-y-1">
                        <p className="leading-snug">{r.text}</p>
                        {r.action && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2 text-[11px]"
                            onClick={r.action.onClick}
                            disabled={r.action.disabled}
                          >
                            {r.action.label}
                          </Button>
                        )}
                        {r.secondary && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-1 h-7 px-2 text-[11px]"
                            onClick={r.secondary.onClick}
                            disabled={r.secondary.disabled}
                          >
                            {r.secondary.label}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })()}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <Label>Sidik jari</Label>
            <p className="text-[11px] text-muted-foreground">
              {bioChecking
                ? "Memeriksa perangkat…"
                : bioAvailable
                  ? "Buka kunci dengan sidik jari (selain PIN/pola)"
                  : bioStatus.reason || "Tidak tersedia di perangkat ini"}
            </p>
            {!bioChecking && !bioAvailable && (
              <div className="mt-2 flex flex-wrap gap-2">
                {bioStatus.native && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleEnroll}
                    disabled={enrolling}
                  >
                    {enrolling ? "Membuka…" : "Daftarkan sidik jari"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runBioCheck(true)}
                  disabled={bioChecking}
                >
                  Cek ulang
                </Button>
              </div>
            )}
            {!bioChecking && !bioAvailable && bioStatus.native && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Setelah menambahkan sidik jari di sistem, kembali ke aplikasi —
                switch akan aktif otomatis.
              </p>
            )}
            {!bioChecking && !bioAvailable && !cfg && (
              <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-200">
                Sidik jari belum tersedia. Buat <b>PIN cadangan</b> agar tetap bisa
                mengaktifkan App Lock dan membuka aplikasi.
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditor("pin");
                      setPin1("");
                      setPin2("");
                    }}
                  >
                    Buat PIN cadangan
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditor("pattern");
                      setPat1([]);
                      setPat2([]);
                      setResetKey((k) => k + 1);
                    }}
                  >
                    Atau pakai Pola
                  </Button>
                </div>
              </div>
            )}
            {cfg && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {cfg.method === "pin" ? "PIN" : "Pola"} cadangan tetap aktif —
                bisa dipakai login bila sidik jari gagal atau dinonaktifkan.
              </p>
            )}
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