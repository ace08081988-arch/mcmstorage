/** Routes covered by visual regression. Keep in sync with src/routes/. */
export const PUBLIC_ROUTES: { name: string; path: string }[] = [
  { name: "auth", path: "/auth" },
  { name: "pricing", path: "/pricing" },
  { name: "terms", path: "/terms" },
  { name: "refund", path: "/refund" },
  { name: "trust", path: "/trust" },
  { name: "download", path: "/download" },
  { name: "reset-password", path: "/reset-password" },
  { name: "error", path: "/error" },
];

export const ADMIN_ROUTES: { name: string; path: string }[] = [
  { name: "home", path: "/" },
  { name: "gudang", path: "/gudang" },
  { name: "ecer", path: "/ecer" },
  { name: "request", path: "/request" },
  { name: "kontak", path: "/kontak" },
  { name: "hutang-piutang", path: "/hutang-piutang" },
  { name: "tugas", path: "/tugas" },
  { name: "chat", path: "/chat" },
  { name: "profil", path: "/profil" },
  { name: "manajemen-pegawai", path: "/manajemen-pegawai" },
  { name: "link-pegawai", path: "/link-pegawai" },
  { name: "pengaturan-kunci", path: "/pengaturan-kunci" },
  { name: "audit", path: "/audit" },
  { name: "label-preview", path: "/label-preview" },
];