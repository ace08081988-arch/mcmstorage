import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, ExternalLink, ShieldAlert, Check, Eye, EyeOff, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { useAdminStatus } from "@/hooks/use-is-admin";

export const Route = createFileRoute("/_authenticated/pengaturan-oauth-google")({
  head: () => ({
    meta: [{ title: "OAuth Google (BYOK) · MCM Storage" }],
  }),
  component: OAuthGooglePage,
});

/**
 * Halaman panduan admin untuk menukar kredensial Google OAuth bawaan Lovable
 * Cloud dengan kredensial milik sendiri (BYOK). Alasan halaman ini panduan,
 * bukan form: broker OAuth Lovable tidak menerima Client ID/Secret dari
 * tabel aplikasi — nilai final harus dipaste di Backend → Users → Auth
 * Settings → Google agar layar consent tampil sebagai "MCM Storage" tanpa
 * merek pihak ketiga. Halaman ini menyiapkan nilai eksak yang harus
 * ditempel ke Google Cloud Console + Backend, plus ceklis progres.
 */

const CHECKLIST_KEY = "mcm.oauth-google.checklist.v1";
const CLIENT_ID_KEY = "mcm.oauth-google.client-id.v1";

// Regex resmi format kredensial Google OAuth 2.0.
// Client ID web: "<digits>-<lowercased-alphanumeric>.apps.googleusercontent.com".
// Client Secret: diawali "GOCSPX-" diikuti minimal 20 karakter A-Z a-z 0-9 _ -.
const clientIdSchema = z
  .string()
  .trim()
  .min(1, "Client ID wajib diisi")
  .max(200, "Client ID terlalu panjang")
  .regex(
    /^\d{6,}-[a-z0-9]{10,}\.apps\.googleusercontent\.com$/,
    "Format tidak dikenali — contoh: 1234567890-abc123def.apps.googleusercontent.com",
  );
const clientSecretSchema = z
  .string()
  .trim()
  .min(1, "Client Secret wajib diisi")
  .max(200, "Client Secret terlalu panjang")
  .regex(
    /^GOCSPX-[A-Za-z0-9_-]{20,}$/,
    "Format tidak dikenali — Client Secret Google diawali GOCSPX-",
  );

const STEPS = [
  { id: "consent", label: "Isi OAuth consent screen (nama, logo, domain)" },
  { id: "scopes", label: "Tambah scope userinfo.email, userinfo.profile, openid" },
  { id: "domains", label: "Tambah authorized domains" },
  { id: "origins", label: "Tambah JavaScript origins" },
  { id: "redirect", label: "Tambah Authorized redirect URI (Callback URL)" },
  { id: "credentials", label: "Buat Client ID & Secret (Web application)" },
  { id: "paste", label: "Paste Client ID & Secret di Backend → Auth Settings → Google" },
  { id: "test", label: "Uji sign-in di preview & domain produksi" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function loadChecks(): Record<StepId, boolean> {
  const base = Object.fromEntries(
    STEPS.map((s) => [s.id, false]),
  ) as Record<StepId, boolean>;
  try {
    const raw = localStorage.getItem(CHECKLIST_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<StepId, boolean>>;
    for (const s of STEPS) if (typeof parsed[s.id] === "boolean") base[s.id] = parsed[s.id]!;
    return base;
  } catch {
    return base;
  }
}

function saveChecks(next: Record<StepId, boolean>) {
  try {
    localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next));
  } catch {
    /* storage penuh — abaikan */
  }
}

function loadClientId(): string {
  try {
    return localStorage.getItem(CLIENT_ID_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveClientId(value: string) {
  try {
    if (value) localStorage.setItem(CLIENT_ID_KEY, value);
    else localStorage.removeItem(CLIENT_ID_KEY);
  } catch {
    /* storage penuh — abaikan */
  }
}

function OAuthGooglePage() {
  const { isAdmin, isCheckingAdmin: adminLoading } = useAdminStatus();

  const [origin, setOrigin] = useState<string>("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const supabaseUrl =
    (typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL) ||
    "";
  const callbackUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/auth/v1/callback` : "";

  // Daftar Authorized redirect URIs yang perlu ditempel ke Google Cloud
  // Console. Yang wajib adalah callback broker Supabase; sisanya adalah
  // callback per-origin yang dipakai oleh flow `signInWithOAuth` di
  // preview & domain produksi supaya tidak pernah tertolak "redirect_uri_mismatch".
  const redirectUris = useMemo(() => {
    const set = new Set<string>();
    if (callbackUrl) set.add(callbackUrl);
    const origins = [
      "https://mcmstorage.biz",
      "https://www.mcmstorage.biz",
      "https://mcmstorage.lovable.app",
      origin,
    ].filter(Boolean);
    for (const o of origins) {
      set.add(`${o}/auth/callback`);
      set.add(`${o}/`);
    }
    return Array.from(set);
  }, [callbackUrl, origin]);

  const authorizedDomains = useMemo(() => {
    const set = new Set<string>();
    // Domain publik proyek.
    set.add("mcmstorage.biz");
    set.add("www.mcmstorage.biz");
    set.add("lovable.app");
    if (origin) {
      try {
        set.add(new URL(origin).hostname);
      } catch {
        /* origin belum siap */
      }
    }
    return Array.from(set);
  }, [origin]);

  const jsOrigins = useMemo(() => {
    const set = new Set<string>();
    set.add("https://mcmstorage.biz");
    set.add("https://www.mcmstorage.biz");
    set.add("https://mcmstorage.lovable.app");
    if (origin) set.add(origin);
    return Array.from(set);
  }, [origin]);

  const scopes = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "openid",
  ];

  const [checks, setChecks] = useState<Record<StepId, boolean>>(() => {
    if (typeof window === "undefined")
      return Object.fromEntries(STEPS.map((s) => [s.id, false])) as Record<StepId, boolean>;
    return loadChecks();
  });
  const toggle = (id: StepId) => {
    setChecks((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveChecks(next);
      return next;
    });
  };
  const doneCount = STEPS.filter((s) => checks[s.id]).length;
  const complete = doneCount === STEPS.length;

  // --- Form kredensial ---------------------------------------------------
  // Client ID: publik-safe (muncul di URL OAuth), disimpan sebagai audit-hint.
  // Client Secret: TIDAK PERNAH disimpan — hanya divalidasi lalu disediakan
  // tombol Salin untuk ditempel ke Backend. State di-clear setelah salin.
  const [clientId, setClientId] = useState<string>("");
  const [savedClientId, setSavedClientId] = useState<string>("");
  const [clientIdError, setClientIdError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string>("");
  const [secretError, setSecretError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    const v = loadClientId();
    setClientId(v);
    setSavedClientId(v);
  }, []);

  const clientIdDirty = clientId.trim() !== savedClientId;

  const handleSaveClientId = () => {
    const parsed = clientIdSchema.safeParse(clientId);
    if (!parsed.success) {
      setClientIdError(parsed.error.issues[0]?.message ?? "Format tidak valid");
      return;
    }
    setClientIdError(null);
    saveClientId(parsed.data);
    setClientId(parsed.data);
    setSavedClientId(parsed.data);
    toast.success("Client ID tersimpan di perangkat ini");
  };

  const handleClearClientId = () => {
    saveClientId("");
    setClientId("");
    setSavedClientId("");
    setClientIdError(null);
    toast.success("Client ID dihapus");
  };

  const handleCopySecret = async () => {
    const parsed = clientSecretSchema.safeParse(clientSecret);
    if (!parsed.success) {
      setSecretError(parsed.error.issues[0]?.message ?? "Format tidak valid");
      return;
    }
    setSecretError(null);
    try {
      await navigator.clipboard.writeText(parsed.data);
      toast.success("Client Secret disalin — tempel ke Backend sekarang");
      // Bersihkan agar tidak menetap di DOM/memory setelah dipakai.
      setClientSecret("");
      setShowSecret(false);
    } catch {
      toast.error("Gagal menyalin — salin manual lalu bersihkan field");
    }
  };

  const handleClearSecret = () => {
    setClientSecret("");
    setSecretError(null);
    setShowSecret(false);
  };

  const copy = async (value: string, label: string) => {
    if (!value) {
      toast.error(`${label} belum tersedia`);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} disalin`);
    } catch {
      toast.error("Gagal menyalin — salin manual");
    }
  };

  if (adminLoading) {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl bg-background px-4 pt-10 text-sm text-muted-foreground">
        Memeriksa akses admin…
      </main>
    );
  }
  if (!isAdmin) {
    return (
      <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-8">
        <SettingsHeader title="OAuth Google (BYOK)" subtitle="Panduan admin" />
        <Card className="mx-4 mt-2 border-destructive/40">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" />
            <div>
              Halaman ini khusus admin. Minta admin membuka pengaturan ini di perangkat mereka.
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-8">
      <SettingsHeader
        title="OAuth Google (BYOK)"
        subtitle="Ganti kredensial bawaan agar layar consent tampil sebagai MCM Storage"
      />
      <div className="space-y-4 px-4 pt-2">
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-4 text-xs leading-snug text-muted-foreground">
            Kredensial (Client ID & Secret) tidak disimpan di aplikasi ini. Setelah dibuat di
            Google Cloud Console, tempel ke <b>Backend → Users → Auth Settings → Google</b>.
            Broker OAuth Lovable Cloud akan otomatis memakai kredensial baru untuk semua
            sesi sign-in berikutnya — layar consent langsung menampilkan nama & logo
            aplikasi Anda tanpa merek pihak ketiga.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Progres</CardTitle>
            <CardDescription className="text-xs">
              {doneCount}/{STEPS.length} langkah selesai.
              {complete ? " Siap uji." : " Ceklis tersimpan di perangkat ini."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {STEPS.map((s, i) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border/50 p-2 hover:bg-muted/50"
              >
                <Checkbox
                  checked={checks[s.id]}
                  onCheckedChange={() => toggle(s.id)}
                  aria-label={s.label}
                  className="mt-0.5"
                />
                <span className="flex-1 text-sm leading-snug">
                  <span className="mr-1 text-muted-foreground">{i + 1}.</span>
                  {s.label}
                </span>
                {checks[s.id] && <Check className="mt-0.5 h-4 w-4 text-emerald-500" />}
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Nilai untuk Google Cloud Console</CardTitle>
            <CardDescription className="text-xs">
              Salin nilai berikut satu per satu ke halaman OAuth di Google Cloud Console.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ListBlock
              label="Authorized redirect URIs"
              values={redirectUris}
              onCopyAll={() => copy(redirectUris.join("\n"), "Redirect URIs")}
              onCopyItem={(v) => copy(v, "Redirect URI")}
              primaryIndex={callbackUrl ? 0 : -1}
              emptyText="Belum tersedia — pastikan Backend aktif"
            />
            <ListBlock
              label="Authorized JavaScript origins"
              values={jsOrigins}
              onCopyAll={() => copy(jsOrigins.join("\n"), "JavaScript origins")}
              onCopyItem={(v) => copy(v, "Origin")}
            />
            <ListBlock
              label="Authorized domains (OAuth consent screen)"
              values={authorizedDomains}
              onCopyAll={() => copy(authorizedDomains.join("\n"), "Authorized domains")}
              onCopyItem={(v) => copy(v, "Domain")}
            />
            <ListBlock
              label="Scope non-sensitive"
              values={scopes}
              onCopyAll={() => copy(scopes.join("\n"), "Scope")}
              onCopyItem={(v) => copy(v, "Scope")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Kredensial Google OAuth</CardTitle>
            <CardDescription className="text-xs leading-snug">
              Validasi Client ID & Secret sebelum ditempel ke Backend. <b>Client Secret
              tidak disimpan</b> di aplikasi — hanya divalidasi lalu tersedia tombol Salin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Client ID */}
            <div className="space-y-1.5">
              <Label htmlFor="google-client-id" className="text-sm">
                Client ID
                {savedClientId && (
                  <Badge variant="outline" className="ml-2 text-[11px]">
                    tersimpan
                  </Badge>
                )}
              </Label>
              <Input
                id="google-client-id"
                autoComplete="off"
                spellCheck={false}
                placeholder="1234567890-abc123def.apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  if (clientIdError) setClientIdError(null);
                }}
                aria-invalid={clientIdError ? true : undefined}
                aria-describedby={clientIdError ? "google-client-id-error" : undefined}
                className={clientIdError ? "border-destructive" : ""}
              />
              {clientIdError ? (
                <p
                  id="google-client-id-error"
                  className="text-xs leading-snug text-destructive"
                >
                  {clientIdError}
                </p>
              ) : (
                <p className="text-xs leading-snug text-muted-foreground">
                  Aman disimpan di perangkat — nilai ini publik pada request OAuth.
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveClientId}
                  disabled={!clientIdDirty || clientId.trim().length === 0}
                  className="gap-1.5"
                >
                  <Save className="h-3.5 w-3.5" />
                  Simpan
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => copy(clientId.trim(), "Client ID")}
                  disabled={!clientId.trim()}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Salin
                </Button>
                {savedClientId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={handleClearClientId}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Hapus
                  </Button>
                )}
              </div>
            </div>

            {/* Client Secret */}
            <div className="space-y-1.5 border-t border-border/50 pt-4">
              <Label htmlFor="google-client-secret" className="text-sm">
                Client Secret
                <Badge variant="outline" className="ml-2 text-[11px]">
                  tidak disimpan
                </Badge>
              </Label>
              <div className="relative">
                <Input
                  id="google-client-secret"
                  type={showSecret ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="GOCSPX-••••••••••••••••••••••••"
                  value={clientSecret}
                  onChange={(e) => {
                    setClientSecret(e.target.value);
                    if (secretError) setSecretError(null);
                  }}
                  aria-invalid={secretError ? true : undefined}
                  aria-describedby={secretError ? "google-client-secret-error" : undefined}
                  className={`pr-10 font-mono ${secretError ? "border-destructive" : ""}`}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label={showSecret ? "Sembunyikan" : "Tampilkan"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {secretError ? (
                <p
                  id="google-client-secret-error"
                  className="text-xs leading-snug text-destructive"
                >
                  {secretError}
                </p>
              ) : (
                <p className="text-xs leading-snug text-muted-foreground">
                  Nilai dibersihkan setelah disalin. Tempel langsung ke Backend → Auth
                  Settings → Google.
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCopySecret}
                  disabled={clientSecret.trim().length === 0}
                  className="gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Validasi &amp; salin
                </Button>
                {clientSecret && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={handleClearSecret}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Bersihkan
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Selanjutnya</CardTitle>
            <CardDescription className="text-xs">
              Setelah Client ID & Secret dibuat, tempel di Backend. Aplikasi tidak perlu
              di-deploy ulang.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Cloud Console
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <a
                href="https://console.cloud.google.com/apis/credentials/consent"
                target="_blank"
                rel="noopener noreferrer"
              >
                OAuth consent screen
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function FieldBlock({
  label,
  value,
  placeholder,
  onCopy,
}: {
  label: string;
  value: string;
  placeholder: string;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2"
          onClick={onCopy}
          disabled={!value}
        >
          <Copy className="h-3.5 w-3.5" />
          Salin
        </Button>
      </div>
      <code className="block break-all rounded-md border border-border/50 bg-muted/50 px-2 py-1.5 text-xs">
        {value || <span className="text-muted-foreground">{placeholder}</span>}
      </code>
    </div>
  );
}

function ListBlock({
  label,
  values,
  onCopyAll,
  onCopyItem,
  primaryIndex = -1,
  emptyText,
}: {
  label: string;
  values: string[];
  onCopyAll: () => void;
  onCopyItem?: (value: string) => void;
  primaryIndex?: number;
  emptyText?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2"
          onClick={onCopyAll}
          disabled={values.length === 0}
        >
          <Copy className="h-3.5 w-3.5" />
          Salin semua
        </Button>
      </div>
      <div className="space-y-1">
        {values.length === 0 && emptyText && (
          <div className="rounded-md border border-border/50 bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
            {emptyText}
          </div>
        )}
        {values.map((v, i) => (
          <div
            key={v}
            className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/50 px-2 py-1.5"
          >
            <code className="break-all text-xs">{v}</code>
            <div className="flex shrink-0 items-center gap-1.5">
              {i === primaryIndex && (
                <Badge className="text-[11px]">wajib</Badge>
              )}
              {onCopyItem ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-1.5"
                  onClick={() => onCopyItem(v)}
                  aria-label={`Salin ${v}`}
                >
                  <Copy className="h-3 w-3" />
                  <span className="text-[11px]">Salin</span>
                </Button>
              ) : (
                <Badge variant="outline" className="text-[11px]">
                  siap
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
