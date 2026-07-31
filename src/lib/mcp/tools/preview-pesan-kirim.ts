import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  buildPaymentMessageLines,
  formatPaymentRupiah,
  getPaymentBreakdown,
} from "@/lib/payment-summary";

/**
 * Menghasilkan preview teks WhatsApp/Chat yang akan dikirim ke pembeli untuk
 * suatu transaksi. Menggunakan format yang identik dengan `buildCaption()` di
 * `SendEcerPrepsDialog` (src/routes/_authenticated.ecer.tsx) — SSOT format
 * caption pengiriman paket ke pembeli.
 *
 * Tool ini murni komputasi (tidak menyentuh DB) sehingga aman dipanggil siapa
 * saja yang sudah terautentikasi lewat OAuth MCP untuk mem-preview draft
 * pesan sebelum benar-benar dikirim.
 */

export default defineTool({
  name: "preview_pesan_kirim",
  title: "Preview pesan WA/Chat",
  description:
    "Menghasilkan preview teks WhatsApp/Chat yang akan dikirim ke pembeli untuk suatu transaksi paket ecer. Formatnya identik dengan yang dipakai tombol 'Verifikasi bayar → Kirim ke pembeli' di aplikasi (judul paket, rincian kotak, total, metode bayar, catatan, lokasi ambil). Gunakan sebelum benar-benar mengirim untuk memastikan copy pesan sesuai.",
  inputSchema: {
    title: z.string().min(1).describe("Nama/judul paket, contoh: 'Kacang tanah 500g'."),
    unit_label: z
      .string()
      .optional()
      .describe("Satuan tampilan per kotak (misal 'g', 'ml', 'pcs'). Default 'g'."),
    items: z
      .array(z.object({ grams: z.number().positive().describe("Isi kotak dalam satuan unit_label.") }))
      .min(1)
      .describe("Daftar kotak/paket yang dikirim (urut sesuai tampilan #1, #2, ...)."),
    total_amount: z.number().nonnegative().describe("Total harga (Rupiah)."),
    payment_method: z
      .enum(["kas", "hutang", "partial"])
      .describe("Metode bayar: 'kas' = Lunas, 'hutang' = Piutang penuh, 'partial' = Bayar sebagian."),
    paid_amount: z
      .number()
      .nonnegative()
      .optional()
      .describe("Nominal yang sudah dibayar; wajib > 0 dan < total_amount saat payment_method='partial'."),
    customer_name: z.string().optional().describe("Nama pembeli. Kalau kosong baris 'Untuk:' dihilangkan."),
    note: z.string().optional().describe("Catatan tambahan untuk pembeli."),
    location_url: z
      .string()
      .url()
      .optional()
      .describe("URL Google Maps titik ambil. Kalau kosong blok 'Lokasi ambil' dihilangkan."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Tidak terautentikasi" }], isError: true };
    }

    const unit = input.unit_label?.trim() || "g";
    const payment = getPaymentBreakdown(
      input.payment_method,
      input.total_amount,
      input.paid_amount ?? 0,
    );

    if (input.payment_method === "partial" && !payment.partialValid) {
      return {
        content: [
          {
            type: "text",
            text:
              "paid_amount untuk metode 'partial' harus > 0 dan < total_amount. " +
              "Gunakan 'kas' bila lunas, atau 'hutang' bila belum ada pembayaran.",
          },
        ],
        isError: true,
      };
    }

    const lines: string[] = [];
    lines.push(`*${input.title}*`);
    lines.push("");
    lines.push(`Isi paket (${input.items.length} kotak):`);
    input.items.forEach((it, i) => {
      lines.push(`• #${i + 1} — ${it.grams} ${unit}`);
    });
    lines.push("");
    lines.push(`Total: *${formatPaymentRupiah(payment.total)}*`);
    lines.push(...buildPaymentMessageLines(payment));
    if (input.customer_name?.trim()) lines.push(`Untuk: ${input.customer_name.trim()}`);
    if (input.note?.trim()) {
      lines.push("");
      lines.push(`Catatan: ${input.note.trim()}`);
    }
    if (input.location_url?.trim()) {
      lines.push("");
      lines.push("📍 Lokasi ambil:");
      lines.push(input.location_url.trim());
    }
    lines.push("");
    lines.push("Terima kasih 🙏");

    const preview = lines.join("\n");
    const payload = {
      preview,
      char_count: preview.length,
      line_count: lines.length,
      payment: {
        method: payment.method,
        label: payment.label,
        total: payment.total,
        paid: payment.paid,
        remaining: payment.remaining,
      },
    };

    return {
      content: [{ type: "text", text: preview }],
      structuredContent: payload,
    };
  },
});