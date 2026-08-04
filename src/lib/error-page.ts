export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <title>Halaman gagal dimuat</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.6 system-ui, -apple-system, sans-serif; background: #0b0b0d; color: #f5f2e8; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; letter-spacing: -0.01em; margin: 0 0 0.5rem; }
      p { color: #a9a598; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { min-height: 44px; display: inline-flex; align-items: center; padding: 0.5rem 1.25rem; border-radius: 0.5rem; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #c9a84c; color: #14120b; }
      .secondary { background: transparent; color: #f5f2e8; border-color: #35322a; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Halaman gagal dimuat</h1>
      <p>Terjadi gangguan sesaat. Coba muat ulang atau kembali ke beranda.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Coba lagi</button>
        <a class="secondary" href="/">Kembali ke beranda</a>
      </div>
    </div>
  </body>
</html>`;
}
