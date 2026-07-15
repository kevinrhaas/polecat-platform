# Fleet Guide — how to work on a Polecat app now

*The one-page onboarding for any session or agent working on a fleet app.
Read this first; it links to everything else.*

## The three rules that changed

1. **Never push to main — but finishing MEANS merging.** Work on a
   `steward/<topic>` branch → open a PR → run your app's smoke gate → **merge
   your own PR when it's green**. That last step is required, not optional:
   Kevin does not manually merge automation output. **Merge is ship** — every
   repo's `deploy.yml` publishes on merge, and Guard-main auto-revert is the
   backstop. A janitor workflow also sweeps every 2h and merges any green
   `steward/*` / `chore/polecat-shell-*` PR that got left behind, so a green
   PR ships either way. Genuinely risky or architectural work is the ONE
   exception: leave the PR open **with the `hold` label** (the janitor never
   touches `hold` or draft PRs) and explain what Kevin should look at.
2. **`vendor/polecat-shell/` is read-only.** It's the shared UI library,
   vendored from this repo with sha256 manifests (sweeps detect edits). Shell
   changes go to `polecat-platform/lib/` (+ VERSION bump + gen-manifest) and
   return via `chore: polecat-shell vX.Y.Z` PRs. App skinning lives in your
   own CSS ([SHELL-API.md](SHELL-API.md) — includes your app's migration
   checklist and the changelog contract).
3. **Stamp your own changelog timestamps.** Ship a fleet-format
   `js/changelog.js` entry in the same commit and run your repo's stamp tool
   before merging (games `tools/stamp-changelog.mjs`; jobtracker/relay/
   autoselector `.github/stamp-changelog.mjs`; analytics
   `tools/changelog-normalize.js`; polecat-app its generator). Nothing stamps
   after merge anymore. Manager and the polecat.live launcher parse this file
   live — never break it.

## What builds what

- **Your playbook still rules content**: ROADMAP.md / BUILD_LOOP.md /
  STATUS.md say *what* to build; this guide says *how* it ships.
- **Scheduled work** runs from this repo's steward workflows
  ([AUTOMATION.md](AUTOMATION.md)): an improve loop, per-app hourly focus
  slots (`.github/steward/focus.json` — flip `enabled` to give your app a
  recurring lane), daily UX + tech sweeps that file findings issues in your
  repo (fixing one is a first-class unit of work), and on-demand shell
  releases. Different apps run in parallel lanes; expect steward PRs and
  sweep issues to appear in your repo.
- **Interactive sessions** (you) work whenever, same rules. Check for open
  `steward/*` PRs and sweep issues before starting so you don't collide or
  duplicate.

## Quality bar (release gates, per SHELL-API.md § Shell standards)

Smoke at 390×780 AND desktop with zero pageerrors before any merge · both
themes always · dashboard tiles/KPI numbers link to their detail · bump your
sw.js cache name when precached files change · one coherent unit of work per
run · no model identifiers in repo artifacts.

## The map

polecat.live = suite launcher (this repo's `site/`) · your app keeps its
`<name>.polecat.live` Pages deploy · migration order and your app's turn:
[MIGRATION.md](MIGRATION.md) · domains/renames (chat rename is GATED on
Kevin's written go): [DOMAINS.md](DOMAINS.md) · architecture:
[PLATFORM.md](PLATFORM.md).
