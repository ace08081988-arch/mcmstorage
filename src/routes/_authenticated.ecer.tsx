import { createFileRoute, redirect } from "@tanstack/react-router";

// Halaman /ecer lama sekarang menyatu di Beranda sebagai section
// "Penyiapan Ecer". Semua bookmark/notifikasi lama diarahkan ke
// Beranda dengan search params + hash agar otomatis scroll ke section.
export const Route = createFileRoute("/_authenticated/ecer")({
  validateSearch: (s: Record<string, unknown>) => ({
    item: typeof s.item === "string" ? s.item : undefined,
    title: typeof s.title === "string" ? s.title : undefined,
    highlight: typeof s.highlight === "string" ? s.highlight : undefined,
    edit: typeof s.edit === "string" ? s.edit : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/",
      search: {
        item: search.item,
        title: search.title,
        highlight: search.highlight,
        edit: search.edit,
      },
      hash: "ecer",
      replace: true,
    });
  },
  component: () => null,
});