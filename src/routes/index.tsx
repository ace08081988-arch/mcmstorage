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
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-3 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold tracking-tight">Penjualan Harian</h1>
              <p className="text-[11px] text-muted-foreground">
                {terkirim}/{items.length} terkirim · {rupiah(total)}
              </p>
            </div>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent"
              aria-label="Ganti tema"
              title={theme === "dark" ? "Mode terang" : "Mode gelap"}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(["semua", "Belum Dikirim", "Sudah Dikirim"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  filter === f
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-accent"
                }`}
              >
                {f === "semua" ? "Semua" : f === "Belum Dikirim" ? "Belum" : "Terkirim"}
              </button>
            ))}
            <div className="ml-auto flex gap-1.5">
              <button
                onClick={resetStatus}
                className="rounded-md border px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
              >
                Reset status
              </button>
              <button
                onClick={reset}
                className="rounded-md border px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-3 sm:px-6">
        <ul className="grid gap-1.5">
          {filtered.map((p) => {
            const sent = p.status === "Sudah Dikirim";
            const waUrl = `https://wa.me/?text=${encodeURIComponent(buildPesan(p))}`;
            const open = openId === p.id;
            const fotoCount = (p.foto ? 1 : 0) + (p.galeri?.length ?? 0);
            return (
              <li
                key={p.id}
                className={`rounded-lg border bg-card transition-opacity ${sent ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <input
                    type="checkbox"
                    checked={sent}
                    onChange={(e) =>
                      update(p.id, {
                        status: e.target.checked ? "Sudah Dikirim" : "Belum Dikirim",
                      })
                    }
                    className="h-4 w-4 shrink-0"
                    aria-label="Tandai terkirim"
                  />
                  <button
                    onClick={() => setOpenId(open ? null : p.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="inline-flex shrink-0 items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                      {TAG[p.kategori]}
                    </span>
                    <span className="truncate text-sm font-medium">{p.nama}</span>
                    {fotoCount > 0 && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">📷{fotoCount}</span>
                    )}
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {rupiah(p.harga)}
                    </span>
                  </button>
                  {!sent && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-md bg-[#25D366] px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                      onClick={(e) => e.stopPropagation()}
                    >
                      WA
                    </a>
                  )}
                </div>

                {open && (
                  <div className="space-y-2 border-t px-2.5 py-2.5">
                    <input
                      value={p.nama}
                      onChange={(e) => update(p.id, { nama: e.target.value })}
                      placeholder="Nama produk"
                      className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        value={p.keterangan}
                        onChange={(e) => update(p.id, { keterangan: e.target.value })}
                        placeholder="Keterangan"
                        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                      <input
                        value={p.lokasi}
                        onChange={(e) => update(p.id, { lokasi: e.target.value })}
                        placeholder="Link Lokasi"
                        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>

                    <div className="flex flex-wrap items-start gap-1.5">
                      {p.foto && (
                        <div className="relative">
                          <img src={p.foto} alt="" className="h-16 w-16 rounded-md border object-cover" />
                          <button
                            onClick={() => removeFoto(p.id)}
                            className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-background text-[10px] shadow"
                          >
                            ×
                          </button>
                        </div>
                      )}
                      {(p.galeri ?? []).map((src, idx) => (
                        <div key={idx} className="relative">
                          <img src={src} alt="" className="h-16 w-16 rounded-md border object-cover" />
                          <button
                            onClick={() => removeGaleri(p.id, idx)}
                            className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-background text-[10px] shadow"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <label className="inline-flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed text-[10px] hover:bg-accent">
                        📷
                        <span>{p.foto ? "Ganti" : "Foto"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => setFoto(p.id, e.target.files)}
                        />
                      </label>
                      <label className="inline-flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed text-[10px] hover:bg-accent">
                        🖼️
                        <span>Galeri</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => addGaleri(p.id, e.target.files)}
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <a
                        href={p.lokasi}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
                      >
                        📍 Lokasi
                      </a>
                      {!sent && (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-md bg-[#25D366] px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                        >
                          KIRIM WA
                        </a>
                      )}
                    </div>
                  </div>
                )}
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
