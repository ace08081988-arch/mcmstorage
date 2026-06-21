import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { publicTaskUrl } from "@/lib/prep";
import { confirm as confirmDialog } from "@/lib/confirm";
import { buildWhatsAppUrl } from "@/lib/share-wa";
import {
  Users, Plus, Pencil, Archive, ArchiveRestore, ChevronLeft, RefreshCw, Search,
  Phone, ExternalLink, Copy, Link2, ClipboardList, Image as ImageIcon, MapPin, X,
  CheckCircle2, Clock, CircleSlash, Trash2, Send, Info,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/manajemen-pegawai")({
  head: () => ({
    meta: [
      { title: "Manajemen Pegawai · MCM Storage" },
      { name: "description", content: "Kelola pegawai, buat link tugas, dan pantau status pengiriman dari satu tempat." },
    ],
  }),
  component: ManajemenPegawaiPage,
});

type Employee = {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  note: string | null;
  archived_at: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  title: string;
  note: string | null;
  share_token: string;
  status: string;
  expires_at: string;
  created_at: string;
  employee_id: string | null;
};

type TaskItem = {
  id: string;
  task_id: string;
  name_snapshot: string;
  qty_requested: number;
  qty_prepared: number;
  unit_label: string | null;
};

type Submission = {
  id: string;
  task_id: string;
  task_item_id: string;
  photo_path: string | null;
  location_url: string | null;
  note: string | null;
  submitted_at: string;
};

function taskAvailability(t: TaskRow, now: number): "active" | "expired" | "done" | "cancelled" {
  if (t.status === "cancelled") return "cancelled";
  if (t.status === "done") return "done";
  if (new Date(t.expires_at).getTime() <= now) return "expired";
  return "active";
}

const AVAIL_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: "Aktif", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30" },
  expired: { label: "Kedaluwarsa", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/30" },
  done: { label: "Selesai", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-400 ring-sky-500/30" },
  cancelled: { label: "Dibatalkan", cls: "bg-muted text-muted-foreground ring-border" },
};

function ManajemenPegawaiPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [openForm, setOpenForm] = useState<Employee | "new" | null>(null);
  const [openDetail, setOpenDetail] = useState<Employee | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const reload = useCallback(async () => {
    if (!uid) return;
    setBusy(true);
    const [{ data: emps, error: e1 }, { data: ts, error: e2 }] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)("employees")
        .select("id,user_id,name,phone,note,archived_at,created_at")
        .order("name"),
      supabase
        .from("prep_tasks")
        .select("id,title,note,share_token,status,expires_at,created_at,employee_id")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    setBusy(false);
    if (e1) toast.error("Gagal memuat pegawai: " + e1.message);
    if (e2) toast.error("Gagal memuat tugas: " + e2.message);
    setEmployees((emps ?? []) as Employee[]);
    setTasks((ts ?? []) as TaskRow[]);
  }, [uid]);
  useEffect(() => { void reload(); }, [reload]);

  const tasksByEmployee = useMemo(() => {
    const m = new Map<string | null, TaskRow[]>();
    for (const t of tasks) {
      const k = t.employee_id;
      const arr = m.get(k) ?? [];
      arr.push(t);
      m.set(k, arr);
    }
    return m;
  }, [tasks]);

  const filteredEmployees = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employees
      .filter((e) => showArchived ? true : !e.archived_at)
      .filter((e) => !needle ||
        e.name.toLowerCase().includes(needle) ||
        (e.phone ?? "").toLowerCase().includes(needle) ||
        (e.note ?? "").toLowerCase().includes(needle));
  }, [employees, q, showArchived]);

  const unassignedTasks = tasksByEmployee.get(null) ?? [];

  // Normalisasi nomor WA → digit-only E.164 (tanpa "+").
  // 0xxx → 62xxx, 00xxx → xxx, lainnya: hanya digit.
  function normalizeWaDigits(raw: string | null | undefined): string {
    let d = (raw ?? "").replace(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = "62" + d.slice(1);
    if (d.length < 8 || d.length > 15) return "";
    return d;
  }

  function buildPrepMessage(empName: string, task: TaskRow): string {
    const url = publicTaskUrl(task.share_token);
    const lines: string[] = [];
    lines.push(`Halo ${empName}, berikut link penyiapan untukmu:`);
    lines.push("");
    lines.push(`*${task.title}*`);
    if (task.note && task.note.trim()) {
      lines.push("");
      lines.push(`Instruksi: ${task.note.trim()}`);
    }
    lines.push("");
    lines.push("Langkah penyiapan:");
    lines.push("1. Buka link di bawah ini.");
    lines.push("2. Isi jumlah aktual tiap produk.");
    lines.push("3. Lampirkan foto bukti + bagikan lokasi.");
    lines.push("4. Tekan Kirim untuk menyelesaikan.");
    lines.push("");
    lines.push(url);
    return lines.join("\n");
  }

  function sendPrepToWa(emp: Employee, task: TaskRow) {
    const phone = normalizeWaDigits(emp.phone);
    if (!phone) {
      toast.error("Nomor WA pegawai belum valid. Edit pegawai untuk mengisi nomor.");
      return;
    }
    const url = buildWhatsAppUrl(buildPrepMessage(emp.name, task), phone);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      toast.error("Popup diblokir browser. Izinkan popup lalu coba lagi.");
      return;
    }
    toast.success(`Link penyiapan dikirim ke WA ${emp.name}`);
  }

  async function archiveEmployee(emp: Employee) {
    const ok = await confirmDialog({
      title: emp.archived_at ? "Pulihkan pegawai?" : "Arsipkan pegawai?",
      description: emp.archived_at
        ? `${emp.name} akan kembali muncul di daftar aktif.`
        : `${emp.name} akan disembunyikan dari daftar utama. Tugas yang sudah dibuat tetap ada.`,
      confirmText: emp.archived_at ? "Pulihkan" : "Arsipkan",
    });
    if (!ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("employees")
      .update({ archived_at: emp.archived_at ? null : new Date().toISOString() })
      .eq("id", emp.id);
    if (error) return toast.error(error.message);
    toast.success(emp.archived_at ? "Pegawai dipulihkan" : "Pegawai diarsipkan");
    void reload();
  }

  async function deleteEmployee(emp: Employee) {
    const ok = await confirmDialog({
      title: "Hapus pegawai?",
      description: `Pegawai "${emp.name}" akan dihapus permanen. Tugas yang sudah dibuat tetap ada (hanya kehilangan tautan ke pegawai).`,
      confirmText: "Hapus",
      destructive: true,
    });
    if (!ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("employees").delete().eq("id", emp.id);
    if (error) return toast.error(error.message);
    toast.success("Pegawai dihapus");
    void reload();
  }

  return (
    <div className="mx-auto max-w-5xl px-3 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link to="/" className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:bg-muted">
          <ChevronLeft className="h-3.5 w-3.5" /> Beranda
        </Link>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h1 className="text-base font-semibold">Manajemen Pegawai</h1>
        </div>
        <button
          onClick={() => void reload()}
          disabled={busy}
          className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Muat ulang
        </button>
        <button
          onClick={() => setOpenForm("new")}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" /> Pegawai baru
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground" data-compact-hide>
        Kelola data pegawai, buat link tugas, dan pantau riwayat pengiriman foto/lokasi dari setiap pegawai.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama, no. HP, atau catatan…"
            className="h-9 w-full rounded-md border bg-background pl-7 pr-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>
        <label className="inline-flex h-9 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Tampilkan yang diarsipkan
        </label>
      </div>

      {unassignedTasks.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs" data-compact-hide>
          <div className="font-medium text-amber-700 dark:text-amber-400">
            {unassignedTasks.length} tugas belum tertaut ke pegawai
          </div>
          <div className="mt-0.5 text-muted-foreground">
            Tautan ada di kartu pegawai (tombol “Tautkan tugas lama”) atau buka{" "}
            <Link to="/link-pegawai" className="underline">daftar link</Link>.
          </div>
        </div>
      )}

      {filteredEmployees.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {employees.length === 0
            ? "Belum ada pegawai. Klik “Pegawai baru” untuk menambahkan."
            : "Tidak ada pegawai yang cocok dengan pencarian."}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {filteredEmployees.map((emp) => {
            const empTasks = tasksByEmployee.get(emp.id) ?? [];
            const counts = empTasks.reduce(
              (acc, t) => {
                const a = taskAvailability(t, now);
                acc[a]++;
                return acc;
              },
              { active: 0, expired: 0, done: 0, cancelled: 0 } as Record<string, number>,
            );
            const lastTask = empTasks[0];
            // Tugas aktif terbaru — diutamakan untuk tombol Kirim WA.
            const activeTask =
              empTasks.find((t) => taskAvailability(t, now) === "active") ?? lastTask;
            const hasPhone = !!normalizeWaDigits(emp.phone);
            return (
              <div
                key={emp.id}
                className={`rounded-lg border bg-card p-3 text-sm shadow-sm transition hover:border-primary/40 ${
                  emp.archived_at ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => setOpenDetail(emp)}
                    className="flex-1 text-left"
                  >
                    <div className="font-medium leading-tight">
                      {emp.name}
                      {emp.archived_at && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          arsip
                        </span>
                      )}
                    </div>
                    {emp.phone && (
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" /> {emp.phone}
                      </div>
                    )}
                    {emp.note && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{emp.note}</div>
                    )}
                  </button>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => setOpenForm(emp)}
                      title="Edit pegawai"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => void archiveEmployee(emp)}
                      title={emp.archived_at ? "Pulihkan" : "Arsipkan"}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
                    >
                      {emp.archived_at ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="rounded-md bg-muted px-1.5 py-0.5">
                    {empTasks.length} tugas
                  </span>
                  {counts.active > 0 && (
                    <span className={`rounded-md px-1.5 py-0.5 ring-1 ${AVAIL_BADGE.active.cls}`}>
                      <CheckCircle2 className="mr-0.5 inline h-3 w-3" /> {counts.active} aktif
                    </span>
                  )}
                  {counts.expired > 0 && (
                    <span className={`rounded-md px-1.5 py-0.5 ring-1 ${AVAIL_BADGE.expired.cls}`} data-compact-hide>
                      <Clock className="mr-0.5 inline h-3 w-3" /> {counts.expired} expired
                    </span>
                  )}
                  {counts.done > 0 && (
                    <span className={`rounded-md px-1.5 py-0.5 ring-1 ${AVAIL_BADGE.done.cls}`} data-compact-hide>
                      {counts.done} selesai
                    </span>
                  )}
                  {counts.cancelled > 0 && (
                    <span className={`rounded-md px-1.5 py-0.5 ring-1 ${AVAIL_BADGE.cancelled.cls}`} data-compact-hide>
                      <CircleSlash className="mr-0.5 inline h-3 w-3" /> {counts.cancelled} batal
                    </span>
                  )}
                </div>

                {lastTask && (
                  <div className="mt-2 truncate border-t pt-2 text-[11px] text-muted-foreground" data-compact-hide>
                    Terakhir: <span className="font-medium text-foreground">{lastTask.title}</span> ·{" "}
                    {new Date(lastTask.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                  </div>
                )}

                {activeTask && (
                  <div className="mt-2 space-y-1.5 rounded-md border bg-muted/30 p-2 text-[11px]">
                    <div className="flex items-center gap-1 font-medium text-foreground">
                      <Link2 className="h-3 w-3 text-primary" />
                      Penyiapan: <span className="truncate">{activeTask.title}</span>
                    </div>
                    <div className="flex items-start gap-1 text-muted-foreground">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="leading-snug">
                        Pegawai membuka link → isi jumlah aktual → foto bukti + lokasi → kirim.
                      </span>
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {publicTaskUrl(activeTask.share_token)}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      <button
                        onClick={() => {
                          navigator.clipboard
                            .writeText(publicTaskUrl(activeTask.share_token))
                            .then(() => toast.success("Link disalin"))
                            .catch(() => toast.error("Gagal menyalin"));
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[11px] hover:bg-muted"
                      >
                        <Copy className="h-3 w-3" /> Salin
                      </button>
                      <a
                        href={publicTaskUrl(activeTask.share_token)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[11px] hover:bg-muted"
                      >
                        <ExternalLink className="h-3 w-3" /> Buka
                      </a>
                      <button
                        onClick={() => sendPrepToWa(emp, activeTask)}
                        disabled={!hasPhone}
                        title={hasPhone ? `Kirim ke WA ${emp.phone}` : "Nomor WA pegawai belum valid"}
                        className="ml-auto inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        <Send className="h-3 w-3" /> Kirim WA
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openForm && (
        <EmployeeFormDialog
          employee={openForm === "new" ? null : openForm}
          uid={uid}
          onClose={() => setOpenForm(null)}
          onSaved={() => { setOpenForm(null); void reload(); }}
          onDelete={openForm === "new" ? undefined : () => { void deleteEmployee(openForm); setOpenForm(null); }}
        />
      )}

      {openDetail && (
        <EmployeeDetailDialog
          employee={openDetail}
          tasks={tasksByEmployee.get(openDetail.id) ?? []}
          unassignedTasks={unassignedTasks}
          now={now}
          onClose={() => setOpenDetail(null)}
          onChanged={() => void reload()}
        />
      )}
    </div>
  );
}

// ---------- Employee form ----------
function EmployeeFormDialog({
  employee, uid, onClose, onSaved, onDelete,
}: {
  employee: Employee | null;
  uid: string | null;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(employee?.name ?? "");
  const [phone, setPhone] = useState(employee?.phone ?? "");
  const [note, setNote] = useState(employee?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return toast.error("Nama wajib diisi");
    if (!uid) return toast.error("Sesi tidak ditemukan, muat ulang halaman");
    setBusy(true);
    const payload = {
      name: name.trim(),
      phone: phone.trim() || null,
      note: note.trim() || null,
    };
    let error;
    if (employee) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ error } = await (supabase.from as any)("employees").update(payload).eq("id", employee.id));
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ error } = await (supabase.from as any)("employees").insert({ ...payload, user_id: uid }));
    }
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(employee ? "Pegawai diperbarui" : "Pegawai ditambahkan");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border bg-background p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{employee ? "Edit pegawai" : "Pegawai baru"}</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nama *</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Nama pegawai"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">No. HP / WhatsApp</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm focus:border-primary focus:outline-none"
              placeholder="08xxxxxxxxxx"
              inputMode="tel"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Catatan</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
              placeholder="Catatan internal (opsional)"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          {onDelete && (
            <button
              onClick={onDelete}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-destructive/40 px-2 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Hapus
            </button>
          )}
          <button onClick={onClose} className="ml-auto inline-flex h-9 items-center rounded-md border px-3 text-sm hover:bg-muted">
            Batal
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Employee detail ----------
function EmployeeDetailDialog({
  employee, tasks, unassignedTasks, now, onClose, onChanged,
}: {
  employee: Employee;
  tasks: TaskRow[];
  unassignedTasks: TaskRow[];
  now: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);

  useEffect(() => {
    const ids = tasks.map((t) => t.id);
    if (ids.length === 0) { setItems([]); setSubmissions([]); setLoading(false); return; }
    setLoading(true);
    Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)("prep_task_items")
        .select("id,task_id,name_snapshot,qty_requested,qty_prepared,unit_label")
        .in("task_id", ids),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)("prep_submissions")
        .select("id,task_id,task_item_id,photo_path,location_url,note,submitted_at")
        .in("task_id", ids)
        .order("submitted_at", { ascending: false })
        .limit(100),
    ]).then(([a, b]) => {
      setItems((a.data ?? []) as TaskItem[]);
      setSubmissions((b.data ?? []) as Submission[]);
      setLoading(false);
    });
  }, [tasks]);

  const itemsByTask = useMemo(() => {
    const m = new Map<string, TaskItem[]>();
    for (const it of items) {
      const arr = m.get(it.task_id) ?? [];
      arr.push(it);
      m.set(it.task_id, arr);
    }
    return m;
  }, [items]);

  const subsByTask = useMemo(() => {
    const m = new Map<string, Submission[]>();
    for (const s of submissions) {
      const arr = m.get(s.task_id) ?? [];
      arr.push(s);
      m.set(s.task_id, arr);
    }
    return m;
  }, [submissions]);

  async function assignTask(taskId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("prep_tasks")
      .update({ employee_id: employee.id })
      .eq("id", taskId);
    if (error) return toast.error(error.message);
    toast.success("Tugas ditautkan ke " + employee.name);
    setShowAssign(false);
    onChanged();
  }

  async function unassignTask(taskId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from as any)("prep_tasks")
      .update({ employee_id: null })
      .eq("id", taskId);
    if (error) return toast.error(error.message);
    toast.success("Tautan pegawai dilepas");
    onChanged();
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(publicTaskUrl(token));
      toast.success("Link disalin");
    } catch {
      toast.error("Gagal menyalin");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-lg border bg-background shadow-lg sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b p-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{employee.name}</h2>
            {employee.phone && (
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" /> {employee.phone}
              </div>
            )}
            {employee.note && <div className="mt-1 text-xs text-muted-foreground">{employee.note}</div>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Link
            to="/tugas"
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Buat tugas baru
          </Link>
          <button
            onClick={() => setShowAssign((v) => !v)}
            className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted"
          >
            <Link2 className="h-3.5 w-3.5" /> Tautkan tugas lama
            {unassignedTasks.length > 0 && (
              <span className="ml-1 rounded bg-muted px-1 text-[10px]">{unassignedTasks.length}</span>
            )}
          </button>
        </div>

        {showAssign && (
          <div className="border-b bg-muted/30 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Pilih tugas tanpa pegawai untuk ditautkan
            </div>
            {unassignedTasks.length === 0 ? (
              <div className="text-xs text-muted-foreground">Semua tugas sudah punya pegawai.</div>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {unassignedTasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => void assignTask(t.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-xs hover:border-primary/40"
                  >
                    <span className="truncate">{t.title}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString("id-ID")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {tasks.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Belum ada tugas. Buat tugas baru atau tautkan tugas yang sudah ada.
            </div>
          ) : loading ? (
            <div className="text-center text-sm text-muted-foreground">Memuat detail…</div>
          ) : (
            <div className="space-y-3">
              {tasks.map((t) => {
                const its = itemsByTask.get(t.id) ?? [];
                const subs = subsByTask.get(t.id) ?? [];
                const totalReq = its.reduce((s, i) => s + Number(i.qty_requested || 0), 0);
                const totalDone = its.reduce((s, i) => s + Number(i.qty_prepared || 0), 0);
                const avail = taskAvailability(t, now);
                const badge = AVAIL_BADGE[avail];
                return (
                  <div key={t.id} className="rounded-lg border bg-card">
                    <div className="flex items-start gap-2 border-b p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{t.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className={`rounded px-1.5 py-0.5 ring-1 ${badge.cls}`}>{badge.label}</span>
                          <span>·</span>
                          <span>{new Date(t.created_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</span>
                          {its.length > 0 && (
                            <>
                              <span>·</span>
                              <span>
                                {its.filter((i) => Number(i.qty_prepared) > 0).length}/{its.length} item terkirim
                              </span>
                            </>
                          )}
                          {totalReq > 0 && (
                            <>
                              <span>·</span>
                              <span>{totalDone}/{totalReq}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => void copyLink(t.share_token)}
                          title="Salin link"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <a
                          href={publicTaskUrl(t.share_token)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Buka link"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <button
                          onClick={() => void unassignTask(t.id)}
                          title="Lepas tautan pegawai"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
                        >
                          <CircleSlash className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {subs.length > 0 ? (
                      <div className="divide-y">
                        {subs.slice(0, 10).map((s) => {
                          const item = its.find((i) => i.id === s.task_item_id);
                          return (
                            <div key={s.id} className="flex items-start gap-2 p-2 text-xs">
                              <div className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                {s.photo_path ? <ImageIcon className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{item?.name_snapshot ?? "Item"}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {new Date(s.submitted_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                                  {s.note && <span> · {s.note}</span>}
                                </div>
                              </div>
                              {s.location_url && (
                                <a
                                  href={s.location_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex h-6 items-center gap-0.5 rounded border px-1 text-[10px] text-muted-foreground hover:bg-muted"
                                >
                                  <MapPin className="h-3 w-3" /> Lokasi
                                </a>
                              )}
                            </div>
                          );
                        })}
                        {subs.length > 10 && (
                          <div className="px-2 py-1 text-[10px] text-muted-foreground">
                            +{subs.length - 10} pengiriman lainnya
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 text-center text-[11px] text-muted-foreground">
                        Belum ada pengiriman dari pegawai.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}