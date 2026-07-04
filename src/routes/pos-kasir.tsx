import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/pos-kasir")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PosKasirLayout,
});

function PosKasirLayout() {
  return <Outlet />;
}
