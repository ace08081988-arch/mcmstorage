import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Loader2, RotateCcw, Save, ShieldCheck, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendly-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  WORKER_PORTAL_DEFAULTS,
  WORKER_PORTAL_CONFIG_FIELDS,
  type WorkerPortalConfig,
} from "@/lib/worker-portal-config";

export const Route = createFileRoute("/_authenticated/admin/worker-portal")({
  head: () => ({
    meta: [
      { title: "Admin · Portal Pegawai · MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminWorkerPortalPage,
});

type FormState = Record<keyof WorkerPortalConfig, string>;

function toFormState(cfg: Partial<WorkerPortalConfig>): FormState {
  const merged = { ...WORKER_PORTAL_DEFAULTS, ...cfg };
  return Object.fromEntries(
    WORKER_PORTAL_CONFIG_FIELDS.map((f) => [f.key, String(merged[f.key])]),
  ) as FormState;
}

function buildSchema() {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of WORKER_PORTAL_CONFIG_FIELDS) {
    shape[f.key] = z
      .number({ invalid_type_error: `${f.label} harus angka` })
      .int(`${f.label} harus bilangan bulat`)
      .min(f.min, `${f.label} minimum ${f.min} ${f.unit}`)
      .max(f.max, `${f.label} maksimum ${f.max} ${f.unit}`);
  }
  return z
    .object(shape)
    .refine(
      (v) => (v.lagThresholdSec as number) < (v.staleThresholdSec as number),
      { message: "Ambang lag harus lebih kecil dari ambang stale.", path: ["lagThresholdSec"] },
    )
    .refine(
      (v) => (v.staleCooldownBaseMs as number) <= (v.staleCooldownMaxMs as number),
      { message: "Cooldown awal stale harus ≤ cooldown maksimum.", path: ["staleCooldownBaseMs"] },
    );
}

function AdminWorkerPortalPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(() => toFormState({}));
  const [errors, setErrors] = useState<Partial<Record<keyof WorkerPortalConfig, string>>>({});
  const schema = useMemo(buildSchema, []);

  useEffect(() => {
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setIsAdmin(false); setLoading(false); return; }
      const { data: roleOk } = await supabase.rpc("has_role", {
        _user_id: u.user.id,
        _role: "admin",
      });
      setIsAdmin(!!roleOk);
      if (!roleOk) { setLoading(false); return; }
      const { data, error } = await supabase
        .from("app_settings")
        .select("worker_portal_config")
        .eq("id", true)
        .maybeSingle();
      if (error) toast.error(friendlyError(error));
      const raw = (data as { worker_portal_config?: unknown } | null)?.worker_portal_config;
      setForm(toFormState((raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Partial<WorkerPortalConfig>));
      setLoading(false);
    })();
  }, []);

  function setField(key: keyof WorkerPortalConfig, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: undefined }));
  }

  function resetToDefaults() {
    setForm(toFormState({}));
    setErrors({});
  }

  async function save() {
    const parsedRaw: Record<string, number> = {};
    for (const f of WORKER_PORTAL_CONFIG_FIELDS) {
      parsedRaw[f.key] = Number(form[f.key]);
    }
    const parsed = schema.safeParse(parsedRaw);
    if (!parsed.success) {
      const nextErrors: Partial<Record<keyof WorkerPortalConfig, string>> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof WorkerPortalConfig | undefined;
        if (k && !nextErrors[k]) nextErrors[k] = issue.message;
      }
      setErrors(nextErrors);
      toast.error("Periksa kembali nilai yang ditandai.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .update({ worker_portal_config: parsed.data })
      .eq("id", true);
    setSaving(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Konfigurasi portal pegawai disimpan. Perangkat pegawai akan memakai nilai baru pada mount berikutnya.");
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <h1 className="text-xl font-semibold">Akses ditolak</h1>
        <p className="mt-2 text-sm text-muted-foreground">Halaman ini hanya untuk admin.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header className="space-y-2">
        <Link to="/" className="inline-flex items-center text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="mr-1 h-4 w-4" /> Kembali
        </Link>
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary"><ShieldCheck className="h-5 w-5" /></div>
          <div>
            <h1 className="text-2xl font-bold">Portal pegawai · konfigurasi runtime</h1>
            <p className="text-sm text-muted-foreground">
              TTL PIN sesi, jumlah retry, dan ambang sinkron. Perubahan berlaku tanpa edit kode pada mount baru di perangkat pegawai (auto-refresh saat tab dibuka kembali).
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-2">
        {WORKER_PORTAL_CONFIG_FIELDS.map((f) => {
          const err = errors[f.key];
          const def = WORKER_PORTAL_DEFAULTS[f.key];
          return (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key} className="flex items-center justify-between gap-2">
                <span>{f.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{f.unit}</span>
              </Label>
              <Input
                id={f.key}
                type="number"
                inputMode="numeric"
                min={f.min}
                max={f.max}
                value={form[f.key]}
                onChange={(e) => setField(f.key, e.target.value)}
                aria-invalid={err ? true : undefined}
                className={err ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              <p className="text-xs text-muted-foreground">{f.help}</p>
              <p className="text-xs text-muted-foreground">
                Rentang valid: {f.min.toLocaleString("id-ID")}–{f.max.toLocaleString("id-ID")} · Default: {String(def)}
              </p>
              {err ? <p className="text-xs font-medium text-destructive">{err}</p> : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Simpan konfigurasi
        </Button>
        <Button variant="outline" onClick={resetToDefaults} disabled={saving}>
          <RotateCcw className="mr-2 h-4 w-4" /> Pulihkan default
        </Button>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
        <strong>Catatan:</strong> Nilai berlaku saat portal pegawai (mis. <code>/t/&lt;token&gt;</code>) dimount ulang. Pegawai yang sudah membuka halaman akan mengambil nilai baru ketika tab dibuka kembali atau halaman di-refresh.
      </div>
    </div>
  );
}