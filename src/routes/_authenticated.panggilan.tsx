import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, PhoneMissed, Video as VideoIcon, Loader2, Trash2, Search, X, ArrowDownWideNarrow, ArrowUpWideNarrow, FileSpreadsheet, FileText, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { CallDetailSheet } from "@/components/chat/CallDetailSheet";
import { toExportRows, exportCallsCsv, exportCallsPdf } from "@/lib/call-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChatBottomNav } from "@/components/chat/ChatBottomNav";
import { ChatSectionHeader } from "@/components/chat/ChatSectionHeader";
import {
  listMyCalls,
  formatCallDuration,
  createCallRow,
  hideCalls,
  hideAllCalls,
  type CallRow,
} from "@/lib/calls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { dispatchStartCall } from "@/components/chat/CallHost";
import { ringUser } from "@/lib/webrtc";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMyUserId } from "@/lib/chat";
import { formatInviteCode } from "@/lib/invite";
import type { CallVisualStatus } from "@/lib/call-status-visual";
import { CallStatusButton } from "@/components/chat/CallStatusButton";
import { VirtualizedList } from "@/components/VirtualizedList";

export const Route = createFileRoute("/_authenticated/panggilan")({
  component: PanggilanPage,
  head: () => ({
    meta: [
      { title: "Panggilan — Ace Storage" },
      { name: "description", content: "Riwayat panggilan suara & video Ace Chat." },
    ],
  }),
});

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

function PanggilanPage() {
  const { data: myId } = useMyUserId();
  const [callingId, setCallingId] = useState<string | null>(null);
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<CallRow | null>(null);
  const [detailRow, setDetailRow] = useState<CallRow | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "missed" | "incoming" | "outgoing" | "video">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exporting, setExporting] = useState<null | "csv" | "pdf">(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const calls = useQuery({
    queryKey: ["chat-calls", myId ?? "_"],
    queryFn: () => listMyCalls(100),
    enabled: !!myId,
    refetchOnWindowFocus: false,
  });

  // Ambil nama peer per user.
  const peerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of calls.data ?? []) {
      if (c.caller_id !== myId) ids.add(c.caller_id);
      if (c.callee_id && c.callee_id !== myId) ids.add(c.callee_id);
    }
    return Array.from(ids);
  }, [calls.data, myId]);

  const profiles = useQuery({
    queryKey: ["chat-calls-profiles", peerIds.join(",")],
    queryFn: async () => {
      if (peerIds.length === 0) return {} as Record<string, string>;
      // Ambil alias kontak (nama yang diedit user di chat / address book) —
      // ini prioritas utama, jatuh ke profil publik hanya bila alias kosong.
      const [aliasRes, profRes] = await Promise.all([
        supabase
          .from("address_book")
          .select("linked_user_id,name,updated_at")
          .in("linked_user_id", peerIds)
          .order("updated_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("id, display_name, invite_code")
          .in("id", peerIds),
      ]);
      const aliasMap: Record<string, string> = {};
      for (const a of (aliasRes.data ?? []) as {
        linked_user_id: string | null;
        name: string | null;
      }[]) {
        const key = a.linked_user_id;
        const name = a.name?.trim();
        if (!key || !name) continue;
        // Order desc → simpan hanya yang pertama (terbaru) untuk tiap peer.
        if (!aliasMap[key]) aliasMap[key] = name;
      }
      const map: Record<string, string> = {};
      const pinFallback = (id: string, invite?: string | null): string => {
        // Prioritas fallback: PIN (invite_code) → cuplikan ID → "Kontak".
        // JANGAN tampilkan nomor telepon mentah — sesuai kebijakan branding
        // PIN xxxx-xxxx (lihat tests/e2e/pin-branding-*.spec.ts).
        const clean = (invite ?? "").trim();
        if (clean) return `PIN ${formatInviteCode(clean)}`;
        const short = id.replace(/-/g, "").slice(0, 8).toUpperCase();
        return short ? `PIN ${formatInviteCode(short)}` : "Kontak";
      };
      for (const p of (profRes.data ?? []) as {
        id: string;
        display_name: string | null;
        invite_code: string | null;
      }[]) {
        const alias = aliasMap[p.id];
        map[p.id] =
          alias ||
          p.display_name?.trim() ||
          pinFallback(p.id, p.invite_code);
      }
      // Peer tanpa row profil: pakai alias bila ada, jika tidak fallback
      // ke cuplikan ID (masih dibungkus format PIN agar konsisten UI).
      for (const id of peerIds) {
        if (map[id]) continue;
        map[id] = aliasMap[id] || pinFallback(id, null);
      }
      return map;
    },
    enabled: peerIds.length > 0,
  });

  const allRows = calls.data ?? [];
  const nameMap = profiles.data ?? {};
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    const filtered = allRows.filter((c) => {
      const outgoing = c.caller_id === myId;
      const ts = new Date(c.started_at).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      if (filter === "missed" && !(c.status === "missed" || (c.status === "declined" && !outgoing))) return false;
      if (filter === "incoming" && outgoing) return false;
      if (filter === "outgoing" && !outgoing) return false;
      if (filter === "video" && c.kind !== "video") return false;
      if (!needle) return true;
      const peerId = outgoing ? c.callee_id : c.caller_id;
      const peerName = (peerId && nameMap[peerId]) || "Kontak";
      return peerName.toLowerCase().includes(needle);
    });
    return filtered.sort((a, b) => {
      const ta = new Date(a.started_at).getTime();
      const tb = new Date(b.started_at).getTime();
      return sort === "newest" ? tb - ta : ta - tb;
    });
  }, [allRows, myId, filter, q, nameMap, sort, dateFrom, dateTo]);
  const isFiltered = q.trim().length > 0 || filter !== "all" || !!dateFrom || !!dateTo;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  // Reset ke halaman 1 setiap pencarian/filter/urutan berubah.
  useEffect(() => {
    setPage(1);
  }, [q, filter, sort, dateFrom, dateTo, pageSize]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const pageRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );
  const rangeStart = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, rows.length);
  // Handler stabil supaya `CallRowItem` (memo) tidak re-render tiap scroll.
  const handleDelete = useCallback((r: CallRow) => setPendingDelete(r), []);
  const handleDetail = useCallback((r: CallRow) => setDetailRow(r), []);
  const handleStartCall = useCallback(
    async (r: CallRow) => {
      if (!myId) return;
      const peerId = r.caller_id === myId ? r.callee_id : r.caller_id;
      if (!peerId) return;
      const peerName = nameMap[peerId] || "Kontak";
      setCallingId(r.id);
      try {
        const row = await createCallRow({
          conversationId: r.conversation_id,
          callerId: myId,
          calleeId: peerId,
          kind: r.kind,
        });
        dispatchStartCall({ callId: row.id, kind: r.kind, peerName });
        void ringUser({
          calleeId: peerId,
          callId: row.id,
          callerId: myId,
          kind: r.kind,
          conversationId: r.conversation_id,
          callerName: peerName,
        }).catch(() => { /* ring gagal — UI tetap jalan */ });
      } catch (e) {
        const { describeCallError } = await import("@/lib/call-errors");
        const info = describeCallError(e, r.kind === "video" ? "video" : "audio");
        toast.error(info.title, { description: info.hint, duration: 8000 });
      } finally {
        setCallingId(null);
      }
    },
    [myId, nameMap],
  );
  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: "all", label: "Semua" },
    { key: "missed", label: "Tak terjawab" },
    { key: "incoming", label: "Masuk" },
    { key: "outgoing", label: "Keluar" },
    { key: "video", label: "Video" },
  ];
  return (
    <main className="mx-auto flex min-h-app-vh max-w-2xl flex-col wa-surface [--chat-nav-h:calc(var(--ms-tap)+1.25rem+var(--app-safe-bottom,env(safe-area-inset-bottom,0px)))]">
      <ChatSectionHeader
        title="Panggilan"
        actions={
          allRows.length > 0 ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-full touch-manipulation"
              aria-label={isFiltered ? "Hapus riwayat panggilan hasil filter" : "Hapus semua riwayat panggilan"}
              onClick={() => setConfirmClearAll(true)}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          ) : null
        }
      />

      {allRows.length > 0 ? (
        <div className="space-ms-2 border-b bg-background/60 px-ms-3 py-ms-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama kontak…"
              aria-label="Cari riwayat panggilan"
              className="h-11 rounded-full pl-9 pr-9"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Bersihkan pencarian"
                className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="flex gap-ms-1.5 overflow-x-auto pt-ms-2 [scrollbar-width:none]">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-ms-xs font-medium transition-colors touch-manipulation ${
                  filter === f.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
              aria-label={sort === "newest" ? "Urutkan: terbaru dulu (ketuk untuk terlama)" : "Urutkan: terlama dulu (ketuk untuk terbaru)"}
              className="ml-auto flex shrink-0 items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-ms-xs font-medium text-muted-foreground transition-colors hover:bg-muted touch-manipulation"
            >
              {sort === "newest" ? (
                <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpWideNarrow className="h-3.5 w-3.5" />
              )}
              {sort === "newest" ? "Terbaru" : "Terlama"}
            </button>
          </div>
          <div className="flex items-center gap-ms-1.5 pt-ms-2">
            <Input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Tanggal mulai"
              className="h-10 flex-1 rounded-full text-ms-xs"
            />
            <span className="text-ms-xs text-muted-foreground">–</span>
            <Input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Tanggal akhir"
              className="h-10 flex-1 rounded-full text-ms-xs"
            />
            {dateFrom || dateTo ? (
              <button
                type="button"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                aria-label="Bersihkan rentang tanggal"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted touch-manipulation"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-ms-1.5 pt-ms-2">
            <span className="text-ms-xs text-muted-foreground">
              {rows.length === 0 ? "0 entri" : `${rangeStart}–${rangeEnd} dari ${rows.length} entri`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rows.length === 0 || exporting !== null}
              className="ml-auto h-9 gap-1.5 rounded-full text-ms-xs"
              onClick={() => {
                try {
                  setExporting("csv");
                  const name = exportCallsCsv(toExportRows(rows, myId ?? null, nameMap));
                  toast.success("CSV diunduh", { description: name });
                } catch (e) {
                  toast.error("Gagal mengekspor CSV", {
                    description: e instanceof Error ? e.message : undefined,
                  });
                } finally {
                  setExporting(null);
                }
              }}
            >
              {exporting === "csv" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-3.5 w-3.5" />
              )}
              CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rows.length === 0 || exporting !== null}
              className="h-9 gap-1.5 rounded-full text-ms-xs"
              onClick={async () => {
                try {
                  setExporting("pdf");
                  const label = isFiltered ? "hasil filter" : "semua entri";
                  const name = await exportCallsPdf(
                    toExportRows(rows, myId ?? null, nameMap),
                    label,
                  );
                  toast.success("PDF diunduh", { description: name });
                } catch (e) {
                  toast.error("Gagal mengekspor PDF", {
                    description: e instanceof Error ? e.message : undefined,
                  });
                } finally {
                  setExporting(null);
                }
              }}
            >
              {exporting === "pdf" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              PDF
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex-1 pb-[var(--chat-nav-h)]">
        {calls.isLoading ? (
          <div className="px-ms-4 py-ms-6 text-center text-ms-xs text-muted-foreground">Memuat riwayat…</div>
        ) : allRows.length === 0 ? (
          <div className="px-ms-4 py-8">
            <div className="mx-auto max-w-sm space-ms-3 rounded-2xl border bg-card p-ms-6 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
                <PhoneMissed className="h-6 w-6" />
              </div>
              <h2 className="text-ms-base font-semibold">Belum ada panggilan</h2>
              <p className="text-ms-xs text-muted-foreground">
                Riwayat panggilan suara & video akan muncul di sini. Mulai panggilan
                dari dalam percakapan.
              </p>
              <Button asChild size="sm" className="gap-ms-1.5">
                <Link to="/chat"><Phone className="h-4 w-4" /> Buka daftar chat</Link>
              </Button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-ms-4 py-8 text-center text-ms-xs text-muted-foreground">
            Tidak ada panggilan yang cocok dengan pencarian atau filter ini.
          </div>
        ) : (
          <>
          <div role="list" className="pb-2">
            <VirtualizedList
              cacheKey="call-list"
              items={pageRows}
              getKey={(c) => c.id}
              estimateSize={64}
              gap={0}
              threshold={12}
              renderItem={(c) => (
                <CallRowItem
                  row={c}
                  myId={myId ?? null}
                  nameMap={nameMap}
                  isCalling={callingId === c.id}
                  onDelete={handleDelete}
                  onDetail={handleDetail}
                  onStartCall={handleStartCall}
                />
              )}
            />
          </div>
          {rows.length > pageSize || pageSize !== 20 ? (
            <nav
              aria-label="Navigasi halaman panggilan"
              className="flex items-center gap-ms-1.5 border-t px-ms-3 py-ms-3"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1 rounded-full text-ms-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Halaman sebelumnya"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Sebelumnya
              </Button>
              <span className="text-ms-xs text-muted-foreground" aria-live="polite">
                Hal {page}/{totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1 rounded-full text-ms-xs"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Halaman berikutnya"
              >
                Berikutnya <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                aria-label="Jumlah entri per halaman"
                className="ml-auto h-9 rounded-full border bg-background px-3 text-ms-xs"
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}/hal</option>
                ))}
              </select>
            </nav>
          ) : null}
          </>
        )}
      </div>

      <ChatBottomNav />

      <CallDetailSheet
        row={detailRow}
        myId={myId ?? null}
        nameMap={nameMap}
        onOpenChange={(o) => { if (!o) setDetailRow(null); }}
        onDelete={(r) => { setDetailRow(null); setPendingDelete(r); }}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus riwayat panggilan?</AlertDialogTitle>
            <AlertDialogDescription>
              Entri ini hanya dihapus dari daftar Anda. Lawan bicara tetap
              melihat riwayat panggilannya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                const row = pendingDelete;
                if (!row) return;
                setBusy(true);
                try {
                  await hideCalls([row.id]);
                  await qc.invalidateQueries({ queryKey: ["chat-calls"] });
                  toast.success("Riwayat panggilan dihapus", {
                    description:
                      "Entri dihapus dari daftar Anda. Riwayat lawan bicara tidak terpengaruh.",
                  });
                  setPendingDelete(null);
                } catch (err) {
                  toast.error("Gagal menghapus riwayat panggilan", {
                    description:
                      err instanceof Error
                        ? err.message
                        : "Periksa koneksi internet lalu coba lagi.",
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isFiltered ? `Hapus ${rows.length} panggilan hasil filter?` : "Hapus semua riwayat panggilan?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isFiltered
                ? "Hanya entri yang sedang tampil yang dihapus dari daftar Anda."
                : "Seluruh daftar panggilan Anda akan dikosongkan."}{" "}
              Tindakan ini tidak memengaruhi riwayat milik lawan bicara.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || (isFiltered && rows.length === 0)}
              onClick={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  let removed: number | undefined;
                  if (isFiltered) {
                    await hideCalls(rows.map((r) => r.id));
                    removed = rows.length;
                  } else {
                    removed = await hideAllCalls();
                  }
                  await qc.invalidateQueries({ queryKey: ["chat-calls"] });
                  toast.success("Riwayat panggilan dikosongkan", {
                    description:
                      typeof removed === "number" && removed > 0
                        ? `${removed} entri dihapus dari daftar Anda.`
                        : "Daftar panggilan Anda kini kosong.",
                  });
                  setConfirmClearAll(false);
                } catch (err) {
                  toast.error("Gagal mengosongkan riwayat panggilan", {
                    description:
                      err instanceof Error
                        ? err.message
                        : "Periksa koneksi internet lalu coba lagi.",
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {isFiltered ? "Hapus hasil filter" : "Hapus semua"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

const CallRowItem = React.memo(function CallRowItem({
  row, myId, nameMap, isCalling, onStartCall, onDelete, onDetail,
}: {
  row: CallRow;
  myId: string | null;
  nameMap: Record<string, string>;
  isCalling: boolean;
  onStartCall: (row: CallRow) => void | Promise<void>;
  onDelete: (row: CallRow) => void;
  onDetail: (row: CallRow) => void;
}) {
  const outgoing = row.caller_id === myId;
  const peerId = outgoing ? row.callee_id : row.caller_id;
  const peerName = (peerId && nameMap[peerId]) || "Kontak";
  const Icon = row.kind === "video" ? VideoIcon : Phone;
  const missed = row.status === "missed" || (row.status === "declined" && !outgoing);
  // Untuk status "ended", tampilkan durasi alih-alih label "Diterima".
  const overrideLabel =
    row.status === "ended" ? formatCallDuration(row.duration_sec) : undefined;

  return (
    <div role="listitem" className="flex items-center gap-ms-1 border-b px-ms-2 py-1">
      <Link
        to="/chat/$conversationId"
        params={{ conversationId: row.conversation_id }}
        preload="intent"
        className="flex min-h-[56px] flex-1 items-center gap-ms-3 rounded-lg px-ms-2 py-ms-2 text-left transition-colors touch-manipulation hover:bg-muted/60 active:bg-muted"
        aria-label={`Buka chat dengan ${peerName}`}
      >
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-ms-sm font-semibold uppercase">
          {peerName.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`truncate text-ms-sm font-medium ${missed ? "text-red-600" : ""}`}>{peerName}</div>
          <CallStatusButton
            status={row.status as CallVisualStatus}
            outgoing={outgoing}
            overrideLabel={overrideLabel}
            trailing={
              <>
                <span>·</span>
                <span>{timeLabel(row.started_at)}</span>
              </>
            }
          />
        </div>
      </Link>
      <button
        type="button"
        disabled={isCalling}
        aria-busy={isCalling}
        onClick={() => void onStartCall(row)}
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors touch-manipulation ${
          isCalling
            ? "cursor-not-allowed opacity-60"
            : "hover:bg-muted/60 active:bg-muted"
        }`}
        aria-label={
          isCalling
            ? `Memulai panggilan ${row.kind === "video" ? "video" : "suara"} ke ${peerName}`
            : row.kind === "video"
              ? `Panggilan video ke ${peerName}`
              : `Panggilan suara ke ${peerName}`
        }
      >
        {isCalling ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <Icon className={`h-5 w-5 ${row.kind === "video" ? "text-primary" : "text-muted-foreground"}`} />
        )}
      </button>
      <button
        type="button"
        onClick={() => onDetail(row)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors touch-manipulation hover:bg-muted/60 active:bg-muted"
        aria-label={`Lihat detail panggilan dengan ${peerName}`}
      >
        <Info className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        onClick={() => onDelete(row)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors touch-manipulation hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20"
        aria-label={`Hapus riwayat panggilan dengan ${peerName}`}
      >
        <Trash2 className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
});