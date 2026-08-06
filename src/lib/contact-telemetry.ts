/**
 * Telemetri klien untuk dua temuan yang sering terlewat:
 *   1. Kegagalan insert/update ke `customers` / `suppliers` (mis. RLS 42501).
 *   2. Blokir duplikat di Buku Alamat (agar ketahuan kalau aturan klien
 *      lebih ketat daripada indeks unik parsial di database).
 *
 * Semua pencatatan fire-and-forget: error telemetri tidak boleh menggagalkan
 * aksi pengguna. Selain menulis ke `portal_error_events` lewat server fn,
 * kita juga console.warn JSON satu baris agar mudah difilter di log browser.
 */
import { logContactEvent } from "./contact-telemetry.functions";

function currentRoute(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.pathname + window.location.search;
}

function send(kind: "party_write_failure" | "address_book_duplicate_block", payload: {
  code?: string | null;
  status?: string | null;
  route?: string | null;
}) {
  const body = { kind, ...payload, route: payload.route ?? currentRoute() };
  // eslint-disable-next-line no-console
  console.warn(`[contact-telemetry] ${JSON.stringify({ ...body, at: new Date().toISOString() })}`);
  try {
    void logContactEvent({ data: body }).catch(() => {});
  } catch {
    // ignore
  }
}

export type PartyTable = "customers" | "suppliers";
export type PartyOp = "insert" | "update" | "delete";

/** Catat kegagalan tulis pelanggan/supplier beserta kode error database. */
export function logPartyWriteFailure(params: {
  table: PartyTable;
  op: PartyOp;
  error: unknown;
  source: string;
}): void {
  const e = (params.error ?? {}) as { code?: string; message?: string };
  send("party_write_failure", {
    code: e.code ?? "unknown",
    status: `${params.table}.${params.op} @${params.source}: ${e.message ?? String(params.error)}`,
  });
}

/** Catat saat UI Buku Alamat memblokir simpan karena dianggap duplikat. */
export function logAddressBookDuplicateBlock(params: {
  field: "name" | "phone" | "email";
  isNew: boolean;
}): void {
  send("address_book_duplicate_block", {
    code: params.field,
    status: `${params.isNew ? "create" : "edit"} diblokir oleh aturan duplikat ${params.field}`,
  });
}
