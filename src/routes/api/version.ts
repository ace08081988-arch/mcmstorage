import { createFileRoute } from "@tanstack/react-router";

// BUILD_ID / BUILD_TIME di-inline oleh Vite (lihat vite.config.ts).
// Endpoint ini dibaca oleh BuildVersionBadge untuk mendeteksi bundle
// baru di server vs bundle lama yang masih berjalan di browser.
const BUILD_ID: string = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";
const BUILD_TIME: string = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : new Date().toISOString();

export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          JSON.stringify({ buildId: BUILD_ID, buildTime: BUILD_TIME }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store, must-revalidate",
            },
          },
        ),
    },
  },
});