# polecat-platform — agent guide

The hub repo for the Polecat suite: Polecat Shell (`lib/`), the polecat.live launcher
(`site/`), and fleet standards (`docs/`). Read `docs/PLATFORM.md` first.

## House rules (distilled from the fleet's best playbooks)

- **Static-first, no build step.** Plain HTML + ES modules + CSS. No bundlers, no
  frameworks, no runtime deps. Vendored code only.
- **lib/ is the fleet's shared surface.** Every change here lands in 8 apps. Keep APIs
  stable; additive over breaking; `storageKey` params, never hardcoded keys. Bump
  `lib/VERSION` + run `node scripts/gen-manifest.mjs` in the same commit as any lib
  change. Apps receive changes ONLY via sync-shell PRs.
- **The changelog contract is sacred** (SHELL-API.md § contract): fleet-format
  `js/changelog.js`, literal style, empty `ts` stamped by CI, ISO-UTC stored / Central
  displayed. Manager + launcher parse it live.
- **Smoke before push**: `node scripts/smoke-test.mjs` — Playwright, 390×780 AND
  1280×800, zero pageerrors, against `lib/demo/index.html` (all palettes) and
  `site/index.html` (including ingest-failure degradation). Advisory in CI; never gate
  deploy on it (auto-revert heals main instead).
- **Design bar**: single-color currentColor icons; both themes always; joyful, elegant,
  modern — delight is a requirement, not decoration. Dashboard tiles/KPIs always link
  to their detail. Mobile is a release gate.
- **Docs move with code**: changes to lib APIs update SHELL-API.md in the same commit;
  user-visible site changes ship a `site/js/changelog.js` entry (empty ts).
- **One unit of high-quality work per run.** Ask via AskUserQuestion when direction is
  ambiguous. Do not use the word "saga" in user-facing text (fleet convention).

## Layout

`lib/` shared modules (see SHELL-API.md) · `lib/demo/` kitchen sink + smoke target ·
`site/` launcher (marketing + app grid + auth stub) · `scripts/` gen-manifest,
smoke-test · `docs/` standards · `.github/workflows/` deploy, ci, auto-revert,
sync-shell.
