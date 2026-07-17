import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CheckCircle2, Loader2, MessageSquare, RefreshCw, RotateCw, Save, XCircle } from "lucide-react";
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
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<Record<string, { ok: boolean; msg: string; at: number }>>({});

  async function loadHistory() {
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from("prep_task_wa_hook_log")
      .select("id, task_id, title, prev_status, new_status, kind, wa_target, send_status, error, payload, created_at, retry_count, last_retry_at")
      .order("created_at", { ascending: false })
      .limit(50);
    setHistoryLoading(false);
    if (error) {
      toast.error("Gagal muat riwayat: " + error.message);
      return;
    }
    setHistory((data ?? []) as HistoryRow[]);
  }

  async function retryRow(row: HistoryRow) {
    const url = forwardUrl.trim();
    if (!url) {
      toast.error("Isi URL webhook dulu, lalu Simpan sebelum coba ulang");
      return;
    }
    if (!row.payload) {
      toast.error("Payload lama tidak tersedia, tidak bisa dikirim ulang");
      return;
    }
    setRetryingId(row.id);
    setRetryResult((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    const nextRetry = (row.retry_count ?? 0) + 1;
    let ok = false;
    let errMsg: string | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...row.payload, retry: true, retry_count: nextRetry }),
      });
      if (!res.ok) {
        errMsg = `HTTP ${res.status}`;
      } else {
        ok = true;
      }
    } catch (e) {
      errMsg = (e as Error).message || "network error";
    }
    const { error: updErr } = await (supabase.from as any)("prep_task_wa_hook_log")
      .update({
        send_status: ok ? "sent" : "failed",
        error: ok ? null : errMsg,
        retry_count: nextRetry,
        last_retry_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    setRetryingId(null);
    if (updErr) {
      setRetryResult((prev) => ({
        ...prev,
        [row.id]: { ok: false, msg: "Gagal simpan: " + updErr.message, at: Date.now() },
      }));
      toast.error("Gagal simpan hasil retry: " + updErr.message);
      return;
    }
    setHistory((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              send_status: ok ? "sent" : "failed",
              error: ok ? null : errMsg,
              retry_count: nextRetry,
              last_retry_at: new Date().toISOString(),
            }
          : r,
      ),
    );
    setRetryResult((prev) => ({
      ...prev,
      [row.id]: {
        ok,
        msg: ok ? "Berhasil terkirim ulang" : "Gagal: " + (errMsg ?? "unknown"),
        at: Date.now(),
      },
    }));
    // auto-hide inline badge after 6s
    setTimeout(() => {
      setRetryResult((prev) => {
        const cur = prev[row.id];
        if (!cur) return prev;
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    }, 6000);
    if (ok) toast.success("Terkirim ulang ke webhook");
    else toast.error("Coba ulang gagal: " + (errMsg ?? "unknown"));
  }

  useEffect(() => {
    void loadHistory();
  }, []);

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

  async function sendTest(variant: "success" | "fail" | "wa") {
    const url = forwardUrl.trim();
    const wa = waTarget.trim();
    if (!url) {
      toast.error("Isi URL webhook dulu, lalu Simpan sebelum uji");
      return;
    }
    if (variant === "wa" && !wa) {
      toast.error("Isi Nomor WA Tujuan dulu untuk uji kirim WA");
      return;
    }
    const kind =
      variant === "success"
        ? "prep_submit_success_ecer"
        : variant === "fail"
          ? "prep_submit_fail_ecer"
          : "prep_submit_test_wa";
    const label =
      variant === "success"
        ? "payload sukses"
        : variant === "fail"
          ? "payload gagal"
          : `WA ke ${wa}`;
    toast.loading(`Mengirim uji ${label}…`, { id: "wa-test" });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          wa_target: wa || null,
          title: "Uji notifikasi MCM Storage",
          item_name: variant === "success" ? "PSR 3 gr" : null,
          photo_count: variant === "success" ? 2 : 0,
          error: variant === "fail" ? "Uji: contoh pesan gagal" : undefined,
          message:
            variant === "wa"
              ? "🔔 Uji notifikasi WA dari MCM Storage. Jika Anda menerima pesan ini, webhook & WA sudah berfungsi."
              : undefined,
          submission_id: "test-" + Date.now(),
          submitted_at: new Date().toISOString(),
          test: true,
        }),
      });
      if (!res.ok) {
        toast.error(`Webhook menolak (HTTP ${res.status})`, { id: "wa-test" });
      } else {
        toast.success(
          variant === "wa"
            ? `Terkirim ke webhook. Cek WA ${wa} sebentar lagi.`
            : "Payload terkirim ke webhook",
          { id: "wa-test" },
        );
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
            <Button
              variant="default"
              onClick={() => sendTest("wa")}
              disabled={saving}
              className="gap-2"
            >
              <MessageSquare className="h-4 w-4" />
              Uji Kirim WA
            </Button>
            <Button variant="outline" onClick={() => sendTest("success")} disabled={saving}>
              Uji Payload Sukses
            </Button>
            <Button variant="outline" onClick={() => sendTest("fail")} disabled={saving}>
              Uji Payload Gagal
            </Button>
          </div>
          <p className="text-ms-2xs text-muted-foreground">
            <strong>Uji Kirim WA</strong> memakai <code>kind: "prep_submit_test_wa"</code> + field{" "}
            <code>message</code>. Pastikan workflow n8n Anda meneruskan field <code>message</code> tsb ke{" "}
            <code>wa_target</code> saat <code>test === true</code> supaya Anda benar-benar menerima pesan WA
            percobaan.
          </p>
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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Riwayat Notifikasi Status Tugas</CardTitle>
              <CardDescription>
                50 upaya pengiriman WA terakhir untuk perubahan status tugas Anda. Ketuk baris untuk melihat isi
                payload yang dikirim.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={loadHistory} disabled={historyLoading} className="gap-1.5">
              <RefreshCw className={`h-4 w-4 ${historyLoading ? "animate-spin" : ""}`} />
              Muat ulang
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {historyLoading && history.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <p className="py-4 text-center text-ms-xs text-muted-foreground">
              Belum ada notifikasi WA yang dikirim untuk perubahan status tugas.
            </p>
          ) : (
            <ul className="divide-y">
              {history.map((row) => {
                const ok = row.send_status === "sent";
                const open = expandedId === row.id;
                return (
                  <li key={row.id} className="py-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(open ? null : row.id)}
                      className="flex w-full items-start gap-2 text-left"
                    >
                      {ok ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success dark:text-success" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-ms-sm font-medium">{row.title ?? "(tanpa judul)"}</span>
                          <span className="shrink-0 font-mono text-ms-2xs text-muted-foreground">
                            {new Date(row.created_at).toLocaleString("id-ID", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ms-2xs text-muted-foreground">
                          <span
                            className={`rounded px-1.5 py-0.5 font-medium ${
                              ok
                                ? "bg-success/10 text-success dark:text-success"
                                : "bg-destructive/10 text-destructive"
                            }`}
                          >
                            {ok ? "Terkirim" : "Gagal"}
                          </span>
                          <span>
                            {row.prev_status ?? "?"} → <strong>{row.new_status ?? "?"}</strong>
                          </span>
                          {row.wa_target ? <span>ke {row.wa_target}</span> : null}
                          <span className="font-mono">{row.kind}</span>
                        </div>
                        {row.error ? (
                          <p className="mt-1 break-words text-ms-2xs text-destructive">{row.error}</p>
                        ) : null}
                        {(row.retry_count ?? 0) > 0 ? (
                          <p className="mt-0.5 text-ms-2xs text-muted-foreground">
                            Sudah dicoba ulang {row.retry_count}×
                            {row.last_retry_at
                              ? " · terakhir " +
                                new Date(row.last_retry_at).toLocaleString("id-ID", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : ""}
                          </p>
                        ) : null}
                        {!ok ? (
                          <div className="mt-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={retryingId === row.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void retryRow(row);
                              }}
                              className="h-7 gap-1.5 px-2 text-ms-2xs"
                            >
                              {retryingId === row.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCw className="h-3.5 w-3.5" />
                              )}
                              Coba ulang
                            </Button>
                          </div>
                        ) : null}
                        {open && row.payload ? (
                          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono text-[10.5px] text-muted-foreground">
                            {JSON.stringify(row.payload, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type HistoryRow = {
  id: string;
  task_id: string | null;
  title: string | null;
  prev_status: string | null;
  new_status: string | null;
  kind: string;
  wa_target: string | null;
  send_status: string;
  error: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  retry_count: number | null;
  last_retry_at: string | null;
};