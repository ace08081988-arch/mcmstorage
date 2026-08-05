/**
 * Pengujian dedup buku alamat di SEMUA alur:
 *   1. Buat kontak baru (manual)
 *   2. Edit kontak yang sudah ada
 *   3. Impor dari perangkat (device contacts)
 *   4. Sinkronisasi ke database (indeks unik Supabase sebagai jaring terakhir)
 *   5. Deteksi + penggabungan kontak ganda
 *
 * Fake DB meniru kolom ter-generate + indeks unik Postgres, jadi setiap kasus
 * yang lolos dari filter klien tetap ketahuan lewat error 23505.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, FAKE_UID, setNormalizers } from "./_fake-address-book-db";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("./_fake-address-book-db");
  return { supabase: m.fakeSupabase };
});
vi.mock("@/lib/ensure-session", () => ({
  ensureFreshSession: async () => ({ userId: FAKE_UID }),
}));
vi.mock("@/lib/storage-access", () => ({ assertStorageAccess: async () => {} }));

const {
  normalizePhone,
  normalizeEmail,
  upsertManualEntry,
  importDeviceContacts,
  findDuplicateGroups,
  mergeContacts,
  fetchAddressBook,
} = await import("@/lib/address-book");

setNormalizers(normalizePhone, normalizeEmail);

beforeEach(() => fakeDb.reset());

// ── 0. Normalisasi ────────────────────────────────────────────────────────
describe("normalisasi", () => {
  const phoneVariants = [
    "0812-3456-7890",
    "+62 812 3456 7890",
    "62 812 3456 7890",
    "0062 812 3456 7890",
    "(0812) 34567890",
    "81234567890",
    "+626281234567890".replace("6262", "62"),
  ];
  it("semua varian nomor jadi satu nilai", () => {
    const set = new Set(phoneVariants.map((p) => normalizePhone(p)));
    expect(set.size).toBe(1);
    expect([...set][0]).toBe("6281234567890");
  });

  it("email disamakan (case, +tag, titik gmail, googlemail)", () => {
    const set = new Set(
      [
        "Budi.Santoso@Gmail.com",
        "budisantoso@gmail.com",
        "budi.santoso+promo@googlemail.com",
        "  BUDISANTOSO@GMAIL.COM ",
      ].map((e) => normalizeEmail(e)),
    );
    expect(set.size).toBe(1);
    expect([...set][0]).toBe("budisantoso@gmail.com");
  });

  it("nilai kosong/ tidak valid mengembalikan null", () => {
    for (const v of [null, undefined, "", "   ", "-", "()"]) {
      expect(normalizePhone(v as string | null)).toBeNull();
    }
    expect(normalizeEmail("   ")).toBeNull();
  });
});

// ── 1. Buat baru ──────────────────────────────────────────────────────────
describe("alur buat kontak baru", () => {
  it("menolak nomor sama walau formatnya berbeda", async () => {
    await upsertManualEntry({ name: "Budi", phone: "0812-3456-7890" });
    await expect(
      upsertManualEntry({ name: "Budi Santoso", phone: "+62 812 3456 7890" }),
    ).rejects.toThrow(/sudah tersimpan/i);
    expect(fakeDb.rows).toHaveLength(1);
  });

  it("menolak email sama walau pakai +tag / titik gmail", async () => {
    await upsertManualEntry({ name: "Ani", email: "ani.putri@gmail.com" });
    await expect(
      upsertManualEntry({ name: "Ani P", email: "aniputri+belanja@googlemail.com" }),
    ).rejects.toThrow(/sudah tersimpan/i);
    expect(fakeDb.rows).toHaveLength(1);
  });

  it("menolak nama sama untuk kontak tanpa nomor & email", async () => {
    await upsertManualEntry({ name: "Toko Sinar" });
    await expect(upsertManualEntry({ name: "  toko sinar " })).rejects.toThrow();
    expect(fakeDb.rows).toHaveLength(1);
  });

  it("mengizinkan kontak berbeda", async () => {
    await upsertManualEntry({ name: "Budi", phone: "081234567890" });
    await upsertManualEntry({ name: "Ani", phone: "081298765432" });
    expect(fakeDb.rows).toHaveLength(2);
  });
});

// ── 2. Edit ───────────────────────────────────────────────────────────────
describe("alur edit kontak", () => {
  it("boleh menyimpan ulang kontak yang sama (tidak dianggap ganda dengan dirinya)", async () => {
    const a = await upsertManualEntry({ name: "Budi", phone: "081234567890" });
    const updated = await upsertManualEntry({
      id: a.id,
      name: "Budi Santoso",
      phone: "+62 812 3456 7890",
    });
    expect(updated.id).toBe(a.id);
    expect(fakeDb.rows).toHaveLength(1);
    expect(updated.name).toBe("Budi Santoso");
  });

  it("menolak edit yang membuat nomor bentrok dengan kontak lain", async () => {
    await upsertManualEntry({ name: "Budi", phone: "081234567890" });
    const b = await upsertManualEntry({ name: "Ani", phone: "081298765432" });
    await expect(
      upsertManualEntry({ id: b.id, name: "Ani", phone: "0812-3456-7890" }),
    ).rejects.toThrow(/sudah tersimpan/i);
    expect(fakeDb.rows.find((r) => r.id === b.id)?.phone_norm).toBe("6281298765432");
  });

  it("menolak edit email yang bentrok setelah normalisasi", async () => {
    await upsertManualEntry({ name: "Ani", email: "ani.putri@gmail.com" });
    const c = await upsertManualEntry({ name: "Cici", email: "cici@mail.com" });
    await expect(
      upsertManualEntry({ id: c.id, name: "Cici", email: "aniputri@gmail.com" }),
    ).rejects.toThrow(/sudah tersimpan/i);
  });
});

// ── 3. Impor dari perangkat ───────────────────────────────────────────────
describe("alur impor kontak perangkat", () => {
  const contact = (
    id: string,
    name: string,
    phones: string[] = [],
    emails: string[] = [],
  ) => ({ device_contact_id: id, name, phones, emails });

  it("tidak mengimpor nomor yang sudah ada di buku alamat", async () => {
    await upsertManualEntry({ name: "Budi", phone: "081234567890" });
    const res = await importDeviceContacts([
      contact("d1", "Budi HP", ["+62 812 3456 7890"]),
      contact("d2", "Ani", ["081298765432"]),
    ]);
    expect(res.inserted).toBe(1);
    expect(fakeDb.rows).toHaveLength(2);
  });

  it("dedup di dalam satu batch impor (nomor & email duplikat)", async () => {
    const res = await importDeviceContacts([
      contact("d1", "Budi", ["0812-3456-7890"]),
      contact("d2", "Budi (kantor)", ["+62 812 3456 7890"]),
      contact("d3", "Ani", [], ["ani.putri@gmail.com"]),
      contact("d4", "Ani Putri", [], ["aniputri+promo@googlemail.com"]),
    ]);
    expect(res.inserted).toBe(2);
    expect(fakeDb.rows).toHaveLength(2);
  });

  it("kontak tanpa nomor/email dedup berdasarkan nama", async () => {
    const res = await importDeviceContacts([
      contact("d1", "Toko Sinar"),
      contact("d2", "toko sinar"),
    ]);
    expect(res.inserted).toBe(1);
  });

  it("impor ulang batch yang sama tidak menambah baris", async () => {
    const batch = [contact("d1", "Budi", ["081234567890"]), contact("d2", "Ani", ["081298765432"])];
    await importDeviceContacts(batch);
    const again = await importDeviceContacts(batch);
    expect(again.inserted).toBe(0);
    expect(fakeDb.rows).toHaveLength(2);
  });
});

// ── 4. Sinkronisasi database (jaring terakhir) ────────────────────────────
describe("jaring terakhir indeks unik database", () => {
  it("insert langsung dengan nomor duplikat ditolak 23505", () => {
    fakeDb.seed({ name: "Budi", phone: "081234567890" });
    expect(() => fakeDb.insert([{ name: "Budi 2", phone: "+62 812 3456 7890" }])).toThrow(
      /duplicate key/,
    );
  });

  it("insert langsung dengan email duplikat ditolak 23505", () => {
    fakeDb.seed({ name: "Ani", email: "ani.putri@gmail.com" });
    expect(() => fakeDb.insert([{ name: "Ani 2", email: "aniputri@googlemail.com" }])).toThrow(
      /duplicate key/,
    );
  });

  it("update yang membuat bentrok ditolak 23505", () => {
    fakeDb.seed({ name: "Budi", phone: "081234567890" });
    const b = fakeDb.seed({ name: "Ani", phone: "081298765432" });
    expect(() => fakeDb.update(b.id, { phone: "+62 812 3456 7890" })).toThrow(/duplicate key/);
  });
});

// ── 5. Deteksi & penggabungan ─────────────────────────────────────────────
describe("deteksi dan penggabungan kontak ganda", () => {
  it("mengelompokkan kontak ganda berdasarkan nomor, email, dan nama", () => {
    fakeDb.seed({ name: "Budi", phone: "081234567890" });
    fakeDb.rows.push({
      ...fakeDb.seed({ name: "Budi Santoso" }),
      phone: "+62 812 3456 7890",
      phone_norm: "6281234567890",
    });
    const groups = findDuplicateGroups(fakeDb.rows);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reason).toBe("phone");
    expect(groups[0]!.rows).toHaveLength(2);
  });

  it("buku alamat bersih tidak menghasilkan grup", async () => {
    await upsertManualEntry({ name: "Budi", phone: "081234567890" });
    await upsertManualEntry({ name: "Ani", email: "ani@mail.com" });
    expect(findDuplicateGroups(await fetchAddressBook())).toHaveLength(0);
  });

  it("penggabungan menyisakan satu baris dengan data pilihan pengguna", async () => {
    const a = fakeDb.seed({ name: "Budi", phone: "081234567890", note: "pelanggan lama" });
    const b = fakeDb.seed({ name: "Budi Santoso", email: "budi@mail.com", linked_user_id: "acc-9" });
    const merged = await mergeContacts({
      keepId: b.id,
      removeIds: [a.id],
      fields: {
        name: "Budi Santoso",
        phone: "081234567890",
        email: "budi@mail.com",
        note: "pelanggan lama",
        linked_user_id: "acc-9",
      },
    });
    expect(fakeDb.rows).toHaveLength(1);
    expect(merged.id).toBe(b.id);
    expect(merged.phone_norm).toBe("6281234567890");
    expect(merged.email_norm).toBe("budi@mail.com");
    expect(merged.note).toBe("pelanggan lama");
    expect(merged.linked_user_id).toBe("acc-9");
    expect(findDuplicateGroups(fakeDb.rows)).toHaveLength(0);
  });

  it("hasil gabungan tidak melanggar indeks unik walau nomor diambil dari baris yang dihapus", async () => {
    const a = fakeDb.seed({ name: "Ani", phone: "081298765432" });
    const b = fakeDb.seed({ name: "Ani Putri", email: "ani@mail.com" });
    await expect(
      mergeContacts({
        keepId: b.id,
        removeIds: [a.id],
        fields: {
          name: "Ani Putri",
          phone: "081298765432",
          email: "ani@mail.com",
          note: null,
          linked_user_id: null,
        },
      }),
    ).resolves.toBeTruthy();
    expect(fakeDb.rows).toHaveLength(1);
  });

  it("setelah semua alur dijalankan, tidak ada duplikat tersisa", async () => {
    await upsertManualEntry({ name: "Budi", phone: "0812-3456-7890" });
    await importDeviceContacts([
      { device_contact_id: "d1", name: "Budi HP", phones: ["+62 812 3456 7890"], emails: [] },
      { device_contact_id: "d2", name: "Ani", phones: ["081298765432"], emails: [] },
      { device_contact_id: "d3", name: "Ani 2", phones: ["62 812 9876 5432"], emails: [] },
    ]);
    await upsertManualEntry({ name: "Cici", email: "Cici.Q@Gmail.com" });
    await expect(
      upsertManualEntry({ name: "Cici Q", email: "ciciq+toko@googlemail.com" }),
    ).rejects.toThrow();
    const rows = await fetchAddressBook();
    expect(findDuplicateGroups(rows)).toHaveLength(0);
    const phones = rows.map((r) => r.phone_norm).filter(Boolean);
    expect(new Set(phones).size).toBe(phones.length);
  });
});
