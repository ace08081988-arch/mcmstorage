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
import {
  Copy,
  ExternalLink,
  ShieldAlert,
  Check,
  Eye,
  EyeOff,
  Save,
  Trash2,
  PlayCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { useAdminStatus } from "@/hooks/use-is-admin";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";

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

// Deep-link ke halaman Google Cloud Console yang relevan untuk tiap langkah.
// "paste" & "test" tidak dibuka di Cloud Console (paste di Backend, test lokal).
const STEP_CONSOLE_URL: Partial<Record<StepId, string>> = {
  consent: "https://console.cloud.google.com/apis/credentials/consent",
  scopes: "https://console.cloud.google.com/apis/credentials/consent/edit",
  domains: "https://console.cloud.google.com/apis/credentials/consent/edit",
  origins: "https://console.cloud.google.com/apis/credentials",
  redirect: "https://console.cloud.google.com/apis/credentials",
  credentials: "https://console.cloud.google.com/apis/credentials",
};

type StepId = (typeof STEPS)[number]["id"];

// Kategori "block" yang bisa disorot pada bagian "Nilai untuk Google Cloud Console".
type BlockId = "redirect" | "origins" | "domains" | "scopes" | "credentials";

/**
 * Diagnosa pesan error dari flow OAuth Google → item checklist & block mana
 * yang paling mungkin bermasalah. Kata kunci diambil dari pesan resmi Google
 * (redirect_uri_mismatch, invalid_client, dst.) sehingga cocok baik untuk
 * error dari popup web_message maupun error dari halaman consent.
 */
function diagnoseError(raw: string): {
  steps: StepId[];
  blocks: BlockId[];
  hint: string;
} {
  const m = raw.toLowerCase();
  // urutan penting: cek yang paling spesifik dulu.
  if (m.includes("redirect_uri_mismatch") || m.includes("redirect uri") || m.includes("redirect_uri")) {
    return {
      steps: ["redirect"],
      blocks: ["redirect"],
      hint: "Google menolak redirect_uri. Pastikan Callback URL Backend tercatat persis (termasuk skema https & tanpa trailing slash tambahan) di daftar Authorized redirect URIs.",
    };
  }
  if (m.includes("origin_mismatch") || m.includes("not a valid origin") || m.includes("origin is not allowed")) {
    return {
      steps: ["origins"],
      blocks: ["origins"],
      hint: "Origin request tidak ada di Authorized JavaScript origins. Tambahkan origin persis (termasuk subdomain preview).",
    };
  }
  if (m.includes("invalid_scope") || m.includes("scope")) {
    return {
      steps: ["scopes"],
      blocks: ["scopes"],
      hint: "Salah satu scope tidak dikenali/disetujui. Pakai persis openid + userinfo.email + userinfo.profile pada OAuth consent screen.",
    };
  }
  if (m.includes("disallowed_useragent") || m.includes("webview")) {
    return {
      steps: ["redirect"],
      blocks: ["redirect"],
      hint: "Google memblokir WebView embedded. Uji di browser sistem atau APK Custom Tabs, bukan iframe editor.",
    };
  }
  if (m.includes("invalid_client") || m.includes("unauthorized_client") || m.includes("client id") || m.includes("client secret")) {
    return {
      steps: ["credentials", "paste"],
      blocks: ["credentials"],
      hint: "Client ID/Secret ditolak. Cek nilai yang ditempel di Backend → Auth Settings → Google persis sama dengan yang di Google Cloud Console (tanpa spasi).",
    };
  }
  if (m.includes("unsupported provider") || m.includes("provider is not enabled") || m.includes("provider not enabled")) {
    return {
      steps: ["paste"],
      blocks: ["credentials"],
      hint: "Provider Google belum aktif di Backend. Tempel Client ID & Secret di Auth Settings → Google lalu aktifkan.",
    };
  }
  if (m.includes("access_denied") || m.includes("consent") || m.includes("verification")) {
    return {
      steps: ["consent", "scopes"],
      blocks: ["domains", "scopes"],
      hint: "Consent ditolak / app belum terverifikasi. Lengkapi OAuth consent screen (nama, logo, domain) dan pastikan scope hanya non-sensitive.",
    };
  }
  if (m.includes("domain") || m.includes("authorized domain")) {
    return {
      steps: ["domains"],
      blocks: ["domains"],
      hint: "Domain tidak terdaftar. Tambahkan di Authorized domains pada OAuth consent screen.",
    };
  }
  return {
    steps: [],
    blocks: [],
    hint: "Pesan tidak dikenali. Cek: (1) Client ID/Secret sudah ditempel di Backend, (2) Callback URL persis sama, (3) domain ada di Authorized domains.",
  };
}

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

  // --- Uji Login Google --------------------------------------------------
  type TestState =
    | { status: "idle" }
    | { status: "running" }
    | { status: "success"; email: string | null; issuer: string | null; at: string }
    | { status: "redirected" }
    | { status: "error"; message: string };
  const [testState, setTestState] = useState<TestState>({ status: "idle" });

  // Item yang di-highlight otomatis berdasarkan pesan error hasil Uji.
  const diagnosis = useMemo(
    () =>
      testState.status === "error"
        ? diagnoseError(testState.message)
        : { steps: [] as StepId[], blocks: [] as BlockId[], hint: "" },
    [testState],
  );
  const flaggedSteps = new Set<StepId>(diagnosis.steps);
  const flaggedBlocks = new Set<BlockId>(diagnosis.blocks);

  const runGoogleTest = async () => {
    setTestState({ status: "running" });
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: { prompt: "select_account" },
      });
      if (result.error) {
        const msg =
          result.error instanceof Error
            ? result.error.message
            : String(result.error);
        setTestState({ status: "error", message: msg });
        toast.error("Uji gagal — cek pesan di kartu Uji");
        return;
      }
      if (result.redirected) {
        // Browser sedang berpindah ke Google. Ini normal di mode full-page.
        setTestState({ status: "redirected" });
        return;
      }
      // Popup flow (iframe/preview): sesi sudah di-set oleh helper.
      const { data } = await supabase.auth.getUser();
      const identity = data.user?.identities?.find((i) => i.provider === "google");
      setTestState({
        status: "success",
        email: data.user?.email ?? null,
        issuer: (identity?.identity_data?.iss as string | undefined) ?? null,
        at: new Date().toISOString(),
      });
      toast.success("Login Google berhasil");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestState({ status: "error", message: msg });
      toast.error("Uji gagal — cek pesan di kartu Uji");
    }
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
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-2 hover:bg-muted/50 ${
                  flaggedSteps.has(s.id)
                    ? "border-amber-500/60 bg-amber-500/10"
                    : "border-border/50"
                }`}
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
                  {flaggedSteps.has(s.id) && STEP_CONSOLE_URL[s.id] && (
                    <a
                      href={STEP_CONSOLE_URL[s.id]}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="ml-2 inline-flex items-center gap-1 rounded border border-amber-500/60 bg-background px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Buka Cloud Console
                    </a>
                  )}
                </span>
                {flaggedSteps.has(s.id) && (
                  <Badge
                    variant="outline"
                    className="mt-0.5 gap-1 border-amber-500/60 text-[11px] text-amber-600"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    cek ini
                  </Badge>
                )}
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
              flagged={flaggedBlocks.has("redirect")}
            />
            <ListBlock
              label="Authorized JavaScript origins"
              values={jsOrigins}
              onCopyAll={() => copy(jsOrigins.join("\n"), "JavaScript origins")}
              onCopyItem={(v) => copy(v, "Origin")}
              flagged={flaggedBlocks.has("origins")}
            />
            <ListBlock
              label="Authorized domains (OAuth consent screen)"
              values={authorizedDomains}
              onCopyAll={() => copy(authorizedDomains.join("\n"), "Authorized domains")}
              onCopyItem={(v) => copy(v, "Domain")}
              flagged={flaggedBlocks.has("domains")}
            />
            <ListBlock
              label="Scope non-sensitive"
              values={scopes}
              onCopyAll={() => copy(scopes.join("\n"), "Scope")}
              onCopyItem={(v) => copy(v, "Scope")}
              flagged={flaggedBlocks.has("scopes")}
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
            <CardTitle className="text-base">Uji Login Google</CardTitle>
            <CardDescription className="text-xs leading-snug">
              Jalankan flow consent nyata untuk memverifikasi Client ID & Secret sudah
              aktif di Backend. Layar consent seharusnya bermerek <b>MCM Storage</b>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={runGoogleTest}
                disabled={testState.status === "running"}
                className="gap-1.5"
              >
                {testState.status === "running" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PlayCircle className="h-3.5 w-3.5" />
                )}
                {testState.status === "running" ? "Membuka Google…" : "Uji Login Google"}
              </Button>
              {testState.status !== "idle" && testState.status !== "running" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setTestState({ status: "idle" })}
                >
                  Reset hasil
                </Button>
              )}
            </div>

            {testState.status === "idle" && (
              <p className="text-xs leading-snug text-muted-foreground">
                Tombol ini membuka popup consent Google. Jika berjalan di WebView APK,
                flow akan berpindah halaman lalu kembali otomatis.
              </p>
            )}

            {testState.status === "success" && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <div className="min-w-0 space-y-0.5 text-xs leading-snug">
                  <div className="font-medium text-foreground">Login Google berhasil</div>
                  {testState.email && (
                    <div className="text-muted-foreground">
                      Akun: <code className="text-foreground">{testState.email}</code>
                    </div>
                  )}
                  {testState.issuer && (
                    <div className="text-muted-foreground">
                      Issuer: <code className="text-foreground">{testState.issuer}</code>
                    </div>
                  )}
                  <div className="text-muted-foreground">
                    Selesai {new Date(testState.at).toLocaleTimeString("id-ID")}
                  </div>
                </div>
              </div>
            )}

            {testState.status === "redirected" && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-500" />
                <div className="text-xs leading-snug text-muted-foreground">
                  Browser sedang berpindah ke Google. Setelah kembali ke halaman ini,
                  buka ulang menu <b>OAuth Google</b> untuk melihat hasil.
                </div>
              </div>
            )}

            {testState.status === "error" && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0 space-y-1 text-xs leading-snug">
                  <div className="font-medium text-destructive">Uji gagal</div>
                  <code className="block break-all rounded bg-background/60 px-1.5 py-1 text-foreground">
                    {testState.message}
                  </code>
                  <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <div>
                      <div className="font-medium">Kemungkinan penyebab</div>
                      <div className="text-muted-foreground">{diagnosis.hint}</div>
                      {flaggedSteps.size > 0 && (
                        <div className="mt-1 text-muted-foreground">
                          Item checklist & daftar di atas yang perlu diperiksa sudah
                          disorot kuning otomatis.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
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
  flagged = false,
}: {
  label: string;
  values: string[];
  onCopyAll: () => void;
  onCopyItem?: (value: string) => void;
  primaryIndex?: number;
  emptyText?: string;
  flagged?: boolean;
}) {
  return (
    <div
      className={
        flagged
          ? "-mx-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-2"
          : undefined
      }
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {label}
          {flagged && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/60 text-[11px] text-amber-600"
            >
              <AlertTriangle className="h-3 w-3" />
              cek ini
            </Badge>
          )}
        </span>
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
