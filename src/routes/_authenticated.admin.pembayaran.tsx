import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X, Loader2, Save, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendly-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/admin/pembayaran")({
  head: () => ({ meta: [{ title: "Admin · Pembayaran · MCM Storage" }] }),
  component: AdminPaymentsPage,
});

type Row = {
  id: string;
  user_id: string;
  amount_idr: number;
  billing_cycle: string;
  sender_name: string;
  sender_bank: string | null;
  transfer_date: string;
  proof_path: string;
  status: string;
  created_at: string;
  admin_note: string | null;
};

function formatIdr(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}

function AdminPaymentsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"pending" | "all">("pending");

  const [settings, setSettings] = useState({
    bank_name: "",
    bank_account_number: "",
    bank_account_holder: "",
    whatsapp_admin: "",
    pro_price_monthly_idr: 99000,
    pro_price_yearly_idr: 990000,
    trial_days: 14,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        setIsAdmin(false);
        return;
      }
      const { data } = await supabase.rpc("has_role", {
        _user_id: u.user.id,
        _role: "admin",
      });
      setIsAdmin(!!data);
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    const q = supabase
      .from("subscription_payments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    const { data, error } = tab === "pending" ? await q.eq("status", "pending") : await q;
    if (error) toast.error(friendlyError(error));
    setRows((data ?? []) as Row[]);
    setLoading(false);

    // Generate signed URLs for proofs in parallel
    const urls: Record<string, string> = {};
    await Promise.all(
      (data ?? []).map(async (r: Row) => {
        const { data: signed } = await supabase.storage
          .from("payment-proofs")
          .createSignedUrl(r.proof_path, 300);
        if (signed?.signedUrl) urls[r.id] = signed.signedUrl;
      }),
    );
    setProofUrls(urls);
  };

  useEffect(() => {
    if (isAdmin) {
      void load();
      void supabase
        .from("app_settings")
        .select("bank_name,bank_account_number,bank_account_holder,whatsapp_admin,pro_price_monthly_idr,pro_price_yearly_idr,trial_days")
        .eq("id", true)
        .maybeSingle()
        .then(({ data }) => data && setSettings(data));
    }
  }, [isAdmin, tab]);

  const approve = async (id: string) => {
    const { data, error } = await supabase.rpc("admin_approve_payment", {
      _payment_id: id,
      _note: notes[id] ?? null,
    });
    if (error) return toast.error(friendlyError(error));
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok) return toast.error(res.error ?? "Gagal");
    toast.success("Pembayaran disetujui & langganan diperpanjang.");
    await load();
  };

  const reject = async (id: string) => {
    const note = notes[id];
    if (!note || note.trim().length < 3) {
      return toast.error("Beri catatan alasan penolakan (min. 3 karakter).");
    }
    const { data, error } = await supabase.rpc("admin_reject_payment", {
      _payment_id: id,
      _note: note,
    });
    if (error) return toast.error(friendlyError(error));
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok) return toast.error(res.error ?? "Gagal");
    toast.success("Pembayaran ditolak.");
    await load();
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    const { error } = await supabase
      .from("app_settings")
      .update(settings)
      .eq("id", true);
    setSavingSettings(false);
    if (error) return toast.error(friendlyError(error));
    toast.success("Pengaturan rekening disimpan.");
  };

  if (isAdmin === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memuat…
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <h1 className="text-xl font-semibold">Akses ditolak</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Halaman ini hanya untuk admin.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Antrian pembayaran</h1>
          <p className="text-sm text-muted-foreground">
            Verifikasi bukti transfer dan perpanjang langganan pelanggan.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" /> Muat ulang
        </Button>
      </header>

      <div className="flex gap-2">
        <Button variant={tab === "pending" ? "default" : "outline"} size="sm" onClick={() => setTab("pending")}>
          Menunggu
        </Button>
        <Button variant={tab === "all" ? "default" : "outline"} size="sm" onClick={() => setTab("all")}>
          Semua
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada data.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">{formatIdr(r.amount_idr)} · {r.billing_cycle}</p>
                  <p className="text-xs text-muted-foreground">User: {r.user_id}</p>
                  <p>
                    Pengirim: <strong>{r.sender_name}</strong>
                    {r.sender_bank ? ` (${r.sender_bank})` : ""}
                  </p>
                  <p>Tanggal transfer: {r.transfer_date}</p>
                  <p className="text-xs text-muted-foreground">
                    Dikirim: {new Date(r.created_at).toLocaleString("id-ID")}
                  </p>
                  <p className="text-xs">
                    Status:{" "}
                    <span
                      className={
                        r.status === "pending"
                          ? "font-medium text-amber-600"
                          : r.status === "approved"
                          ? "font-medium text-emerald-600"
                          : "font-medium text-rose-600"
                      }
                    >
                      {r.status}
                    </span>
                  </p>
                  {r.admin_note && (
                    <p className="text-xs text-muted-foreground">Catatan: {r.admin_note}</p>
                  )}
                </div>
                {proofUrls[r.id] && (
                  <a
                    href={proofUrls[r.id]}
                    target="_blank"
                    rel="noreferrer"
                    className="block max-w-[140px] shrink-0"
                  >
                    <img
                      src={proofUrls[r.id]}
                      alt="Bukti transfer"
                      className="h-32 w-32 rounded-md border object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <span className="mt-1 block text-center text-xs text-primary underline">
                      Buka bukti
                    </span>
                  </a>
                )}
              </div>
              {r.status === "pending" && (
                <div className="mt-3 space-y-2">
                  <Textarea
                    placeholder="Catatan untuk pengguna (opsional jika setuju, wajib jika tolak)"
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => approve(r.id)}>
                      <Check className="mr-1 h-4 w-4" /> Setujui
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => reject(r.id)}>
                      <X className="mr-1 h-4 w-4" /> Tolak
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Settings editor */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Pengaturan rekening & harga</h2>
        <p className="text-xs text-muted-foreground">
          Berlaku untuk semua pengguna di halaman langganan.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Nama bank</Label>
            <Input value={settings.bank_name} onChange={(e) => setSettings({ ...settings, bank_name: e.target.value })} />
          </div>
          <div>
            <Label>Atas nama</Label>
            <Input value={settings.bank_account_holder} onChange={(e) => setSettings({ ...settings, bank_account_holder: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label>No. rekening</Label>
            <Input value={settings.bank_account_number} onChange={(e) => setSettings({ ...settings, bank_account_number: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label>Nomor WhatsApp admin (untuk tombol kontak)</Label>
            <Input
              placeholder="62812xxxxxxx"
              value={settings.whatsapp_admin}
              onChange={(e) => setSettings({ ...settings, whatsapp_admin: e.target.value })}
            />
          </div>
          <div>
            <Label>Harga bulanan (IDR)</Label>
            <Input
              type="number"
              value={settings.pro_price_monthly_idr}
              onChange={(e) =>
                setSettings({ ...settings, pro_price_monthly_idr: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div>
            <Label>Harga tahunan (IDR)</Label>
            <Input
              type="number"
              value={settings.pro_price_yearly_idr}
              onChange={(e) =>
                setSettings({ ...settings, pro_price_yearly_idr: Number(e.target.value) || 0 })
              }
            />
          </div>
          <div>
            <Label>Uji coba (hari)</Label>
            <Input
              type="number"
              value={settings.trial_days}
              onChange={(e) =>
                setSettings({ ...settings, trial_days: Number(e.target.value) || 0 })
              }
            />
          </div>
        </div>
        <Button onClick={saveSettings} disabled={savingSettings} className="mt-4">
          {savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Simpan pengaturan
        </Button>
      </section>
    </div>
  );
}