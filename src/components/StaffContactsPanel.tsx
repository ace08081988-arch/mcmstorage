import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, MessageCircle, Copy, Users, Search, X, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import { confirm as confirmDialog } from "@/lib/confirm";

type Contact = {
  id: string;
  user_id: string;
  name: string;
  wa_phone: string;
  pin_chat_mcm: string | null;
  created_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (): any => (supabase.from as any)("staff_contacts");

/**
 * Cache modul-level per-uid untuk daftar kontak pegawai. Tujuan:
 *   - Remount panel (mis. navigasi bolak-balik) TIDAK memicu flicker /
 *     re-fetch: render langsung pakai snapshot terakhir, lalu revalidate
 *     di background (stale-while-revalidate).
 *   - Search terhadap kontak jalan di-memori atas snapshot ini, jadi
 *     tidak ada network round-trip per ketikan.
 */
const contactsCache = new Map<string, { rows: Contact[]; ts: number }>();
const CACHE_TTL_MS = 60_000;

function normalizePhone(input: string): string {
  let s = input.replace(/\D/g, "");
  if (s.startsWith("0")) s = "62" + s.slice(1);
  return s;
}

export function StaffContactsPanel({ uid }: { uid: string | null }) {
  const [rows, setRows] = useState<Contact[]>(() =>
    uid ? (contactsCache.get(uid)?.rows ?? []) : [],
  );
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pinChatMcm, setPinChatMcm] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Search: `query` = input mentah (responsif), `debounced` = versi yang
  // dipakai filter (delay 200ms) supaya render list tidak dihitung ulang
  // tiap keystroke pada koleksi besar.
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  const load = useCallback(async (force = false) => {
    if (!uid) return;
    const cached = contactsCache.get(uid);
    const fresh = !force && cached && Date.now() - cached.ts < CACHE_TTL_MS;
    if (fresh) return; // masih fresh dan bukan refresh manual → skip network.
    try {
      setRefreshing(true);
      const { data, error } = await table().select("*").order("created_at", { ascending: false });
      if (error) { toast.error(error.message); return; }
      const next = (data ?? []) as Contact[];
      contactsCache.set(uid, { rows: next, ts: Date.now() });
      setRows(next);
    } finally {
      setRefreshing(false);
    }
  }, [uid]);
  useEffect(() => { void load(); }, [load]);

  // Debounce pencarian: hanya update `debounced` setelah 200ms idle.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebounced(query.trim()), 200);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query]);

  // Filter in-memory berdasarkan snapshot yang sudah di-cache. Nol network.
  const filteredRows = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, "");
    return rows.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (digits && c.wa_phone.includes(digits)) return true;
      if (c.pin_chat_mcm && c.pin_chat_mcm.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [rows, debounced]);

  // Mutasi lokal + invalidasi cache supaya delete/insert langsung
  // tercermin tanpa menunggu refetch berikutnya.
  const invalidateCache = useCallback(() => {
    if (uid) contactsCache.delete(uid);
  }, [uid]);

  async function onAdd() {
    if (!uid) return;
    const nm = name.trim();
    const ph = normalizePhone(phone);
    const pin = pinChatMcm.trim().toUpperCase();
    if (!nm) return toast.error("Nama wajib diisi.");
    if (ph.length < 8) return toast.error("Nomor WA tidak valid.");
    setBusy(true);
    const { error } = await table().insert({
      user_id: uid,
      name: nm,
      wa_phone: ph,
      pin_chat_mcm: pin || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Kontak pegawai ditambahkan.");
    setName(""); setPhone(""); setPinChatMcm(""); setOpen(false);
    invalidateCache();
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
    invalidateCache();
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
        <div className="mt-3 grid grid-cols-1 gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-[1fr_1fr_auto] sm:grid-rows-2">
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
            className="h-9 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50 sm:row-span-2"
          >Simpan</button>
          <input
            value={pinChatMcm} onChange={(e) => setPinChatMcm(e.target.value)} placeholder="PIN chat MCM (opsional)"
            inputMode="text" autoCapitalize="characters" maxLength={10}
            className="col-span-1 sm:col-span-2 h-9 rounded-md border bg-background px-2 text-sm font-mono tracking-widest"
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama, nomor, atau PIN…"
            aria-label="Cari kontak pegawai"
            className="h-9 w-full rounded-md border bg-background pl-7 pr-8 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Bersihkan pencarian"
              className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
            Belum ada kontak pegawai. Tambah dulu agar mudah kirim link tugas via WA.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
            Tidak ada kontak yang cocok dengan “{debounced}”.
          </div>
        ) : (
          filteredRows.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md border bg-background p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{c.name}</div>
                <div className="text-[11px] text-muted-foreground">WA: +{c.wa_phone}</div>
                {c.pin_chat_mcm ? (
                  <div className="text-[11px] font-mono text-primary">PIN MCM: {c.pin_chat_mcm}</div>
                ) : null}
              </div>
              <a
                href={buildWhatsAppUrl("", c.wa_phone)} target="_blank" rel="noreferrer"
                title="Kirim via WA"
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