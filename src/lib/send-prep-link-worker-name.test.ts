/**
 * Integrasi: nama pegawai di SendPrepLinkDialog tidak boleh tertukar
 * saat berpindah antar RequestTitle. Test ini menirukan protokol
 * dua-effect di `src/routes/_authenticated.request.tsx` (~L1183–1215):
 *
 *   - state `workerName` (per-title, dihidrasi dari localStorage)
 *   - ref  `loadedKeyRef` (kunci mana yang sudah dihidrasi ke state)
 *   - effect SAVE : tulis ke localStorage[workerNameStorageKey], TOLAK
 *                   jika loadedKeyRef.current !== workerNameStorageKey.
 *   - effect LOAD : saat workerNameStorageKey berubah, muat nilai
 *                   tersimpan → set state → set loadedKeyRef.
 *
 * Simulator menjalankan siklus render React untuk skenario buka-tutup
 * beberapa title secara bergantian dan mengecek bahwa nilai antar-title
 * TIDAK bocor (regresi lama: draft title lama menimpa title baru saat
 * transisi karena save-effect ikut nembak sebelum load-effect update).
 */
import { beforeEach, describe, expect, it } from "vitest";

// ---------- Fake localStorage (env: node) ----------
const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

// ---------- Simulator komponen ----------
function makeKey(titleId: string | null): string | null {
  return titleId ? `mcm:sendPrepLink:workerName:${titleId}` : null;
}

class DialogSim {
  private titleId: string | null = null;
  private storageKey: string | null = null;
  private prevStorageKey: string | null = null; // deps effect LOAD
  private workerName = "";
  private loadedKey: string | null = null;
  private mounted = false;

  /** Buka dialog untuk title tertentu (atau ganti title). */
  open(titleId: string) {
    const nextKey = makeKey(titleId);
    if (!this.mounted) {
      // Mount: useState initializer membaca localStorage[key] sinkron,
      // dan useRef diinisialisasi ke storageKey (lihat L1193-1195).
      this.mounted = true;
      this.titleId = titleId;
      this.storageKey = nextKey;
      this.workerName = nextKey ? localStorage.getItem(nextKey) ?? "" : "";
      this.loadedKey = nextKey;
      this.prevStorageKey = nextKey;
      this.runEffects();
      return;
    }
    this.titleId = titleId;
    this.storageKey = nextKey;
    this.runEffects();
  }

  /** Tutup dialog (title=null): dialog tetap mounted, key jadi null. */
  close() {
    this.titleId = null;
    this.storageKey = null;
    this.runEffects();
  }

  /** User mengetik. */
  type(name: string) {
    this.workerName = name;
    this.runEffects();
  }

  private runEffects() {
    // 1) LOAD effect — deps: [workerNameStorageKey]
    if (this.storageKey !== this.prevStorageKey) {
      if (this.storageKey) {
        const saved = localStorage.getItem(this.storageKey) ?? "";
        this.workerName = saved;
        this.loadedKey = this.storageKey;
      }
      this.prevStorageKey = this.storageKey;
    }
    // 2) SAVE effect — deps: [workerName, workerNameStorageKey]
    if (!this.storageKey) return;
    if (this.loadedKey !== this.storageKey) return; // GUARD
    if (this.workerName) localStorage.setItem(this.storageKey, this.workerName);
    else localStorage.removeItem(this.storageKey);
  }

  get name() {
    return this.workerName;
  }
}

// ---------- Tes ----------
describe("SendPrepLinkDialog · workerName per-title", () => {
  beforeEach(() => localStorage.clear());

  it("menyimpan nama secara terpisah untuk setiap title", () => {
    const d = new DialogSim();
    d.open("A");
    d.type("Andi");
    d.open("B");
    expect(d.name).toBe(""); // title B belum punya draft
    d.type("Budi");

    expect(localStorage.getItem("mcm:sendPrepLink:workerName:A")).toBe("Andi");
    expect(localStorage.getItem("mcm:sendPrepLink:workerName:B")).toBe("Budi");
  });

  it("membuka ulang title mengembalikan draft yang benar", () => {
    const d = new DialogSim();
    d.open("A"); d.type("Andi");
    d.open("B"); d.type("Budi");
    d.open("A");
    expect(d.name).toBe("Andi");
    d.open("B");
    expect(d.name).toBe("Budi");
  });

  it("tidak menimpa draft title baru saat transisi (regresi loadedKeyRef)", () => {
    const d = new DialogSim();
    d.open("A"); d.type("Andi");
    // Sebelum guard ditambahkan, save-effect akan menembak dengan
    // workerName lama "Andi" tetapi storageKey baru "B" saat title
    // berganti — menimpa slot B. Verifikasi hal itu tidak terjadi.
    d.open("B");
    expect(localStorage.getItem("mcm:sendPrepLink:workerName:B")).toBeNull();
    expect(localStorage.getItem("mcm:sendPrepLink:workerName:A")).toBe("Andi");
  });

  it("buka-tutup-buka bergantian tetap menjaga nama per-title", () => {
    const d = new DialogSim();
    d.open("A"); d.type("Andi"); d.close();
    d.open("B"); d.type("Budi"); d.close();
    d.open("C"); d.type("Cici"); d.close();

    d.open("B"); expect(d.name).toBe("Budi");
    d.open("A"); expect(d.name).toBe("Andi");
    d.open("C"); expect(d.name).toBe("Cici");

    // Storage tidak bocor antar slot.
    expect(localStorage.getItem("mcm:sendPrepLink:workerName:A")).toBe("Andi");
    expect(localStorage.getItem("mcm:sendPrepLink:workerName:B")).toBe("Budi");
    expect(localStorage.getItem("mcm:sendPrepLink:workerName:C")).toBe("Cici");
  });

  it("menghapus nama (string kosong) hanya menghapus slot title aktif", () => {
    const d = new DialogSim();
    d.open("A"); d.type("Andi");
    d.open("B"); d.type("Budi");
    d.open("A"); d.type("");
    expect(localStorage.getItem("mcm:sendPrepLink:workerName:A")).toBeNull();
    expect(localStorage.getItem("mcm:sendPrepLink:workerName:B")).toBe("Budi");
  });

  it("rapid switching A→B→A→B tidak menyilangkan draft", () => {
    const d = new DialogSim();
    d.open("A"); d.type("Andi");
    d.open("B"); d.type("Budi");
    d.open("A"); d.open("B"); d.open("A"); d.open("B");
    expect(localStorage.getItem("mcm:sendPrepLink:workerName:A")).toBe("Andi");
    expect(localStorage.getItem("mcm:sendPrepLink:workerName:B")).toBe("Budi");
  });
});
