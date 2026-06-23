import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PhotoEditor } from "@/components/PhotoEditor";
import { signedUrl, uploadPrepPhoto, type PrepItemRow, type PrepTaskRow } from "@/lib/prep";
import { uploadRequestPhotoViaToken } from "@/lib/request";
import { publicSupabase } from "@/lib/public-supabase";
import { MapPin, Camera, Image as ImageIcon, Edit3, Send, Loader2, Lock, ShieldCheck, Clock, CheckCircle2, Package, MessageCircle } from "lucide-react";
import { shareToWhatsApp, notifyShareResult } from "@/lib/share-wa";

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
  const autoTriedRef = useRef(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Pembatasan percobaan di sisi klien: maksimal MAX_ATTEMPTS PIN salah
  // berturut-turut sebelum input PIN dikunci selama LOCK_SECONDS.
  // Data disimpan di localStorage per-token agar reload halaman tidak
  // mem-bypass pembatasan. Server juga punya rate-limit terpisah
  // (mengembalikan "rate_limited" + retry_after).
  const MAX_ATTEMPTS = 3;
  const LOCK_SECONDS = 60;
  const STORAGE_KEY = `prep_pin_attempts:${token}`;
  const [attempts, setAttempts] = useState(0);
  const [justUnlocked, setJustUnlocked] = useState(false);

  type AttemptState = { attempts: number; lockedUntil: number | null };
  function readAttemptState(): AttemptState {
    if (typeof window === "undefined") return { attempts: 0, lockedUntil: null };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return { attempts: 0, lockedUntil: null };
      const parsed = JSON.parse(raw) as AttemptState;
      return {
        attempts: Number(parsed.attempts) || 0,
        lockedUntil: parsed.lockedUntil && parsed.lockedUntil > Date.now() ? parsed.lockedUntil : null,
      };
    } catch {
      return { attempts: 0, lockedUntil: null };
    }
  }
  function writeAttemptState(state: AttemptState) {
    if (typeof window === "undefined") return;
    try {
      if (!state.attempts && !state.lockedUntil) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* ignore quota */ }
  }
  // Reset total: state in-memory + localStorage benar-benar dibersihkan.
  // Dipanggil saat PIN benar agar refresh browser memulai dari 0 percobaan.
  function resetAttemptsFully() {
    setAttempts(0);
    setLockedUntil(null);
    setJustUnlocked(false);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        // jaga-jaga jika ada key lama dari versi sebelumnya
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch { /* ignore */ }
    }
  }

  useEffect(() => {
    const s = readAttemptState();
    setAttempts(s.attempts);
    if (s.lockedUntil) setLockedUntil(s.lockedUntil);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sinkronkan antar-tab: jika tab lain berhasil verifikasi PIN dan
  // menghapus STORAGE_KEY, tab ini juga ikut reset.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue == null) {
        setAttempts(0);
        setLockedUntil(null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lockedUntil == null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (lockedUntil <= t) {
        setLockedUntil(null);
        setAttempts(0);
        writeAttemptState({ attempts: 0, lockedUntil: null });
        setJustUnlocked(true);
        setTimeout(() => setJustUnlocked(false), 6000);
      }
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedUntil]);

  const lockedSecondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const isLocked = lockedSecondsLeft > 0;
  const lockedClock = `${String(Math.floor(lockedSecondsLeft / 60)).padStart(2, "0")}:${String(lockedSecondsLeft % 60).padStart(2, "0")}`;
  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempts);

  async function fetchTask(p: string) {
    if (isLocked) return false;
    setLoading(true);
    const { data, error } = await publicSupabase.rpc("prep_get_task", { _token: token, _pin: p });
    setLoading(false);
    if (error) { toast.error("Gagal: " + error.message); return false; }
    const res = data as { ok: boolean; error?: string; retry_after?: number; task?: PrepTaskRow; items?: PrepItemRow[] };
    if (!res?.ok) {
      if (res?.error === "rate_limited") {
        const secs = Math.max(1, res.retry_after ?? 600);
        setLockedUntil(Date.now() + secs * 1000);
        writeAttemptState({ attempts: MAX_ATTEMPTS, lockedUntil: Date.now() + secs * 1000 });
        toast.error(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(secs / 60)} menit.`);
      } else {
        if (res?.error === "bad_pin") {
          const next = attempts + 1;
          if (next >= MAX_ATTEMPTS) {
            const until = Date.now() + LOCK_SECONDS * 1000;
            setAttempts(next);
            setLockedUntil(until);
            writeAttemptState({ attempts: next, lockedUntil: until });
            toast.error(`PIN salah. Input dikunci ${LOCK_SECONDS} detik.`);
          } else {
            setAttempts(next);
            writeAttemptState({ attempts: next, lockedUntil: null });
            toast.error(`PIN salah. Sisa percobaan: ${MAX_ATTEMPTS - next}`);
          }
          setPin("");
        } else {
          toast.error("Tugas tidak ditemukan / kedaluwarsa");
        }
      }
      return false;
    }
    // PIN benar → reset penuh, termasuk localStorage, sehingga refresh
    // browser tidak membawa sisa percobaan/lock.
    resetAttemptsFully();
    setTask(res.task!); setItems(res.items ?? []); setAuthed(true); pinRef.current = p;
    toast.success("PIN berhasil — selamat datang", {
      description: "Percobaan PIN telah di-reset.",
    });
    // Pastikan posisi scroll kembali ke atas halaman tugas.
    if (typeof window !== "undefined") {
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
    }
    return true;
  }

  // poll-ish refresh after submission
  async function refresh() {
    if (!pinRef.current) return;
    await fetchTask(pinRef.current);
  }

  // Auto-buka tugas jika PIN diberikan via fragment URL ( #p=1234 ).
  // Fragment tidak dikirim ke server, jadi PIN tetap aman dari log.
  useEffect(() => {
    if (authed || autoTriedRef.current || typeof window === "undefined") return;
    const hash = window.location.hash || "";
    const m = hash.match(/(?:^#|[#&])p=(\d{4,8})/);
    if (!m) return;
    autoTriedRef.current = true;
    const autoPin = m[1];
    setPin(autoPin);
    void fetchTask(autoPin);
    // Bersihkan fragment dari address bar agar PIN tidak terlihat lagi.
    try {
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", `${pathname}${search}`);
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authed) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background">
        <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-4 py-8">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <Package className="h-7 w-7 text-primary" />
            </div>
            <div className="text-lg font-semibold tracking-tight">MCM Storage</div>
            <div className="text-xs text-muted-foreground">Portal Tugas Pegawai</div>
          </div>
          <div className="w-full rounded-2xl border bg-card p-6 shadow-lg shadow-black/5">
            <div className="mb-1 flex items-center gap-2 text-base font-semibold"><Lock className="h-4 w-4 text-primary" /> Verifikasi PIN</div>
            <p className="mb-5 text-xs leading-relaxed text-muted-foreground">Masukkan PIN dari pemilik untuk membuka daftar barang yang harus disiapkan.</p>
            {(isLocked || attempts > 0) && (
              <div
                className={
                  "mb-4 grid grid-cols-2 gap-2 rounded-lg border p-2 text-center " +
                  (isLocked
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-amber-500/40 bg-amber-500/5")
                }
              >
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sisa percobaan</div>
                  <div
                    className={
                      "mt-0.5 text-xl font-bold tabular-nums " +
                      (isLocked
                        ? "text-destructive"
                        : attemptsLeft <= 1
                          ? "text-destructive"
                          : "text-amber-700 dark:text-amber-400")
                    }
                  >
                    {attemptsLeft}
                    <span className="text-xs font-normal text-muted-foreground"> / {MAX_ATTEMPTS}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Tunggu</div>
                  <div
                    className={
                      "mt-0.5 text-xl font-bold tabular-nums " +
                      (isLocked ? "text-destructive" : "text-muted-foreground/60")
                    }
                  >
                    {isLocked
                      ? `${Math.floor(lockedSecondsLeft / 60)}:${String(lockedSecondsLeft % 60).padStart(2, "0")}`
                      : "—"}
                  </div>
                </div>
              </div>
            )}
            <input
              inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••" disabled={isLocked}
              className="mb-3 h-14 w-full rounded-lg border bg-background px-3 text-center text-2xl tracking-[0.6em] tabular-nums shadow-inner focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60" />
            <button disabled={pin.length < 4 || loading || isLocked} onClick={() => fetchTask(pin)}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isLocked ? `Terkunci ${lockedClock} lagi` : "Buka Tugas"}
            </button>
            {isLocked && (
              <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11px] leading-relaxed text-destructive">
                <div className="font-semibold">Terkunci {lockedClock} lagi</div>
                <div className="mt-0.5 opacity-90">
                  Terlalu banyak PIN salah. Anda bisa mencoba lagi setelah hitungan mundur selesai.
                </div>
              </div>
            )}
            {!isLocked && justUnlocked && (
              <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                <div className="font-semibold">Kunci dibuka — silakan coba lagi</div>
                <div className="mt-0.5 opacity-90">
                  Pastikan PIN dari pemilik benar. Anda punya {MAX_ATTEMPTS} percobaan baru.
                </div>
              </div>
            )}
            {!isLocked && attempts > 0 && (
              <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                <div className="font-semibold">Silakan coba lagi</div>
                <div className="mt-0.5 opacity-90">
                  Sisa percobaan: <b>{attemptsLeft}</b> dari {MAX_ATTEMPTS}. Setelah {MAX_ATTEMPTS} kali salah, input akan dikunci {LOCK_SECONDS} detik.
                </div>
              </div>
            )}
            {(isLocked || attempts > 0) && (
              <button
                type="button"
                onClick={async () => {
                  const pageUrl = typeof window !== "undefined" ? window.location.href.split("#")[0] : "";
                  const text = [
                    "Halo, saya pegawai untuk tugas penyiapan barang.",
                    isLocked
                      ? "Akses saya terkunci karena PIN salah beberapa kali."
                      : "Sepertinya PIN yang saya terima tidak cocok / sudah kedaluwarsa.",
                    "Mohon kirim ulang PIN tugas yang baru.",
                    "",
                    `Link tugas: ${pageUrl}`,
                  ].join("\n");
                  const res = await shareToWhatsApp({ text, title: "Minta PIN baru", url: pageUrl });
                  notifyShareResult(res);
                }}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 px-3 text-xs font-semibold text-[#128C7E] transition hover:bg-[#25D366]/20 dark:text-[#25D366]"
              >
                <MessageCircle className="h-4 w-4" /> Minta PIN baru ke pemilik
              </button>
            )}
            <p className="mt-2 text-center text-[10px] leading-relaxed text-muted-foreground">
              Tombol ini hanya membuka WhatsApp dengan pesan siap kirim — pembatasan percobaan tetap berlaku sampai hitungan mundur selesai.
            </p>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Koneksi terenkripsi · Sesi terbatas waktu
            </div>
          </div>
          <div className="mt-6 text-[10px] text-muted-foreground">© MCM Storage</div>
        </div>
      </div>
    );
  }

  const totalItems = items.length;
  const completedItems = items.filter((i) => (i.submissions?.length ?? 0) > 0).length;
  const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/40 to-background pb-12">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <Package className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">MCM Storage</div>
            <div className="truncate text-sm font-semibold">Tugas Penyiapan Barang</div>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400">
            <ShieldCheck className="h-3 w-3" /> Terverifikasi
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-3 pt-4">
        <div className="mb-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b bg-gradient-to-r from-primary/5 to-transparent px-4 py-3">
            <div className="text-base font-semibold leading-tight">{task?.title}</div>
            {task?.note && <div className="mt-1 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{task.note}</div>}
          </div>
          <div className="grid grid-cols-2 divide-x text-center">
            <div className="px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Progres</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{completedItems} / {totalItems}</div>
            </div>
            <div className="flex items-center justify-center gap-1.5 px-3 py-2.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <div className="text-left">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Kedaluwarsa</div>
                <div className="text-[11px] font-medium tabular-nums">{task ? new Date(task.expires_at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : ""}</div>
              </div>
            </div>
          </div>
          <div className="h-1.5 w-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="space-y-3">
          {items.map((it, idx) => (
            <ItemCard key={it.id} index={idx + 1} item={it} token={token} pin={pinRef.current} onSubmitted={refresh} />
          ))}
          {items.length === 0 && <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">Belum ada item.</div>}
        </div>

        <RequestSection token={token} pin={pinRef.current} />

        <div className="mt-6 text-center text-[10px] text-muted-foreground">Tetap aman · Jangan bagikan PIN ke siapa pun</div>
      </div>
    </div>
  );
}

function ItemCard({ item, index, token, pin, onSubmitted }: { item: PrepItemRow; index: number; token: string; pin: string; onSubmitted: () => void }) {
  const [photo, setPhoto] = useState<StagedPhoto | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [locUrl, setLocUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refSigned, setRefSigned] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { signedUrl(item.ref_photo_path, 60 * 60 * 24 * 7, publicSupabase).then(setRefSigned); }, [item.ref_photo_path]);

  function pickCamera() { cameraRef.current?.click(); }
  function pickGallery() { galleryRef.current?.click(); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    setEditorSrc(dataUrl);
    setEditorOpen(true);
    // Auto-isi GPS begitu foto dipilih/diambil, supaya pegawai tidak perlu klik tombol manual.
    if (!gps && !locUrl && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setGps({ lat: latitude, lng: longitude });
          setLocUrl(`https://www.google.com/maps?q=${latitude},${longitude}`);
        },
        () => { /* abaikan, pegawai bisa klik tombol GPS manual */ },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
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
    if (!photo) {
      toast.error("Wajib lampirkan foto bukti timbangan/barang");
      return;
    }
    if (locUrl) {
      if (locUrl.length > 2048) { toast.error("URL lokasi terlalu panjang"); return; }
      if (!/^https:\/\//i.test(locUrl)) { toast.error("URL lokasi harus diawali https://"); return; }
    }
    setBusy(true);
    try {
      let photoPath: string | null = null;
      if (photo) {
        photoPath = await uploadPrepPhoto(token, item.id, photo.blob, "jpg", publicSupabase);
        if (!photoPath) { toast.error("Upload foto gagal"); setBusy(false); return; }
      }
      const args = {
        _token: token, _pin: pin, _task_item_id: item.id,
        _photo_path: photoPath, _location_url: locUrl || null,
        _gps_lat: gps?.lat ?? null, _gps_lng: gps?.lng ?? null,
        _note: note || null, _qty_reported: null,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (publicSupabase.rpc as any)("prep_submit", args);
      if (error) throw error;
      const res = data as { ok: boolean; error?: string; available?: number; requested?: number; deducted?: number };
      if (!res?.ok) {
        const msg = res?.error === "insufficient_stock"
          ? `Stok gudang tidak cukup (tersedia ${res.available}, diminta ${res.requested})`
          : res?.error === "item_not_found"
          ? "Barang tidak ditemukan di gudang"
          : res?.error === "bad_pin" ? "PIN salah"
          : (res?.error || "submit_failed");
        throw new Error(msg);
      }
      toast.success(`Terkirim. Stok gudang dikurangi ${res.deducted ?? item.qty_requested} ${item.unit_label ?? ""}`);
      setPhoto(null); setLocUrl(""); setGps(null); setNote("");
      onSubmitted();
    } catch (e) {
      toast.error("Gagal kirim: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  const isDone = (item.submissions?.length ?? 0) > 0;
  return (
    <div className={`overflow-hidden rounded-2xl border bg-card shadow-sm transition ${isDone ? "border-emerald-500/30" : ""}`}>
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Item #{index}</div>
        {isDone ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> Selesai
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400">
            Belum dikirim
          </span>
        )}
      </div>
      <div className="p-3">
      <div className="flex items-start gap-3">
        {refSigned ? (
          <img src={refSigned} alt="" className="h-16 w-16 rounded-lg border object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border bg-muted text-[10px] text-muted-foreground">No img</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight">{item.name}</div>
          <div className="text-[11px] text-muted-foreground">{item.category ?? "—"}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Target {item.qty_requested} {item.unit_label ?? ""}</span>
            <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Disiapkan {item.qty_prepared ?? 0}</span>
          </div>
          {item.note && <div className="mt-1 text-[11px] text-muted-foreground">Catatan: {item.note}</div>}
        </div>
      </div>

      {photo ? (
        <div className="mt-3">
          <img src={photo.dataUrl} alt="" className="w-full rounded-lg border object-cover" />
          <div className="mt-1 flex gap-2">
            <button onClick={() => { setEditorSrc(photo.dataUrl); setEditorOpen(true); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"><Edit3 className="h-3 w-3" /> Edit lagi</button>
            <button onClick={() => setPhoto(null)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-destructive">Hapus</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={pickCamera} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border bg-background text-xs font-medium transition hover:bg-muted"><Camera className="h-4 w-4" /> Kamera</button>
          <button onClick={pickGallery} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border bg-background text-xs font-medium transition hover:bg-muted"><ImageIcon className="h-4 w-4" /> Galeri</button>
        </div>
      )}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
        Siapkan <b>{item.qty_requested} {item.unit_label ?? ""}</b> sesuai instruksi pemilik. Setelah foto + lokasi terkirim, stok gudang otomatis berkurang sebanyak itu — Anda tidak perlu mengisi angka apa pun.
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        <div className="flex gap-2">
          <input value={locUrl} onChange={(e) => setLocUrl(e.target.value)} placeholder="Link Google Maps (opsional)" className="h-10 flex-1 rounded-lg border bg-background px-3 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
          <button onClick={takeLocation} className="inline-flex h-10 items-center gap-1 rounded-lg border bg-background px-3 text-xs font-medium transition hover:bg-muted"><MapPin className="h-4 w-4" /> GPS</button>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" className="h-10 w-full rounded-lg border bg-background px-3 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
      </div>

      <button disabled={busy} onClick={submit} className="mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Kirim
      </button>

      {item.submissions.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Sudah terkirim ({item.submissions.length})</div>
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
    </div>
  );
}

function SubmissionThumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { signedUrl(path, 60 * 60, publicSupabase).then(setUrl); }, [path]);
  if (!url) return <div className="h-12 w-12 shrink-0 rounded border bg-muted" />;
  return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded border object-cover" />;
}

// ------------------------------------------------------------------
// REQUEST section: paket multi-produk untuk pegawai
// ------------------------------------------------------------------
type RequestTitleDTO = {
  id: string;
  name: string;
  note: string | null;
  items: Array<{
    id: string;
    warehouse_item_id: string;
    product_name: string | null;
    target_grams: number;
    unit_label: string;
    note: string | null;
  }>;
};

function RequestSection({ token, pin }: { token: string; pin: string }) {
  const [titles, setTitles] = useState<RequestTitleDTO[] | null>(null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (publicSupabase.rpc as any)("request_list_titles_via_task", { _token: token, _pin: pin });
    if (error) { toast.error("Gagal muat request: " + error.message); return; }
    const res = data as { ok: boolean; titles?: RequestTitleDTO[]; owner_user_id?: string };
    if (res?.ok) {
      setTitles(res.titles ?? []);
      setOwnerUserId(res.owner_user_id ?? null);
    } else setTitles([]);
  }
  useEffect(() => { void load(); }, [token, pin]);

  if (!titles) return null;
  if (titles.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <Package className="h-4 w-4 text-primary" />
        <div className="text-sm font-semibold">Paket Request</div>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{titles.length}</span>
      </div>
      <div className="space-y-2">
        {titles.map((t) => (
          <div key={t.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <button
              onClick={() => setOpenId(openId === t.id ? null : t.id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{t.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {t.items.map((i) => `${i.product_name ?? "?"} ${i.target_grams}${i.unit_label}`).join(" · ")}
                </div>
              </div>
              <span className="ml-2 rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground">
                {openId === t.id ? "Tutup" : "Siapkan"}
              </span>
            </button>
            {openId === t.id && (
              <div className="border-t bg-muted/20 p-3">
                <RequestForm title={t} token={token} pin={pin} ownerUserId={ownerUserId} onDone={() => { setOpenId(null); void load(); }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestForm({
  title, token, pin, ownerUserId, onDone,
}: { title: RequestTitleDTO; token: string; pin: string; ownerUserId: string | null; onDone: () => void }) {
  const [rows, setRows] = useState(
    title.items.map((i) => ({
      warehouse_item_id: i.warehouse_item_id,
      product_name: i.product_name,
      unit_label: i.unit_label,
      actual_grams: String(i.target_grams),
    })),
  );
  const [photo, setPhoto] = useState<StagedPhoto | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);
  const [locUrl, setLocUrl] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    setEditorSrc(dataUrl); setEditorOpen(true);
    if (!gps && !locUrl && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocUrl(`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 },
      );
    }
  }

  function takeLocation() {
    if (!navigator.geolocation) { toast.error("GPS tidak tersedia"); return; }
    const id = toast.loading("Mengambil lokasi…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocUrl(`https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`);
        toast.success("Lokasi terisi", { id });
      },
      (err) => toast.error("Gagal: " + err.message, { id }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit() {
    if (!photo) { toast.error("Wajib lampirkan foto bukti"); return; }
    const validRows = rows.filter((r) => Number(r.actual_grams) > 0);
    if (validRows.length === 0) { toast.error("Minimal 1 item dengan jumlah > 0"); return; }
    setBusy(true);
    try {
      if (!ownerUserId) { toast.error("Sesi belum siap, coba muat ulang"); setBusy(false); return; }
      const photoPath = await uploadRequestPhotoViaToken(ownerUserId, token, photo.blob, "jpg", publicSupabase);
      if (!photoPath) throw new Error("Upload foto gagal");
      const itemsPayload = validRows.map((r) => ({
        warehouse_item_id: r.warehouse_item_id,
        actual_grams: Number(r.actual_grams),
      }));
      const args = {
        _token: token, _pin: pin, _title_id: title.id,
        _items: itemsPayload,
        _photo_path: photoPath, _location_url: locUrl || null,
        _gps_lat: gps?.lat ?? null, _gps_lng: gps?.lng ?? null,
        _note: note || null, _prep_task_item_id: null,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (publicSupabase.rpc as any)("request_submit_via_task", args);
      if (error) throw error;
      const res = data as { ok: boolean; error?: string };
      if (!res?.ok) throw new Error(res?.error || "submit_failed");
      toast.success("Paket request terkirim, stok dikurangi");
      onDone();
    } catch (e) {
      toast.error("Gagal: " + (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {rows.map((r, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-1.5">
            <div className="col-span-8 flex items-center rounded-md border bg-background px-2 text-xs">
              {r.product_name ?? "?"}
            </div>
            <input
              type="number" inputMode="decimal" step="any" min="0"
              value={r.actual_grams}
              onChange={(e) => setRows((rs) => rs.map((x, i) => i === idx ? { ...x, actual_grams: e.target.value } : x))}
              className="col-span-3 h-9 rounded-md border bg-background px-2 text-xs"
            />
            <div className="col-span-1 flex items-center text-[10px] text-muted-foreground">{r.unit_label}</div>
          </div>
        ))}
      </div>

      {photo ? (
        <div>
          <img src={photo.dataUrl} alt="" className="w-full rounded-lg border object-cover" />
          <div className="mt-1 flex gap-2">
            <button onClick={() => { setEditorSrc(photo.dataUrl); setEditorOpen(true); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"><Edit3 className="h-3 w-3" /> Edit</button>
            <button onClick={() => setPhoto(null)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-destructive">Hapus</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => cameraRef.current?.click()} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border bg-background text-xs font-medium hover:bg-muted"><Camera className="h-4 w-4" /> Kamera</button>
          <button onClick={() => galleryRef.current?.click()} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border bg-background text-xs font-medium hover:bg-muted"><ImageIcon className="h-4 w-4" /> Galeri</button>
        </div>
      )}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <div className="flex gap-2">
        <input value={locUrl} onChange={(e) => setLocUrl(e.target.value)} placeholder="Link Google Maps (opsional)" className="h-10 flex-1 rounded-lg border bg-background px-3 text-xs" />
        <button onClick={takeLocation} className="inline-flex h-10 items-center gap-1 rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted"><MapPin className="h-4 w-4" /> GPS</button>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)" className="h-10 w-full rounded-lg border bg-background px-3 text-xs" />

      <button disabled={busy} onClick={submit} className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Kirim Paket
      </button>

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