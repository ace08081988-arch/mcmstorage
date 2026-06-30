import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Loader2, RotateCcw, Save, ShieldCheck, ArrowLeft, FlaskConical, CheckCircle2, AlertTriangle, ExternalLink, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendly-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  WORKER_PORTAL_DEFAULTS,
  WORKER_PORTAL_CONFIG_FIELDS,
  sanitizeWorkerPortalConfig,
  encodePreviewConfigHash,
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
      .number({ invalid_type_error: `${f.label} harus berupa angka (bukan kosong/teks).` })
      .finite(`${f.label} tidak boleh tak hingga.`)
      .int(`${f.label} harus bilangan bulat tanpa desimal.`)
      .min(f.min, `${f.label} minimum ${f.min.toLocaleString("id-ID")} ${f.unit}.`)
      .max(f.max, `${f.label} maksimum ${f.max.toLocaleString("id-ID")} ${f.unit}.`);
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
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    issues: Array<{ key?: keyof WorkerPortalConfig; message: string }>;
    effective: WorkerPortalConfig;
    sources: Record<keyof WorkerPortalConfig, "form" | "default">;
    invariantsAdjusted: string[];
  } | null>(null);
  const schema = useMemo(buildSchema, []);

  // Validasi live: tiap perubahan form langsung dihitung supaya tombol
  // Simpan ter-disable & banner ringkasan error muncul sebelum klik.
  const validation = useMemo(() => {
    const raw: Record<string, number> = {};
    for (const f of WORKER_PORTAL_CONFIG_FIELDS) {
      const s = form[f.key];
      raw[f.key] = s.trim() === "" ? Number.NaN : Number(s);
    }
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      return { ok: true as const, fieldErrors: {} as Partial<Record<keyof WorkerPortalConfig, string>>, list: [] as Array<{ key?: keyof WorkerPortalConfig; label: string; message: string }> };
    }
    const fieldErrors: Partial<Record<keyof WorkerPortalConfig, string>> = {};
    const list: Array<{ key?: keyof WorkerPortalConfig; label: string; message: string }> = [];
    for (const issue of parsed.error.issues) {
      const k = issue.path[0] as keyof WorkerPortalConfig | undefined;
      const meta = k ? WORKER_PORTAL_CONFIG_FIELDS.find((x) => x.key === k) : undefined;
      if (k && !fieldErrors[k]) fieldErrors[k] = issue.message;
      list.push({ key: k, label: meta?.label ?? "Form", message: issue.message });
    }
    return { ok: false as const, fieldErrors, list };
  }, [form, schema]);

  const hasErrors = !validation.ok;

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
    setTestResult(null);
  }

  function testConfig() {
    const parsedRaw: Record<string, number> = {};
    for (const f of WORKER_PORTAL_CONFIG_FIELDS) {
      parsedRaw[f.key] = Number(form[f.key]);
    }
    const parsed = schema.safeParse(parsedRaw);
    const issues: Array<{ key?: keyof WorkerPortalConfig; message: string }> = [];
    const nextErrors: Partial<Record<keyof WorkerPortalConfig, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof WorkerPortalConfig | undefined;
        issues.push({ key: k, message: issue.message });
        if (k && !nextErrors[k]) nextErrors[k] = issue.message;
      }
    }
    setErrors(nextErrors);

    // Hitung config efektif dengan alur yang sama seperti runtime: nilai
    // tidak valid otomatis disaring → fallback ke default, lalu invariants.
    const sanitized = sanitizeWorkerPortalConfig(parsedRaw as Partial<WorkerPortalConfig>);
    const sources = {} as Record<keyof WorkerPortalConfig, "form" | "default">;
    const effective = { ...WORKER_PORTAL_DEFAULTS } as WorkerPortalConfig;
    for (const f of WORKER_PORTAL_CONFIG_FIELDS) {
      if (sanitized[f.key] !== undefined) {
        effective[f.key] = sanitized[f.key] as number;
        sources[f.key] = "form";
      } else {
        sources[f.key] = "default";
      }
    }
    const invariantsAdjusted: string[] = [];
    if (effective.lagThresholdSec >= effective.staleThresholdSec) {
      effective.lagThresholdSec = WORKER_PORTAL_DEFAULTS.lagThresholdSec;
      effective.staleThresholdSec = WORKER_PORTAL_DEFAULTS.staleThresholdSec;
      sources.lagThresholdSec = "default";
      sources.staleThresholdSec = "default";
      invariantsAdjusted.push("lag ≥ stale → kedua ambang dikembalikan ke default.");
    }
    if (effective.staleCooldownBaseMs > effective.staleCooldownMaxMs) {
      effective.staleCooldownBaseMs = WORKER_PORTAL_DEFAULTS.staleCooldownBaseMs;
      effective.staleCooldownMaxMs = WORKER_PORTAL_DEFAULTS.staleCooldownMaxMs;
      sources.staleCooldownBaseMs = "default";
      sources.staleCooldownMaxMs = "default";
      invariantsAdjusted.push("cooldown awal > maksimum → kedua nilai cooldown dikembalikan ke default.");
    }
    setTestResult({ ok: issues.length === 0, issues, effective, sources, invariantsAdjusted });
    if (issues.length === 0 && invariantsAdjusted.length === 0) {
      toast.success("Konfigurasi valid. Lihat ringkasan efektif di bawah.");
    } else {
      toast.message("Uji selesai dengan catatan — lihat hasil di bawah.");
    }
  }

  async function save() {
    // Tolak submit lebih awal sebelum sentuh jaringan.
    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      toast.error(
        `Tidak bisa menyimpan: ${validation.list.length} kesalahan input. Perbaiki dulu kolom yang ditandai merah.`,
      );
      // Fokuskan field pertama yang bermasalah.
      const firstKey = validation.list.find((x) => x.key)?.key;
      if (firstKey) {
        const el = document.getElementById(firstKey) as HTMLInputElement | null;
        el?.focus();
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    const parsedRaw: Record<string, number> = {};
    for (const f of WORKER_PORTAL_CONFIG_FIELDS) {
      parsedRaw[f.key] = Number(form[f.key]);
    }
    const parsed = schema.safeParse(parsedRaw);
    if (!parsed.success) return; // pengaman ganda — seharusnya tidak terjadi
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
          const err = errors[f.key] ?? validation.fieldErrors[f.key];
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
                aria-describedby={err ? `${f.key}-err` : undefined}
                className={err ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              <p className="text-xs text-muted-foreground">{f.help}</p>
              <p className="text-xs text-muted-foreground">
                Rentang valid: {f.min.toLocaleString("id-ID")}–{f.max.toLocaleString("id-ID")} · Default: {String(def)}
              </p>
              {err ? (
                <p id={`${f.key}-err`} role="alert" className="text-xs font-medium text-destructive">
                  {err}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {hasErrors ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            {validation.list.length} input tidak valid · Simpan dinonaktifkan
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {validation.list.slice(0, 8).map((i, idx) => (
              <li key={idx}>
                <strong>{i.label}:</strong> {i.message}
              </li>
            ))}
            {validation.list.length > 8 ? (
              <li className="text-muted-foreground">
                …dan {validation.list.length - 8} lagi.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving || hasErrors} aria-disabled={hasErrors || undefined}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Simpan konfigurasi
        </Button>
        <Button variant="secondary" onClick={testConfig} disabled={saving}>
          <FlaskConical className="mr-2 h-4 w-4" /> Uji konfigurasi
        </Button>
        <Button variant="outline" onClick={resetToDefaults} disabled={saving}>
          <RotateCcw className="mr-2 h-4 w-4" /> Pulihkan default
        </Button>
      </div>

      {testResult ? (
        <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            {testResult.ok ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            )}
            <h2 className="text-base font-semibold">
              {testResult.ok ? "Validasi lolos" : "Ada nilai tidak valid"}
            </h2>
          </div>
          {testResult.issues.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
              {testResult.issues.map((i, idx) => (
                <li key={idx}>
                  {i.key ? <code className="mr-1">{i.key}</code> : null}
                  {i.message}
                </li>
              ))}
            </ul>
          ) : null}
          {testResult.invariantsAdjusted.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              <strong>Invariant antar-field disesuaikan:</strong>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {testResult.invariantsAdjusted.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          ) : null}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Konfigurasi efektif</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Nilai inilah yang akan dipakai portal pegawai dengan input saat ini. Kolom <em>Sumber</em> menunjukkan apakah nilai berasal dari form atau fallback ke default.
            </p>
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Field</th>
                    <th className="px-2 py-1.5 text-right">Nilai efektif</th>
                    <th className="px-2 py-1.5 text-right">Default</th>
                    <th className="px-2 py-1.5 text-right">Sumber</th>
                  </tr>
                </thead>
                <tbody>
                  {WORKER_PORTAL_CONFIG_FIELDS.map((f) => {
                    const src = testResult.sources[f.key];
                    return (
                      <tr key={f.key} className="border-t">
                        <td className="px-2 py-1.5"><code>{f.key}</code> <span className="text-xs text-muted-foreground">({f.unit})</span></td>
                        <td className="px-2 py-1.5 text-right font-mono">{String(testResult.effective[f.key])}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{String(WORKER_PORTAL_DEFAULTS[f.key])}</td>
                        <td className="px-2 py-1.5 text-right">
                          <span className={
                            src === "form"
                              ? "rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                              : "rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                          }>{src}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Lihat JSON</summary>
            <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(testResult.effective, null, 2)}</pre>
          </details>
        </div>
      ) : null}

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
        <strong>Catatan:</strong> Nilai berlaku saat portal pegawai (mis. <code>/t/&lt;token&gt;</code>) dimount ulang. Pegawai yang sudah membuka halaman akan mengambil nilai baru ketika tab dibuka kembali atau halaman di-refresh.
      </div>
    </div>
  );
}