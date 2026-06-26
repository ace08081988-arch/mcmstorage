import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { genPin, genShareToken, publicTaskUrl } from "@/lib/prep";
import { copyText, shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { Plus, Trash2, Copy, MessageCircle, ExternalLink, RefreshCw, ShieldCheck, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/tugas-baru")({
  head: () => ({
    meta: [
      { title: "Buat Tugas Pegawai · MCM Storage" },
      { name: "description", content: "Buat token & PIN tugas pegawai langsung dari UI tanpa akses database." },
    ],
  }),
  component: TugasBaruPage,
});

type Row = { key: string; name: string; qty: string; unit: string };

function newRow(): Row {
  return { key: crypto.randomUUID(), name: "", qty: "1", unit: "" };
}

function TugasBaruPage() {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState(() => genPin());
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ token: string; pin: string; title: string; url: string } | null>(null);

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((s) => s.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function removeRow(key: string) {
    setRows((s) => (s.length <= 1 ? s : s.filter((r) => r.key !== key)));
  }

  async function submit() {
    const t = title.trim();
    if (!t) return toast.error("Judul tugas wajib diisi");
    if (!/^\d{4,8}$/.test(pin)) return toast.error("PIN harus 4–8 digit angka");
    const items = rows
      .map((r) => ({ name: r.name.trim(), qty: Number(r.qty), unit: r.unit.trim() || null }))
      .filter((r) => r.name.length > 0);
    if (items.length === 0) return toast.error("Tambahkan minimal 1 barang");
    if (items.some((r) => !Number.isFinite(r.qty) || r.qty <= 0)) return toast.error("Jumlah setiap barang harus > 0");

    setBusy(true);
    const token = genShareToken();
    const payload = items.map((r) => ({
      name: r.name,
      category: null,
      qty_requested: r.qty,
      unit_label: r.unit,
      ref_photo_path: null,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("prep_create_task", {
      _title: t,
      _note: note.trim() || null,
      _pin: pin,
      _share_token: token,
      _items: payload,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    const url = publicTaskUrl(token);
    setCreated({ token, pin, title: t, url });
    toast.success("Tugas berhasil dibuat");
  }

  async function shareWa() {
    if (!created) return;
    const cleaned = phone.replace(/\D/g, "");
    const text = `Tolong siapkan barang berikut. Buka link, masukkan PIN, foto barangnya & kirim:\n\n${created.title}\nPIN: ${created.pin}`;
    const res = await shareToWhatsApp({ title: created.title, text, url: created.url, phone: cleaned || undefined });
    notifyShareResult(res);
  }

  function reset() {
    setCreated(null);
    setTitle("");
    setNote("");
    setPin(genPin());
    setRows([newRow()]);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Buat Tugas Pegawai</h1>
          <p className="text-xs text-muted-foreground">Buat token & PIN langsung dari UI — tanpa perlu akses database.</p>
        </div>
        <Link to="/tugas" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
          <ArrowLeft className="h-3.5 w-3.5" /> Tugas
        </Link>
      </div>

      {created ? (
        <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
          <div className="flex items-center gap-2 text-emerald-600">
            <ShieldCheck className="h-4 w-4" /> <span className="font-medium">Tugas siap dibagikan</span>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Judul</div>
            <div className="font-medium">{created.title}</div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="PIN">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-muted px-2 py-1 text-base tracking-widest">{created.pin}</code>
                <button type="button" onClick={() => copyText(created.pin)} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </Field>
            <Field label="Link pegawai">
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{created.url}</code>
                <button type="button" onClick={() => copyText(created.url)} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <a href={created.url} target="_blank" rel="noreferrer" className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </Field>
          </div>
          <Field label="Kirim ke WhatsApp (opsional)">
            <div className="flex items-center gap-2">
              <input
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08xxxxxxxxxx"
                className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <button type="button" onClick={shareWa} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                <MessageCircle className="h-3.5 w-3.5" /> Kirim
              </button>
            </div>
          </Field>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              <RefreshCw className="h-3.5 w-3.5" /> Buat tugas lain
            </button>
            <Link to="/tugas" className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              Lihat daftar tugas
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
          <Field label="Judul tugas">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Mis. Penyiapan pesanan Bu Ani"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="Catatan (opsional)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Instruksi tambahan untuk pegawai…"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="PIN (4–8 digit)">
            <div className="flex items-center gap-2">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                className="w-32 rounded-md border bg-background px-2 py-1.5 text-base tracking-widest"
              />
              <button type="button" onClick={() => setPin(genPin())} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                <RefreshCw className="h-3.5 w-3.5" /> Acak
              </button>
            </div>
          </Field>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Daftar barang</div>
              <button type="button" onClick={() => setRows((s) => [...s, newRow()])} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                <Plus className="h-3.5 w-3.5" /> Tambah
              </button>
            </div>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={r.key} className="grid grid-cols-12 items-center gap-2 rounded-md border p-2">
                  <div className="col-span-12 text-[11px] text-muted-foreground sm:hidden">Barang #{i + 1}</div>
                  <input
                    value={r.name}
                    onChange={(e) => updateRow(r.key, { name: e.target.value })}
                    placeholder="Nama barang"
                    className="col-span-12 rounded-md border bg-background px-2 py-1.5 text-sm sm:col-span-6"
                  />
                  <input
                    value={r.qty}
                    onChange={(e) => updateRow(r.key, { qty: e.target.value.replace(/[^\d.]/g, "") })}
                    inputMode="decimal"
                    placeholder="Jumlah"
                    className="col-span-5 rounded-md border bg-background px-2 py-1.5 text-sm sm:col-span-3"
                  />
                  <input
                    value={r.unit}
                    onChange={(e) => updateRow(r.key, { unit: e.target.value })}
                    placeholder="Satuan (gram/pcs/botol)"
                    className="col-span-6 rounded-md border bg-background px-2 py-1.5 text-sm sm:col-span-2"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(r.key)}
                    disabled={rows.length <= 1}
                    className="col-span-1 inline-flex items-center justify-center rounded-md border p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    aria-label="Hapus baris"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Membuat…" : "Buat tugas"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}