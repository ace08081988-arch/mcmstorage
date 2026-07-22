import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listProdukTool from "./tools/list-produk";
import ringkasanPiutangTool from "./tools/ringkasan-piutang";

// Issuer OAuth HARUS host Supabase langsung, bukan proxy .lovable.cloud —
// jika tidak, mcp-js menolak token (RFC 8414 issuer mismatch). Project ref
// di-inline saat build via VITE_SUPABASE_PROJECT_ID; fallback sentinel supaya
// eval manifest-extract tidak crash saat literal belum tersedia.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "mcm-storage-mcp",
  title: "MCM Storage",
  version: "0.1.0",
  instructions:
    "Tools untuk MCM Storage / Toko Kifa. Setiap tool berjalan sebagai user MCM Storage yang sedang terhubung — data tenant lain tidak dapat diakses. Gunakan `whoami` untuk verifikasi koneksi, `list_produk` untuk melihat stok gudang, dan `ringkasan_piutang` untuk melihat total piutang.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listProdukTool, ringkasanPiutangTool],
});