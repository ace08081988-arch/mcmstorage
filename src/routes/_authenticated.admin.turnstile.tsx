import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ShieldAlert,
  Save,
  Loader2,
  KeyRound,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useAdminStatus } from "@/hooks/use-is-admin";
import {
  getTurnstileConfig,
  updateTurnstileConfig,
  testTurnstileSecret,
  type TurnstileSecretTestResult,
} from "@/lib/turnstile-config.functions";

export const Route = createFileRoute("/_authenticated/admin/turnstile")({
  head: () => ({
    meta: [
      { title: "Pengaturan Turnstile · MCM Storage" },
      {
        name: "description",
        content:
          "Kelola Cloudflare Turnstile site key dan secret key untuk verifikasi CAPTCHA.",
      },
    ],
  }),
  component: TurnstileSettingsPage,
});

function StatusRow({
  ok,
  warn,
  label,
  detail,
}: {
  ok: boolean;
  warn?: boolean;
  label: string;
  detail: string;
}) {
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  const color = ok
    ? "text-emerald-600 dark:text-emerald-400"
    : warn
      ? "text-amber-600 dark:text-amber-400"
      : "text-destructive";
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className={"h-4 w-4 mt-0.5 shrink-0 " + color} />
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground break-all">{detail}</div>
      </div>
    </div>
  );
}

function TurnstileSettingsPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const getCfg = useServerFn(getTurnstileConfig);
  const updateCfg = useServerFn(updateTurnstileConfig);
  const testSecret = useServerFn(testTurnstileSecret);
  const qc = useQueryClient();

  const cfgQuery = useQuery({
    queryKey: ["admin", "turnstile-config"],
    queryFn: () => getCfg(),
    enabled: isAdmin,
    retry: false,
    staleTime: 10_000,
  });

  const [siteKey, setSiteKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TurnstileSecretTestResult | null>(
    null,
  );

  useEffect(() => {
    if (cfgQuery.data) setSiteKey(cfgQuery.data.site_key);
  }, [cfgQuery.data]);

  if (isCheckingAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Memeriksa akses…</div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="p-6 flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-destructive mt-0.5" />
        <div>
          <div className="font-medium">Akses ditolak</div>
          <div className="text-sm text-muted-foreground">
            Hanya admin yang dapat mengubah pengaturan Turnstile.
          </div>
        </div>
      </div>
    );
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateCfg({
        data: {
          site_key: siteKey.trim(),
          secret_key: secretKey,
          clear_secret: false,
        },
      });
      setSecretKey("");
      toast.success("Pengaturan Turnstile disimpan");
      await qc.invalidateQueries({ queryKey: ["admin", "turnstile-config"] });
      await qc.invalidateQueries({ queryKey: ["turnstile", "site-key"] });
    } catch (err) {
      toast.error("Gagal menyimpan", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  async function onClearSecret() {
    if (!confirm("Hapus secret key? Verifikasi Turnstile akan berhenti sampai secret diisi ulang.")) return;
    setSaving(true);
    try {
      await updateCfg({
        data: { site_key: siteKey.trim(), secret_key: "", clear_secret: true },
      });
      toast.success("Secret key dihapus");
      await qc.invalidateQueries({ queryKey: ["admin", "turnstile-config"] });
    } catch (err) {
      toast.error("Gagal menghapus", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  }

  async function onTestSecret() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testSecret({ data: { secret_key: secretKey } });
      setTestResult(result);
      if (result.ok) {
        toast.success("Secret key valid");
      } else {
        toast.error("Secret key tidak valid", { description: result.message });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({
        ok: false,
        source: "none",
        codes: ["client_error"],
        message: msg,
      });
      toast.error("Gagal menguji", { description: msg });
    } finally {
      setTesting(false);
    }
  }

  const cfg = cfgQuery.data;

  // Hostname yang WAJIB ada di allowlist widget Turnstile Cloudflare.
  // Kalau hostname aktif tidak ada di daftar ini, widget akan gagal
  // memuat / verifikasi ditolak dengan `invalid-hostname`.
  const EXPECTED_HOSTNAMES = [
    "mcmstorage.biz",
    "www.mcmstorage.biz",
    "mcmstorage.lovable.app",
  ];
  const currentHost =
    typeof window !== "undefined" ? window.location.hostname : "";
  const isLovablePreview = /\.lovable\.app$/.test(currentHost);
  const hostInAllowlist =
    EXPECTED_HOSTNAMES.includes(currentHost) || isLovablePreview;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali
        </Link>
        <Link
          to="/admin/turnstile-audit"
          className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
        >
          Audit kegagalan →
        </Link>
      </div>

      <header className="flex items-start gap-3">
        <KeyRound className="h-6 w-6 mt-1" />
        <div>
          <h1 className="text-xl font-semibold">Pengaturan Turnstile</h1>
          <p className="text-sm text-muted-foreground">
            Kelola Cloudflare Turnstile site key & secret key. Perubahan
            langsung berlaku (tanpa rebuild).
          </p>
        </div>
      </header>

      {cfgQuery.isLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat…
        </div>
      ) : cfgQuery.error ? (
        <div className="text-sm text-destructive">
          Gagal memuat: {(cfgQuery.error as Error).message}
        </div>
      ) : cfg ? (
        <section
          aria-label="Status konfigurasi Turnstile"
          className="rounded-lg border bg-card p-4 space-y-3"
        >
          <div className="text-sm font-medium">Status konfigurasi</div>

          <StatusRow
            ok={Boolean(cfg.site_key)}
            label="Site Key"
            detail={
              cfg.site_key
                ? cfg.site_key.slice(0, 8) + "…" + cfg.site_key.slice(-4)
                : "Belum diatur — isi field di bawah lalu Simpan."
            }
          />

          <StatusRow
            ok={cfg.has_secret}
            label="Secret Key"
            detail={
              cfg.has_secret
                ? "Tersimpan di database (" + cfg.secret_key_masked + ")."
                : "Belum tersimpan. Verifikasi Turnstile TIDAK akan jalan sampai secret diisi."
            }
          />

          <StatusRow
            ok={hostInAllowlist}
            warn={!hostInAllowlist}
            label="Hostname aktif"
            detail={
              currentHost
                ? hostInAllowlist
                  ? currentHost +
                    " — cocok dengan daftar yang seharusnya di-allowlist."
                  : currentHost +
                    " — TIDAK termasuk daftar yang seharusnya di-allowlist. Tambahkan di dashboard Cloudflare."
                : "(tidak tersedia)"
            }
          />

          <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
            <div className="font-medium text-foreground">
              Hostname yang harus ada di allowlist widget Cloudflare:
            </div>
            <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
              {EXPECTED_HOSTNAMES.map((h) => (
                <li key={h}>
                  <code>{h}</code>
                  {h === currentHost && (
                    <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                      ← aktif
                    </span>
                  )}
                </li>
              ))}
              <li>
                <code>*.lovable.app</code> (preview editor)
              </li>
            </ul>
            <div className="text-muted-foreground pt-1">
              Catatan: daftar ini <b>tidak</b> bisa dibaca via API — verifikasi
              manual di Cloudflare Dashboard → Turnstile → widget → Hostname
              Management. Gunakan tombol <b>Uji secret</b> di bawah untuk
              memastikan secret key valid.
            </div>
          </div>

          {cfg.updated_at && (
            <div className="text-xs text-muted-foreground">
              Terakhir diperbarui:{" "}
              {new Date(cfg.updated_at).toLocaleString("id-ID")}
            </div>
          )}
        </section>
      ) : null}

      <form onSubmit={onSave} className="space-y-4 rounded-lg border p-4 bg-card">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="site-key">
            Site Key
          </label>
          <input
            id="site-key"
            type="text"
            value={siteKey}
            onChange={(e) => setSiteKey(e.target.value)}
            placeholder="0x4AAAAAA…"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Publik. Terlihat di HTML halaman signup.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="secret-key">
            Secret Key
          </label>
          <input
            id="secret-key"
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder={
              cfg?.has_secret
                ? `Tersimpan: ${cfg.secret_key_masked} (kosongkan untuk tidak mengubah)`
                : "Belum diatur — masukkan secret Turnstile"
            }
            className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            Rahasia. Hanya dipakai server untuk memvalidasi ke Cloudflare.
            Kosongkan field untuk mempertahankan nilai lama.
          </p>
        </div>

        {cfg?.updated_at && (
          <div className="text-xs text-muted-foreground">
            Diperbarui terakhir:{" "}
            {new Date(cfg.updated_at).toLocaleString("id-ID")}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Simpan
          </button>
          <button
            type="button"
            onClick={onTestSecret}
            disabled={testing || saving}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            title="Menguji secret ke Cloudflare tanpa menyimpan"
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            Uji secret
          </button>
          {cfg?.has_secret && (
            <button
              type="button"
              onClick={onClearSecret}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Hapus secret
            </button>
          )}
        </div>

        {testResult && (
          <div
            className={
              "rounded-md border p-3 text-sm " +
              (testResult.ok
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-destructive/40 bg-destructive/10 text-destructive")
            }
            role="status"
            aria-live="polite"
          >
            <div className="font-medium">
              {testResult.ok ? "✓ Valid" : "✗ Tidak valid"}
              <span className="ml-2 font-normal text-xs opacity-80">
                sumber: {testResult.source}
              </span>
            </div>
            <div className="mt-1">{testResult.message}</div>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs font-mono">
              {typeof testResult.http_status === "number" && (
                <>
                  <dt className="opacity-70">http_status</dt>
                  <dd>{testResult.http_status}</dd>
                </>
              )}
              {typeof testResult.duration_ms === "number" && (
                <>
                  <dt className="opacity-70">duration_ms</dt>
                  <dd>{testResult.duration_ms} ms</dd>
                </>
              )}
              <dt className="opacity-70">secret_source</dt>
              <dd>{testResult.source}</dd>
              {testResult.codes.length > 0 && (
                <>
                  <dt className="opacity-70">error_codes</dt>
                  <dd className="break-all">{testResult.codes.join(", ")}</dd>
                </>
              )}
              {testResult.messages && testResult.messages.length > 0 && (
                <>
                  <dt className="opacity-70">messages</dt>
                  <dd className="break-all">
                    {testResult.messages.join(" | ")}
                  </dd>
                </>
              )}
              {testResult.hostname && (
                <>
                  <dt className="opacity-70">hostname</dt>
                  <dd className="break-all">{testResult.hostname}</dd>
                </>
              )}
              {testResult.action && (
                <>
                  <dt className="opacity-70">action</dt>
                  <dd className="break-all">{testResult.action}</dd>
                </>
              )}
              {testResult.challenge_ts && (
                <>
                  <dt className="opacity-70">challenge_ts</dt>
                  <dd className="break-all">{testResult.challenge_ts}</dd>
                </>
              )}
              {testResult.cf_ray && (
                <>
                  <dt className="opacity-70">cf_ray</dt>
                  <dd className="break-all">{testResult.cf_ray}</dd>
                </>
              )}
              {testResult.request_id && (
                <>
                  <dt className="opacity-70">request_id</dt>
                  <dd className="break-all">{testResult.request_id}</dd>
                </>
              )}
            </dl>
            {testResult.raw && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer opacity-80">
                  Raw response body
                </summary>
                <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono">
                  {testResult.raw}
                </pre>
              </details>
            )}
          </div>
        )}
      </form>

      <div className="rounded-lg border p-4 bg-muted/40 text-sm space-y-2">
        <div className="font-medium">Catatan</div>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Turnstile mendukung <b>multi-hostname allowlist</b> di satu site key — cukup satu pasang kunci untuk dev, preview, dan production.</li>
          <li>Bila DB kosong, sistem otomatis pakai environment variable <code>VITE_TURNSTILE_SITE_KEY</code> / <code>TURNSTILE_SECRET_KEY</code> sebagai fallback.</li>
          <li>Hostname yang perlu di-allowlist di dashboard Cloudflare: <code>mcmstorage.biz</code>, <code>www.mcmstorage.biz</code>, <code>mcmstorage.lovable.app</code>, preview <code>*.lovable.app</code>.</li>
        </ul>
      </div>
    </div>
  );
}