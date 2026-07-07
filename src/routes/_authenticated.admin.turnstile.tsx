import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ShieldAlert, Save, Loader2, KeyRound } from "lucide-react";
import { useAdminStatus } from "@/hooks/use-is-admin";
import {
  getTurnstileConfig,
  updateTurnstileConfig,
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

function TurnstileSettingsPage() {
  const { isAdmin, isCheckingAdmin } = useAdminStatus();
  const getCfg = useServerFn(getTurnstileConfig);
  const updateCfg = useServerFn(updateTurnstileConfig);
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

  const cfg = cfgQuery.data;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali
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