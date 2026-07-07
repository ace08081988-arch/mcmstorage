/**
 * Dialog konfirmasi + dialog alasan pembatalan untuk alur auto-Kirim
 * (flag `send=1` dari beranda). Diekstrak dari `_authenticated.ecer.tsx`
 * supaya bisa dipakai oleh harness e2e non-auth (`/lovable/visual/
 * auto-send-cancel`) TANPA menduplikasi implementasi — spec Playwright
 * kemudian menguji komponen yang sama persis dengan yang dijalankan di
 * halaman /ecer produksi.
 *
 * Kontrak (jangan diubah tanpa menyinkronkan test guardrail):
 *   • AutoSendConfirmDialog.onCancel  : dipanggil ketika Batal / dismiss
 *     — TIDAK BOLEH membuka dialog pembayaran, tugas pemanggil.
 *   • AutoSendConfirmDialog.onConfirm : SATU-SATUNYA jalur yang
 *     mengizinkan pemanggil membuka dialog pembayaran.
 *   • AutoSendCancelReasonDialog       : dipakai setelah cancel; note JSON
 *     final di-set oleh pemanggil via onSubmit / onDismiss.
 */
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ChevronDown, Trash2, Pencil, Check, X, Loader2, AlertTriangle, Search, FileSpreadsheet, FileText, MapPin, ExternalLink } from "lucide-react";
import type { EcerTitle, EcerPreparation } from "@/lib/ecer";
import { rupiah } from "@/lib/stock-format";
import {
  buildAutoSendSummaryCsv,
  buildAutoSendSummaryPdf,
  autoSendExportFilename,
  downloadBlob,
  type AutoSendExportPayload,
} from "@/lib/auto-send-export";
import { toast } from "sonner";

/**
 * Menghitung daftar alasan mengapa satu kotak tidak valid untuk dikirim.
 * Kembali array kosong = kotak valid.
 *
 * Kontrak (jangan diubah tanpa update guardrail):
 *   • Berat tidak boleh <= 0 (baik akibat data lama maupun sabotase edit).
 *   • Kotak yang sudah `sold_at` tidak boleh masuk auto-send.
 *   • Judul harus cocok — kalau tidak, ini kotak dari judul lain.
 *   • Produk harus cocok — kalau tidak, ini kotak dari produk lain.
 */
export function autoSendPrepInvalidReasons(
  p: EcerPreparation,
  opts: { expectedTitleId?: string | null; expectedItemId?: string | null },
): string[] {
  const reasons: string[] = [];
  const grams = Number(p.actual_grams);
  if (!Number.isFinite(grams) || grams <= 0) reasons.push("Berat 0 / tidak valid");
  if (p.sold_at) reasons.push("Sudah terjual");
  if (opts.expectedTitleId && p.title_id !== opts.expectedTitleId)
    reasons.push("Judul lain");
  if (
    opts.expectedItemId &&
    p.warehouse_item_id != null &&
    p.warehouse_item_id !== opts.expectedItemId
  )
    reasons.push("Produk lain");
  return reasons;
}

export function AutoSendConfirmDialog({
  state,
  title,
  itemName,
  onCancel,
  onConfirm,
  onRemove,
  onUpdateGrams,
  pricePerBase,
  expectedItemId,
  expectedTitleId,
}: {
  state: { preps: EcerPreparation[] } | null;
  title: EcerTitle;
  itemName: string;
  onCancel: () => void;
  onConfirm: () => void;
  /**
   * Callback untuk membuang satu kotak dari seleksi auto-send SEBELUM
   * pembayaran dibuka. Pemanggil bertanggung jawab memutakhirkan
   * `state.preps` dan Set seleksi induk. Kalau seleksi menjadi kosong,
   * pemanggil sebaiknya menutup modal + finalize audit sebagai cancelled.
   */
  onRemove?: (prepId: string) => void;
  /**
   * Callback untuk memperbarui `actual_grams` satu kotak di DB.
   * Mengembalikan `true` jika sukses supaya inline-edit menutup dirinya.
   */
  onUpdateGrams?: (prepId: string, grams: number) => Promise<boolean>;
  /**
   * Harga per satuan dasar produk (Rp per `title.unit_label`). Dipakai
   * untuk menampilkan estimasi total harga di modal konfirmasi supaya
   * owner tahu biaya sebelum dialog verifikasi pembayaran terbuka.
   * Bernilai `null`/`undefined`/`0` → baris estimasi disembunyikan.
   */
  pricePerBase?: number | null;
  /**
   * Konteks validasi. Kalau diberikan, setiap kotak diperiksa terhadap
   * `title_id`/`warehouse_item_id` ini; kotak yang tidak cocok disorot
   * merah dengan alasan, dan tombol "Lanjut ke pembayaran" di-disable
   * sampai semua kotak valid.
   */
  expectedItemId?: string | null;
  expectedTitleId?: string | null;
}) {
  // Default terbuka: owner harus bisa memverifikasi kotak (produk,
  // judul, jumlah, berat per kotak) TANPA klik tambahan.
  const [expanded, setExpanded] = useState(true);
  // State inline-edit per baris: hanya satu kotak yang bisa diedit
  // sekaligus supaya total di header konsisten dengan yang terlihat.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [savingId, setSavingId] = useState<string | null>(null);
  // Query pencarian daftar kotak — filter menggunakan ID pendek (prefix 8
  // char, huruf kecil). Reset otomatis saat dialog dibuka ulang supaya
  // tidak "membekukan" filter dari sesi sebelumnya.
  const [search, setSearch] = useState<string>("");
  // Status loading tombol ekspor supaya double-tap tidak memicu unduhan ganda.
  const [exporting, setExporting] = useState<null | "csv" | "pdf">(null);
  useEffect(() => {
    if (state) setExpanded(true);
  }, [state]);
  useEffect(() => {
    // Tutup inline-edit setiap kali dialog dibuka ulang.
    if (state) {
      setEditingId(null);
      setEditingValue("");
      setSavingId(null);
      setSearch("");
    }
  }, [state]);
  if (!state) return null;
  const preps = state.preps;
  const unit = title.unit_label || "g";
  const totalGrams = preps.reduce(
    (acc, p) => acc + (Number(p.actual_grams) || 0),
    0,
  );
  const unitPrice = Number(pricePerBase) || 0;
  const totalPrice = unitPrice > 0 ? totalGrams * unitPrice : 0;
  const validationOpts = {
    expectedTitleId: expectedTitleId ?? title.id,
    expectedItemId: expectedItemId ?? null,
  };
  const invalidByPrep = new Map<string, string[]>();
  for (const p of preps) {
    const reasons = autoSendPrepInvalidReasons(p, validationOpts);
    if (reasons.length > 0) invalidByPrep.set(p.id, reasons);
  }
  const invalidCount = invalidByPrep.size;
  const hasInvalid = invalidCount > 0;
  // Ringkasan per produk (warehouse_item_id). Auto-send seharusnya
  // mengunci satu produk, tapi kalau ada regressi / anomali lintas
  // produk, breakdown ini bikin owner langsung sadar: produk utama
  // pakai `itemName`, produk lain ditandai dengan ID pendek + label
  // "Produk lain".
  const expectedItem = expectedItemId ?? null;
  const productGroups = new Map<
    string,
    { key: string; label: string; count: number; grams: number; isOther: boolean }
  >();
  for (const p of preps) {
    const key = p.warehouse_item_id ?? "__unknown__";
    const isOther = expectedItem != null && key !== "__unknown__" && key !== expectedItem;
    const label = key === "__unknown__"
      ? "Tanpa produk"
      : isOther
        ? `Produk lain · ${key.slice(0, 8)}`
        : itemName;
    const g = productGroups.get(key) ?? { key, label, count: 0, grams: 0, isOther };
    g.count += 1;
    g.grams += Number(p.actual_grams) || 0;
    productGroups.set(key, g);
  }
  const productBreakdown = Array.from(productGroups.values());
  const searchTrim = search.trim().toLowerCase();
  const filteredPreps = searchTrim
    ? preps.filter((p) => String(p.id).toLowerCase().includes(searchTrim))
    : preps;
  const filteredInvalid = filteredPreps.filter((p) => invalidByPrep.has(p.id)).length;
  const canMutate = !!onRemove || !!onUpdateGrams;
  const startEdit = (p: EcerPreparation) => {
    setEditingId(p.id);
    setEditingValue(String(Number(p.actual_grams) || 0));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingValue("");
  };
  const commitEdit = async (p: EcerPreparation) => {
    if (!onUpdateGrams) return;
    const grams = Number(String(editingValue).replace(",", "."));
    if (!Number.isFinite(grams) || grams <= 0) return;
    setSavingId(p.id);
    const ok = await onUpdateGrams(p.id, grams);
    setSavingId(null);
    if (ok) cancelEdit();
  };
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent className="max-w-md" data-testid="auto-send-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>Konfirmasi kirim ke pembeli</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1 text-sm">
              <div><span className="text-muted-foreground">Produk:</span> <span className="font-medium text-foreground">{itemName}</span></div>
              <div><span className="text-muted-foreground">Judul:</span> <span className="font-medium text-foreground">{title.name}</span></div>
              <div>
                <span className="text-muted-foreground">Jumlah:</span>{" "}
                <span
                  className="font-medium text-foreground"
                  data-testid="auto-send-count"
                >
                  {preps.length} kotak
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Total:</span>{" "}
                <span
                  className="font-medium text-foreground"
                  data-testid="auto-send-total"
                >
                  {totalGrams} {unit}
                </span>
              </div>
              {unitPrice > 0 && (
                <div>
                  <span className="text-muted-foreground">
                    Estimasi harga:
                  </span>{" "}
                  <span
                    className="font-semibold text-foreground"
                    data-testid="auto-send-total-price"
                  >
                    {rupiah(totalPrice)}
                  </span>{" "}
                  <span className="text-[10px] text-muted-foreground">
                    ({totalGrams} {unit} × {rupiah(unitPrice)}/{unit})
                  </span>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div
          data-testid="auto-send-product-breakdown"
          data-group-count={productBreakdown.length}
          className="rounded-md border bg-muted/20 px-3 py-2 text-xs"
        >
          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Ringkasan per produk</span>
            <div className="flex items-center gap-1">
              <span className="tabular-nums">
                {productBreakdown.length} produk · {preps.length} kotak
              </span>
              <button
                type="button"
                data-testid="auto-send-export-csv"
                aria-label="Ekspor ringkasan ke CSV"
                className="ml-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium hover:bg-muted disabled:opacity-50"
                disabled={exporting !== null}
                onClick={() => {
                  setExporting("csv");
                  try {
                    const payload: AutoSendExportPayload = {
                      itemName,
                      titleName: title.name,
                      unit,
                      unitPrice,
                      totalCount: preps.length,
                      totalGrams,
                      totalPrice,
                      groups: productBreakdown,
                      generatedAt: new Date(),
                    };
                    const csv = buildAutoSendSummaryCsv(payload);
                    downloadBlob(
                      new Blob([csv], { type: "text/csv;charset=utf-8" }),
                      autoSendExportFilename(payload, "csv"),
                    );
                    toast.success("CSV ringkasan diunduh");
                  } catch (e) {
                    toast.error("Gagal ekspor CSV: " + (e as Error).message);
                  } finally {
                    setExporting(null);
                  }
                }}
              >
                <FileSpreadsheet className="h-3 w-3" aria-hidden />
                CSV
              </button>
              <button
                type="button"
                data-testid="auto-send-export-pdf"
                aria-label="Ekspor ringkasan ke PDF"
                className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium hover:bg-muted disabled:opacity-50"
                disabled={exporting !== null}
                onClick={async () => {
                  setExporting("pdf");
                  try {
                    const payload: AutoSendExportPayload = {
                      itemName,
                      titleName: title.name,
                      unit,
                      unitPrice,
                      totalCount: preps.length,
                      totalGrams,
                      totalPrice,
                      groups: productBreakdown,
                      generatedAt: new Date(),
                    };
                    const blob = await buildAutoSendSummaryPdf(payload);
                    downloadBlob(blob, autoSendExportFilename(payload, "pdf"));
                    toast.success("PDF ringkasan diunduh");
                  } catch (e) {
                    toast.error("Gagal ekspor PDF: " + (e as Error).message);
                  } finally {
                    setExporting(null);
                  }
                }}
              >
                {exporting === "pdf" ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <FileText className="h-3 w-3" aria-hidden />
                )}
                PDF
              </button>
            </div>
          </div>
          <ul className="space-y-0.5">
            {productBreakdown.map((g) => (
              <li
                key={g.key}
                data-testid="auto-send-product-breakdown-row"
                data-item-id={g.key}
                data-other={g.isOther ? "true" : undefined}
                className={`flex items-center justify-between gap-2 tabular-nums ${
                  g.isOther ? "text-destructive" : "text-foreground"
                }`}
              >
                <span className="min-w-0 truncate">
                  {g.isOther && (
                    <AlertTriangle
                      className="mr-1 inline h-3 w-3"
                      aria-hidden
                    />
                  )}
                  {g.label}
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-medium">
                    {g.count} kotak · {g.grams} {unit}
                  </span>
                  {unitPrice > 0 && (
                    <span
                      data-testid="auto-send-product-breakdown-price"
                      className={`ml-2 font-semibold ${
                        g.isOther ? "text-destructive" : "text-foreground"
                      }`}
                      title={
                        g.isOther
                          ? "Harga estimasi memakai tarif produk utama; produk ini beda dari yang dipilih."
                          : undefined
                      }
                    >
                      {rupiah(g.grams * unitPrice)}
                      {g.isOther && "*"}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {unitPrice > 0 && productBreakdown.some((g) => g.isOther) && (
            <div className="mt-1 text-[10px] text-destructive/80">
              * Harga produk lain dihitung memakai tarif produk utama —
              perbaiki seleksi sebelum lanjut.
            </div>
          )}
        </div>
        {hasInvalid && (
          <div
            role="alert"
            data-testid="auto-send-invalid-banner"
            data-invalid-count={invalidCount}
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            <div className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              <span>
                {invalidCount} kotak tidak valid — perbaiki atau hapus sebelum
                lanjut.
              </span>
            </div>
            <ul className="mt-1 space-y-0.5 pl-5 list-disc">
              {Array.from(invalidByPrep.entries()).slice(0, 5).map(([id, reasons]) => {
                const p = preps.find((x) => x.id === id);
                const grams = Number(p?.actual_grams) || 0;
                return (
                  <li
                    key={id}
                    data-testid="auto-send-invalid-item"
                    data-prep-id={id}
                    className="tabular-nums"
                  >
                    <span className="font-mono">{id.slice(0, 8)}</span> ·{" "}
                    {grams} {unit} — {reasons.join(", ")}
                  </li>
                );
              })}
              {invalidCount > 5 && (
                <li className="text-destructive/80">
                  +{invalidCount - 5} kotak lainnya
                </li>
              )}
            </ul>
          </div>
        )}
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-testid="auto-send-toggle-list"
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs font-medium hover:bg-muted"
            >
              <span>Daftar kotak ({preps.length})</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent
            data-testid="auto-send-list"
            className="mt-2 max-h-56 overflow-y-auto rounded-md border"
          >
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                inputMode="search"
                data-testid="auto-send-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari ID pendek (misal a1b2c3d4)"
                className="h-7 flex-1 text-xs"
                aria-label="Cari kotak berdasarkan ID pendek"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Kosongkan pencarian"
                  data-testid="auto-send-search-clear"
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {searchTrim && (
              <div
                data-testid="auto-send-search-summary"
                data-match-count={filteredPreps.length}
                className="border-b bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground"
              >
                {filteredPreps.length} dari {preps.length} kotak cocok
                {filteredInvalid > 0 && ` · ${filteredInvalid} tidak valid`}
              </div>
            )}
            <ul className="divide-y">
              {filteredPreps.length === 0 && (
                <li
                  data-testid="auto-send-search-empty"
                  className="px-3 py-4 text-center text-[11px] text-muted-foreground"
                >
                  Tidak ada kotak yang cocok dengan "{search.trim()}".
                </li>
              )}
              {filteredPreps.map((p) => {
                const i = preps.findIndex((x) => x.id === p.id);
                const isEditing = editingId === p.id;
                const isSaving = savingId === p.id;
                const rowReasons = invalidByPrep.get(p.id) ?? [];
                const isInvalid = rowReasons.length > 0;
                return (
                  <li
                    key={p.id}
                    data-testid="auto-send-list-item"
                    data-prep-id={p.id}
                    data-invalid={isInvalid ? "true" : undefined}
                    className={`flex flex-col gap-1 px-3 py-1.5 text-xs ${
                      isInvalid
                        ? "bg-destructive/5 ring-1 ring-inset ring-destructive/30"
                        : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-muted-foreground">
                        #{i + 1} ·{" "}
                        <span className="font-mono">
                          {String(p.id).slice(0, 8)}
                        </span>
                        {isInvalid && (
                          <AlertTriangle
                            className="ml-1 inline h-3 w-3 text-destructive"
                            aria-hidden
                          />
                        )}
                      </span>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <Input
                          data-testid="auto-send-item-grams-input"
                          type="number"
                          inputMode="decimal"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          className="h-7 w-20 text-xs"
                          min={1}
                          step="0.01"
                          disabled={isSaving}
                          autoFocus
                        />
                        <span className="text-muted-foreground">{unit}</span>
                        <button
                          type="button"
                          aria-label="Simpan berat"
                          data-testid="auto-send-item-save"
                          className="rounded p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          onClick={() => void commitEdit(p)}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label="Batal ubah"
                          data-testid="auto-send-item-edit-cancel"
                          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
                          onClick={cancelEdit}
                          disabled={isSaving}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span
                          className={`font-medium tabular-nums ${
                            isInvalid ? "text-destructive" : ""
                          }`}
                          data-testid="auto-send-item-grams"
                        >
                          {Number(p.actual_grams) || 0} {unit}
                        </span>
                        {onUpdateGrams && (
                          <button
                            type="button"
                            aria-label={`Ubah berat kotak #${i + 1}`}
                            data-testid="auto-send-item-edit"
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => startEdit(p)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {onRemove && (
                          <button
                            type="button"
                            aria-label={`Hapus kotak #${i + 1} dari seleksi`}
                            data-testid="auto-send-item-remove"
                            className="rounded p-1 text-destructive/80 hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                            onClick={() => onRemove(p.id)}
                            disabled={preps.length <= 1}
                            title={
                              preps.length <= 1
                                ? "Minimal satu kotak harus tersisa — pakai Batal untuk membatalkan seluruh auto-Kirim."
                                : undefined
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                    </div>
                    {isInvalid && (
                      <div
                        data-testid="auto-send-item-invalid-reason"
                        className="text-[10px] font-medium text-destructive"
                      >
                        {rowReasons.join(" · ")}
                      </div>
                    )}
                    {(() => {
                      const key = p.warehouse_item_id ?? "__unknown__";
                      const isOtherProduct =
                        expectedItem != null &&
                        key !== "__unknown__" &&
                        key !== expectedItem;
                      const productLabel =
                        key === "__unknown__"
                          ? "Tanpa produk"
                          : isOtherProduct
                            ? `Produk lain · ${key.slice(0, 8)}`
                            : itemName;
                      const locUrl = p.location_url;
                      const hasGps =
                        typeof p.gps_lat === "number" &&
                        typeof p.gps_lng === "number" &&
                        Number.isFinite(p.gps_lat) &&
                        Number.isFinite(p.gps_lng);
                      const gpsUrl = hasGps
                        ? `https://www.google.com/maps?q=${p.gps_lat},${p.gps_lng}`
                        : null;
                      const finalUrl = locUrl || gpsUrl;
                      const locLabel = locUrl
                        ? "Buka lokasi"
                        : hasGps
                          ? `${p.gps_lat!.toFixed(4)}, ${p.gps_lng!.toFixed(4)}`
                          : "Lokasi belum diisi";
                      return (
                        <div
                          data-testid="auto-send-item-meta"
                          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground"
                        >
                          <span
                            data-testid="auto-send-item-product"
                            data-other-product={isOtherProduct ? "true" : undefined}
                            className={`inline-flex items-center gap-1 ${
                              isOtherProduct ? "text-destructive font-medium" : ""
                            }`}
                          >
                            {isOtherProduct && (
                              <AlertTriangle className="h-3 w-3" aria-hidden />
                            )}
                            <span className="truncate max-w-[10rem]">
                              {productLabel}
                            </span>
                          </span>
                          <span aria-hidden>·</span>
                          {finalUrl ? (
                            <a
                              href={finalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid="auto-send-item-location-link"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              <MapPin className="h-3 w-3" aria-hidden />
                              <span className="truncate max-w-[10rem]">
                                {locLabel}
                              </span>
                              <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                            </a>
                          ) : (
                            <span
                              data-testid="auto-send-item-location-missing"
                              className="inline-flex items-center gap-1 italic"
                            >
                              <MapPin className="h-3 w-3" aria-hidden />
                              {locLabel}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </li>
                );
              })}
            </ul>
            {canMutate && (
              <div className="border-t bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
                Ubah berat atau hapus kotak dari seleksi sebelum lanjut.
                Minimal satu kotak harus tersisa.
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
        <div
          data-testid="auto-send-grand-total"
          className="mt-2 flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
        >
          <div className="flex flex-col text-[11px] text-muted-foreground">
            <span className="font-medium uppercase tracking-wide">
              Total keseluruhan
            </span>
            <span className="tabular-nums text-foreground/80">
              {preps.length} kotak · {totalGrams} {unit}
            </span>
          </div>
          <div
            className="text-right font-bold tabular-nums text-primary"
            data-testid="auto-send-grand-total-price"
          >
            {unitPrice > 0 ? (
              rupiah(totalPrice)
            ) : (
              <span className="text-xs font-normal text-muted-foreground">
                Harga diisi di langkah pembayaran
              </span>
            )}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onCancel}
            data-testid="auto-send-confirm-cancel"
          >
            Batal
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            data-testid="auto-send-confirm-continue"
            disabled={!!editingId || hasInvalid}
            title={
              hasInvalid
                ? "Ada kotak tidak valid — perbaiki atau hapus dulu."
                : undefined
            }
          >
            Lanjut ke pembayaran
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Preset alasan pembatalan (token stabil untuk audit note). */
export const AUTO_SEND_CANCEL_REASONS: Array<{ value: string; label: string }> = [
  { value: "salah_pilih", label: "Salah pilih paket / seleksi" },
  { value: "belum_siap", label: "Belum siap kirim sekarang" },
  { value: "pembeli_batal", label: "Pembeli batal / pending konfirmasi" },
  { value: "cek_ulang", label: "Perlu cek ulang berat / harga" },
  { value: "lainnya", label: "Lainnya (isi detail)" },
];

export type AutoSendCancelState = {
  preps: EcerPreparation[];
  auditId: string;
  source: "confirm_modal" | "closed_send_dialog";
};

export function AutoSendCancelReasonDialog({
  state,
  title,
  itemName,
  onSubmit,
  onDismiss,
}: {
  state: AutoSendCancelState | null;
  title: EcerTitle;
  itemName: string;
  onSubmit: (reason: string, detail: string) => void;
  onDismiss: () => void;
}) {
  const [reason, setReason] = useState<string>("salah_pilih");
  const [detail, setDetail] = useState<string>("");
  useEffect(() => {
    if (state) {
      setReason("salah_pilih");
      setDetail("");
    }
  }, [state]);
  if (!state) return null;
  const preps = state.preps;
  const unit = title.unit_label || "g";
  const totalGrams = preps.reduce(
    (acc, p) => acc + (Number(p.actual_grams) || 0),
    0,
  );
  const submit = () => onSubmit(reason, detail.trim());
  return (
    <AlertDialog
      open
      onOpenChange={(o) => {
        if (!o) onDismiss();
      }}
    >
      <AlertDialogContent
        className="max-w-md"
        data-testid="auto-send-cancel-reason"
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Alasan pembatalan auto-Kirim</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Produk:</span>{" "}
                <span className="font-medium text-foreground">{itemName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Judul:</span>{" "}
                <span className="font-medium text-foreground">{title.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Seleksi:</span>{" "}
                <span className="font-medium text-foreground">
                  {preps.length} kotak · {totalGrams} {unit}
                </span>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <RadioGroup
            value={reason}
            onValueChange={setReason}
            data-testid="auto-send-cancel-reason-group"
          >
            {AUTO_SEND_CANCEL_REASONS.map((r) => (
              <label
                key={r.value}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                data-testid={`auto-send-cancel-reason-${r.value}`}
              >
                <RadioGroupItem value={r.value} />
                <span>{r.label}</span>
              </label>
            ))}
          </RadioGroup>
          <div className="space-y-1">
            <Label htmlFor="auto-send-cancel-detail" className="text-xs">
              Detail (opsional)
            </Label>
            <Textarea
              id="auto-send-cancel-detail"
              data-testid="auto-send-cancel-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Catatan singkat supaya mudah ditelusuri…"
              rows={2}
              maxLength={280}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDismiss}>Lewati</AlertDialogCancel>
          <AlertDialogAction
            onClick={submit}
            data-testid="auto-send-cancel-submit"
          >
            Simpan alasan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}