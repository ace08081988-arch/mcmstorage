import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Globe, Users, Loader2, ShieldCheck, Check, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import {
  getDefaultStatusVisibility,
  setDefaultStatusVisibility,
  type StatusVisibility,
} from "@/lib/status";

export const Route = createFileRoute("/_authenticated/pengaturan-privasi")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Privasi · Ace Storage" },
      {
        name: "description",
        content: "Atur siapa yang dapat melihat status Anda secara default.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PrivasiPage,
});

function PrivasiPage() {
  const [visibility, setVisibility] = useState<StatusVisibility | null>(null);
  const [saving, setSaving] = useState<StatusVisibility | null>(null);

  useEffect(() => {
    let alive = true;
    getDefaultStatusVisibility().then((v) => {
      if (alive) setVisibility(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const choose = async (v: StatusVisibility) => {
    if (v === visibility) return;
    setSaving(v);
    const prev = visibility;
    setVisibility(v);
    const ok = await setDefaultStatusVisibility(v);
    setSaving(null);
    if (!ok) {
      setVisibility(prev);
      toast.error("Gagal menyimpan preferensi");
      return;
    }
    toast.success(
      v === "public"
        ? "Status baru terlihat oleh semua orang"
        : "Status baru hanya untuk teman",
    );
  };

  const opt = (
    v: StatusVisibility,
    Icon: typeof Globe,
    title: string,
    desc: string,
  ) => {
    const active = visibility === v;
    return (
      <button
        type="button"
        onClick={() => choose(v)}
        aria-pressed={active}
        disabled={saving !== null}
        className={cn(
          "group flex w-full items-start gap-ms-3 rounded-2xl border p-ms-3.5 text-left transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:opacity-70",
          active
            ? "border-primary bg-primary/8 shadow-sm"
            : "border-border/70 hover:border-primary/40 hover:bg-accent/40",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 transition-colors",
            active
              ? "bg-primary/15 text-primary ring-primary/25"
              : "bg-muted text-muted-foreground ring-border/70 group-hover:text-foreground",
          )}
        >
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-ms-2">
            <span className="text-ms-sm font-semibold tracking-tight">{title}</span>
            {saving === v ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : null}
          </div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            {desc}
          </p>
        </div>
        <span
          aria-hidden
          className={cn(
            "mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
            active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30",
          )}
        >
          {active ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
        </span>
      </button>
    );
  };

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-10">
      <SettingsHeader
        title="Privasi"
        subtitle="Atur siapa yang dapat melihat status Anda"
        icon={ShieldCheck}
      />
      <div className="space-ms-4 px-ms-4 pt-4 sm:pt-5">
        <Card className="overflow-hidden border-border/70 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-ms-sm font-semibold tracking-tight sm:text-ms-base">
              Default status
            </CardTitle>
            <CardDescription className="mt-1 text-ms-xs leading-relaxed">
              Pilihan ini dipakai untuk status baru. Anda tetap bisa mengubahnya
              per status saat mengunggah.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-ms-2 pt-0">
            {visibility === null ? (
              <div className="space-ms-2 py-1" aria-busy>
                {[0, 1].map((k) => (
                  <div
                    key={k}
                    className="flex items-center gap-ms-3 rounded-2xl border border-border/70 p-ms-3.5"
                  >
                    <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-muted" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                      <div className="h-2.5 w-48 animate-pulse rounded bg-muted/60" />
                    </div>
                    <div className="h-5 w-5 shrink-0 animate-pulse rounded-full bg-muted" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {opt(
                  "public",
                  Globe,
                  "Semua orang",
                  "Semua pengguna aplikasi bisa melihat status Anda.",
                )}
                {opt(
                  "friends",
                  Users,
                  "Teman saja",
                  "Hanya kontak dengan permintaan pertemanan yang diterima.",
                )}
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex items-start gap-ms-2.5 rounded-xl border border-border/70 bg-muted/30 p-ms-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            Status yang sudah terlanjur diunggah tetap memakai pengaturan saat
            diunggah. Ubah masing-masing status untuk mengganti visibilitasnya.
          </p>
        </div>
      </div>
    </main>
  );
}