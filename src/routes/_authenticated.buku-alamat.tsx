import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
  ScanLine,
  Loader2,
  Merge,
} from "lucide-react";
import {
  Search as SearchIcon,
  Sparkles,
  Phone as PhoneIcon,
  Mail as MailIcon,
  ArrowUpDown,
  ArrowLeft,
} from "lucide-react";
import { QrScannerDialog } from "@/components/QrScannerDialog";
import {
  formatInviteCode,
  isLikelyInviteCode,
  normalizeInviteCode,
  resolveInviteCode,
  validateInviteCode,
  type InviteProfile,
} from "@/lib/invite";
import { notifyError } from "@/lib/friendly-error";
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
  findDuplicateGroups,
  normalizePhone,
  normalizeEmail,
  type AddressBookRow,
} from "@/lib/address-book";
import { MergeDuplicatesDialog } from "@/components/contacts/MergeDuplicatesDialog";
import { pickDeviceContacts, deviceContactsSupported } from "@/lib/device-contacts";
import { logAddressBookDuplicateBlock } from "@/lib/contact-telemetry";
import { findEditorDuplicate, type DuplicateHit } from "@/lib/address-book-duplicate";
import { notifyRlsRelogin } from "@/lib/rls-relogin";

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
type SortKey = "name" | "recent";

const numberFmt = new Intl.NumberFormat("id-ID");

function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function avatarTone(name: string): string {
  const tones = [
    "bg-primary/15 text-primary",
    "bg-success/15 text-success dark:text-success",
    "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    "bg-warning/15 text-warning dark:text-warning",
    "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300",
    "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return tones[Math.abs(h) % tones.length];
}

type StatTone = "primary" | "emerald" | "sky" | "amber" | "muted";
function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "muted",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: StatTone;
}) {
  const tones: Record<StatTone, string> = {
    primary: "from-primary/12 to-primary/5 text-primary",
    emerald: "from-success/12 to-success/5 text-success dark:text-success",
    sky: "from-sky-500/12 to-sky-500/5 text-sky-600 dark:text-sky-300",
    amber: "from-warning/12 to-warning/5 text-warning dark:text-warning",
    muted: "from-muted/50 to-muted/20 text-foreground",
  };
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-ms-3 shadow-sm">
      <div className="flex items-start gap-ms-2">
        <div
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${tones[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          {/* L10: label & angka bisa panjang (Total Kontak, angka ratusan) —
              truncate agar StatCard tidak overflow di 411px. */}
          <div className="truncate text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground" title={label}>
            {label}
          </div>
          <div className="mt-0.5 truncate text-ms-lg font-bold leading-tight tabular-nums" title={String(value)}>
            {typeof value === "number" ? numberFmt.format(value) : value}
          </div>
          {hint && <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground" title={hint}>{hint}</div>}
        </div>
      </div>
    </div>
  );
}

function BukuAlamatPage() {
  const [rows, setRows] = useState<AddressBookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [matching, setMatching] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [editing, setEditing] = useState<AddressBookRow | "new" | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
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
      notifyError(e);
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
      notifyError(e);
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
      notifyError(e);
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
      notifyError(e);
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
      notifyError(e);
    } finally {
      setChatting(null);
    }
  };

  const handlePromote = async (row: AddressBookRow, kind: "customer" | "supplier") => {
    try {
      if (kind === "customer") await promoteToCustomer(row);
      else await promoteToSupplier(row);
      toast.success(`${row.name} ditambahkan ke ${kind === "customer" ? "pelanggan" : "supplier"}.`);
    } catch (e) {
      const label = kind === "customer" ? "pelanggan" : "supplier";
      if (
        !notifyRlsRelogin(e, {
          message: `Gagal menambahkan ${label}.`,
          onRetry: () => handlePromote(row, kind),
        })
      ) {
        notifyError(e);
      }
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (filter === "linked" && !r.linked_user_id) return false;
      if (filter === "unlinked" && r.linked_user_id) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.phone_norm ?? "").includes(needle) ||
        (r.email_norm ?? "").includes(needle)
      );
    });
    const sorted = [...base];
    if (sort === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name, "id"));
    } else {
      sorted.sort((a, b) => {
        const ax = (a as unknown as { updated_at?: string; created_at?: string });
        const bx = (b as unknown as { updated_at?: string; created_at?: string });
        const at = ax.updated_at ?? ax.created_at ?? "";
        const bt = bx.updated_at ?? bx.created_at ?? "";
        return bt.localeCompare(at);
      });
    }
    return sorted;
  }, [rows, q, filter, sort]);

  const linkedCount = useMemo(() => rows.filter((r) => r.linked_user_id).length, [rows]);
  const dupGroups = useMemo(() => findDuplicateGroups(rows), [rows]);
  const deviceCount = useMemo(() => rows.filter((r) => r.source === "device").length, [rows]);
  const manualCount = useMemo(() => rows.filter((r) => r.source === "manual").length, [rows]);
  const linkedPct = rows.length ? Math.round((linkedCount / rows.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <header className="sticky top-0 z-10 border-b bg-card/85 backdrop-blur-md">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-ms-3 px-ms-4 py-ms-3 sm:px-ms-6">
          <Link
            to="/"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-background/60 hover:bg-accent"
            aria-label="Kembali"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-ms-base font-semibold leading-tight">Pelanggan &amp; Supplier</h1>
            <p className="truncate text-ms-2xs text-muted-foreground">
              Buku alamat &middot; {numberFmt.format(rows.length)} kontak
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => void runMatchOnLatest()}
            disabled={matching || rows.length === 0}
            title="Cocokkan ulang dengan akun terdaftar"
            aria-label="Cocokkan dengan akun terdaftar"
          >
            <RefreshCcw className={`mr-1 h-4 w-4 ${matching ? "animate-spin" : ""}`} />
            {matching ? "Mencocokkan…" : "Cocokkan"}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-ms-4 py-ms-4 sm:px-ms-6 sm:py-ms-6 space-ms-4 sm:space-ms-5">
        <section
          aria-label="Ringkasan kontak"
          className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/10 via-card to-card p-ms-4 shadow-sm"
        >
          <div className="flex items-center gap-ms-2">
            <span className="inline-flex items-center gap-ms-1 rounded-full bg-primary/12 px-ms-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3 w-3" /> CRM Ringkas
            </span>
            {rows.length > 0 && (
              <span className="text-ms-2xs text-muted-foreground">
                {linkedPct}% kontak sudah tertaut ke akun MCM
              </span>
            )}
          </div>
          <p className="mt-2 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
            Kelola pelanggan &amp; supplier Anda: impor dari HP, tautkan otomatis ke akun MCM, dan
            promosikan menjadi pelanggan atau supplier.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-ms-2 sm:grid-cols-4">
            <StatCard label="Total Kontak" value={rows.length} icon={ContactRound} tone="primary" />
            <StatCard
              label="Terdaftar"
              value={linkedCount}
              hint={rows.length ? `${linkedPct}% dari total` : undefined}
              icon={CheckCircle2}
              tone="emerald"
            />
            <StatCard label="Dari HP" value={deviceCount} icon={Smartphone} tone="sky" />
            <StatCard label="Manual" value={manualCount} icon={UserPlus} tone="amber" />
          </div>
        </section>

        <div className="grid grid-cols-2 gap-ms-2">
          <Button
            onClick={() => void handleImport()}
            disabled={importing || support === "unsupported"}
            className="h-11 rounded-xl"
            title={
              support === "unsupported"
                ? "Akses kontak hanya tersedia di aplikasi Android atau Chrome Android."
                : "Ambil kontak dari penyimpanan HP"
            }
          >
            <Smartphone className="mr-1.5 h-4 w-4" />
            {importing ? "Mengimpor…" : "Impor dari HP"}
          </Button>
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() => setEditing("new")}
          >
            <UserPlus className="mr-1.5 h-4 w-4" /> Tambah manual
          </Button>
        </div>
        {dupGroups.length > 0 && (
          <div className="flex items-center gap-ms-2 rounded-xl border border-warning/50 bg-warning/10 px-ms-3 py-ms-2">
            <p className="min-w-0 flex-1 text-ms-xs text-foreground">
              <span className="font-semibold">{dupGroups.length} grup kontak ganda</span> terdeteksi
              (nomor, email, atau nama sama).
            </p>
            <Button size="sm" className="h-9 shrink-0 rounded-lg" onClick={() => setMergeOpen(true)}>
              <Merge className="mr-1.5 h-4 w-4" /> Gabungkan
            </Button>
          </div>
        )}
        {support === "unsupported" && (
          <p className="rounded-xl border border-warning/50 bg-warning px-ms-3 py-ms-2 text-ms-xs text-warning dark:bg-warning/40 dark:text-warning">
            Akses kontak HP hanya tersedia di aplikasi Android MCM Storage, atau di Chrome Android
            (Contact Picker). Tambah manual tetap bisa di semua perangkat.
          </p>
        )}

        <div className="flex items-center gap-ms-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari nama, telepon, atau email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-11 rounded-xl pl-9"
              aria-label="Cari kontak"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-11 shrink-0 rounded-xl"
            onClick={() => setSort((s) => (s === "name" ? "recent" : "name"))}
            title="Urutkan"
            aria-label={`Urut: ${sort === "name" ? "Nama" : "Terbaru"}`}
          >
            <ArrowUpDown className="mr-1.5 h-4 w-4" />
            {sort === "name" ? "Nama" : "Terbaru"}
          </Button>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="grid w-full grid-cols-3 rounded-xl">
            <TabsTrigger value="all" className="rounded-lg">
              Semua <span className="ml-1 text-muted-foreground">({rows.length})</span>
            </TabsTrigger>
            <TabsTrigger value="linked" className="rounded-lg">
              Terdaftar <span className="ml-1 text-muted-foreground">({linkedCount})</span>
            </TabsTrigger>
            <TabsTrigger value="unlinked" className="rounded-lg">
              Belum <span className="ml-1 text-muted-foreground">({rows.length - linkedCount})</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={filter} className="mt-3">
            {loading ? (
              <ul className="space-ms-2" aria-busy="true" aria-live="polite">
                {Array.from({ length: 5 }).map((_, i) => (
                  <li key={i} className="rounded-2xl border bg-card p-ms-3">
                    <div className="flex items-start gap-ms-3">
                      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1 space-ms-2">
                        <Skeleton className="h-4 w-2/5" />
                        <Skeleton className="h-3 w-1/3" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-ms-3 rounded-2xl border border-dashed bg-card/40 py-12 text-center text-ms-sm text-muted-foreground">
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                  <ContactRound className="h-6 w-6" />
                </div>
                <p className="font-semibold text-foreground">
                  {q || filter !== "all" ? "Tidak ada kontak cocok" : "Belum ada kontak"}
                </p>
                <p className="mx-auto max-w-xs text-ms-xs leading-relaxed">
                  {q || filter !== "all" ? (
                    <>Coba ubah kata kunci atau ganti tab filter di atas.</>
                  ) : (
                    <>
                      Mulai dengan <span className="font-medium">Impor dari HP</span> atau tambah
                      satu per satu lewat <span className="font-medium">Tambah manual</span>.
                    </>
                  )}
                </p>
              </div>
            ) : (
              <ul className="space-ms-2">
                {filtered.map((r) => {
                  const sourceLabel =
                    r.source === "device" ? "HP" : r.source === "app" ? "App" : "Manual";
                  return (
                    <li
                      key={r.id}
                      className="group rounded-2xl border bg-card p-ms-3 text-ms-sm shadow-sm transition-colors hover:border-primary/30 hover:bg-card/80"
                    >
                      <div className="flex items-start gap-ms-3">
                        <div
                          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-ms-sm font-semibold ${avatarTone(
                            r.name,
                          )}`}
                          aria-hidden="true"
                        >
                          {initialsOf(r.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-ms-1.5">
                            <span className="min-w-0 truncate font-semibold text-foreground">
                              {r.name}
                            </span>
                            {r.linked_user_id && (
                              <span className="inline-flex items-center gap-ms-1 rounded-full bg-success px-1.5 py-0.5 text-ms-2xs font-medium text-success dark:bg-success/40 dark:text-success">
                                <CheckCircle2 className="h-3 w-3" /> Terdaftar
                              </span>
                            )}
                            <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-ms-2xs font-medium uppercase tracking-wide text-muted-foreground">
                              {sourceLabel}
                            </span>
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {r.phone && (
                              <div className="flex items-center gap-ms-1.5 truncate text-ms-xs text-muted-foreground">
                                <PhoneIcon className="h-3 w-3 shrink-0" />
                                <span className="truncate">{r.phone}</span>
                              </div>
                            )}
                            {r.email && (
                              <div className="flex items-center gap-ms-1.5 truncate text-ms-xs text-muted-foreground">
                                <MailIcon className="h-3 w-3 shrink-0" />
                                <span className="truncate">{r.email}</span>
                              </div>
                            )}
                            {r.note && (
                              <div className="mt-1 truncate text-ms-2xs italic text-muted-foreground">
                                “{r.note}”
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-ms-1.5 border-t pt-2.5">
                        {r.phone && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8 rounded-lg bg-wa/15 text-wa-strong hover:bg-wa/25"
                            onClick={() => void handleWa(r)}
                            aria-label={`Kirim pesan WA ke ${r.name}`}
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
                            className="h-8 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
                            aria-label={`Buka chat dengan ${r.name}`}
                          >
                            {chatting === r.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <MessageCircle className="mr-1 h-3.5 w-3.5" />
                            )}
                            Chat
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg"
                          onClick={() => void handlePromote(r, "customer")}
                          title="Tambahkan sebagai pelanggan"
                          aria-label={`Jadikan ${r.name} pelanggan`}
                        >
                          <Users2 className="mr-1 h-3.5 w-3.5" /> Pelanggan
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg"
                          onClick={() => void handlePromote(r, "supplier")}
                          title="Tambahkan sebagai supplier"
                          aria-label={`Jadikan ${r.name} supplier`}
                        >
                          <Truck className="mr-1 h-3.5 w-3.5" /> Supplier
                        </Button>
                        <div className="ml-auto flex items-center gap-ms-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 rounded-lg"
                            onClick={() => setEditing(r)}
                            aria-label={`Edit ${r.name}`}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void handleDelete(r)}
                            aria-label={`Hapus ${r.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <EditDialog
        target={editing}
        rows={rows}
        onClose={() => setEditing(null)}
        onOpenExisting={(r) => setEditing(r)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
      />

      <MergeDuplicatesDialog
        open={mergeOpen}
        rows={rows}
        onOpenChange={setMergeOpen}
        onMerged={async () => {
          await refresh();
        }}
      />
    </div>
  );
}

function EditDialog({
  target,
  rows,
  onClose,
  onOpenExisting,
  onSaved,
}: {
  target: AddressBookRow | "new" | null;
  rows: AddressBookRow[];
  onClose: () => void;
  onOpenExisting?: (row: AddressBookRow) => void;
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
  const [scanOpen, setScanOpen] = useState(false);
  const [pinPreview, setPinPreview] = useState<InviteProfile | null>(null);
  const [pinChecking, setPinChecking] = useState(false);
  // L13: sequence id agar response resolveInviteCode lama tidak menimpa
  // preview terbaru.
  const pinReqIdRef = useRef(0);

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

  // Debounced preview PIN — hanya di mode "tambah kontak baru".
  useEffect(() => {
    if (!isNew) {
      setPinPreview(null);
      setPinChecking(false);
      return;
    }
    const cleaned = normalizeInviteCode(pin);
    if (!isLikelyInviteCode(cleaned)) {
      setPinPreview(null);
      setPinChecking(false);
      return;
    }
    let cancelled = false;
    const myReq = ++pinReqIdRef.current;
    setPinChecking(true);
    const t = setTimeout(async () => {
      try {
        const p = await resolveInviteCode(cleaned);
        if (!cancelled && myReq === pinReqIdRef.current) setPinPreview(p);
      } catch {
        if (!cancelled && myReq === pinReqIdRef.current) setPinPreview(null);
      } finally {
        if (!cancelled && myReq === pinReqIdRef.current) setPinChecking(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [pin, isNew]);

  // Deteksi duplikat memakai normalisasi yang sama persis dengan database
  // (normalize_phone / normalize_email) supaya klien & server tidak beda hasil.
  const duplicate = useMemo(
    (): DuplicateHit | null =>
      findEditorDuplicate({ rows, currentId: row?.id ?? null, name, phone, email }),
    [rows, row?.id, name, phone, email],
  );

  const save = async () => {
    if (!name.trim()) {
      toast.error("Nama wajib diisi.");
      return;
    }
    let validatedPin = "";
    if (isNew) {
      const v = validateInviteCode(pin);
      if (!v.ok) {
        toast.error(v.reason);
        return;
      }
      validatedPin = v.code;
    }
    if (duplicate) {
      logAddressBookDuplicateBlock({ field: duplicate.field, isNew });
      toast.error(`${duplicate.label} sudah terdaftar`, {
        description: `${duplicate.reason}. Ubah data ini atau buka kontak yang sudah ada.`,
        ...(onOpenExisting
          ? {
              action: {
                label: "Buka kontak",
                onClick: () => onOpenExisting(duplicate.row),
              },
            }
          : {}),
      });
      return;
    }
    setBusy(true);
    try {
      let linkedName: string | null = null;
      let alreadyExisted = false;
      let pendingRequest = false;
      let alreadyFriends = false;
      if (isNew && validatedPin) {
        const { addContactByInviteCode } = await import("@/lib/invite");
        const res = await addContactByInviteCode(validatedPin);
        linkedName = res.displayName;
        alreadyExisted = res.alreadyExisted;
        pendingRequest = res.pending;
        alreadyFriends = res.alreadyFriends;
      }
      await upsertManualEntry({
        id: row?.id,
        name,
        phone: phone || null,
        email: email || null,
        note: note || null,
      });
      if (isNew) {
        const description = linkedName
          ? alreadyFriends
            ? `Berteman dengan ${linkedName}.`
            : pendingRequest
              ? `Permintaan pertemanan terkirim ke ${linkedName}. Chat aktif setelah diterima.`
              : `Tertaut ke akun: ${linkedName}`
          : undefined;
        toast.success(
          alreadyExisted && !pendingRequest
            ? "Kontak sudah ada, diperbarui"
            : "Kontak berhasil ditambahkan",
          description ? { description } : undefined,
        );
      } else {
        toast.success("Kontak berhasil diperbarui");
      }
      await onSaved();
    } catch (e) {
      notifyError(e);
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
              ? "Masukkan nama dan PIN undangan teman (8 karakter) atau pindai QR undangan."
              : "Simpan nama, nomor telepon, dan email."}
          </DialogDescription>
        </DialogHeader>
        {duplicate && (
          <div
            role="alert"
            className="space-y-ms-2 rounded-md border border-destructive/40 bg-destructive/10 px-ms-3 py-ms-2 text-ms-sm text-destructive"
          >
            <p className="font-medium">{duplicate.label} sudah terdaftar</p>
            <p className="text-ms-xs">
              {duplicate.reason}. Ubah {duplicate.label.toLowerCase()} ini atau buka kontak yang
              sudah ada.
            </p>
            {onOpenExisting && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onOpenExisting(duplicate.row)}
              >
                Buka kontak "{duplicate.row.name}"
              </Button>
            )}
          </div>
        )}
        <div className="space-ms-2">
          <Input
            autoFocus
            placeholder="Nama"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={duplicate?.field === "name"}
            className={duplicate?.field === "name" ? "border-destructive" : undefined}
          />
          {isNew ? (
            <>
              <div className="flex items-center gap-ms-2">
                <Input
                  inputMode="text"
                  autoCapitalize="characters"
                  placeholder="PIN undangan (XXXX-XXXX)"
                  value={pin}
                  onChange={(e) => {
                    const raw = normalizeInviteCode(e.target.value);
                    setPin(raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}` : raw);
                  }}
                  maxLength={12}
                  className="font-mono tracking-widest"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Pindai QR undangan"
                  onClick={() => setScanOpen(true)}
                >
                  <ScanLine className="h-4 w-4" />
                </Button>
              </div>
              <div className="rounded-lg border p-ms-2 text-ms-xs">
                {!isLikelyInviteCode(normalizeInviteCode(pin)) ? (
                  <p className="text-muted-foreground">
                    Ketik PIN 8 karakter atau tekan ikon kamera untuk memindai QR.
                  </p>
                ) : pinChecking ? (
                  <p className="flex items-center gap-ms-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memeriksa PIN…
                  </p>
                ) : pinPreview ? (
                  <p className="text-success">
                    Tertaut ke:{" "}
                    <span className="font-medium">{pinPreview.display_name || "Pengguna MCM"}</span>
                    {" · "}PIN {formatInviteCode(pinPreview.invite_code)}
                  </p>
                ) : (
                  <p className="text-warning">
                    PIN tidak ditemukan. Periksa lagi kode dari teman.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <Input
                type="tel"
                inputMode="tel"
                placeholder="Nomor telepon (mis. 0812…)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={duplicate?.field === "phone"}
                className={duplicate?.field === "phone" ? "border-destructive" : undefined}
              />
              <Input
                type="email"
                inputMode="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={duplicate?.field === "email"}
                className={duplicate?.field === "email" ? "border-destructive" : undefined}
              />
            </>
          )}
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
          <Button onClick={() => void save()} disabled={busy || !!duplicate}>
            {busy ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
      {isNew && (
        <QrScannerDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          title="Pindai QR undangan"
          description="Arahkan kamera ke QR undangan teman untuk mengisi PIN otomatis."
          onResult={(text) => {
            const trimmed = (text ?? "").trim();
            try {
              const u = new URL(trimmed);
              const m = u.pathname.match(/\/i\/([^/?#]+)/);
              if (m) {
                const code = normalizeInviteCode(decodeURIComponent(m[1]));
                if (isLikelyInviteCode(code)) {
                  setPin(formatInviteCode(code));
                  toast.success("PIN terisi dari QR.");
                  return;
                }
              }
            } catch {
              /* not a URL */
            }
            const code = normalizeInviteCode(trimmed);
            if (isLikelyInviteCode(code)) {
              setPin(formatInviteCode(code));
              toast.success("PIN terisi dari QR.");
              return;
            }
            toast.error("QR bukan undangan MCM yang dikenali.");
          }}
        />
      )}
    </Dialog>
  );
}
