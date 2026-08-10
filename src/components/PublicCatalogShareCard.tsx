/**
 * Kartu pengaturan Katalog Publik: pemilik toko mengaktifkan katalog,
 * mengatur alamat tautan (slug), nama toko, nomor WA, lalu membagikan
 * tautan yang bisa dibuka pelanggan tanpa login.
 */
import { useEffect, useState } from "react";
import { Copy, Globe, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  slug: string;
  enabled: boolean;
  shop_name: string;
  wa_number: string;
  tagline: string;
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function PublicCatalogShareCard() {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from("public_catalog_settings")
        .select("slug, enabled, shop_name, wa_number, tagline")
        .eq("user_id", uid)
        .maybeSingle();
      if (!alive) return;
      setRow(
        data ?? {
          slug: slugify(auth.user?.email?.split("@")[0] ?? "toko") || "toko",
          enabled: false,
          shop_name: "Toko saya",
          wa_number: "",
          tagline: "",
        },
      );
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save(next: Row) {
    const slug = slugify(next.slug);
    if (slug.length < 2) {
      toast.error("Alamat tautan minimal 2 karakter (huruf/angka).");
      return;
    }
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) {
      setSaving(false);
      return;
    }
    const { error } = await supabase
      .from("public_catalog_settings")
      .upsert({ ...next, slug, user_id: uid, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      toast.error(
        /unique|duplicate/i.test(error.message)
          ? "Alamat tautan sudah dipakai toko lain."
          : error.message,
      );
      return;
    }
    setRow({ ...next, slug });
    toast.success("Pengaturan katalog publik tersimpan.");
  }

  if (loading || !row) return null;

  const url =
    typeof window !== "undefined" ? `${window.location.origin}/katalog/${slugify(row.slug)}` : "";

  return (
    <section className="lux-card space-y-3 p-ms-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-ms-sm font-semibold">
            <Globe className="h-4 w-4 text-primary" aria-hidden /> Katalog publik
          </p>
          <p className="text-ms-2xs text-muted-foreground">
            Pelanggan bisa membuka katalog ini tanpa login dan pesan lewat WA.
          </p>
        </div>
        <Switch
          checked={row.enabled}
          disabled={saving}
          aria-label="Aktifkan katalog publik"
          onCheckedChange={(v) => save({ ...row, enabled: v })}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-ms-2xs text-muted-foreground">Nama toko</span>
          <input
            value={row.shop_name}
            onChange={(e) => setRow({ ...row, shop_name: e.target.value })}
            className="h-9 w-full rounded-md border bg-background px-ms-3 text-ms-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-ms-2xs text-muted-foreground">Nomor WA (mis. 0812…)</span>
          <input
            value={row.wa_number}
            inputMode="tel"
            onChange={(e) => setRow({ ...row, wa_number: e.target.value })}
            className="h-9 w-full rounded-md border bg-background px-ms-3 text-ms-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-ms-2xs text-muted-foreground">Alamat tautan</span>
          <input
            value={row.slug}
            onChange={(e) => setRow({ ...row, slug: e.target.value })}
            className="h-9 w-full rounded-md border bg-background px-ms-3 text-ms-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-ms-2xs text-muted-foreground">Tagline (opsional)</span>
          <input
            value={row.tagline}
            onChange={(e) => setRow({ ...row, tagline: e.target.value })}
            className="h-9 w-full rounded-md border bg-background px-ms-3 text-ms-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" className="rounded-full" disabled={saving} onClick={() => save(row)}>
          Simpan
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={async () => {
            await navigator.clipboard?.writeText(url);
            toast.success("Tautan katalog disalin.");
          }}
        >
          <Copy className="mr-1.5 h-4 w-4" aria-hidden /> Salin tautan
        </Button>
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden /> Buka
          </a>
        </Button>
        <span className="truncate text-ms-2xs text-muted-foreground">{url}</span>
      </div>
      {!row.enabled && (
        <p className="text-ms-2xs text-muted-foreground">
          Katalog masih nonaktif — pengunjung akan melihat halaman "Katalog tidak tersedia".
        </p>
      )}
    </section>
  );
}