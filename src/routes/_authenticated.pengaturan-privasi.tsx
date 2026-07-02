import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Globe, Users, Loader2 } from "lucide-react";
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
      { title: "Privasi · MCM Storage" },
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
        className="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition aria-[pressed=true]:border-primary aria-[pressed=true]:bg-primary/10 disabled:opacity-70"
      >
        <Icon className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{title}</span>
            {saving === v ? <Loader2 className="size-3.5 animate-spin" /> : null}
          </div>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
        <span
          aria-hidden
          className="mt-1 size-4 shrink-0 rounded-full border-2 aria-[checked=true]:border-primary aria-[checked=true]:bg-primary"
          data-state={active ? "on" : "off"}
          {...{ "aria-checked": active }}
        />
      </button>
    );
  };

  return (
    <main className="mx-auto min-h-dvh max-w-2xl bg-background pb-8">
      <SettingsHeader
        title="Privasi"
        subtitle="Atur siapa yang dapat melihat status Anda"
      />
      <div className="space-y-4 px-4 pt-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Default status</CardTitle>
            <CardDescription className="text-xs">
              Pilihan ini dipakai untuk status baru. Anda tetap bisa mengubahnya
              per status saat mengunggah.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {visibility === null ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Memuat…
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

        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          Status yang sudah terlanjur diunggah tetap memakai pengaturan saat
          diunggah. Ubah masing-masing status untuk mengganti visibilitasnya.
        </p>
      </div>
    </main>
  );
}