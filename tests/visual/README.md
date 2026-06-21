# Visual Regression Tests

Playwright `toHaveScreenshot` covering public routes (no auth) and admin routes
(authenticated via persisted Supabase session). Mobile viewport 390×844.

## Setup

```bash
# 1. Install browsers (once per machine / CI image)
bunx playwright install --with-deps chromium

# 2. Start the app in a separate terminal
bun run dev   # http://localhost:5173

# 3. (admin specs only) export a real test account
export TEST_EMAIL=you@example.com
export TEST_PASSWORD=********
# Optional: point at a deployed env
export BASE_URL=https://id-preview--<id>.lovable.app
```

The first login may land on `/device-verify`. Verify the device once manually
with that account, then re-run — the trusted-device cookie is persisted in
`tests/visual/.auth/user.json` together with the Supabase session.

## Commands

```bash
# Generate / update baselines (run after intentional UI changes)
bunx playwright test --update-snapshots

# Run the regression suite
bunx playwright test

# Only public routes (no login needed)
bunx playwright test --project=mobile-public

# Only admin routes (requires TEST_EMAIL/TEST_PASSWORD)
bunx playwright test --project=mobile-admin

# Open the HTML report with diffs
bunx playwright show-report
```

## Adding viewports or routes

- Routes live in `tests/visual/routes.ts` — add an entry and re-run with
  `--update-snapshots` to capture a baseline.
- To add a viewport (e.g. tablet 768×1024 or desktop 1440×900), duplicate the
  `mobile-public` / `mobile-admin` projects in `playwright.config.ts` with a
  different `name` + `viewport`. Each project gets its own baseline folder.

## Notes

- Baselines live under `tests/visual/__screenshots__/` and should be committed.
- `maxDiffPixelRatio: 0.02` absorbs minor font-rendering jitter; tighten if
  you want stricter diffs.
- `.auth/user.json` contains a live session token — keep it out of git
  (already ignored below).