import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Merge, Loader2, ChevronRight } from "lucide-react";
import { notifyError } from "@/lib/friendly-error";
import {
  findDuplicateGroups,
  mergeContacts,
  type AddressBookRow,
  type DuplicateGroup,
} from "@/lib/address-book";

type FieldKey = "name" | "phone" | "email" | "note";

const FIELD_LABEL: Record<FieldKey, string> = {
  name: "Nama",
  phone: "Telepon",
  email: "Email",
  note: "Catatan",
};

function reasonLabel(g: DuplicateGroup): string {
  if (g.reason === "phone") return "Nomor sama";
  if (g.reason === "email") return "Email sama";
  return "Nama sama";
}

function OptionRow({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-ms-2 rounded-xl border px-ms-3 py-ms-2 text-left transition ${
        active ? "border-primary bg-primary/10" : "bg-card hover:bg-accent"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          active ? "border-primary" : "border-muted-foreground/40"
        }`}
      >
        {active && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ms-sm">{label}</span>
        {hint && <span className="block truncate text-ms-2xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}

export function MergeDuplicatesDialog({
  open,
  rows,
  onOpenChange,
  onMerged,
}: {
  open: boolean;
  rows: AddressBookRow[];
  onOpenChange: (v: boolean) => void;
  onMerged: () => void | Promise<void>;
}) {
  const groups = useMemo(() => findDuplicateGroups(rows), [rows]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<FieldKey, string | null>>({
    name: null,
    phone: null,
    email: null,
    note: null,
  });
  const [busy, setBusy] = useState(false);

  const group = groups.find((g) => g.key === activeKey) ?? null;

  useEffect(() => {
    if (!open) {
      setActiveKey(null);
      setBusy(false);
    }
  }, [open]);

  // Saat memilih grup / grup berubah, isi pilihan default dari nilai pertama
  // yang tidak kosong.
  useEffect(() => {
    if (!group) return;
    const first = (k: FieldKey) =>
      group.rows.map((r) => (r[k] ?? "").toString().trim()).find((v) => v) ?? null;
    setKeepId(group.rows.find((r) => r.linked_user_id)?.id ?? group.rows[0]!.id);
    setPicked({ name: first("name"), phone: first("phone"), email: first("email"), note: first("note") });
  }, [activeKey]);

  const optionsFor = (k: FieldKey): string[] => {
    if (!group) return [];
    const set = new Set<string>();
    for (const r of group.rows) {
      const v = (r[k] ?? "").toString().trim();
      if (v) set.add(v);
    }
    return Array.from(set);
  };

  const handleMerge = async () => {
    if (!group || !keepId) return;
    setBusy(true);
    try {
      const linked =
        group.rows.find((r) => r.id === keepId)?.linked_user_id ??
        group.rows.find((r) => r.linked_user_id)?.linked_user_id ??
        null;
      await mergeContacts({
        keepId,
        removeIds: group.rows.filter((r) => r.id !== keepId).map((r) => r.id),
        fields: {
          name: picked.name || group.rows[0]!.name,
          phone: picked.phone,
          email: picked.email,
          note: picked.note,
          linked_user_id: linked,
        },
      });
      toast.success(`${group.rows.length} kontak digabung menjadi satu.`);
      setActiveKey(null);
      await onMerged();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] gap-ms-3 overflow-y-auto sm:max-w-lg">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="flex items-center gap-ms-2 text-ms-base">
            <Merge className="h-4 w-4 text-primary" /> Gabungkan kontak ganda
          </DialogTitle>
          <DialogDescription className="text-ms-xs">
            {group
              ? "Pilih data mana yang ingin dipertahankan. Kontak lain di grup ini akan dihapus."
              : `${groups.length} grup kontak ganda terdeteksi dari nomor, email, atau nama yang sama.`}
          </DialogDescription>
        </DialogHeader>

        {!group ? (
          groups.length === 0 ? (
            <p className="rounded-xl border bg-muted/40 px-ms-3 py-ms-4 text-center text-ms-sm text-muted-foreground">
              Tidak ada kontak ganda. Buku alamat Anda sudah bersih.
            </p>
          ) : (
            <ul className="space-ms-2">
              {groups.map((g) => (
                <li key={g.key}>
                  <button
                    type="button"
                    onClick={() => setActiveKey(g.key)}
                    className="flex w-full items-center gap-ms-2 rounded-xl border bg-card px-ms-3 py-ms-2 text-left hover:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ms-sm font-medium">
                        {g.rows.map((r) => r.name).join(" · ")}
                      </div>
                      <div className="truncate text-ms-2xs text-muted-foreground">
                        {g.rows[0]?.phone || g.rows[0]?.email || "Tanpa nomor/email"}
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {g.rows.length}× · {reasonLabel(g)}
                    </Badge>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="space-ms-3">
            <div>
              <div className="mb-1 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Kontak utama (disimpan)
              </div>
              <div className="space-ms-1.5">
                {group.rows.map((r) => (
                  <OptionRow
                    key={r.id}
                    active={keepId === r.id}
                    label={r.name}
                    hint={[
                      r.phone ?? r.email ?? "tanpa kontak",
                      r.source === "device" ? "dari HP" : r.source === "app" ? "aplikasi" : "manual",
                      r.linked_user_id ? "tertaut akun" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    onClick={() => setKeepId(r.id)}
                  />
                ))}
              </div>
            </div>

            {(["name", "phone", "email", "note"] as FieldKey[]).map((k) => {
              const opts = optionsFor(k);
              if (opts.length === 0) return null;
              return (
                <div key={k}>
                  <div className="mb-1 text-ms-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {FIELD_LABEL[k]}
                  </div>
                  <div className="space-ms-1.5">
                    {opts.map((v) => (
                      <OptionRow
                        key={v}
                        active={picked[k] === v}
                        label={v}
                        onClick={() => setPicked((p) => ({ ...p, [k]: v }))}
                      />
                    ))}
                    {k !== "name" && (
                      <OptionRow
                        active={picked[k] === null}
                        label="Kosongkan"
                        onClick={() => setPicked((p) => ({ ...p, [k]: null }))}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-ms-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => (group ? setActiveKey(null) : onOpenChange(false))}
            disabled={busy}
          >
            {group ? "Kembali" : "Tutup"}
          </Button>
          {group && (
            <Button onClick={() => void handleMerge()} disabled={busy || !keepId}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Merge className="mr-1.5 h-4 w-4" />}
              Gabungkan {group.rows.length} kontak
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}