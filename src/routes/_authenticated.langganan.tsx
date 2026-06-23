import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Check, Upload, Copy, ExternalLink, Clock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/friendly-error";
import { useEntitlement, FREE_CAPS } from "@/hooks/useEntitlement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/langganan")({
  head: () => ({
    meta: [{ title: "Langganan · MCM Storage" }],
  }),
  component: LanggananPage,
});

type AppSettings = {
  bank_name: string;
  bank_account_number: string;
  bank_account_holder: string;
  whatsapp_admin: string;
  pro_price_monthly_idr: number;
  pro_price_yearly_idr: number;
  trial_days: number;
};

type PaymentRow = {
  id: string;
  amount_idr: number;
  billing_cycle: string;
  sender_name: string;
  transfer_date: string;
  status: string;
  admin_note: string | null;
  created_at: string;
};

function formatIdr(n: number) {
  return "Rp " + n.toLocaleString("id-ID");
}
function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function LanggananPage() {
  const ent = useEntitlement();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [sender, setSender] = useState("");
  const [senderBank, setSenderBank] = useState("");
  const [transferDate, setTransferDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);

  const loadPayments = async (uid: string) => {
    const { data } = await supabase
      .from("subscription_payments")
      .select("id,amount_idr,billing_cycle,sender_name,transfer_date,status,admin_note,created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(20);
    setPayments((data ?? []) as PaymentRow[]);
  };

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("bank_name,bank_account_number,bank_account_holder,whatsapp_admin,pro_price_monthly_idr,pro_price_yearly_idr,trial_days")
      .eq("id", true)
      .maybeSingle()
      .then(({ data }) => data && setSettings(data as AppSettings));
  }, []);

  useEffect(() => {
    if (ent.uid) void loadPayments(ent.uid);
  }, [ent.uid]);

  const amount =
    settings && cycle === "monthly"
      ? settings.pro_price_monthly_idr
      : settings?.pro_price_yearly_idr ?? 0;

  const startTrial = async () => {
    setStartingTrial(true);
    const { data, error } = await supabase.rpc("start_pro_trial");
    setStartingTrial(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok) {
      toast.error(
        res.error === "trial_already_used"
          ? "Uji coba sudah pernah dipakai pada akun ini."
          : "Gagal memulai uji coba.",
      );
      return;
    }
    toast.success("Uji coba 14 hari aktif. Selamat menikmati fitur Pro!");
    await ent.refresh();
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ent.uid || !file || !sender || !transferDate) return;
    setSubmitting(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
      const path = `${ent.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await supabase.storage.from("payment-proofs").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (up.error) throw up.error;
      const ins = await supabase.from("subscription_payments").insert({
        user_id: ent.uid,
        amount_idr: amount,
        billing_cycle: cycle,
        sender_name: sender,
        sender_bank: senderBank || null,
        transfer_date: transferDate,
        proof_path: path,
      });
      if (ins.error) throw ins.error;
      toast.success("Bukti transfer terkirim. Menunggu konfirmasi admin.");
      setFile(null);
      setSender("");
      setSenderBank("");
      await loadPayments(ent.uid);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const copy = (s: string) => {
    navigator.clipboard.writeText(s).then(() => toast.success("Disalin"));
  };

  const waUrl =
    settings?.whatsapp_admin
      ? `https://wa.me/${settings.whatsapp_admin.replace(/\D/g, "")}?text=${encodeURIComponent("Halo admin, saya sudah transfer untuk Pro. Bukti sudah saya upload di aplikasi.")}`
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Langganan</h1>
        <p className="text-sm text-muted-foreground">
          Kelola paket dan riwayat pembayaran Pro.
        </p>
      </header>

      {/* Status card */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Paket saat ini
              </span>
              <span
                className={
                  "rounded-full px-2 py-0.5 text-xs font-semibold " +
                  (ent.isPro
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground")
                }
              >
                {ent.isPro ? "Pro" : "Free"}
              </span>
              <span className="text-xs text-muted-foreground">
                {ent.status === "trialing" && "(uji coba)"}
                {ent.status === "expired" && "(kedaluwarsa)"}
                {ent.billingCycle === "promo" && "(promo peluncuran)"}
              </span>
            </div>
            {ent.isPro && ent.periodEnd && (
              <p className="mt-1 flex items-center gap-1 text-sm text-foreground">
                <Clock className="h-3.5 w-3.5" /> Berakhir {formatDate(ent.periodEnd)}{" "}
                <span className="text-muted-foreground">
                  ({ent.daysLeft} hari lagi)
                </span>
              </p>
            )}
          </div>
          {!ent.isPro && !ent.trialUsedAt && (
            <Button onClick={startTrial} disabled={startingTrial}>
              {startingTrial ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Mulai uji coba {settings?.trial_days ?? 14} hari
            </Button>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <UsageRow label="Barang gudang" used={ent.usage.warehouseItems} cap={FREE_CAPS.warehouseItems} isPro={ent.isPro} />
          <UsageRow label="Penjualan / 30 hari" used={ent.usage.salesLast30Days} cap={FREE_CAPS.salesLast30Days} isPro={ent.isPro} />
          <UsageRow label="Kontak pegawai" used={ent.usage.staffContacts} cap={FREE_CAPS.staffContacts} isPro={ent.isPro} />
          <UsageRow label="Perangkat tepercaya" used={ent.usage.devices} cap={FREE_CAPS.devices} isPro={ent.isPro} />
        </div>
      </section>

      {/* Upgrade form */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Upgrade ke Pro</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Transfer manual ke rekening berikut, lalu unggah bukti. Admin akan menyetujui
          dalam beberapa jam kerja.
        </p>

        {settings && (
          <div className="mt-4 grid gap-3 rounded-xl bg-muted/40 p-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Bank</p>
              <p className="font-medium">{settings.bank_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Atas nama</p>
              <p className="font-medium">{settings.bank_account_holder}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">No. rekening</p>
              <div className="flex items-center gap-2">
                <p className="font-mono text-base font-semibold">
                  {settings.bank_account_number}
                </p>
                <button
                  type="button"
                  onClick={() => copy(settings.bank_account_number)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs hover:bg-muted"
                >
                  <Copy className="h-3 w-3" /> Salin
                </button>
              </div>
            </div>
            {waUrl && (
              <a
                href={waUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary underline sm:col-span-2"
              >
                <ExternalLink className="h-3 w-3" /> Chat admin via WhatsApp
              </a>
            )}
          </div>
        )}

        <form onSubmit={submitPayment} className="mt-5 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Siklus</Label>
              <Select value={cycle} onValueChange={(v) => setCycle(v as "monthly" | "yearly")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">
                    Bulanan — {settings ? formatIdr(settings.pro_price_monthly_idr) : "…"}
                  </SelectItem>
                  <SelectItem value="yearly">
                    Tahunan — {settings ? formatIdr(settings.pro_price_yearly_idr) : "…"}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Total transfer: <strong>{formatIdr(amount)}</strong>
              </p>
            </div>
            <div>
              <Label>Tanggal transfer</Label>
              <Input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Nama pengirim</Label>
              <Input
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="Nama di rekening pengirim"
                required
              />
            </div>
            <div>
              <Label>Bank pengirim (opsional)</Label>
              <Input
                value={senderBank}
                onChange={(e) => setSenderBank(e.target.value)}
                placeholder="BCA / Mandiri / dst."
              />
            </div>
          </div>
          <div>
            <Label>Bukti transfer (foto/screenshot)</Label>
            <Input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <Button type="submit" disabled={submitting || !file}>
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Kirim bukti transfer
          </Button>
        </form>
      </section>

      {/* History */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Riwayat pembayaran</h2>
        {payments.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Belum ada pembayaran.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium">
                    {formatIdr(p.amount_idr)} · {p.billing_cycle === "monthly" ? "Bulanan" : "Tahunan"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Transfer {formatDate(p.transfer_date)} · Dikirim {formatDate(p.created_at)}
                  </p>
                  {p.admin_note && (
                    <p className="text-xs text-amber-600">Catatan admin: {p.admin_note}</p>
                  )}
                </div>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-xs text-muted-foreground">
        Punya pertanyaan?{" "}
        <Link to="/refund" className="underline">
          Kebijakan pengembalian
        </Link>
      </p>
    </div>
  );
}

function UsageRow({
  label,
  used,
  cap,
  isPro,
}: {
  label: string;
  used: number;
  cap: number;
  isPro: boolean;
}) {
  const pct = isPro ? 0 : Math.min(100, Math.round((used / cap) * 100));
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {used}
          {!isPro && <span className="text-muted-foreground"> / {cap}</span>}
          {isPro && <span className="text-primary"> · Tak terbatas</span>}
        </span>
      </div>
      {!isPro && <Progress value={pct} className="mt-2 h-1.5" />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: {
      label: "Menunggu konfirmasi",
      cls: "bg-amber-500/15 text-amber-700",
    },
    approved: {
      label: "Disetujui",
      cls: "bg-emerald-500/15 text-emerald-700",
    },
    rejected: {
      label: "Ditolak",
      cls: "bg-rose-500/15 text-rose-700",
    },
  };
  const m = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>
      <Check className="-mt-0.5 mr-1 inline h-3 w-3 align-middle" /> {m.label}
    </span>
  );
}