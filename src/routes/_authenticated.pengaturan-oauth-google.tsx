import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { Copy, ExternalLink, ShieldAlert, Check } from "lucide-react";
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

function OAuthGooglePage() {
  const { isAdmin, isLoading: adminLoading } = useAdminStatus();

  const [origin, setOrigin] = useState<string>("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const supabaseUrl =
    (typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL) ||
    "";
  const callbackUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, "")}/auth/v1/callback` : "";

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
            <FieldBlock
              label="Authorized redirect URI (Callback URL)"
              value={callbackUrl}
              placeholder="URL callback belum tersedia — pastikan Backend aktif"
              onCopy={() => copy(callbackUrl, "Callback URL")}
            />
            <ListBlock
              label="Authorized JavaScript origins"
              values={jsOrigins}
              onCopyAll={() => copy(jsOrigins.join("\n"), "JavaScript origins")}
            />
            <ListBlock
              label="Authorized domains (OAuth consent screen)"
              values={authorizedDomains}
              onCopyAll={() => copy(authorizedDomains.join("\n"), "Authorized domains")}
            />
            <ListBlock
              label="Scope non-sensitive"
              values={scopes}
              onCopyAll={() => copy(scopes.join("\n"), "Scope")}
            />
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
}: {
  label: string;
  values: string[];
  onCopyAll: () => void;
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
        >
          <Copy className="h-3.5 w-3.5" />
          Salin semua
        </Button>
      </div>
      <div className="space-y-1">
        {values.map((v) => (
          <div
            key={v}
            className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/50 px-2 py-1.5"
          >
            <code className="break-all text-xs">{v}</code>
            <Badge variant="outline" className="shrink-0 text-[11px]">
              siap
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
