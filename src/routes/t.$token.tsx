import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PhotoEditor } from "@/components/PhotoEditor";
import { signedUrl, uploadPrepPhoto, type PrepItemRow, type PrepTaskRow } from "@/lib/prep";
import { MapPin, Camera, Image as ImageIcon, Edit3, Send, Loader2, Lock } from "lucide-react";

export const Route = createFileRoute("/t/$token")({
  head: () => ({
    meta: [
      { title: "Tugas Siapkan Barang · MCM Storage" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PublicPrepPage,
});

type StagedPhoto = { dataUrl: string; blob: Blob };

function PublicPrepPage() {
  const { token } = Route.useParams();
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [task, setTask] = useState<PrepTaskRow | null>(null);
  const [items, setItems] = useState<PrepItemRow[]>([]);
  const pinRef = useRef("");

  async function fetchTask(p: string) {
    setLoading(true);
    const { data, error } = await supabase.rpc("prep_get_task", { _token: token, _pin: p });
    setLoading(false);
    if (error) { toast.error("Gagal: " + error.message); return false; }
    const res = data as { ok: boolean; error?: string; task?: PrepTaskRow; items?: PrepItemRow[] };
    if (!res?.ok) {
      toast.error(res?.error === "bad_pin" ? "PIN salah" : "Tugas tidak ditemukan / kedaluwarsa");
      return false;
    }
    setTask(res.task!); setItems(res.items ?? []); setAuthed(true); pinRef.current = p;
    return true;
  }

  // poll-ish refresh after submission
  async function refresh() {
    if (!pinRef.current) return;
    await fetchTask(pinRef.current);
  }

  if (!authed) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-4">
        <div className="w-full rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2 text-lg font-semibold"><Lock className="h-5 w-5" /> Masukkan PIN</div>
          <p className="mb-4 text-xs text-muted-foreground">Tanyakan PIN ke pengirim link. Setelah benar, daftar barang akan tampil.</p>
          <input
            inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="••••••" className="mb-3 h-12 w-full rounded-md border bg-background px-3 text-center text-2xl tracking-[0.5em] tabular-nums" />
          <button disabled={pin.length < 4 || loading} onClick={() => fetchTask(pin)}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Buka tugas
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-3 py-4">
      <div className="mb-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="text-base font-semibold">{task?.title}</div>
        {task?.note && <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{task.note}</div>}
        <div className="mt-2 text-[10px] text-muted-foreground">Kedaluwarsa: {task ? new Date(task.expires_at).toLocaleString("id-ID") : ""}</div>
      </div>
      <div className="space-y-3">
        {items.map((it) => (
          <ItemCard key={it.id} item={it} token={token} pin={pinRef.current} onSubmitted={refresh} />
        ))}
        {items.length === 0 && <div className="rounded-xl border bg-card p-4 text-center text-sm text-muted-foreground">Belum ada item.</div>}
      </div>
    </div>
  );
}

function ItemCard({ item, token, pin, onSubmitted }: { item: PrepItemRow; token: string; pin: string; onSubmitted: () => void }) {
  const [photo, setPhoto] = useState<StagedPhoto | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [locUrl, setLocUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<string>(String(item.qty_requested ?? ""));
  const [busy, setBusy] = useState(false);
  const [refSigned, setRefSigned] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { signedUrl(item.ref_photo_path).then(setRefSigned); }, [item.ref_photo_path]);

  function pickCamera() { cameraRef.current?.click(); }
  function pickGallery() { galleryRef.current?.click(); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    setEditorSrc(dataUrl);
    setEditorOpen(true);
  }

  function takeLocation() {
    if (!navigator.geolocation) { toast.error("GPS tidak tersedia"); return; }
    const id = toast.loading("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setGps({ lat: latitude, lng: longitude });
        setLocUrl(`https://www.google.com/maps?q=${latitude},${longitude}`);
        toast.success("Lokasi terisi", { id });
      },
      (err) => toast.error("Gagal: " + err.message, { id }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function submit() {
    if (!photo && !locUrl && !note) { toast.error("Isi minimal foto, lokasi, atau catatan"); return; }
    setBusy(true);
    try {
      let photoPath: string | null = null;
      if (photo) {
        photoPath = await uploadPrepPhoto(token, item.id, photo.blob, "jpg");
        if (!photoPath) { toast.error("Upload foto gagal"); setBusy(false); return; }
      }
      const { data, error } = await supabase.rpc("prep_submit", {
        _token: token, _pin: pin, _task_item_id: item.id,
        _photo_path: photoPath ?? "",
        _location_url: locUrl || "",
        _gps_lat: gps?.lat ?? 0, _gps_lng: gps?.lng ?? 0,
        _note: note || "", _qty_reported: qty ? Number(qty) : 0,
      } as never);
      if (error) throw error;
      const res = data as { ok: boolean; error?: string };
      if (!res?.ok) throw new Error(res?.error || "submit_failed");
      toast.success("Terkirim ke pemilik tugas");
      setPhoto(null); setLocUrl(""); setGps(null); setNote("");
      onSubmitted();
    } catch (e) {
      toast.error("Gagal kirim: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-3">
        {refSigned ? (
          <img src={refSigned} alt="" className="h-16 w-16 rounded-md border object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-md border bg-muted text-[10px] text-muted-foreground">No img</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{item.name}</div>
          <div className="text-[11px] text-muted-foreground">{item.category ?? "—"}</div>
          <div className="mt-1 text-[11px]">Diminta: <b>{item.qty_requested}</b> {item.unit_label ?? ""}</div>
          {item.note && <div className="mt-1 text-[11px] text-muted-foreground">Catatan: {item.note}</div>}
        </div>
      </div>

      {photo ? (
        <div className="mt-3">
          <img src={photo.dataUrl} alt="" className="w-full rounded-md border object-cover" />
          <div className="mt-1 flex gap-2">
            <button onClick={() => { setEditorSrc(photo.dataUrl); setEditorOpen(true); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"><Edit3 className="h-3 w-3" /> Edit lagi</button>
            <button onClick={() => setPhoto(null)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-destructive">Hapus</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={pickCamera} className="inline-flex h-10 items-center justify-center gap-1 rounded-md border text-xs"><Camera className="h-4 w-4" /> Kamera</button>
          <button onClick={pickGallery} className="inline-flex h-10 items-center justify-center gap-1 rounded-md border text-xs"><ImageIcon className="h-4 w-4" /> Galeri</button>
        </div>
      )}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <div className="mt-3 grid grid-cols-1 gap-2">
        <div className="flex gap-2">
          <input value={locUrl} onChange={(e) => setLocUrl(e.target.value)} placeholder="Link Google Maps (opsional)" className="h-9 flex-1 rounded-md border bg-background px-2 text-xs" />
          <button onClick={takeLocation} className="inline-flex h-9 items-center gap-1 rounded-md border px-2 text-xs"><MapPin className="h-4 w-4" /> GPS</button>
        </div>
        <div className="flex gap-2">
          <input type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty disiapkan" className="h-9 w-32 rounded-md border bg-background px-2 text-xs tabular-nums" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" className="h-9 flex-1 rounded-md border bg-background px-2 text-xs" />
        </div>
      </div>

      <button disabled={busy} onClick={submit} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1 rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Kirim
      </button>

      {item.submissions.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="mb-1 text-[10px] uppercase text-muted-foreground">Sudah terkirim ({item.submissions.length})</div>
          <div className="flex gap-1 overflow-x-auto">
            {item.submissions.map((s) => <SubmissionThumb key={s.id} path={s.photo_path} />)}
          </div>
        </div>
      )}

      {editorOpen && editorSrc && (
        <PhotoEditor
          src={editorSrc}
          onCancel={() => setEditorOpen(false)}
          onSave={(blob, dataUrl) => { setPhoto({ blob, dataUrl }); setEditorOpen(false); }}
        />
      )}
    </div>
  );
}

function SubmissionThumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { signedUrl(path, 60 * 60).then(setUrl); }, [path]);
  if (!url) return <div className="h-12 w-12 shrink-0 rounded border bg-muted" />;
  return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded border object-cover" />;
}