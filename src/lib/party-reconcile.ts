/**
 * Rekonsiliasi kontak (party) untuk transaksi lama.
 *
 * Masalah yang dipecahkan: SSOT `party_balance_v1()` mengelompokkan saldo
 * memakai **nama** yang dinormalisasi (lowercase + rapikan spasi). Jadi
 * satu orang bisa terpecah jadi beberapa "kontak" hanya karena ejaan
 * berbeda ("GIMEN", "Gimen ", "Pak Gimen"), atau catatan manual di `debts`
 * tidak pernah ditautkan ke record pelanggan/supplier yang benar.
 *
 * Modul ini MURNI membaca lalu memetakan ulang baris `debts` milik user
 * (RLS berlaku) — tidak ada penghapusan, tidak ada penulisan saldo baru.
 * Yang diubah hanya `party_name` (agar key SSOT menyatu) dan penautan
 * `customer_id`/`supplier_id` bila ada record kontak yang cocok.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeParty } from "@/lib/chat-debt-sync";
import { nameSimilarity, DUP_THRESHOLD } from "@/lib/contact-dup";

export type ContactRecord = {
  id: string;
  name: string;
  contact: string | null;
  kind: "customer" | "supplier";
};

export type DebtRow = {
  id: string;
  kind: string;
  party_name: string;
  customer_id: string | null;
  supplier_id: string | null;
  amount: number;
  created_at: string;
};

export type ReconcileData = {
  contacts: ContactRecord[];
  debts: DebtRow[];
};

export async function fetchReconcileData(): Promise<ReconcileData> {
  const [cust, sup, debts] = await Promise.all([
    supabase.from("customers").select("id, name, contact"),
    supabase.from("suppliers").select("id, name, contact"),
    supabase
      .from("debts")
      .select("id, kind, party_name, customer_id, supplier_id, amount, created_at")
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);
  if (cust.error) throw cust.error;
  if (sup.error) throw sup.error;
  if (debts.error) throw debts.error;
  const contacts: ContactRecord[] = [
    ...(cust.data ?? []).map((c) => ({
      id: c.id as string,
      name: (c.name as string) ?? "",
      contact: (c.contact as string | null) ?? null,
      kind: "customer" as const,
    })),
    ...(sup.data ?? []).map((s) => ({
      id: s.id as string,
      name: (s.name as string) ?? "",
      contact: (s.contact as string | null) ?? null,
      kind: "supplier" as const,
    })),
  ].filter((c) => c.name.trim() !== "");
  return {
    contacts,
    debts: ((debts.data ?? []) as unknown as DebtRow[]).filter(
      (d) => (d.party_name ?? "").trim() !== "",
    ),
  };
}

/** Satu nama pihak apa adanya, seperti yang dilihat SSOT. */
export type PartyBucket = {
  key: string;
  name: string;
  /** Baris debts yang memakai nama ini. */
  debtIds: string[];
  total: number;
  count: number;
  lastAt: string;
  /** Record kontak resmi dengan key persis sama (kalau ada). */
  contact: ContactRecord | null;
  /** Berapa baris yang belum tertaut ke customer_id/supplier_id. */
  unlinked: number;
};

export type IssueKind =
  /** Beberapa ejaan nama berbeda yang sangat mirip → saldo terpecah. */
  | "variant"
  /** Nama transaksi tidak punya record kontak sama sekali. */
  | "unregistered"
  /** Nama cocok dengan kontak resmi, tapi barisnya belum tertaut. */
  | "unlinked";

export type ReconcileIssue = {
  id: string;
  kind: IssueKind;
  /** Kandidat nama kanonik terbaik (paling banyak dipakai / punya record). */
  suggested: PartyBucket;
  /** Semua bucket dalam satu grup (termasuk `suggested`). */
  buckets: PartyBucket[];
  /** Total nominal seluruh grup. */
  total: number;
  /** Kontak resmi yang direkomendasikan untuk penautan. */
  contact: ContactRecord | null;
};

function buildBuckets(data: ReconcileData): PartyBucket[] {
  const byContactKey = new Map<string, ContactRecord>();
  for (const c of data.contacts) {
    const k = normalizeParty(c.name);
    if (k && !byContactKey.has(k)) byContactKey.set(k, c);
  }
  const map = new Map<string, PartyBucket>();
  for (const d of data.debts) {
    const key = normalizeParty(d.party_name);
    if (!key) continue;
    const b =
      map.get(key) ??
      {
        key,
        name: d.party_name.trim(),
        debtIds: [],
        total: 0,
        count: 0,
        lastAt: d.created_at,
        contact: byContactKey.get(key) ?? null,
        unlinked: 0,
      };
    b.debtIds.push(d.id);
    b.total += Number(d.amount) || 0;
    b.count += 1;
    if (d.created_at > b.lastAt) b.lastAt = d.created_at;
    if (!d.customer_id && !d.supplier_id) b.unlinked += 1;
    map.set(key, b);
  }
  // Kontak resmi yang belum punya baris debts tetap dipakai sebagai target
  // mapping, tapi tidak dijadikan bucket bermasalah.
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

/** Pilih bucket kanonik: yang punya record kontak dulu, lalu nilai terbesar. */
function pickCanonical(buckets: PartyBucket[]): PartyBucket {
  return [...buckets].sort((a, b) => {
    const ca = a.contact ? 1 : 0;
    const cb = b.contact ? 1 : 0;
    if (ca !== cb) return cb - ca;
    if (b.count !== a.count) return b.count - a.count;
    return b.total - a.total;
  })[0];
}

/**
 * Deteksi transaksi lama yang belum match.
 * `threshold` memakai skor kemiripan dari `contact-dup` (0..1).
 */
export function detectIssues(
  data: ReconcileData,
  threshold: number = DUP_THRESHOLD,
): ReconcileIssue[] {
  const buckets = buildBuckets(data);
  const contactByKey = new Map<string, ContactRecord>();
  for (const c of data.contacts) {
    const k = normalizeParty(c.name);
    if (k && !contactByKey.has(k)) contactByKey.set(k, c);
  }

  // 1. Kelompokkan bucket yang mirip (union sederhana berbasis skor).
  const used = new Set<string>();
  const issues: ReconcileIssue[] = [];
  for (const b of buckets) {
    if (used.has(b.key)) continue;
    const group = [b];
    used.add(b.key);
    for (const other of buckets) {
      if (used.has(other.key)) continue;
      if (nameSimilarity(b.name, other.name) >= threshold) {
        group.push(other);
        used.add(other.key);
      }
    }
    if (group.length > 1) {
      const suggested = pickCanonical(group);
      issues.push({
        id: `variant:${suggested.key}`,
        kind: "variant",
        suggested,
        buckets: group.sort((x, y) => y.total - x.total),
        total: group.reduce((s, g) => s + g.total, 0),
        contact: suggested.contact ?? group.find((g) => g.contact)?.contact ?? null,
      });
      continue;
    }
    // 2. Bucket tunggal: cek penautan / pendaftaran.
    const near = !b.contact
      ? data.contacts.find((c) => nameSimilarity(c.name, b.name) >= threshold) ?? null
      : b.contact;
    if (!b.contact && !near) {
      issues.push({
        id: `unregistered:${b.key}`,
        kind: "unregistered",
        suggested: b,
        buckets: [b],
        total: b.total,
        contact: null,
      });
    } else if (b.unlinked > 0) {
      issues.push({
        id: `unlinked:${b.key}`,
        kind: "unlinked",
        suggested: b,
        buckets: [b],
        total: b.total,
        contact: b.contact ?? near,
      });
    }
  }
  return issues.sort((a, b) => b.total - a.total);
}

export const ISSUE_LABEL: Record<IssueKind, string> = {
  variant: "Nama terpecah",
  unregistered: "Belum terdaftar",
  unlinked: "Belum tertaut",
};

export const ISSUE_HINT: Record<IssueKind, string> = {
  variant:
    "Beberapa ejaan nama berbeda dianggap orang berbeda, jadi saldonya terpecah.",
  unregistered:
    "Nama ini hanya ada di catatan hutang, belum punya record pelanggan/supplier.",
  unlinked:
    "Catatan sudah pakai nama kontak resmi, tapi barisnya belum ditautkan ke record-nya.",
};

export type ApplyMappingInput = {
  /** Semua id baris `debts` yang akan dipetakan ulang. */
  debtIds: string[];
  /** Nama kanonik yang dipakai SSOT setelah mapping. */
  canonicalName: string;
  /** Record kontak tujuan (opsional). */
  contact: ContactRecord | null;
};

export type ApplyMappingResult = { updated: number };

/**
 * Terapkan mapping: samakan `party_name` semua baris ke nama kanonik dan
 * tautkan ke record kontak bila ada. Nominal, tanggal, dan pembayaran
 * (`debt_payments`) TIDAK disentuh — saldo total tidak berubah, hanya
 * pengelompokannya yang menyatu.
 */
export async function applyPartyMapping(
  input: ApplyMappingInput,
): Promise<ApplyMappingResult> {
  const ids = Array.from(new Set(input.debtIds)).filter(Boolean);
  const name = input.canonicalName.trim();
  if (ids.length === 0 || !name) return { updated: 0 };
  const patch: Record<string, unknown> = { party_name: name };
  if (input.contact) {
    if (input.contact.kind === "customer") patch.customer_id = input.contact.id;
    else patch.supplier_id = input.contact.id;
  }
  // Batch supaya URL filter `in()` tidak kepanjangan di perangkat mobile.
  let updated = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { error, data } = await supabase
      .from("debts")
      .update(patch as never)
      .in("id", chunk)
      .select("id");
    if (error) throw error;
    updated += (data ?? []).length;
  }
  return { updated };
}

/** Buat record kontak baru sebagai target mapping. */
export async function createContactForParty(
  name: string,
  kind: "customer" | "supplier",
): Promise<ContactRecord> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Sesi berakhir, masuk lagi.");
  const table = kind === "customer" ? "customers" : "suppliers";
  const { data, error } = await supabase
    .from(table)
    .insert({ user_id: uid, name: name.trim() } as never)
    .select("id, name, contact")
    .single();
  if (error) throw error;
  return {
    id: (data as { id: string }).id,
    name: (data as { name: string }).name,
    contact: ((data as { contact?: string | null }).contact ?? null) as string | null,
    kind,
  };
}
