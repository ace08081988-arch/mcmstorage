import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { sendTestPushToContact, sendTestPushToAllContacts } from "@/lib/push.functions";
import { friendlyError } from "@/lib/friendly-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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

type Contact = {
  user_id: string;
  display_name: string | null;
  email: string | null;
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

  const unlink = async (kind: Kind, row: Row) => {
    const table = kind === "customer" ? "customers" : "suppliers";
    const { error } = await supabase
      .from(table)
      .update({ account_user_id: null })
      .eq("id", row.id);
    if (error) toast.error(friendlyError(error));
    else {
      toast.success("Tautan akun dilepas");
      void refresh();
    }
  };

  const handleTest = async (kind: Kind, row: Row) => {
    setTesting(row.id);
    try {
      const res = await sendTest({ data: { kind, id: row.id } });
      if (res.sent > 0) toast.success(res.message);
      else toast.warning(res.message);
    } catch (e: any) {
      toast.error(friendlyError(e));
    } finally {
      setTesting(null);
    }
  };

  const linkedCount = useMemo(
    () => rows.filter((r) => r.account_user_id).length,
    [rows],
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
              <div className="py-12 text-center text-sm text-muted-foreground">
                Memuat…
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                Belum ada {tab === "customer" ? "pelanggan" : "pemasok"}.
                Tambahkan lewat halaman terkait (mis. pesanan atau hutang
                piutang).
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
                        {r.account_user_id && (
                          <>
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

  useEffect(() => {
    if (!target) {
      setQ("");
      setResults([]);
    }
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const h = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_chat_contacts", {
        _q: q || "",
      });
      if (error) {
        toast.error(friendlyError(error));
        return;
      }
      setResults((data ?? []) as Contact[]);
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
    toast.success("Akun ditautkan");
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
            placeholder="Cari nama atau email…"
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
                        {c.display_name || c.email || c.user_id}
                      </span>
                      {c.email && c.display_name && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.email}
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