import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, MessageSquare, Save } from "lucide-react";
import { toast } from "sonner";
import { SettingsHeader } from "@/components/settings/SettingsHeader";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/pengaturan-notifikasi-wa")({
  head: () => ({
    meta: [
      { title: "Notifikasi WA Penyiapan · MCM Storage" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NotifikasiWaPage,
});

function NotifikasiWaPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [forwardUrl, setForwardUrl] = useState("");
  const [waTarget, setWaTarget] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("prep_submit_wa_hook")
        .select("forward_url, wa_target, enabled")
        .eq("id", true)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        toast.error("Gagal muat pengaturan: " + error.message);
      } else if (data) {
        setForwardUrl(data.forward_url ?? "");
        setWaTarget(data.wa_target ?? "");
        setEnabled(!!data.enabled);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    const trimmedUrl = forwardUrl.trim();
    const trimmedWa = waTarget.trim();
    if (enabled) {
      if (!trimmedUrl) {
        toast.error("URL webhook wajib diisi jika notifikasi diaktifkan");
        return;
      }
      if (!/^https:\/\//i.test(trimmedUrl)) {
        toast.error("URL webhook harus diawali https://");
        return;
      }
      if (!trimmedWa) {
        toast.error("Nomor WA tujuan wajib diisi jika notifikasi diaktifkan");
        return;
      }
    }
    setSaving(true);
    const { error } = await supabase
      .from("prep_submit_wa_hook")
      .update({
        forward_url: trimmedUrl || null,
        wa_target: trimmedWa || null,
        enabled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);
    setSaving(false);
    if (error) {
      toast.error("Gagal simpan: " + error.message);
      return;
    }
    toast.success("Pengaturan notifikasi WA tersimpan");
  }

  async function handleTest() {
    if (!forwardUrl.trim()) {
      toast.error("Isi URL webhook dulu, lalu Simpan sebelum uji");
      return;
    }
    toast.loading("Mengirim payload uji…", { id: "wa-test" });
    try {
      const res = await fetch(forwardUrl.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "prep_submit_test",
          wa_target: waTarget.trim() || null,
          title: "Uji notifikasi",
          item_name: null,
          photo_count: 0,
          submitted_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        toast.error(`Webhook menolak (HTTP ${res.status})`, { id: "wa-test" });
      } else {
        toast.success("Payload terkirim ke webhook", { id: "wa-test" });
      }
    } catch (e) {
      toast.error("Gagal kirim: " + ((e as Error).message || "unknown"), { id: "wa-test" });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <SettingsHeader
        icon={MessageSquare}
        title="Notifikasi WA Penyiapan"
        subtitle="Terima pesan WhatsApp otomatis saat pegawai submit penyiapan (berhasil/gagal)."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alur</CardTitle>
          <CardDescription>
            Server MCM meng-POST detail submit ke URL webhook Anda (mis. n8n / Make / Zapier). Workflow di sana
            meneruskan pesan ke nomor WA tujuan lewat WhatsApp Business Anda.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Aktifkan Notifikasi</CardTitle>
              <CardDescription>
                Saat aktif, setiap submit sukses dari halaman pegawai dan setiap laporan gagal dikirim ke webhook.
              </CardDescription>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="forward-url">URL Webhook (n8n / Make)</Label>
            <Input
              id="forward-url"
              type="url"
              placeholder="https://n8n.contoh.com/webhook/mcm-submit"
              value={forwardUrl}
              onChange={(e) => setForwardUrl(e.target.value)}
              autoComplete="off"
              inputMode="url"
            />
            <p className="text-ms-2xs text-muted-foreground">
              Harus HTTPS. Body payload berisi <code>kind</code>, <code>wa_target</code>, <code>title</code>,{" "}
              <code>item_name</code>, <code>photo_count</code>, <code>error</code> (khusus gagal),{" "}
              <code>submission_id</code>, <code>submitted_at</code>.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wa-target">Nomor WA Tujuan</Label>
            <Input
              id="wa-target"
              type="tel"
              placeholder="628123456789"
              value={waTarget}
              onChange={(e) => setWaTarget(e.target.value)}
              autoComplete="off"
              inputMode="numeric"
            />
            <p className="text-ms-2xs text-muted-foreground">
              Format internasional tanpa tanda + (contoh: 628123456789). Nomor ini diteruskan sebagai{" "}
              <code>wa_target</code> ke webhook.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Simpan
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={saving}>
              Uji Kirim Payload
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contoh Payload Sukses (Ecer)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-ms-2xs">{`{
  "kind": "prep_submit_success_ecer",
  "wa_target": "628123456789",
  "title": "Nama tugas",
  "item_name": "PSR 3 gr",
  "photo_count": 2,
  "submission_id": "…",
  "submitted_at": "2026-07-17T10:00:00Z"
}`}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contoh Payload Gagal</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-ms-2xs">{`{
  "kind": "prep_submit_fail_ecer",
  "wa_target": "628123456789",
  "title": "Nama tugas",
  "item_name": null,
  "error": "Stok gudang tidak cukup (tersedia 3, diminta 5)",
  "task_id": "…",
  "submitted_at": "2026-07-17T10:00:00Z"
}`}</pre>
        </CardContent>
      </Card>
    </div>
  );
}