import { useEffect, useRef, useState } from "react";
import { Plus, Image as ImageIcon, Camera, Film, Paperclip, MapPin, UserRound, Package, Loader2, Navigation, Sticker, X, Send, FileText, Search, CheckCircle2, AlertCircle, RotateCcw, RefreshCw, Trash2, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  pickFromCamera, pickViaInput, pickMultipleViaInput, uploadChatFile,
} from "@/lib/chat-attachments";
import { encodeCard } from "@/lib/chat-cards";
import { getCurrentLocation, toGeoError } from "@/lib/get-location";
import { sendMessage } from "@/lib/chat.functions";
import { StickerPickerDialog } from "@/components/chat/StickerPickerDialog";
import type { LucideIcon } from "lucide-react";

function Tile({ icon: Icon, label, color, onClick, recent }: { icon: LucideIcon; label: string; color: string; onClick: () => void | Promise<void>; recent?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`relative flex flex-col items-center gap-1.5 rounded-xl p-2 text-center transition hover:bg-accent active:scale-95 ${recent ? "ring-2 ring-primary/60" : ""}`}>
      <span className={`flex h-12 w-12 items-center justify-center rounded-full ${color}`}>
        <Icon className="h-6 w-6" />
      </span>
      <span className="text-[11px] font-medium text-foreground">{label}</span>
      {recent ? (
        <span className="absolute -top-1 right-0 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-semibold leading-none text-primary-foreground">
          Terakhir
        </span>
      ) : null}
    </button>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ===== Validasi lampiran (ukuran & tipe) =====
const MB = 1024 * 1024;
const LIMIT_IMAGE = 10 * MB;
const LIMIT_VIDEO = 50 * MB;
const LIMIT_AUDIO = 20 * MB;
const LIMIT_DOC = 25 * MB;
const LIMIT_ABS = 50 * MB; // batas keras apa pun jenisnya

// Ekstensi yang ditolak demi keamanan (eksekutabel/installer/script).
const BLOCKED_EXT = new Set([
  "exe","bat","cmd","com","msi","scr","ps1","vbs","js","jse","wsf","wsh",
  "sh","bash","zsh","apk","ipa","dmg","app","jar","dll","so",
]);
// MIME yang ditolak.
const BLOCKED_MIME = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-sh",
  "application/x-bat",
  "application/x-msi",
  "application/vnd.android.package-archive",
  "application/x-executable",
]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function validateFile(file: File): string | null {
  if (!file || file.size === 0) return "Berkas kosong (0 KB) — pilih berkas lain.";
  const ext = extOf(file.name);
  const mime = (file.type || "").toLowerCase();
  if (BLOCKED_EXT.has(ext) || BLOCKED_MIME.has(mime)) {
    return `Jenis berkas .${ext || "tidak dikenal"} tidak diizinkan untuk keamanan.`;
  }
  if (file.size > LIMIT_ABS) {
    return `Ukuran ${formatBytes(file.size)} melebihi batas keras ${formatBytes(LIMIT_ABS)}.`;
  }
  if (mime.startsWith("image/") && file.size > LIMIT_IMAGE) {
    return `Gambar ${formatBytes(file.size)} melebihi batas ${formatBytes(LIMIT_IMAGE)}.`;
  }
  if (mime.startsWith("video/") && file.size > LIMIT_VIDEO) {
    return `Video ${formatBytes(file.size)} melebihi batas ${formatBytes(LIMIT_VIDEO)}.`;
  }
  if (mime.startsWith("audio/") && file.size > LIMIT_AUDIO) {
    return `Audio ${formatBytes(file.size)} melebihi batas ${formatBytes(LIMIT_AUDIO)}.`;
  }
  if (!mime.startsWith("image/") && !mime.startsWith("video/") && !mime.startsWith("audio/")) {
    if (file.size > LIMIT_DOC) {
      return `Dokumen ${formatBytes(file.size)} melebihi batas ${formatBytes(LIMIT_DOC)}.`;
    }
  }
  return null;
}

type Props = {
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
};

export function AttachMenu({ conversationId, disabled, onSent }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [openSheet, setOpenSheet] = useState(false);
  const [openLoc, setOpenLoc] = useState(false);
  const [openContact, setOpenContact] = useState(false);
  const [openProduct, setOpenProduct] = useState(false);
  const [openSticker, setOpenSticker] = useState(false);
  type TileId = "doc" | "gallery" | "camera" | "video" | "location" | "contact" | "product" | "sticker";
  const LAST_KEY = "chat:lastAttachTile";
  const [lastTile, setLastTile] = useState<TileId | null>(() => {
    try {
      const v = localStorage.getItem(LAST_KEY);
      return v && ["doc","gallery","camera","video","location","contact","product","sticker"].includes(v) ? (v as TileId) : null;
    } catch { return null; }
  });
  const persistLast = (id: TileId) => {
    setLastTile(id);
    try { localStorage.setItem(LAST_KEY, id); } catch { /* ignore */ }
  };
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);
  const [search, setSearch] = useState("");
  // Reset pencarian setiap kali sheet ditutup.
  useEffect(() => { if (!openSheet) setSearch(""); }, [openSheet]);

  type TileDef = { id: TileId; label: string; keywords: string[]; color: string; icon: LucideIcon };
  const TILES: TileDef[] = [
    { id: "doc",      label: "Dokumen", keywords: ["dokumen","document","pdf","docx","xls","file","berkas"], color: "bg-violet-500/15 text-violet-500", icon: Paperclip },
    { id: "gallery",  label: "Galeri",  keywords: ["galeri","foto","gambar","image","jpg","png","photo"], color: "bg-fuchsia-500/15 text-fuchsia-500", icon: ImageIcon },
    { id: "camera",   label: "Kamera",  keywords: ["kamera","camera","jepret","selfie","foto"], color: "bg-sky-500/15 text-sky-500", icon: Camera },
    { id: "video",    label: "Video",   keywords: ["video","film","mp4","rekaman","movie"], color: "bg-rose-500/15 text-rose-500", icon: Film },
    { id: "location", label: "Lokasi",  keywords: ["lokasi","maps","gps","alamat","peta","location"], color: "bg-emerald-500/15 text-emerald-500", icon: MapPin },
    { id: "contact",  label: "Kontak",  keywords: ["kontak","contact","nomor","telpon","wa","whatsapp"], color: "bg-blue-500/15 text-blue-500", icon: UserRound },
    { id: "product",  label: "Produk",  keywords: ["produk","product","barang","item","kartu"], color: "bg-amber-500/15 text-amber-500", icon: Package },
    { id: "sticker",  label: "Stiker",  keywords: ["stiker","sticker","panah","rekening","teks","ai","emoji"], color: "bg-pink-500/15 text-pink-500", icon: Sticker },
  ];
  const norm = (s: string) => s.toLowerCase().trim();
  const q = norm(search);
  const filteredTiles = q
    ? TILES.filter((t) => norm(t.label).includes(q) || t.keywords.some((k) => k.includes(q)))
    : TILES;
  type PendingItem = { id: string; file: File; previewUrl: string | null };
  type ItemStatus = "idle" | "uploading" | "sent" | "error";
  type StatusEntry = { state: ItemStatus; error?: string; preflight?: boolean };
  const [pending, setPending] = useState<PendingItem[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, StatusEntry>>({});
  const [caption, setCaption] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Ref agar loop upload selalu baca pending terbaru (penghapusan saat upload tetap konsisten).
  const pendingRef = useRef<PendingItem[] | null>(null);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  const statusesRef = useRef<Record<string, StatusEntry>>({});
  useEffect(() => { statusesRef.current = statuses; }, [statuses]);

  function nextItemId(): string {
    try {
      const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
      if (c?.randomUUID) return c.randomUUID();
    } catch { /* ignore */ }
    return `f_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  // Reset mode pilih saat dialog ditutup atau daftar kosong.
  useEffect(() => {
    if (!pending || pending.length === 0) {
      setSelectMode(false);
      setSelected(new Set());
    }
  }, [pending]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAllPending() {
    if (!pending) return;
    // Tidak ikutkan item yang sudah terkirim atau sedang upload.
    const all = pending
      .filter((p) => {
        const s = statuses[p.id]?.state;
        return s !== "sent" && s !== "uploading";
      })
      .map((p) => p.id);
    setSelected(new Set(all));
  }
  function clearSelection() { setSelected(new Set()); }

  /** Hapus berdasarkan id. Item yang sedang "uploading" tidak boleh dihapus (lock). */
  function removeIds(ids: Iterable<string>): { removed: string[]; skipped: number } {
    if (!pending) return { removed: [], skipped: 0 };
    const wanted = new Set(ids);
    const removed: string[] = [];
    let skipped = 0;
    const nextPending: PendingItem[] = [];
    for (const p of pending) {
      if (wanted.has(p.id)) {
        if (statuses[p.id]?.state === "uploading") {
          skipped += 1;
          nextPending.push(p);
        } else {
          if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
          removed.push(p.id);
        }
      } else {
        nextPending.push(p);
      }
    }
    if (removed.length === 0) return { removed, skipped };
    setPending(nextPending.length ? nextPending : null);
    setStatuses((prev) => {
      const next = { ...prev };
      for (const id of removed) delete next[id];
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of removed) next.delete(id);
      return next;
    });
    // Sinkronkan progress jika upload sedang jalan: kurangi total untuk item yang
    // dihapus & belum selesai (state "idle"/"error" yang akan masuk antrean).
    setProgress((p) => {
      if (!p) return p;
      const stillPending = removed.filter((id) => {
        const s = statusesRef.current[id]?.state;
        return s === "idle" || s === "error";
      }).length;
      if (stillPending === 0) return p;
      const total = Math.max(p.done, p.total - stillPending);
      return { done: p.done, total };
    });
    return { removed, skipped };
  }

  function removeSelectedPending() {
    const { skipped } = removeIds(Array.from(selected));
    if (skipped > 0) toast.message(`${skipped} berkas sedang diunggah dan dilewati`);
    setSelectMode(false);
  }
  function removeAllPending() {
    if (!pending) return;
    const ids = pending.map((p) => p.id);
    const { skipped } = removeIds(ids);
    if (skipped > 0) {
      toast.message(`${skipped} berkas sedang diunggah dan dilewati`);
    } else {
      setCaption("");
    }
    setSelectMode(false);
  }

  const [confirmDelete, setConfirmDelete] = useState<null | "selected" | "all">(null);
  const [showAllDelete, setShowAllDelete] = useState(false);
  const [deleteSnapshot, setDeleteSnapshot] = useState<{ count: number; bytes: number } | null>(null);
  // Saat dialog konfirmasi dibuka, ambil snapshot jumlah & total ukuran agar bisa menampilkan delta real-time.
  useEffect(() => {
    if (confirmDelete === null) {
      setDeleteSnapshot(null);
      return;
    }
    if (!pending) return;
    const list = confirmDelete === "all" ? pending : pending.filter((p) => selected.has(p.id));
    const rem = list.filter((p) => statuses[p.id]?.state !== "uploading");
    setDeleteSnapshot({
      count: rem.length,
      bytes: rem.reduce((s, p) => s + (p.file.size || 0), 0),
    });
    // Hanya saat dialog beralih state (buka/tutup) — bukan saat daftar berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmDelete]);

  async function runTile(id: TileId) {
    persistLast(id);
    setOpenSheet(false);
    switch (id) {
      case "doc":     return stageFiles(await pickMultipleViaInput({ accept: "*/*" }));
      case "gallery": return stageFiles(await pickMultipleViaInput({ accept: "image/*" }));
      case "camera":  return stageFiles(await pickFromCamera());
      case "video":   return stageFiles(await pickMultipleViaInput({ accept: "video/*" }));
      case "location": setOpenLoc(true); return;
      case "contact":  setOpenContact(true); return;
      case "product":  setOpenProduct(true); return;
      case "sticker":  setOpenSticker(true); return;
    }
  }

  function handlePlusPointerDown() {
    longPressedRef.current = false;
    longPressRef.current = setTimeout(() => {
      longPressedRef.current = true;
      setOpenSheet(true);
    }, 450);
  }
  function clearLongPress() {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
  }
  function handlePlusClick() {
    clearLongPress();
    if (longPressedRef.current) return; // sheet already opened
    if (lastTile) { void runTile(lastTile); } else { setOpenSheet(true); }
  }

  // Bersihkan object URL hanya untuk item yang HILANG dari `pending`
  // (bukan revoke semua tiap perubahan — itu bug yang membuat preview tersisa
  // jadi blank setelah satu item dihapus). Penghapusan per-item sudah
  // di-revoke di `removeIds`; efek ini berfungsi sebagai jaring pengaman
  // (mis. saat `setPending(null)` dari tombol Batal / setelah kirim) dan
  // saat unmount komponen.
  const prevPendingRef = useRef<PendingItem[] | null>(null);
  useEffect(() => {
    const prev = prevPendingRef.current;
    if (prev && prev.length > 0) {
      const nextIds = new Set((pending ?? []).map((p) => p.id));
      for (const p of prev) {
        if (p.previewUrl && !nextIds.has(p.id)) {
          try { URL.revokeObjectURL(p.previewUrl); } catch { /* ignore */ }
        }
      }
    }
    prevPendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    return () => {
      prevPendingRef.current?.forEach((p) => {
        if (p.previewUrl) {
          try { URL.revokeObjectURL(p.previewUrl); } catch { /* ignore */ }
        }
      });
    };
  }, []);

  function stageFiles(files: File[] | File | null) {
    const arr = Array.isArray(files) ? files : files ? [files] : [];
    if (arr.length === 0) return;
    setOpenSheet(false);
    setCaption("");
    // Validasi tiap berkas; tetap ditampilkan agar pengguna langsung tahu alasannya.
    const errors = arr.map((f) => validateFile(f));
    const items: PendingItem[] = arr.map((f) => ({
      id: nextItemId(),
      file: f,
      previewUrl: (f.type.startsWith("image/") || f.type.startsWith("video/")) ? URL.createObjectURL(f) : null,
    }));
    const nextStatuses: Record<string, StatusEntry> = {};
    items.forEach((it, i) => {
      const err = errors[i];
      nextStatuses[it.id] = err
        ? { state: "error", error: err, preflight: true }
        : { state: "idle" };
    });
    setPending(items);
    setStatuses(nextStatuses);
    const invalidCount = errors.filter(Boolean).length;
    if (invalidCount > 0) {
      const first = errors.find(Boolean) as string;
      toast.error(
        invalidCount === arr.length
          ? "Semua lampiran tidak valid"
          : `${invalidCount} dari ${arr.length} lampiran ditolak`,
        { description: first },
      );
    }
  }

  function removePendingAt(idx: number) {
    if (!pending) return;
    const target = pending[idx];
    if (!target) return;
    const { skipped } = removeIds([target.id]);
    if (skipped > 0) toast.message("Berkas sedang diunggah; tunggu sampai selesai.");
  }

  function removeInvalidPending() {
    if (!pending) return;
    const ids = pending.filter((p) => statuses[p.id]?.preflight).map((p) => p.id);
    removeIds(ids);
  }

  async function confirmSendPending(retryOnly = false, onlyIds?: string[]) {
    if (!pending || pending.length === 0) return;
    setBusy("upload");
    const cap = caption.trim();
    // ID yang akan dikirim: lewati yang sudah sukses dan yang gagal validasi (preflight).
    const queueIds = pending
      .filter((p) => statuses[p.id]?.state !== "sent" && !statuses[p.id]?.preflight)
      .filter((p) => (onlyIds ? onlyIds.includes(p.id) : retryOnly ? statuses[p.id]?.state === "error" : true))
      .map((p) => p.id);
    if (queueIds.length === 0) {
      setBusy(null);
      toast.error("Tidak ada lampiran valid untuk dikirim", { description: "Buang berkas yang ditolak terlebih dahulu." });
      return;
    }
    let total = queueIds.length;
    let done = 0;
    setProgress({ done, total });
    let anyError = false;
    let failedCount = 0;
    let firstCaptionConsumed = retryOnly || !!onlyIds
      ? Object.values(statuses).some((s) => s?.state === "sent")
      : false;
    let okCount = 0;
    for (const id of queueIds) {
      // Lewati item yang dihapus saat upload berjalan.
      const item = (pendingRef.current ?? []).find((p) => p.id === id);
      if (!item) {
        total = Math.max(done, total - 1);
        setProgress({ done, total });
        continue;
      }
      setStatuses((prev) => ({ ...prev, [id]: { state: "uploading" } }));
      try {
        const up = await uploadChatFile({ conversationId, file: item.file });
        const includeCaption = !firstCaptionConsumed && !!cap;
        await sendMessage({
          data: {
            conversationId,
            attachmentPath: up.path,
            attachmentMime: up.mime,
            attachmentName: up.name,
            attachmentSize: up.size,
            ...(includeCaption ? { body: cap } : {}),
          },
        });
        if (includeCaption) firstCaptionConsumed = true;
        setStatuses((prev) => (prev[id] ? { ...prev, [id]: { state: "sent" } } : prev));
        okCount += 1;
        onSent?.();
      } catch (e) {
        anyError = true;
        failedCount += 1;
        const msg = e instanceof Error ? e.message : "Gagal mengunggah";
        setStatuses((prev) => (prev[id] ? { ...prev, [id]: { state: "error", error: msg } } : prev));
      }
      done += 1;
      setProgress({ done, total });
    }
    setBusy(null);
    setProgress(null);
    if (!anyError && okCount > 0) {
      toast.success(
        okCount > 1 ? `${okCount} lampiran terkirim` : "Lampiran terkirim",
        { description: cap ? `Caption: "${cap.slice(0, 60)}${cap.length > 60 ? "…" : ""}"` : undefined },
      );
      // Semua berhasil → tutup dialog setelah jeda kecil supaya status terlihat.
      setTimeout(() => {
        setPending(null);
        setCaption("");
        setStatuses({});
      }, 300);
    } else if (anyError) {
      const failed = failedCount;
      const ok = okCount;
      toast.error(
        failed > 1 ? `${failed} lampiran gagal diunggah` : "1 lampiran gagal diunggah",
        {
          description: ok > 0
            ? `${ok} berhasil terkirim. Tekan "Coba lagi" untuk mengulang yang gagal.`
            : `Tekan "Coba lagi" untuk mengulang.`,
        },
      );
    }
  }

  async function shareLocationNow(durationMin?: number) {
    setBusy("loc");
    try {
      const loc = await getCurrentLocation();
      const card = encodeCard({
        type: "location",
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        ...(durationMin ? { live_until: new Date(Date.now() + durationMin * 60_000).toISOString() } : {}),
      });
      await sendMessage({ data: { conversationId, body: card } });
      setOpenLoc(false);
      setOpenSheet(false);
      onSent?.();
    } catch (e) {
      const ge = toGeoError(e);
      toast.error(ge.message, { description: ge.hint });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Sheet open={openSheet} onOpenChange={(v) => !busy && setOpenSheet(v)}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || !!busy}
          aria-label={lastTile ? `Lampirkan (terakhir: ${lastTile}) — tahan untuk pilih lain` : "Lampirkan"}
          onClick={handlePlusClick}
          onPointerDown={handlePlusPointerDown}
          onPointerUp={clearLongPress}
          onPointerLeave={clearLongPress}
          onPointerCancel={clearLongPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5" />}
        </Button>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base">Lampirkan</SheetTitle>
          </SheetHeader>
          <div className="relative pt-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus={false}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari: foto, video, lokasi, stiker…"
              className="pl-8 pr-8 h-9"
              onKeyDown={(e) => {
                if (e.key === "Enter" && filteredTiles.length === 1) {
                  e.preventDefault();
                  void runTile(filteredTiles[0].id);
                }
              }}
            />
            {search ? (
              <button type="button" onClick={() => setSearch("")} aria-label="Kosongkan pencarian"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-4 gap-3 pt-3">
            {filteredTiles.map((t) => (
              <Tile key={t.id} recent={lastTile === t.id} color={t.color} icon={t.icon} label={t.label} onClick={() => runTile(t.id)} />
            ))}
            {filteredTiles.length === 0 ? (
              <div className="col-span-4 py-6 text-center text-xs text-muted-foreground">
                Tidak ada pilihan cocok untuk "{search}".
              </div>
            ) : null}
          </div>
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            Tap "+" → opsi terakhir. Tahan "+" untuk menu ini. "Terakhir" = pilihan tersimpan.
          </p>
        </SheetContent>
      </Sheet>

      <Dialog open={!!pending} onOpenChange={(v) => { if (!v && !busy) setPending(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Pratinjau lampiran{pending && pending.length > 1 ? ` · ${pending.length} berkas` : ""}
            </DialogTitle>
          </DialogHeader>
          {pending && pending.length > 0 ? (
            <div className="space-y-3">
              {/* Toolbar: mode pilih + pilih semua + hapus semua */}
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Button
                  type="button"
                  size="sm"
                  variant={selectMode ? "secondary" : "outline"}
                  className="h-7 px-2"
                  disabled={!!busy}
                  onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
                >
                  {selectMode ? <CheckSquare className="mr-1 h-3.5 w-3.5" /> : <Square className="mr-1 h-3.5 w-3.5" />}
                  {selectMode ? "Selesai" : "Pilih"}
                </Button>
                {selectMode ? (
                  <>
                    <Button type="button" size="sm" variant="outline" className="h-7 px-2" disabled={!!busy} onClick={selectAllPending}>
                      Pilih semua
                    </Button>
                    {selected.size > 0 ? (
                      <Button type="button" size="sm" variant="outline" className="h-7 px-2" disabled={!!busy} onClick={clearSelection}>
                        Bersihkan
                      </Button>
                    ) : null}
                    <span className="ml-auto text-muted-foreground">{selected.size}/{pending.length} dipilih</span>
                  </>
                ) : (
                  <span className="ml-auto text-muted-foreground">{pending.length} berkas</span>
                )}
              </div>
              <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
                {pending.map((p, i) => {
                  const st = statuses[p.id]?.state ?? "idle";
                  const isSelected = selected.has(p.id);
                  return (
                  <div
                    key={p.id}
                    role={selectMode ? "button" : undefined}
                    onClick={selectMode && !busy ? () => toggleSelected(p.id) : undefined}
                    className={`relative aspect-square overflow-hidden rounded-lg border bg-muted/30 ${selectMode ? "cursor-pointer" : ""} ${isSelected ? "ring-2 ring-primary" : st === "error" ? "ring-2 ring-destructive" : st === "sent" ? "ring-2 ring-emerald-500/70" : ""}`}
                  >
                    {p.previewUrl && p.file.type.startsWith("image/") ? (
                      <img src={p.previewUrl} alt={p.file.name} className="h-full w-full object-cover" />
                    ) : p.previewUrl && p.file.type.startsWith("video/") ? (
                      <video src={p.previewUrl} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
                        <FileText className="h-8 w-8 text-muted-foreground" />
                        <div className="mt-1 line-clamp-2 text-[10px] font-medium">{p.file.name}</div>
                        <div className="text-[10px] text-muted-foreground">{formatBytes(p.file.size)}</div>
                      </div>
                    )}
                    {selectMode ? (
                      <span className={`absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border bg-background/85 shadow ${isSelected ? "border-primary text-primary" : "border-muted-foreground/40 text-muted-foreground"}`}>
                        {isSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                      </span>
                    ) : null}
                    {!selectMode && !busy ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removePendingAt(i); }}
                        disabled={!!busy}
                        aria-label={`Hapus ${p.file.name}`}
                        className="absolute right-1 top-1 rounded-full bg-background/85 p-1 shadow hover:bg-background disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                    {st === "uploading" ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    ) : st === "sent" && !selectMode ? (
                      <div className="absolute right-7 top-1 rounded-full bg-emerald-500/95 p-0.5 text-white shadow">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                    ) : st === "error" && !selectMode ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); confirmSendPending(false, [p.id]); }}
                        disabled={!!busy}
                        title={`Coba lagi: ${statuses[p.id]?.error ?? ""}`}
                        aria-label={`Coba lagi ${p.file.name}`}
                        className="absolute right-7 top-1 flex items-center gap-1 rounded-full bg-destructive/95 px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground shadow hover:bg-destructive disabled:opacity-60"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Ulang
                      </button>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[10px] text-white">
                      {p.file.name}
                    </div>
                  </div>
                  );
                })}
              </div>
              {/* Daftar error rinci agar pesan tidak terpotong di chip */}
              {Object.values(statuses).some((s) => s?.state === "error") ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px]">
                  <div className="mb-1 flex items-center gap-1 font-medium text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" /> Sebagian lampiran gagal
                  </div>
                  <ul className="space-y-1 text-destructive/90">
                    {pending.map((p) => statuses[p.id]?.state === "error" ? (
                      <li key={p.id} className="flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate">• <span className="font-medium">{p.file.name}:</span> {statuses[p.id]?.error}</span>
                        <button
                          type="button"
                          onClick={() => confirmSendPending(false, [p.id])}
                          disabled={!!busy}
                          className="shrink-0 inline-flex items-center gap-1 rounded border border-destructive/40 bg-background px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                        >
                          <RefreshCw className="h-3 w-3" /> Coba lagi
                        </button>
                      </li>
                    ) : null)}
                  </ul>
                </div>
              ) : null}
              <div>
                <Label className="text-[11px] uppercase text-muted-foreground">
                  Caption {pending.length > 1 ? "(berlaku pada berkas pertama)" : "(opsional)"}
                </Label>
                <Textarea rows={2} maxLength={1000} placeholder="Tulis caption…"
                  value={caption}
                  disabled={!!busy}
                  onChange={(e) => setCaption(e.target.value)} />
              </div>
              {progress ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Mengunggah {progress.done}/{progress.total}…</span>
                    <span>{Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%</span>
                  </div>
                  <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} className="h-1.5" />
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => { setPending(null); setStatuses({}); }} disabled={!!busy}>
              <X className="mr-1 h-4 w-4" /> Batal
            </Button>
            {selectMode && selected.size > 0 && !busy ? (
              <Button variant="destructive" onClick={() => setConfirmDelete("selected")}>
                <Trash2 className="mr-1 h-4 w-4" />
                Hapus terpilih ({selected.size})
              </Button>
            ) : null}
            {!selectMode && (pending?.length ?? 0) > 1 && !busy ? (
              <Button variant="outline" onClick={() => setConfirmDelete("all")} aria-label="Hapus semua lampiran">
                <Trash2 className="mr-1 h-4 w-4" />
                Hapus semua
              </Button>
            ) : null}
            {Object.values(statuses).some((s) => s?.preflight) && !busy ? (
              <Button variant="outline" onClick={removeInvalidPending}>
                <X className="mr-1 h-4 w-4" />
                Buang yang ditolak ({Object.values(statuses).filter((s) => s?.preflight).length})
              </Button>
            ) : null}
            {Object.values(statuses).some((s) => s?.state === "error" && !s?.preflight) && !busy ? (
              <Button variant="secondary" onClick={() => confirmSendPending(true)}>
                <RotateCcw className="mr-1 h-4 w-4" />
                Coba lagi ({Object.values(statuses).filter((s) => s?.state === "error" && !s?.preflight).length})
              </Button>
            ) : null}
            <Button onClick={() => confirmSendPending(false)} disabled={!!busy || (pending?.length ?? 0) === 0 || (pending ?? []).every((p) => statuses[p.id]?.state === "sent" || statuses[p.id]?.preflight)}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
              Kirim{pending && pending.length > 1 ? ` (${pending.length})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openLoc} onOpenChange={(v) => !busy && setOpenLoc(v)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Bagikan lokasi</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <Button className="w-full justify-start" variant="outline" onClick={() => shareLocationNow()} disabled={!!busy}>
              <MapPin className="mr-2 h-4 w-4" /> Lokasi sekarang (sekali kirim)
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => shareLocationNow(15)} disabled={!!busy}>
              <Navigation className="mr-2 h-4 w-4" /> Live location · 15 menit
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => shareLocationNow(60)} disabled={!!busy}>
              <Navigation className="mr-2 h-4 w-4" /> Live location · 1 jam
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Live location dipasang sebagai label; posisinya tetap pada saat dikirim (tidak diperbarui otomatis di backend).
              Kirim ulang jika ingin update posisi.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <ContactDialog
        conversationId={conversationId}
        open={openContact}
        onOpenChange={setOpenContact}
        onSent={() => { onSent?.(); setOpenContact(false); }}
      />
      <ProductDialog
        conversationId={conversationId}
        open={openProduct}
        onOpenChange={setOpenProduct}
        onSent={() => { onSent?.(); setOpenProduct(false); }}
      />
      <StickerPickerDialog
        conversationId={conversationId}
        open={openSticker}
        onOpenChange={setOpenSticker}
        onSent={() => { onSent?.(); setOpenSticker(false); }}
      />
      <AlertDialog open={confirmDelete !== null} onOpenChange={(v) => { if (!v) { setConfirmDelete(null); setShowAllDelete(false); } }}>
        <AlertDialogContent>
          {(() => {
            const targets = !pending ? [] : confirmDelete === "all"
              ? pending
              : pending.filter((p) => selected.has(p.id));
            const lockedCount = targets.filter((p) => statuses[p.id]?.state === "uploading").length;
            const removable = targets.filter((p) => statuses[p.id]?.state !== "uploading");
            const previewLimit = 6;
            const shown = showAllDelete ? targets : targets.slice(0, previewLimit);
            const extra = targets.length - shown.length;
            const totalBytes = removable.reduce((sum, p) => sum + (p.file.size || 0), 0);
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {confirmDelete === "all"
                      ? `Hapus semua lampiran (${removable.length})?`
                      : `Hapus ${removable.length} berkas terpilih?`}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {removable.length === 0
                      ? "Tidak ada berkas yang dapat dihapus."
                      : `Total ${formatBytes(totalBytes)} akan dibuang dari antrean dan tidak bisa dikembalikan.`}
                    {deleteSnapshot && (deleteSnapshot.count !== removable.length || deleteSnapshot.bytes !== totalBytes) ? (
                      <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-400">
                        Daftar diperbarui:{" "}
                        {deleteSnapshot.count !== removable.length
                          ? `${removable.length - deleteSnapshot.count > 0 ? "+" : ""}${removable.length - deleteSnapshot.count} berkas`
                          : null}
                        {deleteSnapshot.count !== removable.length && deleteSnapshot.bytes !== totalBytes ? ", " : ""}
                        {deleteSnapshot.bytes !== totalBytes
                          ? `${totalBytes - deleteSnapshot.bytes > 0 ? "+" : "−"}${formatBytes(Math.abs(totalBytes - deleteSnapshot.bytes))}`
                          : null}
                        {" "}sejak dialog dibuka.
                      </span>
                    ) : null}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {targets.length > 0 ? (
                  <ul className={`${showAllDelete ? "max-h-64" : "max-h-44"} overflow-y-auto rounded-md border bg-muted/30 p-2 text-[12px]`}>
                    {shown.map((p) => {
                      const st = statuses[p.id]?.state ?? "idle";
                      const preflight = statuses[p.id]?.preflight;
                      const isLocked = st === "uploading";
                      const label =
                        st === "uploading" ? "uploading"
                          : st === "error" ? "gagal"
                          : st === "sent" ? "terkirim"
                          : preflight ? "ditolak"
                          : "menunggu";
                      const tone =
                        st === "uploading" ? "border-amber-400/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          : st === "error" ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : st === "sent" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : preflight ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-muted-foreground/30 bg-background text-muted-foreground";
                      return (
                        <li key={p.id} className={`flex items-center justify-between gap-2 py-0.5 ${isLocked ? "opacity-60" : ""}`}>
                          <span className="min-w-0 flex-1 truncate" title={p.file.name}>
                            • {p.file.name}
                            {isLocked ? <span className="ml-1 text-[10px] italic text-amber-600 dark:text-amber-400">(dilewati)</span> : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span className={`rounded-full border px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide ${tone}`}>{label}</span>
                            <span className="text-[10px] text-muted-foreground">{formatBytes(p.file.size)}</span>
                          </span>
                        </li>
                      );
                    })}
                    {extra > 0 ? (
                      <li className="flex items-center justify-between pt-1">
                        <span className="text-[11px] italic text-muted-foreground">…dan {extra} berkas lainnya</span>
                        <button
                          type="button"
                          onClick={() => setShowAllDelete(true)}
                          className="shrink-0 text-[11px] font-medium text-primary hover:underline"
                        >
                          Lihat semua
                        </button>
                      </li>
                    ) : showAllDelete && removable.length > previewLimit ? (
                      <li className="pt-1 text-right">
                        <button
                          type="button"
                          onClick={() => setShowAllDelete(false)}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          Tampilkan lebih sedikit
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
                {lockedCount > 0 ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    {lockedCount} berkas sedang diunggah dan akan dilewati.
                  </p>
                ) : null}
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={removable.length === 0}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                    onClick={() => {
                      if (confirmDelete === "all") removeAllPending();
                      else if (confirmDelete === "selected") removeSelectedPending();
                      setConfirmDelete(null);
                      setShowAllDelete(false);
                    }}
                  >
                    Hapus{removable.length > 0 ? ` (${removable.length})` : ""}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ContactDialog({ conversationId, open, onOpenChange, onSent }: { conversationId: string; open: boolean; onOpenChange: (v: boolean) => void; onSent: () => void; }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const staff = useQuery({
    queryKey: ["chat-attach", "staff"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_contacts").select("id,name,wa_phone").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  async function submit() {
    if (!name.trim() || !phone.trim()) { toast.error("Nama & nomor wajib diisi"); return; }
    setBusy(true);
    try {
      await sendMessage({ data: { conversationId, body: encodeCard({ type: "contact", name: name.trim(), phone: phone.trim(), note: note.trim() || undefined }) } });
      setName(""); setPhone(""); setNote("");
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim kontak");
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Kirim kontak</DialogTitle></DialogHeader>
        {staff.data && staff.data.length > 0 ? (
          <div className="space-y-1">
            <Label className="text-[11px] uppercase text-muted-foreground">Dari daftar pegawai</Label>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded border p-1">
              {staff.data.map((s) => (
                <button key={s.id} type="button" className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent"
                  onClick={() => { setName(s.name); setPhone(s.wa_phone); }}>
                  <span className="truncate">{s.name}</span>
                  <span className="text-muted-foreground">{s.wa_phone}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <div><Label>Nama</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Nomor WhatsApp</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="62812..." /></div>
          <div><Label>Catatan (opsional)</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Batal</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Kirim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({ conversationId, open, onOpenChange, onSent }: { conversationId: string; open: boolean; onOpenChange: (v: boolean) => void; onSent: () => void; }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const items = useQuery({
    queryKey: ["chat-attach", "warehouse-items", q],
    enabled: open,
    queryFn: async () => {
      let qb = supabase.from("warehouse_items").select("id,name,category,package_type,package_size").order("name").limit(40);
      const term = q.trim();
      if (term) qb = qb.ilike("name", `%${term}%`);
      const { data, error } = await qb;
      if (error) throw error;
      return data ?? [];
    },
  });
  async function send(it: { id: string; name: string; category: string | null; package_type: string; package_size: number }) {
    setBusy(true);
    try {
      const pkg = `${it.package_size} ${it.package_type}`;
      await sendMessage({ data: { conversationId, body: encodeCard({ type: "product", id: it.id, name: it.name, package: pkg, category: it.category, href: "/ecer" }) } });
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengirim produk");
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Kirim tautan produk</DialogTitle></DialogHeader>
        <Input placeholder="Cari nama produk…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {items.isLoading ? <div className="p-2 text-center text-xs text-muted-foreground">Memuat…</div> : null}
          {items.data?.length === 0 ? <div className="p-2 text-center text-xs text-muted-foreground">Tidak ditemukan.</div> : null}
          {(items.data ?? []).map((it) => (
            <button key={it.id} type="button" className="flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
              disabled={busy}
              onClick={() => send(it as { id: string; name: string; category: string | null; package_type: string; package_size: number })}>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{it.name}</span>
                {it.category ? <span className="ml-1 text-muted-foreground">· {it.category}</span> : null}
              </span>
              <span className="shrink-0 text-muted-foreground">{it.package_size} {it.package_type}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}