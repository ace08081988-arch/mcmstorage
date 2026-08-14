#!/usr/bin/env node
/**
 * Static preview server untuk E2E Playwright.
 *
 * `vite preview` tidak bisa dipakai di CI karena build web memakai preset
 * Cloudflare (nitro) — entry `dist/server/server.js` tidak ada, sehingga
 * step "Wait for server" selalu timeout. Untuk harness E2E kita cukup
 * memakai build SPA statis (`bun run build:e2e`) dan menyajikannya dengan
 * fallback index.html supaya routing client-side tetap jalan.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "dist/client");
const PORT = Number(process.env.PORT || process.argv[2] || 4173);
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

async function readIfFile(path) {
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let body = await readIfFile(join(ROOT, rel));
  let ext = extname(rel);
  if (!body) {
    body = await readIfFile(join(ROOT, "index.html"));
    ext = ".html";
  }
  if (!body) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[ext] || "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(body);
});

server.listen(PORT, HOST, () => {
  console.log(`[serve-e2e] http://${HOST}:${PORT} (root: ${ROOT})`);
});
