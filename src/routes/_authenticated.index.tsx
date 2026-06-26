import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";
import { useNavigate, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { isAutoLockEnabled, setAutoLockEnabled, AUTO_LOCK_EVENT } from "@/lib/auto-lock";
import {
  getLockConfig,
  requestLockNow,
  APP_LOCK_EVENT,
  type LockConfig,
} from "@/lib/app-lock";
import { AppLockSetup } from "@/components/AppLockSetup";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AppearanceSettings } from "@/components/appearance-settings";
import { ProductEditDrawer } from "@/components/ProductEditDrawer";
import { confirm } from "@/lib/confirm";
import { SecurityScanReminder } from "@/components/SecurityScanReminder";
import { SecurityFindingsBanner } from "@/components/SecurityFindingsBanner";
import { ReadyEcerSection } from "@/components/ReadyEcerSection";
import { ReadyRequestSection } from "@/components/ReadyRequestSection";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Beranda — Kelola Pesanan & Kirim WhatsApp · MCM Storage" },
      { name: "description", content: "Catat pesanan harian, lampirkan foto & lokasi, tandai status pengiriman, dan kirim detail ke WhatsApp pelanggan dalam satu halaman." },
      { property: "og:title", content: "Beranda — Kelola Pesanan & Kirim WhatsApp · MCM Storage" },
      { property: "og:description", content: "Catat pesanan harian, lampirkan foto & lokasi, tandai status pengiriman, dan kirim detail ke WhatsApp pelanggan dalam satu halaman." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://mcmstorage.lovable.app/" },
    ],
    links: [{ rel: "canonical", href: "https://mcmstorage.lovable.app/" }],
  }),
  component: Index,
});

type Status = "Belum Dikirim" | "Sudah Dikirim";
type Kategori = string;

type Satuan = "gram" | "kg" | "botol" | "sachet" | "pcs" | "lusin" | "pak" | "dus";

const SATUAN_LIST: Satuan[] = ["gram", "kg", "botol", "sachet", "pcs", "lusin", "pak", "dus"];

function satuanBounds(s: Satuan): { min: number; max: number; step: number } {
  switch (s) {
    case "gram":
      return { min: 0.01, max: 5000, step: 0.01 };
    case "kg":
      return { min: 0.001, max: 5, step: 0.001 };
    default:
      return { min: 1, max: 9999, step: 1 };
  }
}

function formatJumlah(j: number, s: Satuan): string {
  const n = Number.isFinite(j) ? j : 0;
  if (s === "gram") return `${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })} g`;
  if (s === "kg") return `${n.toLocaleString("id-ID", { maximumFractionDigits: 3 })} kg`;
  return `${n.toLocaleString("id-ID")} ${s}`;
}

type Produk = {
  id: number;
  kategori: Kategori;
  nama: string;
  harga: number;
  status: Status;
  keterangan: string;
  lokasi: string;
  satuan?: Satuan;
  jumlah?: number;
  foto?: string;
  galeri?: string[];
};

function tagFor(kat: Kategori): string {
  return kat.trim().slice(0, 3) || "—";
}

const THEME_KEY = "penjualan-theme";
const VIEW_KEY = "penjualan-view";
const ACTIVE_CAT_KEY = "penjualan-active-cat";

function rupiah(n: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(n);
}

function buildPesan(p: Produk) {
  const s = p.satuan ?? "pcs";
  const j = p.jumlah ?? 1;
  return `📦 [${tagFor(p.kategori)}] *${p.nama}*\n⚖️ ${formatJumlah(j, s)}\n💰 Harga: Rp ${p.harga.toLocaleString("id-ID")}\n📍 ${p.lokasi}\nKet: ${p.keterangan}`;
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
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  const [uid, setUid] = useState<string | null>(null);
  const [autoLock, setAutoLock] = useState(false);
  const [lockCfg, setLockCfg] = useState<LockConfig | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const id = data.user?.id ?? null;
      setUid(id);
      if (id) {
        setAutoLock(isAutoLockEnabled(id));
        setLockCfg(getLockConfig(id));
      }
    });
    const sync = () => {
      supabase.auth.getUser().then(({ data }) => {
        const id = data.user?.id ?? null;
        if (id) {
          setAutoLock(isAutoLockEnabled(id));
          setLockCfg(getLockConfig(id));
        }
      });
    };
    window.addEventListener(AUTO_LOCK_EVENT, sync);
    window.addEventListener(APP_LOCK_EVENT, sync);
    return () => {
      window.removeEventListener(AUTO_LOCK_EVENT, sync);
      window.removeEventListener(APP_LOCK_EVENT, sync);
    };
  }, []);
  const toggleAutoLock = () => {
    if (!uid) return;
    const next = !autoLock;
    setAutoLock(next);
    setAutoLockEnabled(uid, next);
    toast.success(next ? "Kunci otomatis aktif" : "Kunci otomatis dimatikan");
  };
  const lockMenu = (compact: boolean, triggerClassName?: string) => {
    const label = lockCfg
      ? compact
        ? "🔒"
        : `🔒 ${lockCfg.method === "pin" ? "PIN" : "Pola"}`
      : compact
      ? "🔓"
      : "🔓 Atur Kunci";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={
              triggerClassName ??
              `inline-flex h-8 items-center justify-center rounded-md border px-2 text-[11px] font-medium hover:bg-accent ${
                lockCfg ? "bg-accent" : ""
              }`
            }
            title="Kunci aplikasi"
            aria-label="Kunci aplikasi"
          >
            {label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {lockCfg ? (
            <>
              <DropdownMenuItem onClick={() => requestLockNow()}>
                🔒 Kunci Sekarang
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSetupOpen(true)}>
                ⚙️ Ubah Metode / Opsi
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/pengaturan-kunci">📄 Pengaturan Kunci</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleAutoLock}>
                {autoLock ? "✓ " : ""}Hapus sesi saat tutup tab
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onClick={() => setSetupOpen(true)}>
                🔧 Atur Kunci (PIN/Pola/Sidik Jari)
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/pengaturan-kunci">📄 Pengaturan Kunci</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleAutoLock}>
                {autoLock ? "✓ " : ""}Hapus sesi saat tutup tab
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const resetAllData = async () => {
    if (!(await confirm({
      title: "Reset semua data?",
      description: "Semua kategori dan produk milik akun ini akan dihapus permanen.",
      confirmText: "Hapus semua",
      destructive: true,
    }))) return;
    if (!(await confirm({
      title: "Yakin reset ke nol?",
      description: "Konfirmasi sekali lagi sebelum melanjutkan.",
      confirmText: "Ya, reset",
      destructive: true,
    }))) return;
    setItems([]);
    setCategories([]);
    setActiveCat(null);
    setSelected(new Set());
    setSelectMode(false);
    setOpenId(null);
    toast.success("Semua data berhasil dihapus.");
  };
  const [items, setItems] = useState<Produk[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<"semua" | Status>(() => {
    if (typeof window === "undefined") return "semua";
    const v = window.localStorage.getItem("mcm_filter");
    if (v === "Belum Dikirim" || v === "Sudah Dikirim" || v === "semua") return v;
    return "semua";
  });
  const [openId, setOpenId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("mcm_active_cat");
  });
  const [newCatName, setNewCatName] = useState("");
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem("mcm_rail_open");
    if (saved === "1") return true;
    if (saved === "0") return false;
    return window.innerWidth >= 640;
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("mcm_rail_open", railOpen ? "1" : "0");
    } catch {
      /* ignore quota errors */
    }
  }, [railOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem("mcm_filter", filter);
    } catch {
      /* ignore */
    }
  }, [filter]);

  useEffect(() => {
    try {
      if (activeCat) window.localStorage.setItem("mcm_active_cat", activeCat);
      else window.localStorage.removeItem("mcm_active_cat");
    } catch {
      /* ignore */
    }
  }, [activeCat]);

  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY) as "list" | "grid" | null;
      if (v) setViewMode(v);
    } catch {}
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) {
        setHydrated(true);
        return;
      }
      const { data, error } = await supabase
        .from("user_storage")
        .select("items, categories")
        .eq("user_id", uid)
        .maybeSingle();
      if (error) {
        toast.error("Gagal memuat data: " + friendlyError(error), {
          action: {
            label: "Lihat detail",
            onClick: () =>
              navigate({
                to: "/error",
                search: { kind: "data", title: "Gagal memuat data", message: (error as any).message, code: (error as any).code, from: "/" },
              }),
          },
        });
      } else {
        const loadedItems = Array.isArray(data?.items) ? (data!.items as unknown as Produk[]) : [];
        const loadedCats = Array.isArray(data?.categories) ? (data!.categories as unknown as string[]) : [];
        setItems(loadedItems);
        setCategories(loadedCats);
        try {
          const saved = localStorage.getItem(ACTIVE_CAT_KEY);
          if (saved && loadedCats.includes(saved)) setActiveCat(saved);
        } catch {}
      }
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid || cancelled) return;
      const { error } = await supabase
        .from("user_storage")
        .upsert({ user_id: uid, items: items as any, categories: categories as any });
      if (error && !cancelled) toast.error("Gagal menyimpan: " + friendlyError(error));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [items, categories, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(VIEW_KEY, viewMode);
  }, [viewMode, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (activeCat) localStorage.setItem(ACTIVE_CAT_KEY, activeCat);
      else localStorage.removeItem(ACTIVE_CAT_KEY);
    } catch {}
  }, [activeCat, hydrated]);

  const scopedItems = useMemo(
    () => (activeCat ? items.filter((i) => i.kategori === activeCat) : items),
    [items, activeCat],
  );
  const total = useMemo(
    () => scopedItems.reduce((s, i) => s + i.harga, 0),
    [scopedItems],
  );

  const update = (id: number, patch: Partial<Produk>) =>
    setItems((arr) => arr.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const setFoto = async (id: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const dataUrl = await compressImage(files[0]);
    update(id, { foto: dataUrl });
    setOpenId(id);
    toast.success("Foto tersimpan");
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      const tId = toast.loading("Mengambil lokasi…");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          const link = `https://www.google.com/maps?q=${latitude},${longitude}`;
          update(id, { lokasi: link });
          toast.success("Lokasi otomatis terisi", { id: tId });
        },
        (err) => {
          toast.error("Gagal ambil lokasi: " + friendlyError(err), { id: tId });
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

  const reset = async () => {
    if (!activeCat) return;
    const ok = await confirm({
      title: "Hapus semua pesanan?",
      description: `Semua pesanan di kategori "${activeCat}" akan dihapus.`,
      confirmText: "Hapus",
      destructive: true,
    });
    if (ok) setItems((arr) => arr.filter((i) => i.kategori !== activeCat));
  };

  const addCategory = (name: string) => {
    const v = name.trim();
    if (!v) return;
    if (categories.includes(v)) {
      toast.error("Kategori sudah ada");
      return;
    }
    setCategories((c) => [...c, v]);
    setActiveCat(v);
    setNewCatName("");
    toast.success(`Kategori "${v}" dibuat`);
  };

  const deleteCategory = async (name: string) => {
    if (categories.length <= 1) {
      toast.error("Tidak bisa menghapus kategori terakhir. Buat kategori lain dulu.");
      return;
    }
    const ok = await confirm({
      title: `Hapus kategori "${name}"?`,
      description: "Kategori beserta seluruh pesanannya akan dihapus.",
      confirmText: "Hapus",
      destructive: true,
    });
    if (!ok) return;
    setCategories((c) => c.filter((x) => x !== name));
    setItems((arr) => arr.filter((i) => i.kategori !== name));
    if (activeCat === name) setActiveCat(null);
  };

  const addProduk = () => {
    if (!activeCat) return;
    const nextId = items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
    const fresh: Produk = {
      id: nextId,
      kategori: activeCat,
      nama: `Produk ${nextId}`,
      harga: 0,
      status: "Belum Dikirim",
      keterangan: "",
      lokasi: "",
      satuan: "pcs",
      jumlah: 1,
    };
    setItems((arr) => [...arr, fresh]);
    setOpenId(nextId);
  };

  const resetStatus = async () => {
    const ok = await confirm({
      title: "Reset status pengiriman?",
      description: "Semua pesanan akan ditandai sebagai Belum Dikirim.",
      confirmText: "Tandai ulang",
    });
    if (ok) setItems((arr) => arr.map((i) => ({ ...i, status: "Belum Dikirim" })));
  };

  const filtered = scopedItems.filter((i) => filter === "semua" || i.status === filter);

  const toggleSelect = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectAllVisible = () => {
    const ids = filtered.map((i) => i.id);
    const allIn = ids.every((id) => selected.has(id));
    setSelected((s) => {
      const n = new Set(s);
      if (allIn) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  };

  const selectedItems = items.filter((i) => selected.has(i.id));
  const bulkTotal = selectedItems.reduce((s, i) => s + i.harga, 0);

  const bulkPesan = () =>
    selectedItems.map((p, idx) => `${idx + 1}. ${buildPesan(p)}`).join("\n\n") +
    `\n\n💵 *Total: ${rupiah(bulkTotal)}*`;

  const bulkWaUrl = `https://wa.me/?text=${encodeURIComponent(bulkPesan())}`;

  const markSent = (id: number) => {
    const target = items.find((i) => i.id === id);
    setItems((arr) =>
      arr.map((i) => (i.id === id ? { ...i, status: "Sudah Dikirim" } : i)),
    );
    toast.success(`Terkirim · ${target?.nama ?? "Pesanan"} ditandai sudah dikirim`, {
      action: {
        label: "Urungkan",
        onClick: () =>
          setItems((arr) =>
            arr.map((i) => (i.id === id ? { ...i, status: "Belum Dikirim" } : i)),
          ),
      },
    });
  };

  const removeItem = async (id: number) => {
    const snapshot = items;
    const target = items.find((i) => i.id === id);
    const ok = await confirm({
      title: "Hapus pesanan?",
      description: `Pesanan "${target?.nama ?? ""}" akan dihapus dari penyimpanan.`,
      confirmText: "Hapus",
      destructive: true,
    });
    if (!ok) return;
    setItems((arr) => arr.filter((i) => i.id !== id));
    toast.success(`Pesanan dihapus`, {
      action: {
        label: "Urungkan",
        onClick: () => setItems(snapshot),
      },
    });
  };

  const bulkMarkSent = () => {
    if (selected.size === 0) return;
    const ids = new Set(selected);
    const count = ids.size;
    setItems((arr) =>
      arr.map((i) => (ids.has(i.id) ? { ...i, status: "Sudah Dikirim" } : i)),
    );
    setSelected(new Set());
    toast.success(`${count} pesanan ditandai sudah dikirim`, {
      action: {
        label: "Urungkan",
        onClick: () =>
          setItems((arr) =>
            arr.map((i) =>
              ids.has(i.id) ? { ...i, status: "Belum Dikirim" } : i,
            ),
          ),
      },
    });
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Memuat…
      </div>
    );
  }

  if (!activeCat) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card/95">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold tracking-tight">
                Pilih Kategori — MCM Storage
              </h1>
              <p className="text-[11px] text-muted-foreground">
                Buat atau pilih kategori dulu sebelum masuk ke penyimpanan.
              </p>
            </div>
            {lockMenu(false)}
            <AppearanceSettings />
            <button
              onClick={signOut}
              className="inline-flex h-8 items-center justify-center rounded-md border px-2 text-[11px] font-medium hover:bg-accent"
            >
              Keluar
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-md space-y-4 px-3 py-6 sm:px-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addCategory(newCatName);
            }}
            className="space-y-2 rounded-lg border bg-card p-3"
          >
            <label htmlFor="new-category-name" className="block text-xs font-medium text-foreground">
              {categories.length === 0 ? "Buat kategori pertama" : "Tambah kategori baru"}
            </label>
            <div className="flex gap-2">
              <input
                id="new-category-name"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Contoh: Sembako, Pakaian, 1 gram"
                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
              <button
                type="submit"
                className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                Buat
              </button>
            </div>
          </form>

          {categories.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Kategori kamu
              </p>
              <ul className="grid gap-1.5">
                {categories.map((c) => {
                  const count = items.filter((i) => i.kategori === c).length;
                  return (
                    <li
                      key={c}
                      className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2"
                    >
                      <button
                        onClick={() => setActiveCat(c)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className="inline-flex shrink-0 items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                          {tagFor(c)}
                        </span>
                        <span className="truncate text-sm font-medium">{c}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                          {count} pesanan
                        </span>
                      </button>
                      <button
                        onClick={() => deleteCategory(c)}
                        disabled={categories.length <= 1}
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        title={categories.length <= 1 ? "Minimal harus ada 1 kategori" : `Hapus kategori ${c}`}
                        aria-label={`Hapus kategori ${c}`}
                      >
                        Hapus
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {(categories.length > 0 || items.length > 0) && (
            <button
              onClick={resetAllData}
              className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20"
            >
              🗑 Reset semua data saya
            </button>
          )}

          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Pintasan
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { to: "/gudang", label: "Gudang & Supplier", emoji: "📦", desc: "Stok, pembelian, penjualan" },
                { to: "/ecer", label: "Penyiapan Ecer", emoji: "⚖️", desc: "Judul & kotak penyiapan" },
                { to: "/request", label: "Penyiapan Request", emoji: "📦", desc: "Paket multi-produk" },
                { to: "/tugas", label: "Tugas Pegawai", emoji: "📋", desc: "Buat & pantau penyiapan" },
                { to: "/hutang-piutang", label: "Hutang & Piutang", emoji: "💳", desc: "Pelanggan & supplier" },
                { to: "/kontak", label: "Pelanggan & Pemasok", emoji: "👥", desc: "Tautkan akun pengguna" },
                { to: "/label-preview", label: "Pratinjau Label", emoji: "🏷️", desc: "Cetak label produk" },
                { to: "/pengaturan-kunci", label: "Pengaturan Kunci", emoji: "🔒", desc: "PIN, pola, sidik jari" },
              ].map((s) => (
                <Link
                  key={s.to}
                  to={s.to}
                  preload="intent"
                  className="group flex flex-col gap-0.5 rounded-md border bg-card px-3 py-2.5 text-left hover:border-primary/40 hover:bg-accent"
                >
                  <span className="text-base leading-none">{s.emoji}</span>
                  <span className="mt-1 text-xs font-semibold leading-tight">{s.label}</span>
                  <span className="text-[10px] leading-tight text-muted-foreground">{s.desc}</span>
                </Link>
              ))}
            </div>
          </div>

          <ReadyEcerSection />
          <ReadyRequestSection />
        </main>
        {uid && <AppLockSetup uid={uid} open={setupOpen} onOpenChange={setSetupOpen} />}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile drawer backdrop */}
      {railOpen && (
        <button
          aria-label="Tutup menu"
          onClick={() => setRailOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm sm:hidden"
        />
      )}
      {/* Vertical action rail */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-14 flex-col items-center gap-1.5 border-r bg-card/95 px-1 py-3 backdrop-blur transition-transform duration-200 sm:sticky sm:top-0 sm:z-20 sm:transition-[width,transform] ${
          railOpen
            ? "translate-x-0 sm:w-14"
            : "-translate-x-full sm:translate-x-0 sm:w-0 sm:overflow-hidden sm:border-r-0 sm:px-0"
        }`}
      >
        <button
          onClick={() => {
            setActiveCat(null);
            setSelectMode(false);
            setSelected(new Set());
            setOpenId(null);
          }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors hover:bg-accent"
          aria-label="Ganti kategori"
          title="Ganti kategori"
        >
          ↩
        </button>

        <div className="my-1 h-px w-6 bg-border" />

        <button
          onClick={addProduk}
          title="Tambah produk"
          aria-label="Tambah produk"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
        >
          +
        </button>
        <button
          onClick={() => {
            if (selectMode) exitSelect();
            else setSelectMode(true);
          }}
          title={selectMode ? "Selesai memilih" : "Pilih beberapa"}
          aria-label={selectMode ? "Selesai memilih" : "Pilih beberapa"}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors ${
            selectMode
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "hover:bg-accent"
          }`}
        >
          {selectMode ? "✓" : "☑"}
        </button>
        <button
          onClick={resetStatus}
          title="Reset status terkirim"
          aria-label="Reset status terkirim"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors hover:bg-accent"
        >
          ↺
        </button>
        <button
          onClick={reset}
          title="Hapus semua"
          aria-label="Hapus semua"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-base text-destructive transition-colors hover:bg-destructive/10"
        >
          🗑
        </button>

        <div className="my-1 h-px w-6 bg-border" />

        <button
          onClick={() => setViewMode("list")}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors ${
            viewMode === "list"
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "hover:bg-accent"
          }`}
          aria-label="Tampilan daftar"
          title="Daftar"
        >
          ☰
        </button>
        <button
          onClick={() => setViewMode("grid")}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors ${
            viewMode === "grid"
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "hover:bg-accent"
          }`}
          aria-label="Tampilan kotak"
          title="Kotak"
        >
          ▦
        </button>

        <div className="flex-1" />

        <AppearanceSettings
          compact
          triggerClassName="inline-flex h-9 w-9 items-center justify-center rounded-lg text-base leading-none transition-colors hover:bg-accent"
        />
        <button
          onClick={() => {
            try {
              window.localStorage.removeItem("mcm_rail_open");
            } catch {
              /* ignore */
            }
            setRailOpen(
              typeof window !== "undefined" ? window.innerWidth >= 640 : true,
            );
            toast.success("Tampilan menu dikembalikan ke default");
          }}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors hover:bg-accent"
          aria-label="Reset tampilan menu"
          title="Reset tampilan menu"
        >
          ⟲
        </button>
        {lockMenu(
          true,
          `inline-flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors hover:bg-accent ${
            lockCfg ? "bg-accent" : ""
          }`,
        )}
        <button
          onClick={signOut}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-base transition-colors hover:bg-accent"
          aria-label="Keluar"
          title="Keluar"
        >
          ⎋
        </button>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
          <div className="mx-auto max-w-6xl px-3 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setRailOpen((v) => !v)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-card text-base transition-colors hover:bg-accent"
                aria-label={railOpen ? "Sembunyikan menu" : "Tampilkan menu"}
                title={railOpen ? "Sembunyikan menu" : "Tampilkan menu"}
              >
                ☰
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-semibold tracking-tight">
                  {activeCat} · MCM Storage
                </h1>
                <p className="text-[11px] text-muted-foreground">
                  {scopedItems.length} pesanan · {rupiah(total)}
                </p>
              </div>
              <div className="inline-flex h-8 shrink-0 overflow-hidden rounded-full border bg-card">
                {(["semua", "Belum Dikirim", "Sudah Dikirim"] as const).map(
                  (f, i) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      title={
                        f === "semua"
                          ? "Semua"
                          : f === "Belum Dikirim"
                          ? "Belum dikirim"
                          : "Sudah dikirim"
                      }
                      className={`inline-flex shrink-0 items-center justify-center px-3 text-[11px] font-medium transition-colors ${
                        i > 0 ? "border-l" : ""
                      } ${
                        filter === f
                          ? "bg-primary text-primary-foreground"
                          : "bg-card hover:bg-accent"
                      }`}
                    >
                      {f === "semua"
                        ? "Semua"
                        : f === "Belum Dikirim"
                        ? "Belum"
                        : "Terkirim"}
                    </button>
                  ),
                )}
              </div>
              <button
                onClick={() => {
                  setFilter("semua");
                  setActiveCat(null);
                  setSelectMode(false);
                  setSelected(new Set());
                  setOpenId(null);
                  toast.success("Filter dikembalikan ke default");
                }}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-card text-base transition-colors hover:bg-accent"
                aria-label="Reset filter"
                title="Reset filter"
              >
                ⟲
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-3 py-3 sm:px-6">
        <SecurityScanReminder />
        <SecurityFindingsBanner />
        {(() => {
          const total = scopedItems.length;
          const terkirim = scopedItems.filter((i) => i.status === "Sudah Dikirim");
          const belum = total - terkirim.length;
          const omzet = terkirim.reduce((s, i) => s + i.harga, 0);
          const byUnit = new Map<Satuan, number>();
          for (const it of terkirim) {
            const s = it.satuan ?? "pcs";
            byUnit.set(s, (byUnit.get(s) ?? 0) + (it.jumlah ?? 0));
          }
          return (
            <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border bg-card p-2.5 text-[11px] sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Total pesanan</p>
                <p className="text-sm font-semibold tabular-nums">{total}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Belum dikirim</p>
                <p className="text-sm font-semibold tabular-nums">{belum}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Terjual</p>
                <p className="text-sm font-semibold tabular-nums text-[#128C7E]">
                  {terkirim.length}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Omzet</p>
                <p className="text-sm font-semibold tabular-nums">{rupiah(omzet)}</p>
              </div>
              {byUnit.size > 0 && (
                <div className="col-span-2 sm:col-span-4">
                  <p className="text-muted-foreground">Terjual per satuan</p>
                  <p className="text-xs font-medium tabular-nums">
                    {Array.from(byUnit.entries())
                      .map(([s, j]) => formatJumlah(j, s))
                      .join(" · ")}
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        <ul
          className={
            viewMode === "grid"
              ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
              : "grid gap-1.5"
          }
        >
          {filtered.map((p) => {
            const sent = p.status === "Sudah Dikirim";
            const waUrl = `https://wa.me/?text=${encodeURIComponent(buildPesan(p))}`;
            const open = openId === p.id;
            const fotoCount = (p.foto ? 1 : 0) + (p.galeri?.length ?? 0);
            const thumb = p.foto ?? p.galeri?.[0];
            return (
              <li
                key={p.id}
                className={`overflow-hidden rounded-lg border bg-card transition-opacity ${sent ? "opacity-60" : ""} ${
                  viewMode === "grid" && open ? "col-span-full" : ""
                }`}
              >
                {viewMode === "grid" && (
                  <button
                    onClick={() =>
                      selectMode ? toggleSelect(p.id) : setOpenId(open ? null : p.id)
                    }
                    className={`relative block w-full overflow-hidden bg-muted ${open ? "h-32 sm:h-40" : "aspect-square"}`}
                    aria-label="Buka detail"
                  >
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl text-muted-foreground">
                        📦
                      </div>
                    )}
                    <span className="absolute left-1.5 top-1.5 inline-flex items-center rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">
                      {tagFor(p.kategori)}
                    </span>
                    {fotoCount > 0 && (
                      <span className="absolute right-1.5 top-1.5 inline-flex items-center rounded bg-background/90 px-1.5 py-0.5 text-[10px]">
                        📷{fotoCount}
                      </span>
                    )}
                    {selectMode && (
                      <span
                        className={`absolute bottom-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] ${
                          selected.has(p.id)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-background bg-background/80"
                        }`}
                      >
                        {selected.has(p.id) ? "✓" : ""}
                      </span>
                    )}
                  </button>
                )}
                <div className="flex items-center gap-2 px-2.5 py-2">
                  {selectMode && viewMode === "list" ? (
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="h-4 w-4 shrink-0 accent-primary"
                      aria-label="Pilih untuk kirim massal"
                    />
                  ) : viewMode === "list" ? (
                    <input
                      type="checkbox"
                      checked={sent}
                      onChange={(e) => {
                        if (e.target.checked) markSent(p.id);
                        else
                          setItems((arr) =>
                            arr.map((i) =>
                              i.id === p.id ? { ...i, status: "Belum Dikirim" } : i,
                            ),
                          );
                      }}
                      className="h-4 w-4 shrink-0"
                      aria-label="Tandai terkirim"
                      title="Tandai terkirim"
                    />
                  ) : null}
                  <button
                    onClick={() =>
                      selectMode ? toggleSelect(p.id) : setOpenId(open ? null : p.id)
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {viewMode === "list" && (
                      <span className="inline-flex shrink-0 items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground">
                        {tagFor(p.kategori)}
                      </span>
                    )}
                    <span className="truncate text-sm font-medium">{p.nama}</span>
                    {viewMode === "list" && p.satuan && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        · {formatJumlah(p.jumlah ?? 0, p.satuan)}
                      </span>
                    )}
                    {viewMode === "list" && sent && (
                      <span className="shrink-0 rounded bg-[#25D366]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#128C7E]">
                        ✓
                      </span>
                    )}
                    {viewMode === "list" && fotoCount > 0 && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">📷{fotoCount}</span>
                    )}
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {rupiah(p.harga)}
                    </span>
                  </button>
                  {!sent && !selectMode && (
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
                  {!selectMode && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditId(p.id); }}
                      className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent"
                      aria-label="Edit lengkap"
                      title="Edit lengkap"
                    >
                      ✎
                    </button>
                  )}
                </div>
                {viewMode === "grid" && (
                  <div className="flex items-center gap-2 border-t px-2.5 py-1.5">
                    <label className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={sent}
                        onChange={(e) => {
                          if (e.target.checked) markSent(p.id);
                          else
                            setItems((arr) =>
                              arr.map((i) =>
                                i.id === p.id ? { ...i, status: "Belum Dikirim" } : i,
                              ),
                            );
                        }}
                        className="h-3.5 w-3.5"
                      />
                      Tandai terkirim
                    </label>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditId(p.id); }}
                      className="ml-auto rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent"
                    >
                      ✎ Edit
                    </button>
                  </div>
                )}

                {open && (
                  <div className="space-y-2 border-t px-2.5 py-2.5">
                    <div className="flex gap-2">
                      <select
                        value={p.kategori}
                        onChange={(e) =>
                          update(p.id, { kategori: e.target.value as Kategori })
                        }
                        className="rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                        aria-label="Kategori"
                      >
                        {categories.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                      <input
                        value={p.nama}
                        onChange={(e) => update(p.id, { nama: e.target.value })}
                        placeholder="Nama produk"
                        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <label className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm">
                      <span className="text-muted-foreground">Rp</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={p.harga}
                        aria-label="Harga produk"
                        onFocus={() => setFlashId(p.id)}
                        onBlur={() =>
                          setFlashId((cur) => (cur === p.id ? null : cur))
                        }
                        onChange={(e) =>
                          {
                            update(p.id, { harga: Math.max(0, Number(e.target.value) || 0) });
                            setFlashId(p.id);
                            window.setTimeout(() => {
                              setFlashId((cur) => (cur === p.id ? null : cur));
                            }, 900);
                          }
                        }
                        className="w-full bg-transparent tabular-nums outline-none"
                        placeholder="Harga"
                      />
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {rupiah(p.harga)}
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={p.satuan ?? "pcs"}
                        onChange={(e) => {
                          const next = e.target.value as Satuan;
                          const b = satuanBounds(next);
                          const cur = p.jumlah ?? 1;
                          const clamped = Math.min(b.max, Math.max(b.min, cur));
                          update(p.id, { satuan: next, jumlah: clamped });
                        }}
                        className="rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                        aria-label="Satuan"
                      >
                        {SATUAN_LIST.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const s = p.satuan ?? "pcs";
                        const b = satuanBounds(s);
                        return (
                          <label className="flex w-full items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm">
                            <span className="text-muted-foreground">Jumlah</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min={b.min}
                              max={b.max}
                              step={b.step}
                              value={p.jumlah ?? b.min}
                              onChange={(e) => {
                                const raw = Number(e.target.value);
                                if (!Number.isFinite(raw)) return;
                                const clamped = Math.min(b.max, Math.max(b.min, raw));
                                update(p.id, { jumlah: clamped });
                              }}
                              className="w-full bg-transparent tabular-nums outline-none"
                              placeholder="Jumlah"
                            />
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatJumlah(p.jumlah ?? b.min, s)}
                            </span>
                          </label>
                        );
                      })()}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Gram: 0.01 – 5000 · Kg: 0.001 – 5 · lainnya pakai bilangan bulat.
                    </p>
                    <div
                      className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors ${
                        flashId === p.id
                          ? "border-[#25D366] bg-[#25D366]/10 text-[#128C7E]"
                          : "bg-background text-muted-foreground"
                      }`}
                      aria-live="polite"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            flashId === p.id ? "bg-[#25D366] animate-pulse" : "bg-[#25D366]/60"
                          }`}
                        />
                        {flashId === p.id
                          ? `Sedang diperbarui · ${rupiah(p.harga)}`
                          : `Sinkron ✓ · ${rupiah(p.harga)}`}
                      </span>
                      <span className="tabular-nums">
                        {flashId === p.id ? "memperbarui…" : "live"}
                      </span>
                    </div>
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
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => {
                          if (!navigator.geolocation) {
                            toast.error("Geolocation tidak tersedia");
                            return;
                          }
                          const tId = toast.loading("Mengambil lokasi…");
                          navigator.geolocation.getCurrentPosition(
                            (pos) => {
                              const { latitude, longitude } = pos.coords;
                              update(p.id, {
                                lokasi: `https://www.google.com/maps?q=${latitude},${longitude}`,
                              });
                              toast.success("Lokasi diperbarui", { id: tId });
                            },
                            (err) =>
                              toast.error("Gagal: " + friendlyError(err), { id: tId }),
                            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
                          );
                        }}
                        className="rounded-md border px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
                      >
                        📍 Ambil lokasi sekarang
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard
                            ?.writeText(p.lokasi)
                            .then(() => toast.success("Link lokasi disalin"))
                            .catch(() => toast.error("Gagal menyalin"));
                        }}
                        className="rounded-md border px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
                      >
                        Salin link
                      </button>
                    </div>

                    <div className="flex flex-wrap items-start gap-1.5">
                      {p.foto && (
                        <div className="relative">
                          <img src={p.foto} alt="" className="h-16 w-16 rounded-md border object-cover" />
                          <button
                            onClick={() => removeFoto(p.id)}
                            aria-label="Hapus foto utama"
                            title="Hapus foto utama"
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
                            aria-label="Hapus foto galeri"
                            title="Hapus foto galeri"
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
                      <button
                        onClick={() => {
                          setOpenId(null);
                          toast.success("Tersimpan");
                        }}
                        className="inline-flex items-center rounded-md border border-primary bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
                      >
                        💾 Simpan
                      </button>
                      <button
                        onClick={() => removeItem(p.id)}
                        className="ml-auto inline-flex items-center rounded-md border border-destructive/40 px-2.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                      >
                        🗑 Hapus
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {scopedItems.length === 0
                ? `Belum ada pesanan di kategori "${activeCat}".`
                : "Tidak ada pesanan untuk filter ini."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                onClick={addProduk}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                + Tambah produk
              </button>
              <button
                onClick={() => {
                  setActiveCat(null);
                  setSelectMode(false);
                  setSelected(new Set());
                  setOpenId(null);
                }}
                className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Kelola kategori
              </button>
            </div>
          </div>
        )}
        {selectMode && <div className="h-20" />}
      </main>
      </div>

      {selectMode && (
        <div className="sticky bottom-0 z-10 border-t bg-card/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-3 py-2 sm:px-6">
            <button
              onClick={selectAllVisible}
              className="rounded-md border px-2.5 py-1 text-[11px] font-medium hover:bg-accent"
            >
              {filtered.every((i) => selected.has(i.id)) && filtered.length > 0
                ? "Batal semua"
                : "Pilih semua"}
            </button>
            <span className="text-[11px] text-muted-foreground">
              {selected.size} dipilih · {rupiah(bulkTotal)}
            </span>
            <div className="ml-auto flex gap-1.5">
              <button
                onClick={bulkMarkSent}
                disabled={selected.size === 0}
                className="rounded-md border px-2.5 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-40"
              >
                Tandai terkirim
              </button>
              <a
                href={selected.size === 0 ? undefined : bulkWaUrl}
                target="_blank"
                rel="noreferrer"
                aria-disabled={selected.size === 0}
                onClick={(e) => {
                  if (selected.size === 0) e.preventDefault();
                }}
                className={`inline-flex items-center rounded-md bg-[#25D366] px-3 py-1 text-[11px] font-semibold text-white ${
                  selected.size === 0 ? "pointer-events-none opacity-40" : "hover:opacity-90"
                }`}
              >
                KIRIM WA MASSAL ({selected.size})
              </a>
            </div>
          </div>
        </div>
      )}
      {uid && <AppLockSetup uid={uid} open={setupOpen} onOpenChange={setSetupOpen} />}
      <ProductEditDrawer
        open={editId !== null}
        onOpenChange={(v) => { if (!v) setEditId(null); }}
        produk={items.find((i) => i.id === editId) ?? null}
        categories={categories}
        satuanList={SATUAN_LIST}
        satuanBounds={satuanBounds}
        formatJumlah={formatJumlah}
        rupiah={rupiah}
        update={update}
        setFoto={setFoto}
        addGaleri={addGaleri}
        removeFoto={removeFoto}
        removeGaleri={removeGaleri}
        removeItem={removeItem}
        markSent={markSent}
        buildPesan={buildPesan}
      />
    </div>
  );
}
