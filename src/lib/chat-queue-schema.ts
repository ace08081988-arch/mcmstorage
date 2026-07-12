/**
 * Envelope versi untuk `mcm.chat.pendingProducts.<convId>` di
 * localStorage. Diekstrak ke modul kecil supaya harness/spec e2e
 * dapat mengimpor konstanta yang SAMA dengan route produksi — bump
 * versi otomatis memaksa spec ikut update.
 */
export const PENDING_PRODUCTS_VERSION = 2 as const;