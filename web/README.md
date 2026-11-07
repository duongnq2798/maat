# Maat web

Public landing page for Maat (W1), a static Next.js export.
Spec: `docs/superpowers/specs/2026-11-07-maat-web-design.md`. Approved comp: `docs/superpowers/specs/assets/2026-11-07-maat-landing-v2.dc.html`.

## Commands (run in `web/`)

| Command | What it does |
|---|---|
| `npm install` | install the pinned dependencies |
| `npm run dev` | dev server on http://localhost:3000 |
| `npm test` | unit, component and contract parity tests |
| `npm run typecheck` | Next route types + `tsc --noEmit` |
| `npm run build` | static export into `out/` |
| `npm run check:out` | checks `out/`: metadata, link targets, no third-party scripts, Saturday state in the HTML |
| `npm run verify` | `typecheck` + `test` + `build` + `check:out`, in that order. It does not run the e2e tests |
| `npm run brand` | re-renders the logo, icons, OG image and X avatar/banner |
| `npm run e2e` | Playwright smoke on `out/`. Run `npm run build` first: it serves the existing `out/` and does not build. Once per machine: `npx playwright install chromium` |

Keep Next's anonymous telemetry off when you build:

- Git Bash: `NEXT_TELEMETRY_DISABLED=1 npm run build`
- PowerShell: `$env:NEXT_TELEMETRY_DISABLED=1; npm run build`

Full local check: `npm run verify`, then `npm run e2e` (the build inside `verify` leaves the `out/` that e2e serves).

## Where the numbers come from

Every number on the page lives in `content/facts.ts` with a `source`. `test/facts.test.ts` reads the contracts and the fork test directly, so a contract change that moves a number fails the tests until the site is updated.

W1 shows only the labeled Base fork run. Values that exist only after the mainnet deploy are shown as `[after deploy]` and `[from mainnet tx]`, never as made-up hashes.

## Deploy (owner)

0. **Get `web/` onto the branch Vercel builds.** `web/` exists only on `feat/web`, which sits on top of the plan-1, plan-2a and plan-2b branches. The default branch `main` has no `web/` today, so "Root Directory: `web`" fails there. Either:
   - push `feat/web` and merge it into the repo's default branch, or
   - set `feat/web` as the Production Branch in the Vercel project settings.
1. **Vercel:** Add New → Project → import this GitHub repo.
   - Root Directory: `web`.
   - Framework preset: Next.js.
   - Node.js version: 24.x.
   - No environment variables are needed for the first deploy.
2. **Deploy.** The site works on its `*.vercel.app` URL, and the OG and Twitter cards use that URL automatically.
3. **Custom domain:**
   - after buying the domain, add it under Project → Domains and set the DNS records Vercel shows;
   - set `NEXT_PUBLIC_SITE_URL=https://<domain>` for Production;
   - redeploy, so the cards point at the domain.
4. **X (@maatonbase):** upload `brand/out/x-avatar.png` as the profile photo and `brand/out/x-banner.png` as the header.
5. **Before announcing:** run Lighthouse on the production URL (Chrome DevTools → Lighthouse → Mobile, all categories). Targets:

   | Category | Target |
   |---|---|
   | Performance | ≥ 90 |
   | Accessibility | 100 |
   | Best Practices | ≥ 95 |
   | SEO | 100 |

## Brand files

| File | Use |
|---|---|
| `brand/src/mark.svg`, `mark-light.svg`, `lockup.svg` | vector logo (dark tile, outlined tile, mark + wordmark) |
| `brand/out/og.png` | 1200×630 link preview (also `app/opengraph-image.png`) |
| `brand/out/x-avatar.png`, `x-banner.png` | X profile photo and header |
| `brand/out/favicon-32.png`, `icon-512.png`, `apple-icon-180.png` | icons (also copied into `app/`) |

The geometry lives in `brand/mark.ts`. Change it there and run `npm run brand`. A test fails if the committed SVGs no longer match.
