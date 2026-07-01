import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, MessageCircle, Copy, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import { confirm as confirmDialog } from "@/lib/confirm";

type Contact = {
  id: string;
  user_id: string;
  name: string;
  wa_phone: string;
  created_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (): any => (supabase.from as any)("staff_contacts");

function normalizePhone(input: string): string {
  let s = input.replace(/\D/g, "");
  if (s.startsWith("0")) s = "62" + s.slice(1);
  return s;
}

export function StaffContactsPanel({ uid }: { uid: string | null }) {
  const [rows, setRows] = useState<Contact[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    const { data, error } = await table().select("*").order("created_at", { ascending: false });
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as Contact[]);
  }, [uid]);
  useEffect(() => { void load(); }, [load]);

  async function onAdd() {
    if (!uid) return;
    const nm = name.trim();
    const ph = normalizePhone(phone);
    if (!nm) return toast.error("Nama wajib diisi.");
    if (ph.length < 8) return toast.error("Nomor WA tidak valid.");
    setBusy(true);
    const { error } = await table().insert({ user_id: uid, name: nm, wa_phone: ph });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Kontak pegawai ditambahkan.");
    setName(""); setPhone(""); setOpen(false);
    void load();
  }

  async function onDelete(c: Contact) {
    if (!(await confirmDialog({
      title: "Hapus kontak?",
      description: `${c.name} (${c.wa_phone}) akan dihapus.`,
      confirmText: "Hapus", destructive: true,
    }))) return;
    const { error } = await table().delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("Kontak dihapus.");
    void load();
  }

  async function copyPhone(c: Contact) {
    try { await navigator.clipboard.writeText(c.wa_phone); toast.success("Nomor disalin."); }
    catch { toast.error("Gagal menyalin."); }
  }

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4" />
        <div className="text-sm font-semibold">Kontak Pegawai</div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"
        >
          <Plus className="h-3.5 w-3.5" /> {open ? "Batal" : "Tambah"}
        </button>
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-1 gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama pegawai"
            className="h-9 rounded-md border bg-background px-2 text-sm"
          />
          <input
            value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Nomor WA (08… / 628…)"
            inputMode="tel" className="h-9 rounded-md border bg-background px-2 text-sm"
          />
          <button
            onClick={onAdd} disabled={busy}
            className="h-9 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >Simpan</button>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
            Belum ada kontak pegawai. Tambah dulu agar mudah kirim link tugas via WA.
          </div>
        ) : (
          rows.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md border bg-background p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{c.name}</div>
                <div className="text-[11px] text-muted-foreground">+{c.wa_phone}</div>
              </div>
              <a
                href={buildWhatsAppUrl("", c.wa_phone)} target="_blank" rel="noreferrer"
                title="Kirim via MCM"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#25D366]/40 bg-[#25D366]/10 text-[#1ea952]"
              ><MessageCircle className="h-4 w-4" /></a>
              <button
                onClick={() => copyPhone(c)} title="Salin nomor"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border"
              ><Copy className="h-4 w-4" /></button>
              <button
                onClick={() => onDelete(c)} title="Hapus"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-destructive"
              ><Trash2 className="h-4 w-4" /></button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}