/**
 * Generator bukti pembayaran (PNG) untuk penjualan Siapkan Sendiri.
 *
 * Dipakai oleh alur share WA/Chat: setelah pembayaran tercatat
 * (`sold_at` != null), owner mengirim foto paket + caption + gambar
 * bukti ini sebagai lampiran tambahan ke pembeli.
 *
 * Kontrak (jangan diubah tanpa memutakhirkan pemanggil di
 * SiapkanSendiriSection.onSendWA / onSendChat):
 *   • Fungsi ini SELALU mengembalikan File PNG bila `sold_at` dan
 *     `sold_summary` tersedia; kalau salah satu kosong, kembalikan
 *     `null` (bukti tidak dilampirkan, alur tetap jalan).
 *   • Nama file: `bukti-<8charid>-<yyyymmdd>.png` supaya konsisten
 *     di history WhatsApp/Chat.
 *   • Rendering murni client-side pakai OffscreenCanvas → Canvas
 *     fallback; TIDAK memanggil AI Gateway (bukti bersifat mekanis,
 *     bukan generatif).
 */

export type SaleReceiptInput = {
  id: string;
  title: string;
  sold_at: string;
  sold_summary: string;
  sold_total: number;
  sold_paid_amount: number;
  sold_payment_method: string | null;
  customer_name?: string | null;
  org_name?: string | null;
};

const WIDTH = 900;
const PADDING = 40;
const LINE = 28;

function rupiah(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function methodLabel(m: string | null): { text: string; color: string } {
  switch (m) {
    case "kas":
      return { text: "LUNAS", color: "#16a34a" };
    case "partial":
      return { text: "SEBAGIAN", color: "#d97706" };
    case "hutang":
      return { text: "HUTANG", color: "#dc2626" };
    default:
      return { text: (m ?? "—").toUpperCase(), color: "#64748b" };
  }
}

export async function generateSaleReceipt(
  input: SaleReceiptInput,
): Promise<File | null> {
  if (!input.sold_at || !input.sold_summary) return null;
  const summaryLines = input.sold_summary.split("\n").filter((l) => l.trim().length > 0);
  // Tinggi kanvas dihitung dinamis dari jumlah baris ringkasan.
  const headerH = PADDING + 90;
  const bodyH = summaryLines.length * LINE + 20;
  const footerH = 180;
  const height = headerH + bodyH + footerH;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);

  // Border kartu
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, WIDTH - 24, height - 24);

  // Header
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 32px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(input.org_name?.trim() || "MCM Storage", PADDING, PADDING + 28);

  ctx.fillStyle = "#64748b";
  ctx.font = "500 16px system-ui, -apple-system, sans-serif";
  ctx.fillText("BUKTI PEMBAYARAN", PADDING, PADDING + 54);

  // Badge metode di kanan
  const method = methodLabel(input.sold_payment_method);
  ctx.fillStyle = method.color;
  ctx.font = "bold 20px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(method.text, WIDTH - PADDING, PADDING + 28);

  // Meta: tanggal + ID
  const dt = new Date(input.sold_at);
  const dtLabel = dt.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const shortId = input.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  ctx.fillStyle = "#64748b";
  ctx.font = "500 14px system-ui, -apple-system, sans-serif";
  ctx.fillText(`#${shortId}`, WIDTH - PADDING, PADDING + 54);
  ctx.textAlign = "left";
  ctx.fillText(dtLabel, PADDING, PADDING + 78);
  if (input.customer_name) {
    ctx.textAlign = "right";
    ctx.fillText(`Pelanggan: ${input.customer_name}`, WIDTH - PADDING, PADDING + 78);
  }

  // Divider
  const dividerY = headerH;
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, dividerY);
  ctx.lineTo(WIDTH - PADDING, dividerY);
  ctx.stroke();

  // Judul paket
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 18px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(input.title, PADDING, dividerY + 24);

  // Ringkasan baris per baris
  ctx.fillStyle = "#334155";
  ctx.font = "500 16px system-ui, -apple-system, sans-serif";
  let y = dividerY + 24 + LINE;
  for (const line of summaryLines) {
    // Baris "Total: …" / "Pembayaran: …" ditebalkan
    if (/^(Total|Pembayaran|Dibayar|Sisa piutang):/i.test(line.trim())) {
      ctx.fillStyle = "#0f172a";
      ctx.font = "600 16px system-ui, -apple-system, sans-serif";
    } else {
      ctx.fillStyle = "#334155";
      ctx.font = "500 16px system-ui, -apple-system, sans-serif";
    }
    // Pemenggalan sederhana kalau kelewat lebar
    const maxW = WIDTH - PADDING * 2;
    let text = line;
    if (ctx.measureText(text).width > maxW) {
      while (text.length > 4 && ctx.measureText(text + "…").width > maxW) {
        text = text.slice(0, -1);
      }
      text = text + "…";
    }
    ctx.fillText(text, PADDING, y);
    y += LINE;
  }

  // Divider bawah
  const bottomDivider = y + 12;
  ctx.strokeStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.moveTo(PADDING, bottomDivider);
  ctx.lineTo(WIDTH - PADDING, bottomDivider);
  ctx.stroke();

  // Ringkasan total besar
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 18px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Total", PADDING, bottomDivider + 32);
  ctx.textAlign = "right";
  ctx.font = "bold 22px system-ui, -apple-system, sans-serif";
  ctx.fillText(rupiah(input.sold_total), WIDTH - PADDING, bottomDivider + 32);

  if (input.sold_payment_method !== "kas") {
    ctx.fillStyle = "#334155";
    ctx.font = "500 15px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Dibayar", PADDING, bottomDivider + 60);
    ctx.textAlign = "right";
    ctx.fillText(rupiah(input.sold_paid_amount), WIDTH - PADDING, bottomDivider + 60);

    const remaining = Math.max(0, input.sold_total - input.sold_paid_amount);
    ctx.fillStyle = "#dc2626";
    ctx.font = "600 15px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Sisa piutang", PADDING, bottomDivider + 86);
    ctx.textAlign = "right";
    ctx.fillText(rupiah(remaining), WIDTH - PADDING, bottomDivider + 86);
  }

  // Footer
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 12px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    "Bukti ini digenerate otomatis dari sistem penjualan.",
    WIDTH / 2,
    height - 24,
  );

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png", 0.92),
  );
  if (!blob) return null;
  const yyyymmdd =
    dt.getFullYear().toString() +
    String(dt.getMonth() + 1).padStart(2, "0") +
    String(dt.getDate()).padStart(2, "0");
  const name = `bukti-${shortId.toLowerCase()}-${yyyymmdd}.png`;
  return new File([blob], name, { type: "image/png" });
}