import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Penjualan Harian" },
      { name: "description", content: "Kelola pesanan, status pengiriman, dan kirim WA dalam satu halaman." },
      { property: "og:title", content: "Penjualan Harian" },
      { property: "og:description", content: "Kelola pesanan, status pengiriman, dan kirim WA dalam satu halaman." },
    ],
  }),
  component: Index,
});

type Status = "Belum Dikirim" | "Sudah Dikirim";
type Kategori = "1 gram" | "St" | "Spr";

type Produk = {
  id: number;
  kategori: Kategori;
  nama: string;
  harga: number;
  status: Status;
  keterangan: string;
  lokasi: string;
  foto?: string;
  galeri?: string[];
};

const HARGA: Record<Kategori, number> = { "1 gram": 50000, St: 75000, Spr: 100000 };
const TAG: Record<Kategori, string> = { "1 gram": "1g", St: "St", Spr: "Spr" };

function buildInitial(): Produk[] {
  const items: Produk[] = [];
  let id = 1;
  const make = (kat: Kategori, count: number) => {
    for (let i = 0; i < count; i++, id++) {
      items.push({
        id,
        kategori: kat,
        nama: `Produk ${id}`,
        harga: HARGA[kat],
        status: "Belum Dikirim",
        keterangan: id === 1 ? "5g lakban hitam pepet tembok" : `Keterangan ${id}`,
        lokasi:
          id === 1
            ? "https://goo.gl/maps/RKwBxEqwHeM8TAEB6"
            : "https://goo.gl/maps/xxx",
      });
    }
  };
  make("1 gram", 10);
  make("St", 10);
  make("Spr", 10);
  return items;
}

const STORAGE_KEY = "penjualan-harian-v1";
const THEME_KEY = "penjualan-theme";

function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

function buildPesan(p: Produk) {
  return `📦 [${TAG[p.kategori]}] *${p.nama}*\n💰 Harga: Rp ${p.harga.toLocaleString("id-ID")}\n📍 ${p.lokasi}\nKet: ${p.keterangan}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file: File, maxSize = 1280, quality = 0.75): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function Index() {
  const [items, setItems] = useState<Produk[]>(() => buildInitial());
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<"semua" | Status>("semua");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {}
    try {
      const t = localStorage.getItem(THEME_KEY) as "light" | "dark" | null;
      const initial =
        t ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      setTheme(initial);
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme, hydrated]);

  const total = useMemo(
    () => items.filter((i) => i.status === "Sudah Dikirim").reduce((s, i) => s + i.harga, 0),
    [items],
  );
  const terkirim = items.filter((i) => i.status === "Sudah Dikirim").length;

  const update = (id: number, patch: Partial<Produk>) =>
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const setFoto = async (id: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const dataUrl = await compressImage(files[0]);
    update(id, { foto: dataUrl });
    // Ambil lokasi otomatis saat foto diambil
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          const link = `https://www.google.com/maps?q=${latitude},${longitude}`;
          update(id, { lokasi: link });
        },
        (err) => {
          alert("Gagal ambil lokasi: " + err.message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    }
  };

  const addGaleri = async (id: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr: string[] = [];
    for (const f of Array.from(files)) arr.push(await compressImage(f));
    setItems((items) =>
      items.map((i) =>
        i.id === id ? { ...i, galeri: [...(i.galeri ?? []), ...arr] } : i,
      ),
    );
  };

  const removeFoto = (id: number) => update(id, { foto: undefined });
  const removeGaleri = (id: number, idx: number) =>
    setItems((items) =>
      items.map((i) =>
        i.id === id
          ? { ...i, galeri: (i.galeri ?? []).filter((_, n) => n !== idx) }
          : i,
      ),
    );

  const reset = () => {
    if (confirm("Reset semua data ke kondisi awal?")) setItems(buildInitial());
  };

  const resetStatus = () => {
    if (confirm("Tandai semua pesanan sebagai Belum Dikirim?"))
      setItems((arr) => arr.map((i) => ({ ...i, status: "Belum Dikirim" })));
  };

  const filtered = items.filter((i) => filter === "semua" || i.status === filter);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Penjualan Harian</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {terkirim} dari {items.length} pesanan terkirim
              </p>
            </div>
            <div className="rounded-xl border bg-secondary px-5 py-4 text-right">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Total penjualan hari ini
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {rupiah(total)}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {(["semua", "Belum Dikirim", "Sudah Dikirim"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === f
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-accent"
                }`}
              >
                {f === "semua" ? "Semua" : f}
              </button>
            ))}
            <div className="ml-auto flex gap-2">
              <button
                onClick={resetStatus}
                className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Reset status
              </button>
              <button
                onClick={reset}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                Reset data
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <ul className="grid gap-3">
          {filtered.map((p) => {
            const sent = p.status === "Sudah Dikirim";
            const waUrl = `https://wa.me/?text=${encodeURIComponent(buildPesan(p))}`;
            return (
              <li
                key={p.id}
                className={`rounded-xl border bg-card p-4 shadow-sm transition-opacity ${
                  sent ? "opacity-70" : ""
                }`}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                        {p.kategori}
                      </span>
                      <span className="text-xs text-muted-foreground">#{p.id}</span>
                    </div>
                    <input
                      value={p.nama}
                      onChange={(e) => update(p.id, { nama: e.target.value })}
                      className="mt-2 w-full bg-transparent text-base font-semibold outline-none focus:ring-2 focus:ring-ring rounded px-1 -mx-1"
                    />
                    <div className="mt-1 text-sm font-medium tabular-nums text-foreground">
                      {rupiah(p.harga)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={sent}
                        onChange={(e) =>
                          update(p.id, {
                            status: e.target.checked ? "Sudah Dikirim" : "Belum Dikirim",
                          })
                        }
                        className="h-4 w-4"
                      />
                      {sent ? "Sudah Dikirim" : "Tandai Terkirim"}
                    </label>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Keterangan</span>
                    <input
                      value={p.keterangan}
                      onChange={(e) => update(p.id, { keterangan: e.target.value })}
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Link Lokasi</span>
                    <input
                      value={p.lokasi}
                      onChange={(e) => update(p.id, { lokasi: e.target.value })}
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Foto Langsung</div>
                    <div className="mt-1 flex items-start gap-2">
                      {p.foto ? (
                        <div className="relative">
                          <img
                            src={p.foto}
                            alt={`Foto ${p.nama}`}
                            className="h-24 w-24 rounded-md border object-cover"
                          />
                          <button
                            onClick={() => removeFoto(p.id)}
                            className="absolute -right-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-background text-xs shadow hover:bg-destructive hover:text-destructive-foreground"
                            aria-label="Hapus foto"
                          >
                            ×
                          </button>
                        </div>
                      ) : null}
                      <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent">
                        📷 {p.foto ? "Ganti" : "Ambil Foto"}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => setFoto(p.id, e.target.files)}
                        />
                      </label>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-muted-foreground">
                      Foto Galeri {p.galeri?.length ? `(${p.galeri.length})` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap items-start gap-2">
                      {(p.galeri ?? []).map((src, idx) => (
                        <div key={idx} className="relative">
                          <img
                            src={src}
                            alt={`Galeri ${idx + 1}`}
                            className="h-20 w-20 rounded-md border object-cover"
                          />
                          <button
                            onClick={() => removeGaleri(p.id, idx)}
                            className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-background text-[10px] shadow hover:bg-destructive hover:text-destructive-foreground"
                            aria-label="Hapus"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-xs font-medium hover:bg-accent">
                        🖼️ Tambah
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => addGaleri(p.id, e.target.files)}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    href={p.lokasi}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    📍 Buka Lokasi
                  </a>
                  {!sent && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-md bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                    >
                      KIRIM WA
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            Tidak ada pesanan untuk filter ini.
          </div>
        )}
      </main>
    </div>
  );
}
