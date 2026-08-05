/**
 * Fake Supabase untuk tabel `address_book` yang MENIRU aturan database asli:
 * kolom ter-generate `phone_norm` / `email_norm` plus indeks unik parsial
 * (phone_norm, email_norm, dan nama untuk kontak tanpa nomor/email) per user.
 *
 * Tujuannya: kalau logika dedup di klien lolos, fake DB ini melempar 23505
 * persis seperti Postgres — jadi tes gagal, bukan diam-diam lolos.
 */
import { normalizeEmail, normalizePhone, type AddressBookRow } from "@/lib/address-book";

export const FAKE_UID = "user-1";

type Row = AddressBookRow;

export class FakeAddressBookDb {
  rows: Row[] = [];
  private seq = 0;

  reset() {
    this.rows = [];
    this.seq = 0;
  }

  seed(partial: Partial<Row> & { name: string }): Row {
    const row = this.materialize(partial);
    this.rows.push(row);
    return row;
  }

  private materialize(p: Partial<Row> & { name: string }): Row {
    const now = new Date(Date.now() + this.seq * 1000).toISOString();
    return {
      id: p.id ?? `row-${++this.seq}`,
      user_id: p.user_id ?? FAKE_UID,
      name: p.name,
      phone: p.phone ?? null,
      phone_norm: normalizePhone(p.phone ?? null),
      email: p.email ?? null,
      email_norm: normalizeEmail(p.email ?? null),
      source: p.source ?? "manual",
      device_contact_id: p.device_contact_id ?? null,
      linked_user_id: p.linked_user_id ?? null,
      note: p.note ?? null,
      created_at: p.created_at ?? now,
      updated_at: p.updated_at ?? now,
    };
  }

  /** Meniru indeks unik parsial Postgres. */
  private assertUnique(candidate: Row) {
    const others = this.rows.filter(
      (r) => r.id !== candidate.id && r.user_id === candidate.user_id,
    );
    const clash = others.some((r) => {
      if (candidate.phone_norm && r.phone_norm === candidate.phone_norm) return true;
      if (candidate.email_norm && r.email_norm === candidate.email_norm) return true;
      if (
        !candidate.phone_norm &&
        !candidate.email_norm &&
        !r.phone_norm &&
        !r.email_norm &&
        r.name.trim().toLowerCase() === candidate.name.trim().toLowerCase()
      )
        return true;
      return false;
    });
    if (clash) {
      const err = new Error("duplicate key value violates unique constraint");
      (err as unknown as { code: string }).code = "23505";
      throw err;
    }
  }

  insert(payloads: Array<Partial<Row> & { name: string }>): Row[] {
    const created: Row[] = [];
    for (const p of payloads) {
      const row = this.materialize(p);
      this.assertUnique(row);
      this.rows.push(row);
      created.push(row);
    }
    return created;
  }

  upsert(p: Partial<Row> & { name: string }): Row {
    if (p.id) {
      const idx = this.rows.findIndex((r) => r.id === p.id);
      if (idx >= 0) {
        const next = this.materialize({ ...this.rows[idx], ...p });
        this.assertUnique(next);
        this.rows[idx] = next;
        return next;
      }
    }
    return this.insert([p])[0]!;
  }

  update(id: string, patch: Partial<Row>): Row {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx < 0) throw new Error("row not found");
    const next = this.materialize({ ...this.rows[idx], ...patch });
    this.assertUnique(next);
    this.rows[idx] = next;
    return next;
  }

  delete(ids: string[]) {
    this.rows = this.rows.filter((r) => !ids.includes(r.id));
  }
}

export const fakeDb = new FakeAddressBookDb();

type Filter = { op: "eq" | "neq" | "in" | "ilike"; col: string; val: unknown };

class Builder implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private mode: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: unknown = null;
  private _limit: number | null = null;
  private _single = false;
  private _maybe = false;

  select() {
    if (this.mode === "select") this.mode = "select";
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this._limit = n;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ op: "eq", col, val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push({ op: "neq", col, val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.filters.push({ op: "in", col, val });
    return this;
  }
  ilike(col: string, val: string) {
    this.filters.push({ op: "ilike", col, val });
    return this;
  }
  insert(payload: unknown) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  upsert(payload: unknown) {
    this.mode = "upsert";
    this.payload = payload;
    return this;
  }
  update(payload: unknown) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  single() {
    this._single = true;
    return this;
  }
  maybeSingle() {
    this._maybe = true;
    return this;
  }

  private matches(row: Record<string, unknown>) {
    return this.filters.every((f) => {
      const v = row[f.col];
      if (f.op === "eq") return v === f.val;
      if (f.op === "neq") return v !== f.val;
      if (f.op === "in") return (f.val as unknown[]).includes(v);
      return String(v ?? "").toLowerCase() === String(f.val).toLowerCase();
    });
  }

  private run(): { data: unknown; error: unknown } {
    try {
      if (this.mode === "delete") {
        const ids = fakeDb.rows.filter((r) => this.matches(r as never)).map((r) => r.id);
        fakeDb.delete(ids);
        return { data: null, error: null };
      }
      if (this.mode === "insert") {
        const rows = fakeDb.insert(
          (Array.isArray(this.payload) ? this.payload : [this.payload]) as never,
        );
        return { data: this._single ? rows[0] : rows, error: null };
      }
      if (this.mode === "upsert") {
        const row = fakeDb.upsert(this.payload as never);
        return { data: this._single ? row : [row], error: null };
      }
      if (this.mode === "update") {
        const targets = fakeDb.rows.filter((r) => this.matches(r as never));
        const out = targets.map((t) => fakeDb.update(t.id, this.payload as Partial<Row>));
        return { data: this._single ? (out[0] ?? null) : out, error: null };
      }
      let rows = fakeDb.rows.filter((r) => this.matches(r as never));
      if (this._limit != null) rows = rows.slice(0, this._limit);
      if (this._single) {
        if (rows.length !== 1) return { data: null, error: { code: "PGRST116" } };
        return { data: rows[0], error: null };
      }
      if (this._maybe) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    } catch (e) {
      const code = (e as { code?: string }).code ?? "XXXXX";
      return { data: null, error: { code, message: (e as Error).message } };
    }
  }

  then<T1 = { data: unknown; error: unknown }, T2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export const fakeSupabase = {
  from: () => new Builder(),
  auth: {
    getUser: async () => ({ data: { user: { id: FAKE_UID } }, error: null }),
  },
  rpc: async () => ({ data: [], error: null }),
};
