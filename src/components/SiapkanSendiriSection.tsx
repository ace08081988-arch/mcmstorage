import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Image as ImageIcon, MapPin, Trash2, Send, ExternalLink, Loader2, CheckCircle2, RefreshCw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";
import { confirm as confirmDialog } from "@/lib/confirm";

const BUCKET = "self-prep-photos";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp", "heic", "heif"] as const;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
const COMPRESS_TARGET_BYTES = 7.5 * 1024 * 1024; // sedikit di bawah batas

// Kompres gambar via canvas → JPEG. Mengembalikan File baru, atau null bila gagal
// (mis. HEIC yang tidak bisa di-decode browser).
async function compressImage(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file).catch(async () => {
      // Fallback via HTMLImageElement bila createImageBitmap gagal
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("decode-failed"));
          el.src = url;
        });
        return img as unknown as ImageBitmap;
      } finally {
        URL.revokeObjectURL(url);
      }
    });
    const srcW = (bitmap as ImageBitmap).width || (bitmap as unknown as HTMLImageElement).naturalWidth;
    const srcH = (bitmap as ImageBitmap).height || (bitmap as unknown as HTMLImageElement).naturalHeight;
    if (!srcW || !srcH) return null;

    // Iterasi: turunkan dimensi & kualitas sampai <= target
    const attempts: Array<{ scale: number; quality: number }> = [
      { scale: 1, quality: 0.85 },
      { scale: 1, quality: 0.7 },
      { scale: 0.8, quality: 0.7 },
      { scale: 0.6, quality: 0.65 },
      { scale: 0.5, quality: 0.6 },
      { scale: 0.4, quality: 0.55 },
    ];
    for (const { scale, quality } of attempts) {
      const w = Math.max(1, Math.round(srcW * scale));
      const h = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", quality),
      );
      if (!blob) continue;
      if (blob.size <= COMPRESS_TARGET_BYTES) {
        const base = file.name.replace(/\.[^.]+$/, "") || "foto";
        return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function pickFile(
  f: File | null | undefined,
  setFile: (f: File | null) => void,
  inputEl?: HTMLInputElement | null,
  opts: {
    autoCompress?: boolean;
    onCompressed?: (info: { originalBytes: number; compressedBytes: number }) => void;
  } = {},
) {
  if (!f) return;
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  const mimeOk = ALLOWED_MIME.includes(f.type as (typeof ALLOWED_MIME)[number]);
  const extOk = ALLOWED_EXT.includes(ext as (typeof ALLOWED_EXT)[number]);
  const toastId = `pickfile-${Date.now()}`;
  const retryAction = inputEl
    ? {
        label: "Coba Upload Lagi",
        onClick: () => {
          toast.dismiss(toastId);
          inputEl.value = "";
          // Tunggu satu tick agar toast tertutup dulu, lalu buka dialog file
          setTimeout(() => inputEl.click(), 0);
        },
      }
    : undefined;
  const reject = (title: string, description: string, duration: number) => {
    toast.error(title, { id: toastId, description, duration, action: retryAction });
    if (inputEl) inputEl.value = "";
  };
  if (!mimeOk && !extOk) {
    return reject(
      "Format foto tidak didukung",
      `File "${f.name}" tidak bisa diunggah.\nSaran: konversi foto ke salah satu format JPG, PNG, WEBP, atau HEIC/HEIF, lalu coba unggah ulang (maks 8 MB).`,
      7000,
    );
  }
  if (f.size > MAX_FILE_BYTES) {
    if (opts.autoCompress) {
      const loadingId = toast.loading("Mengompres foto…", {
        description: `Ukuran asli ${(f.size / 1024 / 1024).toFixed(1)} MB. Menyesuaikan agar di bawah 8 MB.`,
      });
      const compressed = await compressImage(f);
      toast.dismiss(loadingId);
      if (compressed && compressed.size <= MAX_FILE_BYTES && compressed.size > 0) {
        const beforeMB = f.size / 1024 / 1024;
        const afterMB = compressed.size / 1024 / 1024;
        const savedMB = beforeMB - afterMB;
        const savedPct = (savedMB / beforeMB) * 100;
        toast.success("Foto dikompres otomatis", {
          description:
            `Sebelum: ${beforeMB.toFixed(2)} MB\n` +
            `Sesudah: ${afterMB.toFixed(2)} MB (JPEG)\n` +
            `Hemat: ${savedMB.toFixed(2)} MB (≈ ${savedPct.toFixed(0)}%)`,
          duration: 7000,
        });
        opts.onCompressed?.({ originalBytes: f.size, compressedBytes: compressed.size });
        if (inputEl) inputEl.value = "";
        setFile(compressed);
        return;
      }
      return reject(
        "Kompres otomatis gagal",
        `File "${f.name}" berukuran ${(f.size / 1024 / 1024).toFixed(1)} MB tidak bisa dikompres otomatis (mungkin format HEIC/HEIF).\nSaran: kompres manual ke JPG/PNG/WEBP di bawah 8 MB, lalu coba lagi.`,
        8000,
      );
    }
    return reject(
      "Ukuran foto terlalu besar",
      `File "${f.name}" berukuran ${(f.size / 1024 / 1024).toFixed(1)} MB (maksimal 8 MB).\nSaran: kompres foto agar di bawah 8 MB (mis. aplikasi 'Photo Compress' / 'Compress Image'), turunkan resolusi, atau ambil ulang dengan resolusi kamera lebih rendah.`,
      8000,
    );
  }
  if (f.size === 0) {
    return reject(
      "File foto kosong atau rusak",
      "Tidak ada data pada file ini.\nSaran: pilih ulang foto dari galeri, atau ambil foto baru dengan kamera. Pastikan format JPG/PNG/WEBP/HEIC dan ukuran di bawah 8 MB.",
      7000,
    );
  }
  setFile(f);
}

type Row = {
  id: string;
  user_id: string;
  title: string;
  photo_path: string | null;
  location_url: string | null;
  note: string | null;
  status: "ready" | "sent";
  wa_target: string | null;
  sent_at: string | null;
  created_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (): any => (supabase.from as any)("self_prep_items");

function isHttpsUrl(s: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function SiapkanSendiriSection({ uid }: { uid: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [previewSend, setPreviewSend] = useState<Row | null>(null);
  const [sending, setSending] = useState(false);

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [locationUrl, setLocationUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoCompress, setAutoCompress] = useState(true);
  const [compressionInfo, setCompressionInfo] = useState<{
    originalBytes: number;
    compressedBytes: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    const { data, error } = await table()
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const list = (data ?? []) as Row[];
    setRows(list);
    // Pre-sign thumbnails (1 jam)
    const paths = list.map((r) => r.photo_path).filter((p): p is string => !!p);
    if (paths.length) {
      const map: Record<string, string> = {};
      await Promise.all(
        paths.map(async (p) => {
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(p, 3600);
          if (data?.signedUrl) map[p] = data.signedUrl;
        }),
      );
      setThumbs(map);
    } else {
      setThumbs({});
    }
  }, [uid]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function resetForm() {
    setTitle("");
    setFile(null);
    setCompressionInfo(null);
    setLocationUrl("");
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onSave() {
    if (!uid) return toast.error("Belum login.");
    if (!title.trim()) return toast.error("Judul wajib diisi.");
    if (locationUrl.trim() && !isHttpsUrl(locationUrl.trim())) {
      return toast.error("Link lokasi harus diawali https://");
    }
    setBusy(true);
    try {
      let photoPath: string | null = null;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const up = await supabase.storage.from(BUCKET).upload(path, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        if (up.error) { toast.error(`Upload gagal: ${up.error.message}`); setBusy(false); return; }
        photoPath = path;
      }
      const { error } = await table().insert({
        user_id: uid,
        title: title.trim(),
        photo_path: photoPath,
        location_url: locationUrl.trim() || null,
        note: note.trim() || null,
        status: "ready",
      });
      if (error) { toast.error(error.message); setBusy(false); return; }
      toast.success("Tersimpan di Siap Dikirim.");
      resetForm();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(r: Row) {
    if (!(await confirmDialog({
      title: "Hapus item?",
      description: r.status === "sent" ? "Item riwayat akan dihapus permanen." : "Item siap kirim akan dihapus.",
      confirmText: "Hapus", destructive: true,
    }))) return;
    if (r.photo_path) {
      await supabase.storage.from(BUCKET).remove([r.photo_path]);
    }
    const { error } = await table().delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Item dihapus.");
    await load();
  }

  async function onSendWA(r: Row) {
    const lines = [r.title];
    if (r.location_url) lines.push(`📍 ${r.location_url}`);
    if (r.note) lines.push(r.note);
    const text = lines.join("\n");

    let files: File[] | undefined;
    if (r.photo_path) {
      const url = thumbs[r.photo_path];
      if (url) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const blob = await res.blob();
            const name = r.photo_path.split("/").pop() || "foto.jpg";
            files = [new File([blob], name, { type: blob.type || "image/jpeg" })];
          }
        } catch { /* ignore — fallback ke teks saja */ }
      }
    }

    const result = await shareToWhatsApp({ text, files });
    notifyShareResult(result);
    if (result.status === "shared" || result.status === "fallback") {
      const { error } = await table()
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", r.id);
      if (error) toast.error(`Status gagal diperbarui: ${error.message}`);
      else await load();
    }
  }

  async function onUnsend(r: Row) {
    const { error } = await table().update({ status: "ready", sent_at: null }).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("Dikembalikan ke Siap Dikirim.");
    await load();
  }

  const ready = rows.filter((r) => r.status === "ready");
  const sent = rows.filter((r) => r.status === "sent");

  return (
    <div className="space-y-4">
      {/* Form */}
      <div className="rounded-xl border bg-card p-3 shadow-sm space-y-3">
        <div className="text-sm font-semibold">Siapkan produk sendiri</div>
        <div>
          <label className="text-[11px] font-medium text-muted-foreground">Judul / nama produk</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mis. Beras Pandan 5 kg"
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Foto produk</label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  setCompressionInfo(null);
                  void pickFile(e.target.files?.[0], setFile, e.currentTarget, {
                    autoCompress,
                    onCompressed: setCompressionInfo,
                  });
                }}
                className="hidden"
              />
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  setCompressionInfo(null);
                  void pickFile(e.target.files?.[0], setFile, e.currentTarget, {
                    autoCompress,
                    onCompressed: setCompressionInfo,
                  });
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1.5 text-xs hover:bg-muted/80"
              >
                <ImageIcon className="h-3.5 w-3.5" /> Pilih file
              </button>
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1.5 text-xs hover:bg-muted/80"
              >
                <Camera className="h-3.5 w-3.5" /> Foto langsung
              </button>
              {file && (
                <span className="truncate text-[10px] text-muted-foreground max-w-[140px]">
                  {file.name}
                </span>
              )}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Format: JPG, PNG, WEBP, HEIC. Ukuran maks 8 MB.
            </div>
            <label className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoCompress}
                onChange={(e) => setAutoCompress(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span>
                Auto-kompres foto besar (otomatis diturunkan ke &lt; 8 MB, JPG)
              </span>
            </label>
            {previewUrl && file && (
              <div className="mt-2 rounded-lg border bg-background p-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium text-muted-foreground">
                    Pratinjau foto
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {file.size >= 1024 * 1024
                      ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                      : `${(file.size / 1024).toFixed(0)} KB`}
                  </span>
                </div>
                {compressionInfo && (
                  <div className="mb-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-700 dark:text-emerald-300">
                    Auto-kompres aktif:
                    {" "}
                    <strong>{(compressionInfo.originalBytes / 1024 / 1024).toFixed(2)} MB</strong>
                    {" → "}
                    <strong>{(compressionInfo.compressedBytes / 1024 / 1024).toFixed(2)} MB</strong>
                    {" "}
                    (hemat{" "}
                    {((compressionInfo.originalBytes - compressionInfo.compressedBytes) / 1024 / 1024).toFixed(2)} MB,
                    {" ≈ "}
                    {(
                      ((compressionInfo.originalBytes - compressionInfo.compressedBytes) /
                        compressionInfo.originalBytes) *
                      100
                    ).toFixed(0)}
                    %)
                  </div>
                )}
                <img
                  src={previewUrl}
                  alt="Pratinjau foto produk"
                  className="w-full max-h-64 rounded-md border object-contain bg-muted/30"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1.5 text-xs hover:bg-muted/80"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Ganti dari file
                  </button>
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1.5 text-xs hover:bg-muted/80"
                  >
                    <Camera className="h-3.5 w-3.5" /> Foto ulang
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setCompressionInfo(null);
                      if (fileRef.current) fileRef.current.value = "";
                      if (cameraRef.current) cameraRef.current.value = "";
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/20"
                  >
                    <X className="h-3.5 w-3.5" /> Hapus
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Link lokasi (paste)</label>
            <div className="mt-1 flex items-center gap-1">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={locationUrl}
                onChange={(e) => setLocationUrl(e.target.value)}
                placeholder="https://maps.app.goo.gl/…"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                inputMode="url"
              />
            </div>
            <label className="mt-2 block text-[11px] font-medium text-muted-foreground">Catatan (opsional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Catatan tambahan…"
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={resetForm}
            className="h-9 rounded-md border px-3 text-xs"
            disabled={busy}
          >Reset</button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !title.trim()}
            className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Simpan
          </button>
        </div>
      </div>

      {/* Siap Dikirim */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Siap Dikirim ({ready.length})</h2>
        {loading && rows.length === 0 ? (
          <div className="rounded-xl border bg-card p-4 text-center text-xs text-muted-foreground">Memuat…</div>
        ) : ready.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-4 text-center text-xs text-muted-foreground">
            Belum ada produk siap kirim. Isi form di atas dan klik Simpan.
          </div>
        ) : (
          <ul className="space-y-2">
            {ready.map((r) => (
              <li key={r.id} className="flex gap-3 rounded-xl border bg-card p-3 shadow-sm">
                {r.photo_path && thumbs[r.photo_path] ? (
                  <img src={thumbs[r.photo_path]} alt="" className="h-16 w-16 shrink-0 rounded-md border object-cover" />
                ) : (
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.title}</div>
                  {r.location_url && (
                    <a href={r.location_url} target="_blank" rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary underline">
                      <MapPin className="h-3 w-3" /> Lihat lokasi <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {r.note && <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{r.note}</div>}
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Dibuat {new Date(r.created_at).toLocaleString("id-ID")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => setPreviewSend(r)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-[#25D366]/40 bg-[#25D366]/10 px-2 text-[11px] font-semibold text-[#1ea952]"
                    >
                      <Send className="h-3.5 w-3.5" /> Kirim WA
                    </button>
                    <button
                      onClick={() => onRemove(r)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Hapus
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Riwayat Terkirim */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">Riwayat Terkirim ({sent.length})</h2>
        {sent.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-4 text-center text-xs text-muted-foreground">
            Belum ada riwayat kiriman.
          </div>
        ) : (
          <ul className="space-y-2">
            {sent.map((r) => (
              <li key={r.id} className="flex gap-3 rounded-xl border bg-card p-3 shadow-sm opacity-90">
                {r.photo_path && thumbs[r.photo_path] ? (
                  <img src={thumbs[r.photo_path]} alt="" className="h-14 w-14 shrink-0 rounded-md border object-cover" />
                ) : (
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Dikirim {r.sent_at ? new Date(r.sent_at).toLocaleString("id-ID") : "—"}
                  </div>
                  {r.location_url && (
                    <a href={r.location_url} target="_blank" rel="noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary underline">
                      <MapPin className="h-3 w-3" /> Lokasi
                    </a>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => onUnsend(r)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px]"
                    >↩ Tandai belum terkirim</button>
                    <button
                      onClick={() => onRemove(r)}
                      className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Hapus
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}