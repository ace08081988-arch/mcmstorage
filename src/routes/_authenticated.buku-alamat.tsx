import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Smartphone,
  UserPlus,
  Users2,
  Truck,
  MessageCircle,
  RefreshCcw,
  Trash2,
  ContactRound,
  CheckCircle2,
} from "lucide-react";
import { friendlyError } from "@/lib/friendly-error";
import { confirm } from "@/lib/confirm";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { useStartDm } from "@/lib/chat";
import {
  fetchAddressBook,
  deleteAddressBookEntry,
  upsertManualEntry,
  importDeviceContacts,
  matchAgainstProfiles,
  applyProfileMatches,
  promoteToCustomer,
  promoteToSupplier,
  type AddressBookRow,
} from "@/lib/address-book";
import {
  pickDeviceContacts,
  deviceContactsSupported,
} from "@/lib/device-contacts";

export const Route = createFileRoute("/_authenticated/buku-alamat")({
  head: () => ({
    meta: [
      { title: "Buku Alamat · MCM Storage" },
      {
        name: "description",
        content:
          "Sinkronkan kontak dari penyimpanan HP, kelola nomor telepon dan email, dan temukan akun yang sudah terdaftar.",
      },
    ],
  }),
  component: BukuAlamatPage,
});

type Filter = "all" | "linked" | "unlinked";

function BukuAlamatPage() {
  const [rows, setRows] = useState<AddressBookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<AddressBookRow | "new" | null>(null);
  const navigate = useNavigate();
  const startDm = useStartDm();
  const [chatting, setChatting] = useState<string | null>(null);
  const support = useMemo(
    () => (typeof window === "undefined" ? "unsupported" : deviceContactsSupported()),
    [],
  );

  const refresh = async () => {
    setLoading(true);
    try {
      setRows(await fetchAddressBook());
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const handleImport = async () => {
    setImporting(true);
    try {
      const picked = await pickDeviceContacts();
      if (picked.length === 0) {
        toast.info("Tidak ada kontak yang dipilih.");
        return;
      }
      const { inserted } = await importDeviceContacts(picked);
      toast.success(`${inserted} kontak diimpor dari perangkat.`);
      await refresh();
      // Auto-match against profiles after import
      void runMatchOnLatest();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setImporting(false);
    }
  };

  const runMatchOnLatest = async () => {
    setMatching(true);
    try {
      const latest = await fetchAddressBook();
      const matches = await matchAgainstProfiles(latest);
      const updated = await applyProfileMatches(latest, matches);
      if (updated > 0) {
        toast.success(`${updated} kontak otomatis ditautkan ke akun terdaftar.`);
        await refresh();
      } else {
        toast.info("Tidak ada kecocokan baru dengan akun terdaftar.");
      }
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setMatching(false);
    }
  };

  const handleDelete = async (row: AddressBookRow) => {
    if (
      !(await confirm({
        title: "Hapus kontak?",
        description: `${row.name} akan dihapus dari buku alamat.`,
        confirmText: "Hapus",
        destructive: true,
      }))
    )
      return;
    try {
      await deleteAddressBookEntry(row.id);
      toast.success("Kontak dihapus");
      setRows((rs) => rs.filter((r) => r.id !== row.id));
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const handleWa = async (row: AddressBookRow) => {
    const text = `Halo ${row.name},`;
    const phone = row.phone_norm || row.phone?.replace(/\D/g, "") || undefined;
    if (!phone) {
      toast.error("Kontak ini tidak punya nomor telepon.");
      return;
    }
    const res = await shareToWhatsApp({ text, title: row.name, phone });
    notifyShareResult(res);
  };

  const handleChat = async (row: AddressBookRow) => {
    if (!row.linked_user_id) {
      toast.error("Akun terdaftar belum ditautkan untuk kontak ini.");
      return;
    }
    setChatting(row.id);
    try {
      const cid = await startDm.mutateAsync(row.linked_user_id);
      if (!cid) throw new Error("Tidak menerima ID percakapan");
      navigate({ to: "/chat/$conversationId", params: { conversationId: cid } });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setChatting(null);
    }
  };

  const handlePromote = async (row: AddressBookRow, kind: "customer" | "supplier") => {
    try {
      if (kind === "customer") await promoteToCustomer(row);
      else await promoteToSupplier(row);
      toast.success(
        `${row.name} ditambahkan ke ${kind === "customer" ? "pelanggan" : "pemasok"}.`,
      );
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "linked" && !r.linked_user_id) return false;
      if (filter === "unlinked" && r.linked_user_id) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.phone_norm ?? "").includes(needle) ||
        (r.email_norm ?? "").includes(needle)
      );
    });
  }, [rows, q, filter]);

  const linkedCount = useMemo(() => rows.filter((r) => r.linked_user_id).length, [rows]);

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
          <h1 className="flex-1 truncate text-base font-semibold">Buku Alamat</h1>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void runMatchOnLatest()}
            disabled={matching || rows.length === 0}
            title="Cocokkan ulang dengan akun terdaftar"
          >
            <RefreshCcw className="mr-1 h-4 w-4" />
            {matching ? "Mencocokkan…" : "Cocokkan"}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 px-3 py-4 sm:px-6">
        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={() => void handleImport()}
            disabled={importing || support === "unsupported"}
            title={
              support === "unsupported"
                ? "Akses kontak hanya tersedia di aplikasi Android atau Chrome Android."
                : "Ambil kontak dari penyimpanan HP"
            }
          >
            <Smartphone className="mr-1 h-4 w-4" />
            {importing ? "Mengimpor…" : "Impor dari HP"}
          </Button>
          <Button variant="outline" onClick={() => setEditing("new")}>
            <UserPlus className="mr-1 h-4 w-4" /> Tambah manual
          </Button>
        </div>
        {support === "unsupported" && (
          <p className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Akses kontak HP hanya tersedia di aplikasi Android MCM Storage, atau di Chrome
            Android (Contact Picker). Tambah manual tetap bisa di semua perangkat.
          </p>
        )}

        <div className="flex items-center gap-2">
          <Input
            placeholder="Cari nama, telepon, atau email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all">Semua ({rows.length})</TabsTrigger>
            <TabsTrigger value="linked">Terdaftar ({linkedCount})</TabsTrigger>
            <TabsTrigger value="unlinked">Belum ({rows.length - linkedCount})</TabsTrigger>
          </TabsList>

          <TabsContent value={filter} className="mt-3">
            {loading ? (
              <ul className="space-y-2" aria-busy="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="rounded-lg border bg-card p-3">
                    <Skeleton className="h-4 w-2/5" />
                    <Skeleton className="mt-2 h-3 w-1/3" />
                  </li>
                ))}
              </ul>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ContactRound className="h-5 w-5" />
                </div>
                <p className="font-medium text-foreground">Belum ada kontak</p>
                <p className="mx-auto max-w-xs text-xs">
                  Mulai dengan <span className="font-medium">Impor dari HP</span> atau tambah
                  satu per satu lewat <span className="font-medium">Tambah manual</span>.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {filtered.map((r) => (
                  <li key={r.id} className="rounded-lg border bg-card p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{r.name}</span>
                          {r.linked_user_id && (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                              <CheckCircle2 className="h-3 w-3" /> Akun terdaftar
                            </span>
                          )}
                          <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {r.source === "device"
                              ? "HP"
                              : r.source === "app"
                                ? "App"
                                : "Manual"}
                          </span>
                        </div>
                        {r.phone && (
                          <div className="truncate text-xs text-muted-foreground">
                            📱 {r.phone}
                          </div>
                        )}
                        {r.email && (
                          <div className="truncate text-xs text-muted-foreground">
                            ✉️ {r.email}
                          </div>
                        )}
                        {r.note && (
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                            {r.note}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        {r.phone && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="bg-[#25D366]/15 text-[#1ea952] hover:bg-[#25D366]/25"
                            onClick={() => void handleWa(r)}
                          >
                            MCM
                          </Button>
                        )}
                        {r.linked_user_id && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={chatting === r.id}
                            onClick={() => void handleChat(r)}
                            className="bg-primary/10 text-primary hover:bg-primary/20"
                          >
                            <MessageCircle className="mr-1 h-3.5 w-3.5" /> Chat
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handlePromote(r, "customer")}
                          title="Tambahkan sebagai pelanggan"
                        >
                          <Users2 className="mr-1 h-3.5 w-3.5" /> Pelanggan
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handlePromote(r, "supplier")}
                          title="Tambahkan sebagai pemasok"
                        >
                          <Truck className="mr-1 h-3.5 w-3.5" /> Pemasok
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing(r)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void handleDelete(r)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      <EditDialog
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
      />
    </div>
  );
}

function EditDialog({
  target,
  onClose,
  onSaved,
}: {
  target: AddressBookRow | "new" | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const isNew = target === "new";
  const row = !isNew && target ? target : null;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) {
      setName("");
      setPhone("");
      setEmail("");
      setNote("");
      setPin("");
    } else if (row) {
      setName(row.name);
      setPhone(row.phone ?? "");
      setEmail(row.email ?? "");
      setNote(row.note ?? "");
      setPin("");
    }
  }, [target]);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Nama wajib diisi.");
      return;
    }
    setBusy(true);
    try {
      if (isNew && pin.trim()) {
        const { addContactByInviteCode } = await import("@/lib/invite");
        await addContactByInviteCode(pin.trim());
      }
      await upsertManualEntry({
        id: row?.id,
        name,
        phone: phone || null,
        email: email || null,
        note: note || null,
      });
      toast.success(isNew ? "Kontak ditambahkan" : "Kontak diperbarui");
      await onSaved();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "Tambah kontak" : "Edit kontak"}</DialogTitle>
          <DialogDescription>
            {isNew
              ? "Masukkan nama dan PIN undangan teman untuk menautkan akun terdaftar. Nomor telepon & email opsional."
              : "Simpan nama, nomor telepon, dan email."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            autoFocus
            placeholder="Nama"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {isNew && (
            <Input
              inputMode="text"
              autoCapitalize="characters"
              placeholder="PIN undangan (8 karakter)"
              value={pin}
              onChange={(e) => setPin(e.target.value.toUpperCase())}
              maxLength={12}
            />
          )}
          <Input
            type="tel"
            inputMode="tel"
            placeholder={isNew ? "Nomor telepon (opsional)" : "Nomor telepon (mis. 0812…)"}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Input
            type="email"
            inputMode="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            placeholder="Catatan (opsional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}