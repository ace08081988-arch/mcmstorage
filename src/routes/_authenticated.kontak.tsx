import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { sendTestPushToContact, sendTestPushToAllContacts } from "@/lib/push.functions";
import { friendlyError } from "@/lib/friendly-error";
import { confirm } from "@/lib/confirm";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useStartDm } from "@/lib/chat";
import { MessageSquare, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Users2, Truck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/kontak")({
  head: () => ({
    meta: [
      { title: "Pelanggan & Pemasok · MCM Storage" },
      {
        name: "description",
        content:
          "Kelola kontak pelanggan dan pemasok, serta tautkan ke akun pengguna untuk notifikasi push.",
      },
    ],
  }),
  component: KontakPage,
});

type Kind = "customer" | "supplier";

type Row = {
  id: string;
  name: string;
  contact: string | null;
  account_user_id: string | null;
};

// Beberapa row bisa merujuk ke pelanggan/pemasok yang sama (duplikat import
// atau tertaut ke akun sama). Gabungkan tampilan; operasi berlaku ke semua id.
type GroupedRow = Row & { ids: string[]; dupCount: number };

function groupRows(rows: Row[]): GroupedRow[] {
  const map = new Map<string, GroupedRow>();
  for (const r of rows) {
    const key = r.account_user_id
      ? `acc:${r.account_user_id}`
      : `nc:${r.name.trim().toLowerCase()}|${(r.contact ?? "").trim().toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      existing.ids.push(r.id);
      existing.dupCount = existing.ids.length;
      if (!existing.contact && r.contact) existing.contact = r.contact;
    } else {
      map.set(key, { ...r, ids: [r.id], dupCount: 1 });
    }
  }
  return Array.from(map.values());
}

type Contact = {
  user_id: string;
  display_name: string | null;
  phone: string | null;
};

function KontakPage() {
  const [tab, setTab] = useState<Kind>("customer");
  const [customers, setCustomers] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkFor, setLinkFor] = useState<{ kind: Kind; row: Row } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const sendTest = useServerFn(sendTestPushToContact);
  const sendTestAll = useServerFn(sendTestPushToAllContacts);
  const navigate = useNavigate();
  const startDm = useStartDm();
  const [chatting, setChatting] = useState<string | null>(null);

  const openChat = async (row: GroupedRow) => {
    if (!row.account_user_id) {
      toast.error("Tautkan akun pengguna dulu sebelum memulai chat.");
      return;
    }
    setChatting(row.ids[0]);
    try {
      const conversationId = await startDm.mutateAsync(row.account_user_id);
      if (!conversationId) throw new Error("Tidak menerima ID percakapan");
      navigate({ to: "/chat/$conversationId", params: { conversationId } });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setChatting(null);
    }
  };

  const refresh = async () => {
    setLoading(true);
    const [c, s] = await Promise.all([
      supabase
        .from("customers")
        .select("id,name,contact,account_user_id")
        .order("name"),
      supabase
        .from("suppliers")
        .select("id,name,contact,account_user_id")
        .order("name"),
    ]);
    if (c.error) toast.error(friendlyError(c.error));
    else setCustomers((c.data ?? []) as Row[]);
    if (s.error) toast.error(friendlyError(s.error));
    else setSuppliers((s.data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const rows = tab === "customer" ? customers : suppliers;
  const groupedRows = useMemo(() => groupRows(rows), [rows]);

  const unlink = async (kind: Kind, row: GroupedRow) => {
    const table = kind === "customer" ? "customers" : "suppliers";
    const { error } = await supabase
      .from(table)
      .update({ account_user_id: null })
      .in("id", row.ids);
    if (error) toast.error(friendlyError(error));
    else {
      toast.success("Tautan akun dilepas");
      void refresh();
    }
  };

  const removeRow = async (kind: Kind, row: GroupedRow) => {
    const label = kind === "customer" ? "pelanggan" : "pemasok";
    const extra = row.ids.length > 1
      ? ` (${row.ids.length} entri duplikat akan digabung & dihapus)`
      : "";
    if (
      !(await confirm({
        title: `Hapus ${label}?`,
        description: `${row.name}${extra} akan dihapus permanen. Riwayat transaksi terkait tetap ada, tapi tidak lagi tertaut ke kontak ini.`,
        confirmText: "Hapus",
        destructive: true,
      }))
    ) return;
    const table = kind === "customer" ? "customers" : "suppliers";
    const { error } = await supabase.from(table).delete().in("id", row.ids);
    if (error) toast.error(friendlyError(error));
    else {
      toast.success(`${label[0].toUpperCase() + label.slice(1)} dihapus`);
      void refresh();
    }
  };

  const sendWa = async (row: GroupedRow) => {
    const text = `Halo ${row.name}, ada yang ingin saya sampaikan.`;
    const phone = row.contact?.replace(/\D/g, "") || undefined;
    const res = await shareToWhatsApp({ text, title: row.name, phone });
    notifyShareResult(res);
  };

  const handleTest = async (kind: Kind, row: GroupedRow) => {
    setTesting(row.ids[0]);
    try {
      const res = await sendTest({ data: { kind, id: row.ids[0] } });
      if (res.sent > 0) toast.success(res.message);
      else toast.warning(res.message);
    } catch (e: any) {
      toast.error(friendlyError(e));
    } finally {
      setTesting(null);
    }
  };

  const linkedCount = useMemo(
    () => groupedRows.filter((r) => r.account_user_id).length,
    [groupedRows],
  );

  const handleTestAll = async () => {
    setTestingAll(true);
    try {
      const res = await sendTestAll({ data: { kind: tab } });
      if (res.sent > 0) toast.success(res.message);
      else toast.warning(res.message);
    } catch (e: any) {
      toast.error(friendlyError(e));
    } finally {
      setTestingAll(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-3 sm:px-6">
          <Link
            to="/"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm hover:bg-accent"
            aria-label="Kembali"
          >
            ←
          </Link>
          <h1 className="flex-1 truncate text-base font-semibold">
            Pelanggan &amp; Pemasok
          </h1>
          <Button
            size="sm"
            variant="secondary"
            disabled={testingAll || linkedCount === 0}
            onClick={() => void handleTestAll()}
            title={
              linkedCount === 0
                ? "Belum ada kontak tertaut"
                : `Kirim uji ke ${linkedCount} kontak tertaut`
            }
          >
            {testingAll ? "Mengirim…" : "Uji ke semua"}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 py-4 sm:px-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="customer">Pelanggan</TabsTrigger>
            <TabsTrigger value="supplier">Pemasok</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-3">
            {loading ? (
              <ul className="space-y-2" aria-busy="true" aria-label="Memuat kontak">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="rounded-lg border bg-card p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/5" />
                        <Skeleton className="h-3 w-1/3" />
                        <Skeleton className="h-3 w-20 rounded-full" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Skeleton className="h-7 w-24 rounded-md" />
                        <Skeleton className="h-7 w-24 rounded-md" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  {tab === "customer" ? <Users2 className="h-5 w-5" /> : <Truck className="h-5 w-5" />}
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    Belum ada {tab === "customer" ? "pelanggan" : "pemasok"}
                  </p>
                  <p className="mx-auto max-w-xs text-xs">
                    Tambahkan lewat halaman terkait seperti{" "}
                    <Link to="/gudang" className="text-primary hover:underline">pesanan</Link>
                    {" "}atau{" "}
                    <Link to="/hutang-piutang" className="text-primary hover:underline">hutang piutang</Link>.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border bg-card p-3 text-sm"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{r.name}</div>
                        {r.contact && (
                          <div className="truncate text-xs text-muted-foreground">
                            {r.contact}
                          </div>
                        )}
                        <div className="mt-1 text-[11px]">
                          {r.account_user_id ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                              Tertaut ke akun
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              Belum tertaut akun
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setLinkFor({ kind: tab, row: r })}
                        >
                          {r.account_user_id ? "Ubah tautan" : "Tautkan akun"}
                        </Button>
                        {r.contact && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="bg-[#25D366]/15 text-[#1ea952] hover:bg-[#25D366]/25"
                            onClick={() => void sendWa(r)}
                            title={`Kirim via MCM ke ${r.contact}`}
                          >
                            Kirim via MCM
                          </Button>
                        )}
                        {r.account_user_id && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={chatting === r.id}
                              onClick={() => void openChat(r)}
                              title={`Chat dengan ${r.name}`}
                              className="bg-primary/10 text-primary hover:bg-primary/20"
                            >
                              {chatting === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <MessageSquare className="h-4 w-4" />
                              )}
                              Chat
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={testing === r.id}
                              onClick={() => void handleTest(tab, r)}
                            >
                              {testing === r.id ? "Mengirim…" : "Kirim notifikasi uji"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => void unlink(tab, r)}
                            >
                              Lepas
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void removeRow(tab, r)}
                        >
                          Hapus
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <LinkAccountDialog
        target={linkFor}
        onClose={() => setLinkFor(null)}
        onSaved={() => {
          setLinkFor(null);
          void refresh();
        }}
      />
    </div>
  );
}

function LinkAccountDialog({
  target,
  onClose,
  onSaved,
}: {
  target: { kind: Kind; row: Row } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!target) {
      setQ("");
      setResults([]);
    }
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const h = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_profiles_for_link", {
        _q: q || "",
      });
      if (error) {
        toast.error(friendlyError(error));
        return;
      }
      setResults(
        ((data ?? []) as Array<{ user_id: string; display_name: string | null; phone: string | null }>).map(
          (r) => ({ user_id: r.user_id, display_name: r.display_name, phone: r.phone }),
        ),
      );
    }, 200);
    return () => clearTimeout(h);
  }, [q, target]);

  const link = async (userId: string) => {
    if (!target) return;
    const table = target.kind === "customer" ? "customers" : "suppliers";
    setBusy(true);
    const { error } = await supabase
      .from(table)
      .update({ account_user_id: userId })
      .eq("id", target.row.id);
    setBusy(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    // Refresh chat contact list so the + DM dialog finds the newly linked
    // account immediately, without requiring a page refresh or re-login.
    await qc.invalidateQueries({ queryKey: ["chat", "contacts"] });
    const contactName = target.row.name;
    toast.success(`${contactName} berhasil ditautkan`, {
      description: "Kontak siap dipakai di tombol + DM pada halaman Chat.",
      duration: 6000,
      action: {
        label: "Buka Chat",
        onClick: () => navigate({ to: "/chat" }),
      },
    });
    onSaved();
  };

  const open = useMemo(() => !!target, [target]);

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tautkan akun pengguna</DialogTitle>
          <DialogDescription>
            Pilih pengguna yang sudah terdaftar untuk dihubungkan ke{" "}
            <span className="font-medium">{target?.row.name}</span>. Notifikasi
            push chat akan dikirim ke akun yang tertaut.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="Cari nama atau nomor telepon…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="max-h-72 space-y-1 overflow-auto">
            {results.length === 0 ? (
              <li className="py-6 text-center text-xs text-muted-foreground">
                Tidak ada hasil.
              </li>
            ) : (
              results.map((c) => (
                <li key={c.user_id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void link(c.user_id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                       <span className="block truncate font-medium">
                         {c.display_name || c.phone || c.user_id}
                       </span>
                       {c.phone && c.display_name && (
                         <span className="block truncate text-xs text-muted-foreground">
                           {c.phone}
                         </span>
                       )}
                    </span>
                    <span className="text-xs text-primary">Tautkan</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}