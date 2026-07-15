# Polecat Platform — Architecture

The Polecat suite is a fleet of static-first web apps under `*.polecat.live`. This doc
defines the platform topology and the contracts that hold it together.

## Principles (carried forward from the fleet)

- **Static-first, no build step.** Every app is plain HTML + ES modules + CSS deployed
  as files. Vendored libraries only; no bundlers, no frameworks.
- **Local-first data.** Apps work fully logged-out on localStorage/IndexedDB with
  schema-versioned **additive** migrations. Remote backends are optional mirrors.
- **Joy is the product.** Single-color iconography, elegant motion (respecting
  reduce-motion), delightful details, mobile as a release gate — not a port.
- **Never break the ingest contract.** Every app publishes `/js/changelog.js` in the
  fleet format (see SHELL-API.md); Manager and the launcher read it live.
- **Never hard-gate deploy on CI.** Smoke tests advise; auto-revert heals. (Learned the
  hard way: a `needs: test` gate once froze analytics for ~21 hours.)

## Topology: hub + spokes

```
kevinrhaas/polecat-platform          ← THIS REPO (hub)
  lib/          Polecat Shell vX.Y.Z (source of truth)
  site/         polecat.live (marketing + launcher)
  docs/         standards
kevinrhaas/<app>.polecat.live        ← one repo per app (spokes)
  vendor/polecat-shell/              versioned verbatim copy of lib/ (read-only)
  js/, css/, app code                app-owned
  js/changelog.js                    fleet-format changelog (app-owned)
  .github/workflows/deploy.yml       Pages deploy (unchanged)
```

Why not a monorepo: GitHub Pages serves exactly one site + CNAME per repo; per-repo
spokes keep independent deploys, per-app privacy options, independent agent loops, and
blast-radius isolation. The hub gives us the single source of truth the fleet lacked.

## Shell distribution (vendoring)

- `lib/VERSION` is a semver; `scripts/gen-manifest.mjs` writes `lib/MANIFEST.json`
  (`{version, files: {path: sha256}}`). Run it before tagging `shell-vX.Y.Z`.
- `.github/workflows/sync-shell.yml` (manual dispatch; inputs: `apps`, `ref`) copies
  `lib/` → each app's `vendor/polecat-shell/` and opens a PR. Nothing auto-merges.
- Apps pin whatever version is vendored. Upgrades are explicit, reviewed PRs.
- Modules take `storageKey`/config parameters — the shell NEVER hardcodes an app's
  localStorage keys, so adopting it never wipes user state.

## Auth seam (backend: Supabase, bring-your-own)

Identity mirrors the proven DataSource adapter pattern (manager `js/sources/schema.js`,
analytics `app/sources/schema.js`):

- `lib/auth/schema.js` — the contract: `init(cfg)`, `getUser()`, `onAuthChange(cb)`,
  `signInWithOAuth('google'|'apple')`, `signInWithEmail(email)`, `signOut()`.
- `lib/auth/null.js` — default adapter: logged-out-first. Everything works without an
  account; sign-in surfaces the roadmap + BYO-backend docs.
- `lib/auth/supabase.js` — the first real adapter (lazy CDN-ESM import, config
  injected at `init()`, never hardcoded). Supabase because it is open-source and
  self-hostable (GPL-aligned), ships Google/Apple/email OAuth out of the box, and is
  Postgres — the natural substrate for suite-wide reporting via the analytics engine.
- Users may point any app at their own Supabase (or any adapter-conforming backend).

Rollout: launcher ships logged-out with the null adapter → Supabase project + Google/
Apple providers configured → launcher sign-in goes live → apps adopt per MIGRATION.md.
User administration (roles, per-feature grants, turning app features on/off centrally)
builds on the same seam and lands with the Supabase phase; Manager grows the admin UI.

## Reporting substrate

The analytics app's adapter architecture (data-plane connectors: Snowflake, Databricks,
BigQuery, DuckDB-Wasm, SQLite-HTTP, generic SQL; meta-plane: Turso/Supabase/Firebase/
local) is the suite's reporting engine. Cross-suite dashboards read fleet data
(changelogs, runs, health) once it mirrors into the main backend. Analytics migrates to
the shell LAST and its conventions are canonized, not disturbed.

## UI modes & administration

`lib/settings.js` defines `uiMode: 'simple' | 'standard' | 'expert'`. Rail sections and
settings fields declare `minMode` (and `admin`). Simple mode trims chrome; expert
reveals power tools. Per-user server-controlled feature grants arrive with Supabase.

## Hosting & privacy

- Public apps: GitHub Pages + GoDaddy CNAME (see DOMAINS.md).
- Protected apps: put **Cloudflare Access** in front of the Pages origin (free, real
  auth wall) — private-repo Pages requires a paid GitHub plan. The in-app ECDSA
  `access.js` gate is UX-level gating, not a security boundary; docs say so plainly.

## Mobile & native

Mobile web is first-class (390×780 smoke gate). Native path when wanted: the apps are
already PWAs (manifest + network-first SW); package with Capacitor per-app, starting
with the launcher. Tracked in ROADMAP.md.
